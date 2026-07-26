import {
  ChatRole,
  MemorySource,
  ProjectDocumentSource,
} from "../../src/generated/prisma/enums.ts";
import type { AccountExportSourceRecord } from "../../src/modules/data-portability/account-data-portability.types.ts";

export const ACCOUNT_EXPORT_TEST_DATE = new Date("2026-07-03T12:00:00.000Z");

export function createAccountExportSource(
  overrides: Partial<AccountExportSourceRecord> = {}
): AccountExportSourceRecord {
  return {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    locale: "en",
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    settings: {
      language: "en",
      theme: "dark",
      defaultModel: "gemini-3.1-flash-lite",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:00:00.000Z"),
    },
    memories: [
      {
        id: "memory-1",
        content: "Prefer concise QA reports.",
        source: MemorySource.USER_PROVIDED,
        createdAt: new Date("2026-02-01T10:00:00.000Z"),
        updatedAt: new Date("2026-02-01T10:00:00.000Z"),
      },
    ],
    projects: [
      {
        id: "project-1",
        name: "Checkout QA",
        description: "Checkout regression coverage.",
        createdAt: new Date("2026-03-01T10:00:00.000Z"),
        updatedAt: new Date("2026-07-01T10:00:00.000Z"),
        instruction: {
          content: "Focus on payment safety.",
          createdAt: new Date("2026-03-01T10:00:00.000Z"),
          updatedAt: new Date("2026-03-01T10:00:00.000Z"),
        },
        projectMemory: {
          content: "Guest checkout is supported.",
          source: MemorySource.IMPORTED,
          createdAt: new Date("2026-03-02T10:00:00.000Z"),
          updatedAt: new Date("2026-03-02T10:00:00.000Z"),
        },
        documents: [
          {
            id: "document-1",
            title: "requirements.json",
            content: '{"checkout":true}',
            source: ProjectDocumentSource.IMPORTED,
            mimeType: "application/json",
            metadata: {
              originalName: "requirements.json",
              sizeBytes: 17,
            },
            createdAt: new Date("2026-03-03T10:00:00.000Z"),
            updatedAt: new Date("2026-03-03T10:00:00.000Z"),
          },
        ],
      },
    ],
    chats: [
      {
        id: "chat-1",
        projectId: "project-1",
        title: "Checkout test cases",
        mode: "test-cases",
        model: "gemini-3.1-flash-lite",
        createdAt: new Date("2026-04-01T10:00:00.000Z"),
        updatedAt: new Date("2026-04-01T10:05:00.000Z"),
        messages: [
          {
            id: "message-1",
            role: ChatRole.USER,
            content: "Create checkout test cases.",
            mode: "test-cases",
            model: null,
            attachment: [
              {
                type: "file",
                name: "requirements.json",
                mimeType: "application/json",
              },
            ],
            metadata: null,
            createdAt: new Date("2026-04-01T10:00:00.000Z"),
          },
          {
            id: "message-2",
            role: ChatRole.ASSISTANT,
            content: "Here are the test cases.",
            mode: "test-cases",
            model: "gemini-3.1-flash-lite",
            attachment: null,
            metadata: null,
            createdAt: new Date("2026-04-01T10:00:10.000Z"),
          },
        ],
      },
    ],
    ...overrides,
  };
}
