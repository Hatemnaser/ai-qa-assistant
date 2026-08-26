import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareChatAttachmentsForSubmit } from "../src/features/chat/chatAttachmentSubmission.ts";
import { BackendApiError } from "../src/api/backendErrors.ts";
import type { AssetDto } from "../src/features/assets/types.ts";
import type { SelectedAttachment } from "../src/features/chat/types.ts";

describe("chat attachment submission", () => {
  it("uses opaque asset references for authenticated users without leaking bytes or signed URLs", async () => {
    const selected = createSelected(new File(["private requirements"], "requirements.md", {
      type: "text/markdown",
    }));
    const prepared = await prepareChatAttachmentsForSubmit(
      [selected],
      { isAuthenticated: true, projectId: "project-1" },
      {
        async cancel() {},
        async upload(file, options) {
          assert.equal(file, selected.file);
          assert.deepEqual(options, {
            declaredMimeType: "text/markdown",
            projectId: "project-1",
            purpose: "CHAT_ATTACHMENT",
          });
          return { asset: createAsset(), checksumSha256: "checksum" };
        },
      }
    );

    assert.deepEqual(prepared.requestAttachments, [{ assetId: "asset-1" }]);
    assert.deepEqual(prepared.displayAttachments, [{
      assetId: "asset-1",
      mimeType: "text/markdown",
      name: "requirements.md",
      type: "file",
    }]);
    const serialized = JSON.stringify(prepared);
    assert.doesNotMatch(serialized, /private requirements|signed|blob:|data:/i);
  });

  it("keeps the legacy inline contract for guests", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "screen.png", { type: "image/png" });
    const prepared = await prepareChatAttachmentsForSubmit(
      [createSelected(file, "image")],
      { isAuthenticated: false },
      {
        async cancel() {},
        async upload() {
          throw new Error("guest upload must not use private storage");
        },
      }
    );

    assert.deepEqual(prepared.requestAttachments, [{
      data: "AQID",
      mimeType: "image/png",
      name: "screen.png",
      type: "image",
    }]);
    assert.equal(prepared.displayAttachments?.[0]?.previewUrl, "data:image/png;base64,AQID");
    assert.equal(prepared.displayAttachments?.[0]?.assetId, undefined);
  });

  it("cancels earlier completed assets when a later upload in the batch fails", async () => {
    const cancelled: string[] = [];
    let uploadCount = 0;

    await assert.rejects(
      () => prepareChatAttachmentsForSubmit(
        [
          createSelected(new File(["one"], "one.txt", { type: "text/plain" })),
          createSelected(new File(["two"], "two.txt", { type: "text/plain" })),
        ],
        { isAuthenticated: true },
        {
          async cancel(assetId) {
            cancelled.push(assetId);
          },
          async upload() {
            uploadCount += 1;
            if (uploadCount === 2) throw new Error("second upload failed");
            return { asset: createAsset(), checksumSha256: "checksum" };
          },
        }
      ),
      /second upload failed/
    );
    assert.deepEqual(cancelled, ["asset-1"]);
  });

  it("uses the legacy contract only when private storage is explicitly disabled", async () => {
    const prepared = await prepareChatAttachmentsForSubmit(
      [createSelected(new File(["hello"], "notes.txt", { type: "text/plain" }))],
      { isAuthenticated: true },
      {
        async cancel() {},
        async upload() {
          throw new BackendApiError("Private storage is disabled.", {
            code: "ASSET_STORAGE_DISABLED",
            status: 503,
          });
        },
      }
    );

    assert.deepEqual(prepared.requestAttachments, [{
      content: "hello",
      mimeType: "text/plain",
      name: "notes.txt",
      type: "file",
    }]);
  });
});

function createSelected(file: File, type: "file" | "image" = "file"): SelectedAttachment {
  return {
    file,
    mimeType: file.type,
    name: file.name,
    previewUrl: type === "image" ? "blob:local-only" : undefined,
    type,
  };
}

function createAsset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    createdAt: "2026-08-12T12:00:00.000Z",
    declaredMimeType: "text/markdown",
    detectedMimeType: "text/markdown",
    expectedSizeBytes: 20,
    id: "asset-1",
    originalName: "requirements.md",
    projectId: "project-1",
    purpose: "CHAT_ATTACHMENT",
    readyAt: "2026-08-12T12:00:01.000Z",
    sizeBytes: 20,
    status: "READY",
    ...overrides,
  };
}
