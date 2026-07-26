import { createHash } from "node:crypto";

import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { validateExternalChatImport } from "./external-chat-adapters.js";
import { decodeSafeUtf8, readSafeZip } from "./safe-zip.js";
import {
  ACCOUNT_IMPORT_LIMITS,
  type AccountImportCounts,
  type NativeAccountImportChat,
  type NativeAccountImportProject,
  type ValidatedAccountImport,
  type ValidatedNativeAccountImport,
} from "./account-import.types.js";

const INVALID_PACKAGE = {
  code: "ACCOUNT_IMPORT_PACKAGE_INVALID",
  message: "Account import file is invalid or unsupported.",
};
const PROFILE_WARNING =
  "Account identity, sign-in credentials, sessions, and settings are not replaced. Portable records are imported as new local data.";
const REPEAT_IMPORT_WARNING =
  "Projects and chats are created as new copies. Exact Account Memory duplicates are skipped.";
const portableTimestampSchema = z.string().datetime();
const traceIdSchema = z.string().min(1).max(240);
const projectDataPathSchema = z
  .string()
  .regex(/^data\/projects\/project-\d+\.json$/)
  .max(240);
const projectReadablePathSchema = z
  .string()
  .regex(/^readable\/projects\/project-\d+\.md$/)
  .max(240);
const chatDataPathSchema = z
  .string()
  .regex(/^data\/chats\/chat-\d+\.json$/)
  .max(240);
const chatReadablePathSchema = z
  .string()
  .regex(/^readable\/chats\/chat-\d+\.md$/)
  .max(240);
const fileReferenceSchema = z
  .object({
    path: z.string().regex(/^documents\/[^/]+\/[^/]+$/).max(240),
    encoding: z.literal("utf-8"),
  })
  .strict();
const countSchema = z.number().int().nonnegative();

const manifestSchema = z
  .object({
    formatVersion: z.literal("1.0"),
    exportType: z.literal("account"),
    exportedAt: portableTimestampSchema,
    accountId: traceIdSchema,
    counts: z
      .object({
        projects: countSchema,
        documents: countSchema,
        chats: countSchema,
        messages: countSchema,
        accountMemories: countSchema,
      })
      .strict(),
    contains: z
      .object({
        canonicalJson: z.literal(true),
        readableMarkdown: z.literal(true),
        migrationReference: z.literal(true),
        attachmentFiles: z.literal(false),
        derivedData: z.literal(false),
        secrets: z.literal(false),
      })
      .strict(),
    warnings: z.array(z.string().max(1_000)).max(1_000),
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(240),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            sizeBytes: countSchema,
          })
          .strict()
      )
      .max(ACCOUNT_IMPORT_LIMITS.maxEntries),
  })
  .strict();

const accountMemorySchema = z
  .object({
    sourceId: traceIdSchema,
    content: z.string().max(4_000).refine((value) => value.trim().length > 0),
    source: z.enum(["USER_PROVIDED", "IMPORTED"]),
    createdAt: portableTimestampSchema,
    updatedAt: portableTimestampSchema,
  })
  .strict();

const projectReferenceSchema = z
  .object({
    sourceId: traceIdSchema,
    name: z.string().trim().min(1).max(120),
    dataPath: projectDataPathSchema,
    readablePath: projectReadablePathSchema,
    documentCount: countSchema,
    chatCount: countSchema,
  })
  .strict();

const chatReferenceSchema = z
  .object({
    sourceId: traceIdSchema,
    sourceProjectId: traceIdSchema.nullable(),
    title: z.string().trim().min(1).max(120),
    dataPath: chatDataPathSchema,
    readablePath: chatReadablePathSchema,
    messageCount: countSchema,
  })
  .strict();

