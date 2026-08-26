import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AppError } from "../src/lib/errors.ts";
import type { AssetConsumptionService, ReadReadyAsset } from "../src/modules/assets/assets-consumption.service.ts";
import {
  projectDocumentImportInputSchema,
  projectDocumentInputSchema,
} from "../src/modules/project-documents/project-documents.schema.ts";
import { PROJECT_DOCUMENT_IMPORT_POLICY } from "../src/modules/project-documents/project-document-files.ts";
import {
  createProjectDocumentsService,
} from "../src/modules/project-documents/project-documents.service.ts";
import type {
  ProjectDocumentRecord,
  ProjectDocumentsRepository,
} from "../src/modules/project-documents/project-documents.types.ts";
import type {
  ProjectDocumentIndexer,
} from "../src/modules/project-documents/project-document-index.service.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("project documents service", () => {
  it("creates project documents for owned projects", async () => {
    const { indexer, repository, service } = setupProjectDocumentsService(
      [],
      [createFakeProject("project-1", "user-1")]
    );

    const document = await service.createProjectDocument("user-1", "project-1", {
      title: "Checkout rules",
      content: "Guest checkout is disabled.",
    });

    assert.equal(document.projectId, "project-1");
    assert.equal(document.title, "Checkout rules");
    assert.equal(repository.documents[0]?.content, "Guest checkout is disabled.");
    assert.deepEqual(indexer.indexedDocumentIds, ["document-1"]);
  });

  it("imports project files with source metadata", async () => {
    const { indexer, repository, service } = setupProjectDocumentsService(
      [],
      [createFakeProject("project-1", "user-1")]
    );

    const documents = await service.importProjectDocuments("user-1", "project-1", {
      files: [
        {
          name: "requirements.md",
          content: "# Checkout requirements",
          mimeType: "text/markdown",
          sizeBytes: 23,
        },
      ],
    });

    assert.equal(documents[0]?.source, "IMPORTED");
    assert.deepEqual(documents[0]?.metadata, {
      originalName: "requirements.md",
      sizeBytes: 23,
    });
    assert.equal(repository.documents[0]?.title, "requirements.md");
    assert.deepEqual(indexer.indexedDocumentIds, ["document-1"]);
  });

  it("imports a READY owned project source asset and retains the original link", async () => {
    const reads: Array<Record<string, unknown>> = [];
    const assetConsumption = {
      async getReadyOwnedAsset() { throw new Error("not used"); },
      async readReadyOwnedAsset(input) {
        reads.push(input);
        return readyProjectSource();
      },
    } satisfies AssetConsumptionService;
    const { indexer, repository, service } = setupProjectDocumentsService(
      [],
      [createFakeProject("project-1", "user-1")],
      assetConsumption
    );

    const documents = await service.importProjectDocuments("user-1", "project-1", {
      files: [{ sourceAssetId: "asset-1" }],
    });

    assert.deepEqual(reads, [{
      assetId: "asset-1",
      ownerId: "user-1",
      projectId: "project-1",
      purpose: "PROJECT_DOCUMENT_SOURCE",
    }]);
    assert.equal(repository.documents[0]?.content, "# Stored requirements");
    assert.equal(repository.documents[0]?.sourceAssetId, "asset-1");
    assert.equal(documents[0]?.sourceAssetId, "asset-1");
    assert.deepEqual(indexer.indexedDocumentIds, ["document-1"]);
  });

  it("does not create a project document for an inaccessible stored source", async () => {
    const assetConsumption = {
      async getReadyOwnedAsset() { throw new Error("not used"); },
      async readReadyOwnedAsset() {
        throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
      },
    } satisfies AssetConsumptionService;
    const { repository, service } = setupProjectDocumentsService(
      [],
      [createFakeProject("project-1", "user-1")],
      assetConsumption
    );

    await assert.rejects(
      () => service.importProjectDocuments("user-1", "project-1", {
        files: [{ sourceAssetId: "foreign-asset" }],
      }),
      { code: "ASSET_NOT_FOUND", statusCode: 404 }
    );
    assert.equal(repository.documents.length, 0);
  });

  it("lists only project documents after ownership checks", async () => {
    const { indexer, service } = setupProjectDocumentsService(
      [
        createFakeProjectDocumentRecord({
          id: "document-1",
          projectId: "project-1",
          title: "Owned document",
        }),
        createFakeProjectDocumentRecord({
          id: "document-2",
          projectId: "project-2",
          title: "Other project document",
        }),
      ],
      [createFakeProject("project-1", "user-1"), createFakeProject("project-2", "user-1")]
    );

    const documents = await service.listProjectDocuments("user-1", "project-1");

    assert.deepEqual(
      documents.map((document) => document.id),
      ["document-1"]
    );
    assert.deepEqual(indexer.indexedDocumentIds, ["document-1"]);
  });

  it("rejects project documents for projects owned by another user", async () => {
    const { service } = setupProjectDocumentsService([], [createFakeProject("project-1", "user-2")]);

    await assert.rejects(
      () =>
        service.createProjectDocument("user-1", "project-1", {
          title: "Stolen document",
          content: "Private context",
        }),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
  });

  it("updates and deletes only documents in the requested project", async () => {
    const { indexer, repository, service } = setupProjectDocumentsService(
      [
        createFakeProjectDocumentRecord({
          id: "document-1",
          projectId: "project-1",
          title: "Old title",
        }),
        createFakeProjectDocumentRecord({
          id: "document-2",
          projectId: "project-2",
          title: "Other project",
        }),
      ],
      [createFakeProject("project-1", "user-1"), createFakeProject("project-2", "user-1")]
    );

    const updated = await service.updateProjectDocument("user-1", "project-1", "document-1", {
      title: "New title",
      content: "Updated content",
    });
    await service.deleteProjectDocument("user-1", "project-2", "document-2");

    assert.equal(updated.title, "New title");
    assert.deepEqual(
      repository.documents.map((document) => document.id),
      ["document-1"]
    );
    assert.deepEqual(indexer.indexedDocumentIds, ["document-1"]);
  });

  it("keeps imported project files read-only", async () => {
    const { service } = setupProjectDocumentsService(
      [
        createFakeProjectDocumentRecord({
          id: "document-1",
          projectId: "project-1",
          source: "IMPORTED",
          title: "requirements.md",
        }),
      ],
      [createFakeProject("project-1", "user-1")]
    );

    await assert.rejects(
      () =>
        service.updateProjectDocument("user-1", "project-1", "document-1", {
          title: "Changed title",
          content: "Changed content",
        }),
      {
        code: "PROJECT_DOCUMENT_READ_ONLY",
        statusCode: 409,
      }
    );
  });

  it("normalizes project document input", () => {
    const input = projectDocumentInputSchema.parse({
      title: "  Requirements  ",
      content: "  Checkout must support card payments.  ",
      mimeType: "   ",
    });

    assert.deepEqual(input, {
      title: "Requirements",
      content: "Checkout must support card payments.",
      mimeType: null,
    });

    assert.deepEqual(
      projectDocumentInputSchema.parse({
        title: "Requirements",
        content: "Checkout must support card payments.",
        mimeType: null,
      }),
      {
        title: "Requirements",
        content: "Checkout must support card payments.",
        mimeType: null,
      }
    );
  });

  it("validates imported project file batches", () => {
    assert.deepEqual(
      [...PROJECT_DOCUMENT_IMPORT_POLICY.supportedExtensions].sort(),
      ["css", "csv", "html", "js", "json", "log", "md", "ts", "txt"]
    );

    const input = projectDocumentImportInputSchema.parse({
      files: [
        {
          name: "requirements.md",
          content: "# Requirements",
          mimeType: "text/markdown",
          sizeBytes: 14,
        },
      ],
    });

    const requirementsFile = input.files[0];
    assert.ok(requirementsFile && "name" in requirementsFile);
    assert.equal(requirementsFile.name, "requirements.md");
    assert.deepEqual(
      projectDocumentImportInputSchema.parse({ files: [{ assetId: "asset-1" }] }),
      { files: [{ sourceAssetId: "asset-1" }] }
    );
    assert.throws(
      () => projectDocumentImportInputSchema.parse({
        files: [{ sourceAssetId: "asset-1" }, { sourceAssetId: "asset-1" }],
      }),
      /only be imported once/
    );
    const stylesheet = projectDocumentImportInputSchema.parse({
      files: [
        {
          name: "theme.css",
          content: ":root { color-scheme: dark; }",
          mimeType: "text/css",
          sizeBytes: 29,
        },
      ],
    }).files[0];
    assert.ok(stylesheet && "name" in stylesheet);
    assert.equal(stylesheet.name, "theme.css");
    assert.throws(
      () =>
        projectDocumentImportInputSchema.parse({
          files: [
            {
              name: "requirements.pdf",
              content: "PDF content",
              mimeType: "application/pdf",
              sizeBytes: 11,
            },
          ],
        }),
      /Unsupported file type/
    );
    assert.throws(
      () =>
        projectDocumentImportInputSchema.parse({
          files: [
            {
              name: "requirements.pdf",
              content: "Pretend text content",
              mimeType: "text/plain",
              sizeBytes: 20,
            },
          ],
        }),
      /Unsupported file type/
    );
    assert.throws(
      () =>
        projectDocumentImportInputSchema.parse({
          files: [
            {
              name: "theme.css",
              content: ":root { color-scheme: dark; }",
              mimeType: "application/json",
              sizeBytes: 29,
            },
          ],
        }),
      /Unsupported file type/
    );
  });
});

