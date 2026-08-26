import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import { deleteCurrentAccount } from "../src/features/account/accountApi.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("account API", () => {
  it("deletes the current account with credentials and password confirmation", async () => {
    globalThis.fetch = createCsrfAwareFetch(async (input, init) => {
      assert.equal(input, "/api/account");
      assert.equal(init?.method, "DELETE");
      assert.equal(init?.credentials, "include");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        currentPassword: "correct password",
      });

      return jsonResponse({ ok: true });
    });

    assert.deepEqual(await deleteCurrentAccount("correct password"), { ok: true });
  });

  it("surfaces a safe backend password-confirmation error", async () => {
    globalThis.fetch = createCsrfAwareFetch(async () =>
      jsonResponse(
        {
          code: "CURRENT_PASSWORD_INVALID",
          error: "Current password is incorrect.",
        },
        403
      )
    );

    await assert.rejects(() => deleteCurrentAccount("wrong password"), /Current password is incorrect/);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