const accountDocumentSchema = z
  .object({
    formatVersion: z.literal("1.0"),
    exportType: z.literal("account"),
    account: z
      .object({
        sourceId: traceIdSchema,
        email: z.string().email().max(320),
        name: z.string().max(160).nullable(),
        locale: z.string().min(1).max(20),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
      })
      .strict(),
    settings: z
      .object({
        language: z.string().min(1).max(20),
        theme: z.string().min(1).max(40),
        defaultModel: z.string().min(1).max(120),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
      })
      .strict()
      .nullable(),
    accountMemories: z
      .array(accountMemorySchema)
      .max(ACCOUNT_IMPORT_LIMITS.maxAccountMemories),
    projects: z
      .array(projectReferenceSchema)
      .max(ACCOUNT_IMPORT_LIMITS.maxProjects),
    chats: z.array(chatReferenceSchema).max(ACCOUNT_IMPORT_LIMITS.maxChats),
  })
  .strict();

const documentSchema = z
  .object({
    sourceId: traceIdSchema,
    title: z.string().trim().min(1).max(160),
    source: z.enum(["USER_PROVIDED", "IMPORTED"]),
    mimeType: z.string().max(120).nullable(),
    metadata: z
      .object({
        originalName: z.string().min(1).max(255).optional(),
        sizeBytes: countSchema.optional(),
      })
      .strict()
      .nullable(),
    createdAt: portableTimestampSchema,
    updatedAt: portableTimestampSchema,
    file: fileReferenceSchema,
  })
  .strict();

const projectDocumentSchema = z
  .object({
    formatVersion: z.literal("1.0"),
    exportType: z.literal("account_project"),
    project: z
      .object({
        sourceId: traceIdSchema,
        name: z.string().trim().min(1).max(120),
        description: z.string().max(1_000).nullable(),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
        instructions: z
          .object({
            content: z.string().max(12_000).refine((value) => value.trim().length > 0),
            createdAt: portableTimestampSchema,
            updatedAt: portableTimestampSchema,
          })
          .strict()
          .nullable(),
        memory: z
          .object({
            content: z.string().max(6_000).refine((value) => value.trim().length > 0),
            source: z.enum([
              "USER_PROVIDED",
              "AI_EXTRACTED",
              "CHAT_SUMMARY",
              "IMPORTED",
            ]),
            createdAt: portableTimestampSchema,
            updatedAt: portableTimestampSchema,
          })
          .strict()
          .nullable(),
        documents: z
          .array(documentSchema)
          .max(ACCOUNT_IMPORT_LIMITS.maxDocuments),
        chatSourceIds: z.array(traceIdSchema).max(ACCOUNT_IMPORT_LIMITS.maxChats),
      })
      .strict(),
  })
  .strict();

const attachmentSchema = z
  .object({
    type: z.enum(["image", "file"]),
    name: z.string().min(1).max(255),
    mimeType: z.string().max(120),
  })
  .strict();

const messageSchema = z
  .object({
    sourceId: traceIdSchema,
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().max(ACCOUNT_IMPORT_LIMITS.maxMessageChars),
    mode: z.string().min(1).max(120),
    model: z.string().max(120).nullable(),
    createdAt: portableTimestampSchema,
    attachments: z.array(attachmentSchema).max(20).optional(),
    isError: z.literal(true).optional(),
  })
  .strict();

const chatDocumentSchema = z
  .object({
    formatVersion: z.literal("1.0"),
    exportType: z.literal("account_chat"),
    chat: z
      .object({
        sourceId: traceIdSchema,
        sourceProjectId: traceIdSchema.nullable(),
        title: z.string().trim().min(1).max(120),
        mode: z.string().min(1).max(120),
        model: z.string().min(1).max(120),
        createdAt: portableTimestampSchema,
        updatedAt: portableTimestampSchema,
        messages: z.array(messageSchema).max(ACCOUNT_IMPORT_LIMITS.maxMessages),
      })
      .strict(),
  })
  .strict();

export function validateAccountImportPackage(
  archive: Buffer
): ValidatedAccountImport {
  const entries = readSafeZip(archive, ACCOUNT_IMPORT_LIMITS, INVALID_PACKAGE);
  const manifestEntry = entries["manifest.json"];

  if (!manifestEntry) {
    const external = validateExternalChatImport(archive, "auto");
    return {
      importKind: "chat_archive",
      packageDigest: external.packageDigest,
      external,
      warnings: external.warnings,
    };
  }

  const untrustedManifest = parseJson(manifestEntry);
  if (isRecord(untrustedManifest) && untrustedManifest.exportType === "project") {
    throw new AppError(
      "This project archive must be imported from the Projects page.",
      400,
      "ACCOUNT_IMPORT_PROJECT_ARCHIVE_UNSUPPORTED"
    );
  }

  if (!isRecord(untrustedManifest) || untrustedManifest.exportType !== "account") {
    throwInvalidPackage();
  }

  return validateNativeAccountArchive(archive, entries, untrustedManifest);
}