function setupProjectDocumentsService(
  initialDocuments: ProjectDocumentRecord[] = [],
  projects: FakeProject[] = [],
  assetConsumption?: AssetConsumptionService
) {
  const indexer = createFakeProjectDocumentIndexer();
  const repository = createFakeProjectDocumentsRepository(initialDocuments);
  const service = createProjectDocumentsService({
    assetConsumption,
    indexer,
    projectAccess: createFakeProjectAccess(
      new Map(projects.map((project) => [project.id, project.ownerId]))
    ),
    repository,
  });

  return {
    indexer,
    repository,
    service,
  };
}

function readyProjectSource(): ReadReadyAsset {
  const bytes = new TextEncoder().encode("# Stored requirements");

  return {
    asset: {
      checksumSha256: "checksum",
      createdAt: NOW,
      declaredMimeType: "text/markdown",
      detectedMimeType: "text/markdown",
      etag: "etag",
      expectedSizeBytes: bytes.byteLength,
      id: "asset-1",
      objectKey: "project-documents/asset-1",
      originalName: "requirements.md",
      ownerId: "user-1",
      projectId: "project-1",
      purpose: "PROJECT_DOCUMENT_SOURCE",
      readyAt: NOW,
      sizeBytes: bytes.byteLength,
      status: "READY",
      updatedAt: NOW,
      uploadExpiresAt: null,
      validationStartedAt: null,
    },
    bytes,
  };
}

