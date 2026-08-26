import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  setOperationalEventLoggerForTests,
  type OperationalEventRecord,
} from "../src/lib/operational-events.ts";
import {
  needsProjectDocumentIndex,
  prepareProjectDocumentIndex,
  PROJECT_DOCUMENT_CHUNKING_VERSION,
  type PreparedProjectDocumentIndex,
} from "../src/modules/project-documents/project-document-index.ts";
import type {
  ProjectDocumentIndexRepository,
} from "../src/modules/project-documents/project-document-index.types.ts";
import {
  PROJECT_DOCUMENT_INDEX_FAILURE_MESSAGE,
} from "../src/modules/project-documents/project-document-index.repository.ts";
import {
  createProjectDocumentIndexer,
} from "../src/modules/project-documents/project-document-index.service.ts";
import type {
  ProjectDocumentEmbeddingService,
} from "../src/modules/project-documents/project-document-embedding.service.ts";
import type {
  ProjectDocumentRecord,
} from "../src/modules/project-documents/project-documents.types.ts";

describe("project document index", () => {
  it("builds stable hashes from normalized document content", () => {
    const windowsIndex = prepareProjectDocumentIndex(
      createProjectDocument({
        content: "Checkout rules\r\n\r\nCard payments are required.\r\n",
      })
    );
    const unixIndex = prepareProjectDocumentIndex(
      createProjectDocument({
        content: "Checkout rules\n\nCard payments are required.\n",
      })
    );

    assert.equal(windowsIndex.chunkingVersion, PROJECT_DOCUMENT_CHUNKING_VERSION);
    assert.equal(windowsIndex.contentHash, unixIndex.contentHash);
    assert.deepEqual(
      windowsIndex.chunks.map((chunk) => chunk.contentHash),
      unixIndex.chunks.map((chunk) => chunk.contentHash)
    );
  });

  it("invalidates document and chunk hashes when the title changes", () => {
    const firstIndex = prepareProjectDocumentIndex(
      createProjectDocument({
        title: "Checkout rules",
      })
    );
    const renamedIndex = prepareProjectDocumentIndex(
      createProjectDocument({
        title: "Payment rules",
      })
    );

    assert.notEqual(firstIndex.contentHash, renamedIndex.contentHash);
    assert.notEqual(
      firstIndex.chunks[0]?.contentHash,
      renamedIndex.chunks[0]?.contentHash
    );
  });

  it("detects pending and outdated persisted indexes", () => {
    assert.equal(needsProjectDocumentIndex(createProjectDocument()), true);
    assert.equal(
      needsProjectDocumentIndex(
        createProjectDocument({
          chunkingVersion: PROJECT_DOCUMENT_CHUNKING_VERSION,
          contentHash: "current-hash",
          indexStatus: "READY",
        })
      ),
      false
    );
    assert.equal(
      needsProjectDocumentIndex(
        createProjectDocument({
          chunkingVersion: "boundary-v0",
          contentHash: "old-hash",
          indexStatus: "READY",
        })
      ),
      true
    );
    assert.equal(
      needsProjectDocumentIndex(
        createProjectDocument({
          indexStatus: "FAILED",
        })
      ),
      false
    );
  });

  it("persists the prepared index through the repository boundary", async () => {
    const repository = createFakeIndexRepository();
    const embeddings = createFakeEmbeddingService();
    const indexer = createProjectDocumentIndexer(repository, embeddings);

    await indexer.indexDocument(createProjectDocument(), "user-1");

    assert.equal(repository.replacements.length, 1);
    assert.equal(repository.replacements[0]?.documentId, "document-1");
    assert.equal(repository.replacements[0]?.chunks.length, 1);
    assert.deepEqual(repository.failures, []);
    assert.deepEqual(embeddings.preparedDocumentIds, ["document-1"]);
    assert.deepEqual(embeddings.preparedUserIds, ["user-1"]);
  });

  it("does not embed an index after the source document becomes stale", async () => {
    const repository = createFakeIndexRepository({
      replaceResult: false,
    });
    const embeddings = createFakeEmbeddingService();
    const indexer = createProjectDocumentIndexer(repository, embeddings);

    await indexer.indexDocument(createProjectDocument());

    assert.deepEqual(repository.replacements, []);
    assert.deepEqual(repository.failures, []);
    assert.deepEqual(embeddings.preparedDocumentIds, []);
  });

  it("marks failed indexes without failing the source document workflow", async () => {
    const repository = createFakeIndexRepository({
      replaceError: new Error(
        "Chunk storage unavailable for document-1; token=super-secret"
      ),
    });
    const indexer = createProjectDocumentIndexer(
      repository,
      createFakeEmbeddingService()
    );
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      await indexer.indexDocument(createProjectDocument());
    } finally {
      restore();
    }

    assert.deepEqual(repository.failures, [
      {
        documentId: "document-1",
        error: PROJECT_DOCUMENT_INDEX_FAILURE_MESSAGE,
        sourceUpdatedAt: new Date("2026-06-11T08:00:00.000Z"),
      },
    ]);
    assert.equal(events[0]?.event, "project_document_processing");
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].operation
        : undefined,
      "index_persistence"
    );
    assert.doesNotMatch(
      JSON.stringify(events),
      /document-1|super-secret|Chunk storage unavailable|token=/i
    );
  });

  it("keeps a ready deterministic index when embedding orchestration fails", async () => {
    const repository = createFakeIndexRepository();
    const embeddings = createFakeEmbeddingService();
    embeddings.embedPreparedIndex = async () => {
      throw new Error("Embedding orchestration failed; token=super-secret");
    };
    const indexer = createProjectDocumentIndexer(repository, embeddings);
    const events: OperationalEventRecord[] = [];
    const restore = setOperationalEventLoggerForTests((_level, event) => {
      events.push(event);
    });

    try {
      await indexer.indexDocument(createProjectDocument());
    } finally {
      restore();
    }

    assert.equal(repository.replacements.length, 1);
    assert.deepEqual(repository.failures, []);
    assert.equal(events[0]?.event, "project_document_processing");
    assert.equal(
      events[0]?.event === "project_document_processing"
        ? events[0].operation
        : undefined,
      "embedding_orchestration"
    );
    assert.doesNotMatch(JSON.stringify(events), /super-secret|token=/i);
  });
});

