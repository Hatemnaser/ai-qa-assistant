import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as backendErrors from "../src/api/backendErrors";

const source = await readFile(new URL("../src/features/test-sessions/testSessionsApi.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
function client(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const modules: Record<string, unknown> = {
    "../../api/backendErrors": backendErrors,
    "../../api/csrf": { csrfFetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return response; } },
    "../../config/api": { API_BASE_URL: "https://api.example.invalid" },
    "../../i18n/useI18n": { t: (key: string) => key },
  };
  const api = {} as typeof import("../src/features/test-sessions/testSessionsApi");
  new Function("require", "exports", compiled)((id: string) => {
    assert.ok(id in modules, `Unexpected API dependency ${id}`);
    return modules[id];
  }, api);
  return { api, calls };
}

describe("Test sessions API HTTP contracts", () => {
  it("activates an existing Chat only through the scoped explicit conversion endpoint", async () => {
    const { api, calls } = client(Response.json({ session: { id: "chat-existing" } }));
    const input = { chatId: "chat-existing", expectedUpdatedAt: "2026-09-28T12:00:00.000Z", expectedMessageCount: 3 };
    assert.equal((await api.activateTestSession("project/one", input)).id, "chat-existing");
    assert.deepEqual(calls, [{
      url: "https://api.example.invalid/api/projects/project%2Fone/test-sessions/activate",
      init: { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    }]);
  });

  it("accepts the delete route's real empty 204 response and preserves scope/version/CSRF transport", async () => {
    const { api, calls } = client(new Response(null, { status: 204 }));
    assert.equal(await api.deleteTestSession("project/one", "session?one", 7), undefined);
    assert.deepEqual(calls, [{
      url: "https://api.example.invalid/api/projects/project%2Fone/test-sessions/session%3Fone",
      init: { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedSessionVersion: 7 }) },
    }]);
  });

  it("retains structured backend conflicts instead of treating failed deletion as success", async () => {
    const { api } = client(Response.json({ code: "TEST_SESSION_HAS_RECORDS", message: "Archive this Test instead." }, { status: 409 }));
    await assert.rejects(api.deleteTestSession("p1", "s1", 2), (failure: unknown) => {
      assert.ok(failure instanceof backendErrors.BackendApiError);
      assert.equal(failure.code, "TEST_SESSION_HAS_RECORDS");
      assert.equal(failure.status, 409);
      return true;
    });
  });

  it("rejects an unexpected empty detail response with the localized response error", async () => {
    const { api } = client(new Response(null, { status: 204 }));
    await assert.rejects(api.fetchTestSession("p1", "s1"), /testSessions.errors.response/);
  });
});