interface FakeProject {
  id: string;
  ownerId: string;
}

interface FakeProjectDocumentsRepository extends ProjectDocumentsRepository {
  documents: ProjectDocumentRecord[];
}

interface FakeProjectDocumentIndexer extends ProjectDocumentIndexer {
  indexedDocumentIds: string[];
}

function createFakeProjectDocumentIndexer(): FakeProjectDocumentIndexer {
  const indexedDocumentIds: string[] = [];

  return {
    indexedDocumentIds,
    async ensureDocumentsIndexed(documents) {
      indexedDocumentIds.push(...documents.map((document) => document.id));
    },
    async indexDocument(document) {
      indexedDocumentIds.push(document.id);
    },
    async indexDocuments(documents) {
      indexedDocumentIds.push(...documents.map((document) => document.id));
    },
  };
}

function createFakeProjectDocumentsRepository(
  initialDocuments: ProjectDocumentRecord[] = []
): FakeProjectDocumentsRepository {
  const repository: FakeProjectDocumentsRepository = {
    documents: [...initialDocuments],

    async createProjectDocument(input) {
      const document = createFakeProjectDocumentRecord({
        content: input.content,
        id: `document-${repository.documents.length + 1}`,
        metadata: input.metadata || null,
        mimeType: input.mimeType || null,
        projectId: input.projectId,
        source: input.source || "USER_PROVIDED",
        sourceAssetId: input.sourceAssetId || null,
        title: input.title,
      });

      repository.documents.push(document);

      return document;
    },

    async createProjectDocuments(inputs) {
      const documents = inputs.map((input, index) =>
        createFakeProjectDocumentRecord({
          content: input.content,
          id: `document-${repository.documents.length + index + 1}`,
          metadata: input.metadata || null,
          mimeType: input.mimeType || null,
          projectId: input.projectId,
          source: input.source || "USER_PROVIDED",
          sourceAssetId: input.sourceAssetId || null,
          title: input.title,
        })
      );

      repository.documents.push(...documents);

      return documents;
    },

    async deleteProjectDocument(projectId, documentId) {
      const documentIndex = repository.documents.findIndex(
        (document) => document.id === documentId && document.projectId === projectId
      );

      if (documentIndex === -1) return 0;

      repository.documents.splice(documentIndex, 1);

      return 1;
    },

    async findProjectDocument(projectId, documentId) {
      return (
        repository.documents.find(
          (document) => document.id === documentId && document.projectId === projectId
        ) || null
      );
    },

    async listProjectDocuments(projectId) {
      return repository.documents
        .filter((document) => document.projectId === projectId)
        .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());
    },

    async updateProjectDocument(input) {
      const document = repository.documents.find(
        (item) => item.id === input.documentId && item.projectId === input.projectId
      );

      if (!document) return null;

      document.title = input.title;
      document.content = input.content;
      document.mimeType = input.mimeType || null;
      document.updatedAt = NOW;

      return document;
    },
  };

  return repository;
}

function createFakeProjectDocumentRecord(overrides: Partial<ProjectDocumentRecord> = {}): ProjectDocumentRecord {
  return {
    chunkingVersion: "",
    contentHash: "",
    id: "document-1",
    indexError: null,
    indexedAt: null,
    indexStatus: "PENDING",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
    sourceAssetId: null,
    mimeType: null,
    metadata: null,
    createdAt: new Date("2026-06-06T09:00:00.000Z"),
    updatedAt: new Date("2026-06-06T09:00:00.000Z"),
    ...overrides,
  };
}

function createFakeProject(id: string, ownerId: string): FakeProject {
  return {
    id,
    ownerId,
  };
}