function validateNativeAccountArchive(
  archive: Buffer,
  entries: Record<string, Uint8Array>,
  untrustedManifest: unknown
): ValidatedNativeAccountImport {
  const manifest = parseSchema(manifestSchema, untrustedManifest);
  validateManifestFiles(entries, manifest.files);

  const accountEntry = entries["data/account.json"];
  if (!accountEntry) throwInvalidPackage();
  const accountDocument = parseSchema(
    accountDocumentSchema,
    parseJson(accountEntry)
  );

  if (accountDocument.account.sourceId !== manifest.accountId) {
    throwInvalidPackage();
  }

  assertUnique(accountDocument.accountMemories.map((memory) => memory.sourceId));
  assertUnique(accountDocument.projects.map((project) => project.sourceId));
  assertUnique(accountDocument.projects.map((project) => project.dataPath));
  assertUnique(accountDocument.chats.map((chat) => chat.sourceId));
  assertUnique(accountDocument.chats.map((chat) => chat.dataPath));

  const projects = accountDocument.projects.map((reference) =>
    parseProject(entries, reference)
  );
  const chats = accountDocument.chats.map((reference) =>
    parseChat(entries, reference)
  );

  validateRelations(projects, chats);

  const counts = getNativeCounts(
    accountDocument.accountMemories.length,
    projects,
    chats
  );
  if (!sameCounts(counts, manifest.counts) || exceedsImportLimits(counts)) {
    throwInvalidPackage();
  }

  return {
    importKind: "account_archive",
    packageDigest: createHash("sha256").update(archive).digest("hex"),
    sourceAccountId: manifest.accountId,
    accountMemories: accountDocument.accountMemories.map((memory) => ({
      ...memory,
      createdAt: new Date(memory.createdAt),
      updatedAt: new Date(memory.updatedAt),
    })),
    projects,
    chats,
    warnings: Array.from(
      new Set([...manifest.warnings, PROFILE_WARNING, REPEAT_IMPORT_WARNING])
    ),
  };
}

function parseProject(
  entries: Record<string, Uint8Array>,
  reference: z.infer<typeof projectReferenceSchema>
): NativeAccountImportProject {
  const entry = entries[reference.dataPath];
  if (!entry || !entries[reference.readablePath]) throwInvalidPackage();
  const document = parseSchema(projectDocumentSchema, parseJson(entry));
  const project = document.project;

  if (
    project.sourceId !== reference.sourceId ||
    project.name !== reference.name ||
    project.documents.length !== reference.documentCount ||
    project.chatSourceIds.length !== reference.chatCount
  ) {
    throwInvalidPackage();
  }

  assertUnique(project.documents.map((item) => item.sourceId));
  assertUnique(project.documents.map((item) => item.file.path));
  assertUnique(project.chatSourceIds);

  return {
    sourceId: project.sourceId,
    name: project.name,
    description: project.description,
    instructions: project.instructions
      ? { content: project.instructions.content }
      : null,
    memory: project.memory ? { content: project.memory.content } : null,
    documents: project.documents.map((item) => {
      const content = entries[item.file.path];
      if (!content) throwInvalidPackage();

      return {
        sourceId: item.sourceId,
        title: item.title,
        content: decodeSafeUtf8(content, INVALID_PACKAGE),
        mimeType: item.mimeType,
        metadata: item.metadata,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt),
      };
    }),
    chatSourceIds: project.chatSourceIds,
  };
}

