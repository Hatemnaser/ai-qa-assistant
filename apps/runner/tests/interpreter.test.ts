import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { RecipeItemV1 } from "@oddpath/qa-execution-contract";

import {
  executeRecipeItem,
  type SemanticBrowserSession,
} from "../src/interpreter.js";
import { testConfig } from "./fixtures.js";

const originalEmail = process.env.ODDPATH_TEST_EMAIL;
afterEach(() => {
  if (originalEmail === undefined) delete process.env.ODDPATH_TEST_EMAIL;
  else process.env.ODDPATH_TEST_EMAIL = originalEmail;
});

describe("RecipeV1 interpreter", () => {
  it("executes only declared semantic operations and resolves profile values locally", async () => {
    process.env.ODDPATH_TEST_EMAIL = "secret@example.test";
    const session = new FakeSession();
    const result = await executeRecipeItem({
      item: recipeItem(),
      profile: testConfig().profiles[0]!,
      session,
    });

    assert.equal(result.status, "PASS");
    assert.deepEqual(session.operations.map(({ operation }) => operation), ["navigate", "fill", "expect"]);
    assert.equal(session.operations[1]?.value, "secret@example.test");
    assert.equal(JSON.stringify(result).includes("secret@example.test"), false);
  });

  it("reports a failed observable expectation as FAIL without leaking the browser error", async () => {
    process.env.ODDPATH_TEST_EMAIL = "secret@example.test";
    const session = new FakeSession();
    session.failExpectation = true;
    const result = await executeRecipeItem({
      item: recipeItem(),
      profile: testConfig().profiles[0]!,
      session,
    });

    assert.equal(result.status, "FAIL");
    assert.equal(result.failedStepRef, "verify-order");
    assert.equal(JSON.stringify(result).includes("raw browser failure"), false);
  });

  it("blocks a semantic click that navigates outside the configured origin", async () => {
    const session = new FakeSession();
    session.escapeOnClick = true;
    const item: RecipeItemV1 = {
      checklistItemId: "item-1",
      steps: [
        { action: "navigate", path: "/checkout", ref: "open", waitUntil: "load" },
        {
          action: "click",
          locator: { by: "role", name: "Continue", role: "button" },
          ref: "continue",
        },
        {
          action: "expect",
          expectation: {
            kind: "visible",
            locator: { by: "role", name: "Done", role: "heading" },
          },
          ref: "done",
        },
      ],
    };
    const result = await executeRecipeItem({
      item,
      profile: testConfig().profiles[0]!,
      session,
    });

    assert.equal(result.status, "BLOCKED");
    assert.equal(result.failedStepRef, "continue");
    assert.equal(JSON.stringify(result).includes("attacker.test"), false);
  });
});

function recipeItem(): RecipeItemV1 {
  return {
    checklistItemId: "item-1",
    steps: [
      { action: "navigate", path: "/checkout", ref: "open-checkout", waitUntil: "domcontentloaded" },
      {
        action: "fill",
        locator: { by: "label", value: "Email" },
        ref: "fill-email",
        value: { key: "customer.email", source: "profile" },
      },
      {
        action: "expect",
        expectation: {
          kind: "visible",
          locator: { by: "role", name: "Place order", role: "button" },
        },
        ref: "verify-order",
      },
    ],
  };
}

class FakeSession implements SemanticBrowserSession {
  escapeOnClick = false;
  failExpectation = false;
  operations: Array<{ operation: string; value?: string }> = [];
  url = "about:blank";

  async check() { this.operations.push({ operation: "check" }); }
  async click() {
    this.operations.push({ operation: "click" });
    if (this.escapeOnClick) this.url = "https://attacker.test/escaped";
  }
  async close() {}
  currentUrl() { return this.url; }
  async expect() {
    this.operations.push({ operation: "expect" });
    if (this.failExpectation) throw new Error("raw browser failure with private state");
  }
  async fill(_locator: unknown, value: string) {
    this.operations.push({ operation: "fill", value });
  }
  async hover() { this.operations.push({ operation: "hover" }); }
  async navigate(url: string) {
    this.operations.push({ operation: "navigate" });
    this.url = url;
  }
  async press() { this.operations.push({ operation: "press" }); }
  async screenshot() { return new Uint8Array([1, 2, 3]); }
  async select(_locator: unknown, _option: unknown, value: string) {
    this.operations.push({ operation: "select", value });
  }
}
