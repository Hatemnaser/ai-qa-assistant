import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { strFromU8, unzipSync } from "fflate";

import { createDataPortabilityService } from "../src/modules/data-portability/data-portability.service.ts";
import type { DataPortabilityRepository } from "../src/modules/data-portability/data-portability.repository.ts";
import type {
  ProjectExportSourceRecord,
} from "../src/modules/data-portability/data-portability.types.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";
import {
  createProjectExportSource,
  PROJECT_EXPORT_TEST_DATE,
} from "./helpers/projectExportPackage.ts";

const EXPORTED_AT = PROJECT_EXPORT_TEST_DATE;

describe("data portability project export", () => {
  it("exports an owned project as a portable ZIP", async () => {
    const { repository, service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: true,
    });
    const entries = unzipSync(result.archive);

    assert.equal(repository.lastIncludeChats, true);
    assert.equal(result.downloadFilename, "checkout-qa-export.zip");
    assert.ok(entries["manifest.json"]);
    assert.ok(entries["data/project.json"]);
    assert.ok(entries["data/chats/chat-001.json"]);
    assert.ok(entries["documents/001-requirements.json"]);
    assert.ok(entries["readable/project.md"]);
    assert.ok(entries["readable/chats/chat-001.md"]);
    assert.ok(entries["readable/instructions.md"]);
    assert.ok(entries["readable/memory.md"]);
  });

  it("rejects a foreign project with the safe project not-found error", async () => {
    const { service } = createTestService({
      projectOwners: new Map([["project-1", "user-2"]]),
    });

    await assert.rejects(
      service.exportOwnedProject("user-1", "project-1", {
        includeChats: true,
      }),
      (error: unknown) =>
        isErrorWithCode(error, "PROJECT_NOT_FOUND") &&
        (error as { statusCode?: unknown }).statusCode === 404
    );
  });

  it("rejects a missing project with the same safe project not-found error", async () => {
    const { service } = createTestService({
      projectOwners: new Map(),
    });

    await assert.rejects(
      service.exportOwnedProject("user-1", "missing-project", {
        includeChats: true,
      }),
      (error: unknown) =>
        isErrorWithCode(error, "PROJECT_NOT_FOUND") &&
        (error as { statusCode?: unknown }).statusCode === 404
    );
  });

  it("writes format and export metadata to manifest.json", async () => {
    const { service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: true,
    });
    const manifest = readZipJson(result.archive, "manifest.json");

    assert.equal(manifest.formatVersion, "1.0");
    assert.equal(manifest.exportType, "project");
    assert.equal(manifest.exportedAt, EXPORTED_AT.toISOString());
    assert.equal(manifest.projectId, "project-1");
    assert.equal(manifest.projectName, "Checkout QA");
    assert.deepEqual(manifest.include, {
      chats: true,
      documents: true,
      readable: true,
    });
    assert.deepEqual(manifest.counts, {
      chats: 1,
      documents: 1,
      messages: 2,
    });
    assert.ok(Array.isArray(manifest.files));
    assert.ok(
      (manifest.files as Array<{ path?: string }>).some(
        (file) => file.path === "data/project.json"
      )
    );
  });

  it("keeps project.json canonical and excludes derived state", async () => {
    const { service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: true,
    });
    const projectJson = readZipJson(result.archive, "data/project.json");
    const serialized = JSON.stringify(projectJson);

    assert.equal(projectJson.formatVersion, "1.0");
    assert.equal(projectJson.exportType, "project");
    assert.equal((projectJson.project as { sourceId?: string }).sourceId, "project-1");
    assert.doesNotMatch(serialized, /conversationSummary/i);
    assert.doesNotMatch(serialized, /embedding/i);
    assert.doesNotMatch(serialized, /indexStatus/i);
    assert.doesNotMatch(serialized, /chunkingVersion/i);
    assert.doesNotMatch(serialized, /contentHash/i);
    assert.doesNotMatch(serialized, /usageEvent/i);
    assert.doesNotMatch(serialized, /session/i);
    assert.doesNotMatch(serialized, /passwordHash/i);
    assert.doesNotMatch(serialized, /resetToken/i);
    assert.doesNotMatch(serialized, /verificationToken/i);
    assert.doesNotMatch(serialized, /providerKey/i);
    assert.doesNotMatch(serialized, /serverConfig/i);
    assert.doesNotMatch(serialized, /billingSecret/i);
  });

  it("includes project chats and messages when includeChats is true", async () => {
    const { service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: true,
    });
    const entries = unzipSync(result.archive);
    const chatJson = readZipJson(result.archive, "data/chats/chat-001.json");
    const chat = chatJson.chat as {
      sourceId?: string;
      messages?: Array<{ role?: string; content?: string }>;
    };

    assert.ok(entries["readable/chats/chat-001.md"]);
    assert.equal(chat.sourceId, "chat-1");
    assert.equal(chat.messages?.length, 2);
    assert.deepEqual(
      chat.messages?.map((message) => [message.role, message.content]),
      [
        ["user", "Please review the checkout requirements."],
        ["assistant", "The checkout flow needs guest and card validation coverage."],
      ]
    );
  });

  it("excludes project chats and messages when includeChats is false", async () => {
    const { repository, service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: false,
    });
    const entries = unzipSync(result.archive);
    const manifest = readZipJson(result.archive, "manifest.json");
    const projectJson = readZipJson(result.archive, "data/project.json");

    assert.equal(repository.lastIncludeChats, false);
    assert.equal(entries["data/chats/chat-001.json"], undefined);
    assert.equal(entries["readable/chats/chat-001.md"], undefined);
    assert.deepEqual(manifest.counts, {
      chats: 0,
      documents: 1,
      messages: 0,
    });
    assert.deepEqual((projectJson.project as { chats?: unknown[] }).chats, []);
  });

  it("exports stored project document content and references it from project.json", async () => {
    const { service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: false,
    });
    const entries = unzipSync(result.archive);
    const projectJson = readZipJson(result.archive, "data/project.json");
    const documents = (projectJson.project as {
      documents?: Array<{ sourceId?: string; file?: { path?: string } }>;
    }).documents;

    assert.equal(
      strFromU8(entries["documents/001-requirements.json"]!),
      '{"guestCheckout":false}\n'
    );
    assert.deepEqual(documents, [
      {
        sourceId: "document-1",
        title: "requirements.json",
        source: "IMPORTED",
        mimeType: "application/json",
        metadata: {
          originalName: "requirements.json",
          sizeBytes: 24,
        },
        createdAt: "2026-06-20T10:00:00.000Z",
        updatedAt: "2026-06-21T10:00:00.000Z",
        file: {
          path: "documents/001-requirements.json",
          encoding: "utf-8",
        },
      },
    ]);
  });

  it("warns when chat attachment metadata has no persisted file bytes", async () => {
    const { service } = createTestService();
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: true,
    });
    const manifest = readZipJson(result.archive, "manifest.json");
    const chatJson = readZipJson(result.archive, "data/chats/chat-001.json");
    const messages = (chatJson.chat as {
      messages?: Array<{ attachments?: Array<Record<string, unknown>> }>;
    }).messages;

    assert.deepEqual(manifest.warnings, [
      "Chat attachment files are not included because chat file persistence is not implemented. Attachment metadata is included only.",
    ]);
    assert.deepEqual(messages?.[0]?.attachments, [
      {
        type: "image",
        name: "checkout.png",
        mimeType: "image/png",
      },
    ]);
    assert.equal(unzipSync(result.archive)["attachments/checkout.png"], undefined);
  });

  it("normalizes document names so ZIP entries cannot escape documents/", async () => {
    const source = createProjectExportSource();
    source.documents = [
      {
        ...source.documents[0]!,
        title: "../fallback.json",
        metadata: {
          originalName: "..\\..\\secrets.json",
          sizeBytes: 24,
        },
      },
      {
        ...source.documents[0]!,
        id: "document-2",
        title: "/absolute/requirements.json",
        metadata: null,
      },
    ];
    const { service } = createTestService({ source });
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: false,
    });
    const paths = Object.keys(unzipSync(result.archive));

    assert.ok(paths.includes("documents/001-secrets.json"));
    assert.ok(paths.includes("documents/002-requirements.json"));
    assert.equal(paths.some((path) => path.includes("..")), false);
    assert.equal(paths.some((path) => path.includes("\\")), false);
    assert.equal(paths.some((path) => path.startsWith("/")), false);
    assert.equal(paths.every((path) => !/^[a-z]:/i.test(path)), true);
  });

  it("exports user-created documents as Markdown even when the title has an unsafe extension", async () => {
    const source = createProjectExportSource();
    source.documents = [
      {
        ...source.documents[0]!,
        source: "USER_PROVIDED",
        title: "release-notes.exe",
        mimeType: "text/markdown",
        metadata: null,
      },
    ];
    const { service } = createTestService({ source });
    const result = await service.exportOwnedProject("user-1", "project-1", {
      includeChats: false,
    });
    const paths = Object.keys(unzipSync(result.archive));

    assert.ok(paths.includes("documents/001-release-notes.exe.md"));
  });
});

function createTestService(options: {
  projectOwners?: Map<string, string>;
  source?: ProjectExportSourceRecord | null;
} = {}) {
  const source = options.source === undefined ? createProjectExportSource() : options.source;
  const repository = {
    lastIncludeChats: undefined as boolean | undefined,
    async findOwnedProjectExportData(_userId: string, _projectId: string, includeChats: boolean) {
      repository.lastIncludeChats = includeChats;
      return source;
    },
  } satisfies DataPortabilityRepository & {
    lastIncludeChats: boolean | undefined;
  };
  const projectOwners =
    options.projectOwners === undefined
      ? new Map([["project-1", "user-1"]])
      : options.projectOwners;

  return {
    repository,
    service: createDataPortabilityService({
      now: () => EXPORTED_AT,
      projectAccess: createFakeProjectAccess(projectOwners),
      repository,
    }),
  };
}

function readZipJson(archive: Buffer, path: string) {
  const entry = unzipSync(archive)[path];

  assert.ok(entry, `Expected ZIP entry ${path}.`);

  return JSON.parse(strFromU8(entry)) as Record<string, unknown>;
}

function isErrorWithCode(error: unknown, code: string) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code
  );
}