function parseChat(
  entries: Record<string, Uint8Array>,
  reference: z.infer<typeof chatReferenceSchema>
): NativeAccountImportChat {
  const entry = entries[reference.dataPath];
  if (!entry || !entries[reference.readablePath]) throwInvalidPackage();
  const document = parseSchema(chatDocumentSchema, parseJson(entry));
  const chat = document.chat;

  if (
    chat.sourceId !== reference.sourceId ||
    chat.sourceProjectId !== reference.sourceProjectId ||
    chat.title !== reference.title ||
    chat.messages.length !== reference.messageCount
  ) {
    throwInvalidPackage();
  }

  assertUnique(chat.messages.map((message) => message.sourceId));

  return {
    ...chat,
    createdAt: new Date(chat.createdAt),
    updatedAt: new Date(chat.updatedAt),
    messages: chat.messages.map((message) => ({
      ...message,
      attachments: message.attachments || [],
      isError: message.isError === true,
      createdAt: new Date(message.createdAt),
    })),
  };
}

function validateRelations(
  projects: NativeAccountImportProject[],
  chats: NativeAccountImportChat[]
) {
  const projectsById = new Map(projects.map((project) => [project.sourceId, project]));
  const chatsById = new Map(chats.map((chat) => [chat.sourceId, chat]));

  for (const chat of chats) {
    if (chat.sourceProjectId && !projectsById.has(chat.sourceProjectId)) {
      throwInvalidPackage();
    }
  }

  for (const project of projects) {
    const expectedChatIds = chats
      .filter((chat) => chat.sourceProjectId === project.sourceId)
      .map((chat) => chat.sourceId);

    if (
      project.chatSourceIds.length !== expectedChatIds.length ||
      project.chatSourceIds.some((id) => !chatsById.has(id)) ||
      expectedChatIds.some((id) => !project.chatSourceIds.includes(id))
    ) {
      throwInvalidPackage();
    }
  }
}

function validateManifestFiles(
  entries: Record<string, Uint8Array>,
  files: Array<{ path: string; sha256: string; sizeBytes: number }>
) {
  assertUnique(files.map((file) => file.path));
  const listedPaths = new Set(files.map((file) => file.path));
  const actualPaths = Object.keys(entries).filter(
    (path) => path !== "manifest.json" && !path.endsWith("/")
  );

  if (
    files.some((file) => file.path === "manifest.json") ||
    actualPaths.length !== listedPaths.size ||
    actualPaths.some((path) => !listedPaths.has(path))
  ) {
    throwInvalidPackage();
  }

  for (const file of files) {
    const content = entries[file.path];
    if (
      !content ||
      content.byteLength !== file.sizeBytes ||
      createHash("sha256").update(content).digest("hex") !== file.sha256
    ) {
      throwInvalidPackage();
    }
  }
}

function getNativeCounts(
  accountMemories: number,
  projects: NativeAccountImportProject[],
  chats: NativeAccountImportChat[]
): AccountImportCounts {
  return {
    projects: projects.length,
    documents: projects.reduce(
      (total, project) => total + project.documents.length,
      0
    ),
    chats: chats.length,
    messages: chats.reduce((total, chat) => total + chat.messages.length, 0),
    accountMemories,
  };
}

function sameCounts(
  actual: AccountImportCounts,
  expected: AccountImportCounts
) {
  return (Object.keys(actual) as Array<keyof AccountImportCounts>).every(
    (key) => actual[key] === expected[key]
  );
}

function exceedsImportLimits(counts: AccountImportCounts) {
  return (
    counts.projects > ACCOUNT_IMPORT_LIMITS.maxProjects ||
    counts.documents > ACCOUNT_IMPORT_LIMITS.maxDocuments ||
    counts.chats > ACCOUNT_IMPORT_LIMITS.maxChats ||
    counts.messages > ACCOUNT_IMPORT_LIMITS.maxMessages ||
    counts.accountMemories > ACCOUNT_IMPORT_LIMITS.maxAccountMemories
  );
}

function assertUnique(values: string[]) {
  if (new Set(values).size !== values.length) throwInvalidPackage();
}

function parseJson(content: Uint8Array) {
  try {
    return JSON.parse(decodeSafeUtf8(content, INVALID_PACKAGE)) as unknown;
  } catch {
    throwInvalidPackage();
  }
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throwInvalidPackage();

  return result.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function throwInvalidPackage(): never {
  throw new AppError(INVALID_PACKAGE.message, 400, INVALID_PACKAGE.code);
}