interface FakeIndexRepository extends ProjectDocumentIndexRepository {
  failures: Array<{
    documentId: string;
    error: string;
    sourceUpdatedAt: Date;
  }>;
  replacements: PreparedProjectDocumentIndex[];
}

function createFakeIndexRepository(
  input: {
    replaceError?: Error;
    replaceResult?: boolean;
  } = {}
): FakeIndexRepository {
  const failures: FakeIndexRepository["failures"] = [];
  const replacements: PreparedProjectDocumentIndex[] = [];

  return {
    failures,
    replacements,
    async listEmbeddingCandidates() {
      return [];
    },
    async markChunkEmbeddingFailed() {},
    async markDocumentIndexFailed(documentId, sourceUpdatedAt, error) {
      failures.push({
        documentId,
        error,
        sourceUpdatedAt,
      });
    },
    async replaceDocumentIndex(index) {
      if (input.replaceError) throw input.replaceError;
      if (input.replaceResult === false) return false;

      replacements.push(index);
      return true;
    },
    async saveChunkEmbedding() {},
  };
}

interface FakeEmbeddingService extends ProjectDocumentEmbeddingService {
  pendingDocumentIds: string[];
  preparedDocumentIds: string[];
  preparedUserIds: Array<string | undefined>;
}

function createFakeEmbeddingService(): FakeEmbeddingService {
  const pendingDocumentIds: string[] = [];
  const preparedDocumentIds: string[] = [];
  const preparedUserIds: Array<string | undefined> = [];

  return {
    pendingDocumentIds,
    preparedDocumentIds,
    preparedUserIds,
    async embedPendingDocumentChunks(documentId) {
      pendingDocumentIds.push(documentId);
    },
    async embedPreparedIndex(index, userId) {
      preparedDocumentIds.push(index.documentId);
      preparedUserIds.push(userId);
    },
  };
}

function createProjectDocument(
  overrides: Partial<ProjectDocumentRecord> = {}
): ProjectDocumentRecord {
  return {
    chunkingVersion: "",
    content: "Guest checkout is disabled.",
    contentHash: "",
    createdAt: new Date("2026-06-11T08:00:00.000Z"),
    id: "document-1",
    indexError: null,
    indexedAt: null,
    indexStatus: "PENDING",
    metadata: null,
    mimeType: "text/markdown",
    projectId: "project-1",
    source: "USER_PROVIDED",
    title: "Checkout rules",
    updatedAt: new Date("2026-06-11T08:00:00.000Z"),
    ...overrides,
    sourceAssetId: overrides.sourceAssetId ?? null,
  };
}
