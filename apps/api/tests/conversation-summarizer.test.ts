import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildSummaryPrompt } from "../src/modules/ai/summarization/gemini-conversation-summarizer.ts";

describe("conversation summarizer prompt", () => {
  it("uses only existing derived state and persisted complete turns", () => {
    const prompt = buildSummaryPrompt({
      existingOpenQuestions: ["Which browsers are required?"],
      existingSummary: "The user is planning checkout coverage.",
      turns: [
        {
          assistant: "We agreed to cover card and wallet payments.",
          assistantMessageId: "assistant-2",
          user: "Include wallet payments too.",
          userMessageId: "user-2",
        },
      ],
    });

    assert.match(prompt, /"existingSummary":/);
    assert.match(prompt, /Which browsers are required\?/);
    assert.match(prompt, /Include wallet payments too\./);
    assert.match(prompt, /persisted complete turns/);
    assert.match(prompt, /Do not add Project Documents, Project Memory/);
    assert.match(prompt, /untrusted conversation content/);
    assert.match(prompt, /CONVERSATION_DATA:/);
  });
});

describe("conversation summarizer usage on invalid output", () => {
  it("preserves actual SDK metadata and normalized errors without another provider call", async () => {
    const program = `
      import assert from 'node:assert/strict';
      const metadata={promptTokenCount:1000,candidatesTokenCount:1000,totalTokenCount:2000};
      const expected={inputTokens:1000,outputTokens:1000,totalTokens:2000};
      let text='',usageMetadata=metadata,calls=0;
      globalThis.fetch=async url=>{
        assert.match(String(url),/generativelanguage.googleapis.com/);
        calls++;
        return Response.json({candidates:[{content:{role:'model',parts:[{text}]}}],usageMetadata});
      };
      const {geminiConversationSummarizer:summarizer}=await import(${JSON.stringify(new URL("../src/modules/ai/summarization/gemini-conversation-summarizer.ts", import.meta.url).href)});
      const input={existingOpenQuestions:[],turns:[]};
      for(const [output,code] of [['','SUMMARY_RESPONSE_INVALID'],['not valid JSON','SUMMARY_RESPONSE_INVALID'],['{"summary":""}','AI_PROVIDER_ERROR']]){
        text=output;const before=calls;
        await assert.rejects(summarizer.generate(input),error=>{
          assert.equal(error.code,code);assert.equal(error.statusCode,502);
          assert.deepEqual(error.usage,expected);
          return true;
        });
        assert.equal(calls,before+1,'Output validation must not replay generation');
      }
      text='{"summary":"Valid summary","openQuestions":[]}';
      assert.deepEqual((await summarizer.generate(input)).usage,expected);
    `;

    await runOfflineSummarizer(program);
  });

  it("keeps missing, empty, and invalid token evidence unconfirmed", async () => {
    const program = `
      import assert from 'node:assert/strict';
      let usageMetadata,calls=0;
      globalThis.fetch=async()=>{
        calls++;
        return Response.json({candidates:[{content:{role:'model',parts:[{text:'invalid JSON'}]}}],usageMetadata});
      };
      const {geminiConversationSummarizer:summarizer}=await import(${JSON.stringify(new URL("../src/modules/ai/summarization/gemini-conversation-summarizer.ts", import.meta.url).href)});
      const invalid=[undefined,{}, {totalTokenCount:0}, {totalTokenCount:-1}, {totalTokenCount:1.5},
        {totalTokenCount:Number.MAX_SAFE_INTEGER+1}, {totalTokenCount:'2000'},
        {totalTokenCount:2000,promptTokenCount:-1}];
      for(usageMetadata of invalid){
        const before=calls;
        await assert.rejects(summarizer.generate({existingOpenQuestions:[],turns:[]}),error=>{
          assert.equal(error.code,'SUMMARY_RESPONSE_INVALID');assert.equal(error.usage,undefined);
          return true;
        });
        assert.equal(calls,before+1);
      }
    `;

    await runOfflineSummarizer(program);
  });

  it("preserves provider rejection semantics without confirming error-body token fields", async () => {
    const program = `
      import assert from 'node:assert/strict';
      let calls=0;
      globalThis.fetch=async()=>{
        calls++;
        return Response.json({error:{code:403,status:'PERMISSION_DENIED',message:'Private provider detail'},
          usageMetadata:{totalTokenCount:2000}},{status:403});
      };
      const {geminiConversationSummarizer:summarizer}=await import(${JSON.stringify(new URL("../src/modules/ai/summarization/gemini-conversation-summarizer.ts", import.meta.url).href)});
      await assert.rejects(summarizer.generate({existingOpenQuestions:[],turns:[]}),error=>{
        assert.equal(error.code,'AI_PROVIDER_AUTH_ERROR');assert.equal(error.statusCode,502);
        assert.equal(error.expose,false);assert.equal(error.usage,undefined);
        assert.doesNotMatch(error.message,/Private provider detail/);
        return true;
      });
      assert.equal(calls,1);
    `;

    await runOfflineSummarizer(program);
  });
});

async function runOfflineSummarizer(program: string) {
  // Isolate frozen env and the real Gemini SDK transport from other test files.
  await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", program],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: {
        ...process.env,
        NODE_ENV: "test",
        GEMINI_API_KEY: "offline-summary-test-only",
        AI_SUMMARY_MODEL: "gemini-3.1-flash-lite",
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    }
  );
}
