import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { getUsageStatusTranslationKey } from "../src/features/usage/usageStatus.ts";
import { messages } from "../src/i18n/messages/index.ts";

const CHAT_BOUNDARY_KEYS = [
  "chat.attachments.limit",
  "chat.attachments.imageTooLarge",
  "chat.attachments.fileTooLarge",
  "chat.attachments.futureType",
  "chat.attachments.unsupportedType",
  "chat.attachments.openFailed",
  "chat.attachments.uploadedMany",
  "chat.attachments.uploadedImage",
  "chat.attachments.uploadedFile",
  "chat.export.noActive",
  "chat.import.jsonOnly",
  "chat.import.failed",
  "chat.import.defaultTitle",
  "chat.import.defaultAttachmentName",
] as const;

describe("web i18n boundaries", () => {
  it("keeps attachment-only chat content and attachment errors in the locale catalog", async () => {
    const [attachmentPolicy, attachmentComposable] = await Promise.all([
      readSource("src/features/chat/chatAttachments.ts"),
      readSource("src/features/chat/composables/useChatAttachments.ts"),
    ]);

    assert.doesNotMatch(attachmentPolicy, /Please upload|next version|too large/i);
    assert.doesNotMatch(attachmentComposable, /Uploaded an image|Uploaded an attachment|attachments per message/i);
    assert.match(attachmentComposable, /t\("chat\.attachments\.uploadedImage"\)/);
    assert.match(attachmentComposable, /t\("chat\.attachments\.uploadedFile"\)/);

    for (const [locale, catalog] of Object.entries(messages)) {
      for (const key of CHAT_BOUNDARY_KEYS) {
        assert.ok(catalog[key].trim(), `${locale}.${key} must not be empty`);
      }
    }
  });

  it("keeps chat export/import alerts at the translation boundary", async () => {
    const source = await readSource("src/features/chat/composables/useChatExportImport.ts");

    assert.doesNotMatch(source, /There is no active chat|Please choose a JSON|Could not import|Copy failed/);
    assert.match(source, /t\("chat\.export\.noActive"\)/);
    assert.match(source, /t\("chat\.import\.failed"\)/);
    assert.match(source, /t\("chat\.messages\.copyFailed"\)/);
  });

  it("maps raw usage statuses to complete locale keys", () => {
    assert.equal(getUsageStatusTranslationKey("completed"), "usage.status.completed");
    assert.equal(getUsageStatusTranslationKey("FAILED"), "usage.status.failed");
    assert.equal(getUsageStatusTranslationKey("reserved"), "usage.status.reserved");
    assert.equal(getUsageStatusTranslationKey("future_status"), "usage.status.unknown");

    for (const [locale, catalog] of Object.entries(messages)) {
      for (const status of ["completed", "failed", "reserved", "unknown"] as const) {
        const key = `usage.status.${status}` as const;
        assert.ok(catalog[key].trim(), `${locale}.${key} must not be empty`);
      }
    }
  });

  it("keeps memory and settings adapter fallbacks as stable data until the page boundary", async () => {
    const [memoryApi, settingsApi, settingsPage] = await Promise.all([
      readSource("src/features/memory/memoryApi.ts"),
      readSource("src/features/settings/settingsApi.ts"),
      readSource("src/features/settings/SettingsPage.vue"),
    ]);

    for (const adapter of [memoryApi, settingsApi]) {
      assert.doesNotMatch(adapter, /Could not (?:connect|load)|Make sure the API server|response was missing/i);
      assert.match(adapter, /new ApiAdapterError\("(?:INVALID_RESPONSE|NETWORK_UNAVAILABLE|REQUEST_FAILED)"/);
    }

    assert.match(settingsPage, /error instanceof ApiAdapterError/);
    assert.match(settingsPage, /return t\(fallbackKey\)/);
  });
});

function readSource(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
