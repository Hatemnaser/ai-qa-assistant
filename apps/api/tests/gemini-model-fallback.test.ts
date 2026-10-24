import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "node:test";

const primary = "gemini-3.1-flash-lite";
const missing = `models/${primary} is not found for API version v1beta, or is not supported for generateContent.`;
const cases = [
  { name: "Auto uses the compatible fallback for a model-specific NOT_FOUND", selection: "auto", status: 404, message: missing, code: "NOT_FOUND", fallback: true },
  { name: "explicit selection does not switch on model-specific NOT_FOUND", selection: primary, status: 404, message: missing, code: "NOT_FOUND", expectedError: "MODEL_UNAVAILABLE" },
  { name: "Auto stops for generic NOT_FOUND", selection: "auto", status: 404, message: "File is not found", code: "NOT_FOUND", expectedError: "AI_PROVIDER_REQUEST_REJECTED" },
  { name: "Auto stops for a different missing model", selection: "auto", status: 404, message: "models/other-model is not found", code: "NOT_FOUND", expectedError: "AI_PROVIDER_REQUEST_REJECTED" },
  { name: "Auto stops for permission errors", selection: "auto", status: 403, message: missing, code: "PERMISSION_DENIED", expectedError: "AI_PROVIDER_AUTH_ERROR" },
  { name: "Auto stops for invalid input", selection: "auto", status: 400, message: missing, code: "INVALID_ARGUMENT", expectedError: "AI_PROVIDER_REQUEST_REJECTED" },
] as const;

describe("Gemini SDK model-availability boundary", () => {
  for (const scenario of cases) it(scenario.name, async () => {
    const program = `
      import assert from 'node:assert/strict';
      const scenario=${JSON.stringify(scenario)},calls=[];
      globalThis.fetch=async url=>{
        const model=decodeURIComponent(String(url).match(/\\/models\\/([^:]+):generateContent/)?.[1]||'');
        assert.ok(model,'Unexpected SDK request');calls.push(model);
        if(calls.length===1)return Response.json({error:{code:scenario.status,status:scenario.code,message:scenario.message}},{status:scenario.status});
        return Response.json({candidates:[{content:{role:'model',parts:[{text:'Offline reply'}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:6,totalTokenCount:18}});
      };
      const {createChatService}=await import(${JSON.stringify(new URL("../src/modules/chat/chat.service.ts", import.meta.url).href)});
      const {chatWithAi}=await import(${JSON.stringify(new URL("../src/modules/ai/provider-registry.ts", import.meta.url).href)});
      let completed;
      const service=createChatService({chatWithAi,reserveUsage:async()=>({unit:'credits',limit:100,used:1,remaining:99,reserved:1}),
        completeUsage:async(reservation,value)=>{completed=value;return reservation;}});
      const input={message:'Review login',mode:'general',history:[],model:scenario.selection};
      if(scenario.fallback){
        const response=await service.createChatReply(input);
        assert.deepEqual(calls,['${primary}','gemini-2.5-flash-lite']);
        assert.equal(response.model,'gemini-2.5-flash-lite');assert.equal(response.modelRouting.requestedModel,'auto');
        assert.equal(completed.model,response.model);assert.equal(completed.totalTokens,18);
      }else{
        await assert.rejects(()=>service.createChatReply(input),{code:scenario.expectedError});assert.deepEqual(calls,['${primary}']);
      }
    `;
    // Isolate frozen env and the real SDK's transport from every other test.
    await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", program], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { ...process.env, NODE_ENV: "test", GEMINI_API_KEY: "offline-test-only", AI_WORKFLOW_ROUTER_ENABLED: "false", AI_MODEL_ROUTER_ENABLED: "true", AI_GENERAL_MODEL: primary, AI_FALLBACK_MODEL: "gemini-2.5-flash-lite" },
      timeout: 15_000, maxBuffer: 1024 * 1024,
    });
  });
});
