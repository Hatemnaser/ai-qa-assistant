import {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../src/generated/prisma/enums.ts";
import { createProjectExportPackage } from "../../src/modules/data-portability/export-package.ts";
import type { ProjectExportSourceRecord } from "../../src/modules/data-portability/data-portability.types.ts";

export const PROJECT_EXPORT_TEST_DATE = new Date("2026-06-24T12:00:00.000Z");

export function createTestProjectExportArchive() {
  return createProjectExportPackage(
    createProjectExportSource(),
    {
      includeChats: true,
    },
    PROJECT_EXPORT_TEST_DATE
  ).archive;
}

export function createProjectExportSource(): ProjectExportSourceRecord {
  return {
    id: "project-1",
    name: "Checkout QA",
    description: "Checkout and payment quality workspace.",
    createdAt: new Date("2026-06-18T10:00:00.000Z"),
    updatedAt: new Date("2026-06-23T10:00:00.000Z"),
    instruction: {
      content: "Answer as a senior QA engineer.",
      createdAt: new Date("2026-06-18T11:00:00.000Z"),
      updatedAt: new Date("2026-06-19T11:00:00.000Z"),
    },
    projectMemory: {
      content: "Guest checkout is disabled.",
      source: MemorySource.USER_PROVIDED,
      createdAt: new Date("2026-06-18T12:00:00.000Z"),
      updatedAt: new Date("2026-06-19T12:00:00.000Z"),
    },
    documents: [
      {
        id: "document-1",
        title: "requirements.json",
        content: '{"guestCheckout":false}\n',
        source: ProjectDocumentSource.IMPORTED,
        mimeType: "application/json",
        metadata: {
          originalName: "requirements.json",
          sizeBytes: 24,
        },
        createdAt: new Date("2026-06-20T10:00:00.000Z"),
        updatedAt: new Date("2026-06-21T10:00:00.000Z"),
      },
    ],
    chats: [
      {
        id: "chat-1",
        title: "Checkout review",
        mode: "general",
        model: "gemini-3.1-flash-lite",
        createdAt: new Date("2026-06-22T10:00:00.000Z"),
        updatedAt: new Date("2026-06-22T11:00:00.000Z"),
        messages: [
          {
            id: "message-1",
            role: ChatRole.USER,
            content: "Please review the checkout requirements.",
            mode: "general",
            model: "gemini-3.1-flash-lite",
            attachment: [
              {
                type: "image",
                name: "checkout.png",
                mimeType: "image/png",
                previewUrl: "data:image/png;base64,not-exported",
              },
            ],
            metadata: null,
            createdAt: new Date("2026-06-22T10:00:00.000Z"),
          },
          {
            id: "message-2",
            role: ChatRole.ASSISTANT,
            content: "The checkout flow needs guest and card validation coverage.",
            mode: "general",
            model: "gemini-3.1-flash-lite",
            attachment: null,
            metadata: null,
            createdAt: new Date("2026-06-22T10:01:00.000Z"),
          },
        ],
      },
    ],
  };
}
