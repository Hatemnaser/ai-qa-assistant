import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  commitAccountImport,
  exportAccountDataZip,
  previewAccountImport,
} from "../src/features/data-portability/accountDataPortabilityApi.ts";
import { setLocale } from "../src/i18n/useI18n.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  resetCsrfTokenForTests();
  setLocale("en");
  globalThis.fetch = originalFetch;
});

describe("Account Data portability API", () => {
  it("downloads the full account ZIP from the owner-scoped endpoint", async () => {
    mockFetch(async (input, init) => {
      assert.equal(input, "/api/portability/account/export");
      assert.equal(init?.method, "GET");
      assert.equal(init?.credentials, "include");

      return zipResponse("account-data");
    });

    const archive = await exportAccountDataZip();

    assert.equal(archive.type, "application/zip");
    assert.equal(await archive.text(), "account-data");
  });

  it("previews the exact ZIP through the auto-detect account endpoint with CSRF", async () => {
    const file = createZipFile();

    mockFetch(async (input, init) => {
      assert.equal(
        input,
        "/api/portability/account/import/preview"
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.equal(init?.body, file);
      assert.equal(
        new Headers(init?.headers).get("content-type"),
        "application/zip"
      );

      return jsonResponse(createPreview());
    });

    const preview = await previewAccountImport(file);

    assert.equal(preview.importKind, "account_archive");
    assert.deepEqual(preview.counts, createCounts());
  });

  it("commits the same ZIP with only the preview digest identity", async () => {
    const file = createZipFile();

    mockFetch(async (input, init) => {
      const headers = new Headers(init?.headers);

      assert.equal(input, "/api/portability/account/import/commit");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, file);
      assert.equal(headers.get("content-type"), "application/zip");
      assert.equal(headers.get("x-import-source"), null);
      assert.equal(headers.get("x-package-digest"), "a".repeat(64));

      return jsonResponse({
        imported: createCounts(),
        importKind: "account_archive",
        skipped: { accountMemories: 1 },
        warnings: [],
      });
    });

    const result = await commitAccountImport(file, createPreview().packageDigest);

    assert.equal(result.imported.chats, 3);
    assert.equal(result.skipped.accountMemories, 1);
  });

  it("shows a localized explanation for project ZIPs", async () => {
    setLocale("ar");
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          code: "ACCOUNT_IMPORT_PROJECT_ARCHIVE_UNSUPPORTED",
          error: "Backend fallback must not be shown.",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 400,
        }
      )
    );

    await assert.rejects(
      () => previewAccountImport(createZipFile()),
      /هذا ملف تصدير مشروع/
    );
  });
});

function createPreview() {
  return {
    compatible: true as const,
    importKind: "account_archive" as const,
    packageDigest: "a".repeat(64),
    counts: createCounts(),
    warnings: ["Attachment files are not imported."],
  };
}

function createZipFile() {
  return new File(["account-export"], "account-export.zip", {
    type: "application/zip",
  });
}

function createCounts() {
  return {
    projects: 2,
    documents: 4,
    chats: 3,
    messages: 12,
    accountMemories: 5,
  };
}

function mockFetch(handler: typeof fetch) {
  globalThis.fetch = createCsrfAwareFetch(handler);
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function zipResponse(content: string) {
  return new Response(new Blob([content], { type: "application/zip" }), {
    headers: {
      "Content-Type": "application/zip",
    },
  });
}
