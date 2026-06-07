import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
} from "../src/modules/project-documents/project-documents.repository.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("project documents service", () => {
  it("creates project documents for owned projects", async () => {
    const { repository, service } = setupProjectDocumentsService([], [createFakeProject("project-1", "user-1")]);

    const document = await service.createProjectDocument("user-1", "project-1", {
      title: "Checkout rules",
      content: "Guest checkout is disabled.",
    });

    assert.equal(document.projectId, "project-1");
    assert.equal(document.title, "Checkout rules");
    assert.equal(repository.documents[0]?.content, "Guest checkout is disabled.");
  });

  it("imports project files with source metadata", async () => {
    const { repository, service } = setupProjectDocumentsService([], [createFakeProject("project-1", "user-1")]);

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
  });

  it("lists only project documents after ownership checks", async () => {
    const { service } = setupProjectDocumentsService(
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
    const { repository, service } = setupProjectDocumentsService(
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

    assert.equal(input.files[0]?.name, "requirements.md");
    assert.equal(
      projectDocumentImportInputSchema.parse({
        files: [
          {
            name: "theme.css",
            content: ":root { color-scheme: dark; }",
            mimeType: "text/css",
            sizeBytes: 29,
          },
        ],
      }).files[0]?.name,
      "theme.css"
    );
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

function setupProjectDocumentsService(initialDocuments: ProjectDocumentRecord[] = [], projects: FakeProject[] = []) {
  const repository = createFakeProjectDocumentsRepository(initialDocuments);
  const service = createProjectDocumentsService({
    projectAccess: createFakeProjectAccess(
      new Map(projects.map((project) => [project.id, project.ownerId]))
    ),
    repository,
  });

  return {
    repository,
    service,
  };
}

interface FakeProject {
  id: string;
  ownerId: string;
}

interface FakeProjectDocumentsRepository extends ProjectDocumentsRepository {
  documents: ProjectDocumentRecord[];
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
    id: "document-1",
    projectId: "project-1",
    title: "Project document",
    content: "Project document content",
    source: "USER_PROVIDED",
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
