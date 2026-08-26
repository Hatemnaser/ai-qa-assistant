import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import type { ReadReadyAsset } from "../src/modules/assets/assets-consumption.service.ts";
import type { AssetRecord } from "../src/modules/assets/assets.types.ts";
import { createChatService } from "../src/modules/chat/chat.service.ts";

const NOW = new Date("2026-08-12T12:00:00.000Z");

describe("chat stored attachments", () => {
  it("loads exact owner-scoped stored image and text bytes for the provider", async () => {
    const reads: Array<Record<string, unknown>> = [];
    const order: string[] = [];
    const service = createChatService({
      async chatWithAi(input) {
        assert.deepEqual(input.images, [{ data: "AQID", mimeType: "image/png" }]);
        assert.deepEqual(input.attachments, [{
          type: "file",
          name: "requirements.md",
          mimeType: "text/markdown",
          content: "# Requirements",
        }]);
        return { reply: "reviewed", model: input.model!, provider: "gemini" };
      },
      async getStoredAttachment(input) {
        return input.assetId === "image-1"
          ? readAsset("image-1", "screen.png", "image/png", Uint8Array.from([1, 2, 3])).asset
          : readAsset(
              "text-1",
              "requirements.md",
              "text/markdown",
              new TextEncoder().encode("# Requirements")
            ).asset;
      },
      async readStoredAttachment(input) {
        order.push("read");
        reads.push(input);
        return input.assetId === "image-1"
          ? readAsset("image-1", "screen.png", "image/png", Uint8Array.from([1, 2, 3]))
          : readAsset(
              "text-1",
              "requirements.md",
              "text/markdown",
              new TextEncoder().encode("# Requirements")
            );
      },
      async reserveUsage() {
        order.push("usage");
        return undefined;
      },
    });

    await service.createChatReply(
      {
        attachments: [{ assetId: "image-1" }, { assetId: "text-1" }],
        history: [],
        message: "Review these",
        mode: "general",
        model: "gemini-2.5-flash",
        projectId: "project-1",
      },
      { userId: "user-1" }
    );

    assert.deepEqual(reads, [
      {
        assetId: "image-1",
        ownerId: "user-1",
        projectId: "project-1",
        purpose: "CHAT_ATTACHMENT",
      },
      {
        assetId: "text-1",
        ownerId: "user-1",
        projectId: "project-1",
        purpose: "CHAT_ATTACHMENT",
      },
    ]);
    assert.deepEqual(order, ["usage", "read", "read"]);
  });

  it("rejects stored references from guests before usage or provider work", async () => {
    const calls: string[] = [];
    const service = createChatService({
      async chatWithAi() {
        calls.push("ai");
        return { reply: "no", model: "gemini-2.5-flash", provider: "gemini" };
      },
      async getStoredAttachment() {
        calls.push("metadata");
        return readAsset("asset-1", "notes.txt", "text/plain", new TextEncoder().encode("notes")).asset;
      },
      async readStoredAttachment() {
        calls.push("storage");
        return readAsset("asset-1", "notes.txt", "text/plain", new TextEncoder().encode("notes"));
      },
      async reserveUsage() {
        calls.push("usage");
        return undefined;
      },
    });

    await assert.rejects(
      () => service.createChatReply({
        attachments: [{ assetId: "asset-1" }],
        history: [],
        message: "Read this",
        mode: "general",
      }, { guestId: "guest-1" }),
      (error: unknown) => hasCode(error, "AUTH_REQUIRED")
    );
    assert.deepEqual(calls, []);
  });

  it("does not convert an inaccessible stored asset into a provider request", async () => {
    let aiCalled = false;
    const service = createChatService({
      async chatWithAi() {
        aiCalled = true;
        return { reply: "no", model: "gemini-2.5-flash", provider: "gemini" };
      },
      async getStoredAttachment() {
        throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
      },
    });

    await assert.rejects(
      () => service.createChatReply({
        attachments: [{ assetId: "foreign-asset" }],
        history: [],
        message: "Read this",
        mode: "general",
      }, { userId: "user-1" }),
      (error: unknown) => hasCode(error, "ASSET_NOT_FOUND")
    );
    assert.equal(aiCalled, false);
  });

  it("does not read R2 bytes when the usage guard rejects the request", async () => {
    let bytesRead = false;
    const service = createChatService({
      async chatWithAi() {
        throw new Error("not reached");
      },
      async getStoredAttachment() {
        return readAsset(
          "asset-1",
          "notes.txt",
          "text/plain",
          new TextEncoder().encode("notes")
        ).asset;
      },
      async readStoredAttachment() {
        bytesRead = true;
        return readAsset(
          "asset-1",
          "notes.txt",
          "text/plain",
          new TextEncoder().encode("notes")
        );
      },
      async reserveUsage() {
        throw new AppError("Limit reached.", 429, "USAGE_LIMIT_REACHED");
      },
    });

    await assert.rejects(
      () => service.createChatReply({
        attachments: [{ assetId: "asset-1" }],
        history: [],
        message: "Read this",
        mode: "general",
      }, { userId: "user-1" }),
      (error: unknown) => hasCode(error, "USAGE_LIMIT_REACHED")
    );
    assert.equal(bytesRead, false);
  });
});

function readAsset(
  id: string,
  originalName: string,
  detectedMimeType: string,
  bytes: Uint8Array
): ReadReadyAsset {
  return {
    asset: {
      checksumSha256: "checksum",
      createdAt: NOW,
      declaredMimeType: detectedMimeType,
      detectedMimeType,
      etag: "etag",
      expectedSizeBytes: bytes.byteLength,
      id,
      objectKey: `chat-attachments/${id}`,
      originalName,
      ownerId: "user-1",
      projectId: "project-1",
      purpose: "CHAT_ATTACHMENT",
      readyAt: NOW,
      sizeBytes: bytes.byteLength,
      status: "READY",
      updatedAt: NOW,
      uploadExpiresAt: null,
      validationStartedAt: null,
    } satisfies AssetRecord as ReadReadyAsset["asset"],
    bytes,
  };
}

function hasCode(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
