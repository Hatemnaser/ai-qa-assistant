import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AccountImportCommitResult,
  AccountImportPreview,
} from "../src/features/data-portability/accountDataPortabilityApi.ts";
import { useAccountImportFlow } from "../src/features/data-portability/accountImportFlow.ts";
import { messages } from "../src/i18n/messages/index.ts";

describe("account import flow", () => {
  it("blocks commit until auto-detection preview returns all counts", async () => {
    const flow = createFlow();

    assert.equal(flow.canCommit.value, false);
    flow.selectFile(createZipFile("account.zip"));
    await flow.previewSelectedFile();

    assert.equal(flow.canCommit.value, true);
    assert.equal(flow.preview.value?.importKind, "account_archive");
    assert.deepEqual(flow.preview.value?.counts, createCounts());
    assert.equal(flow.preview.value?.packageDigest, "a".repeat(64));
  });

  it("commits the exact previewed file with its digest and no provider selection", async () => {
    const file = createZipFile("account.zip");
    const calls: Array<{ file: File; digest: string }> = [];
    const flow = useAccountImportFlow({
      async commit(receivedFile, digest) {
        calls.push({ file: receivedFile, digest });
        return createCommitResult();
      },
      async preview() {
        return createPreview();
      },
    });

    flow.selectFile(file);
    await flow.previewSelectedFile();
    const result = await flow.commitSelectedFile();

    assert.equal(result?.imported.projects, 2);
    assert.deepEqual(calls, [{ file, digest: "a".repeat(64) }]);
  });

  it("clears the old preview and digest when a different file is selected", async () => {
    const flow = createFlow();

    flow.selectFile(createZipFile("first.zip"));
    await flow.previewSelectedFile();
    assert.equal(flow.canCommit.value, true);

    flow.selectFile(createZipFile("second.zip"));
    assert.equal(flow.preview.value, null);
    assert.equal(flow.canCommit.value, false);
  });

  it("keeps safe preview errors visible and commit blocked", async () => {
    const flow = useAccountImportFlow({
      async commit() {
        throw new Error("Commit must remain blocked.");
      },
      async preview() {
        throw new Error("Account import file is invalid or unsupported.");
      },
    });

    flow.selectFile(createZipFile("invalid.zip"));
    await flow.previewSelectedFile();

    assert.equal(
      flow.errorMessage.value,
      "Account import file is invalid or unsupported."
    );
    assert.equal(flow.canCommit.value, false);
    assert.equal(await flow.commitSelectedFile(), null);
  });

  it("keeps generic account import translations aligned in every locale", () => {
    const keys = [
      "portability.title",
      "portability.export.action",
      "portability.import.action",
      "portability.import.autoDetectNote",
      "portability.import.projects",
      "portability.import.accountMemories",
      "portability.import.preview",
      "portability.import.commit",
      "portability.import.success",
    ] as const;

    for (const locale of ["en", "ar", "de"] as const) {
      for (const key of keys) {
        assert.ok(messages[locale][key], `${locale}.${key} must exist`);
      }
    }
  });
});

function createFlow() {
  return useAccountImportFlow({
    async commit() {
      return createCommitResult();
    },
    async preview() {
      return createPreview();
    },
  });
}

function createPreview(): AccountImportPreview {
  return {
    compatible: true,
    importKind: "account_archive",
    packageDigest: "a".repeat(64),
    counts: createCounts(),
    warnings: ["Existing sign-in data will not be replaced."],
  };
}

function createCommitResult(): AccountImportCommitResult {
  return {
    importKind: "account_archive",
    imported: createCounts(),
    skipped: { accountMemories: 1 },
    warnings: [],
  };
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

function createZipFile(name: string) {
  return new File(["account-export"], name, {
    type: "application/zip",
  });
}
