import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getProjectDocumentFileError,
  prepareProjectDocumentFiles,
  PROJECT_DOCUMENT_FILE_POLICY,
} from "../src/features/project-documents/projectDocumentFiles.ts";

describe("project document files", () => {
  it("keeps the supported file contract explicit", () => {
    assert.deepEqual(
      [...PROJECT_DOCUMENT_FILE_POLICY.supportedExtensions].sort(),
      ["css", "csv", "html", "js", "json", "log", "md", "ts", "txt"]
    );
  });

  it("prepares supported project files for import", async () => {
    const file = createFakeFile({
      content: "# Requirements",
      name: "requirements.md",
      size: 14,
      type: "text/markdown",
    });

    const files = await prepareProjectDocumentFiles([file]);

    assert.deepEqual(files, [
      {
        name: "requirements.md",
        content: "# Requirements",
        mimeType: "text/markdown",
        sizeBytes: 14,
      },
    ]);
  });

  it("normalizes code file MIME types from their extensions", async () => {
    const files = await prepareProjectDocumentFiles([
      createFakeFile({
        content: ":root { color-scheme: dark; }",
        name: "theme.css",
        type: "",
      }),
      createFakeFile({
        content: "const enabled: boolean = true;",
        name: "feature.ts",
        type: "video/mp2t",
      }),
    ]);

    assert.equal(files[0]?.mimeType, "text/css");
    assert.equal(files[1]?.mimeType, "text/typescript");
  });

  it("rejects unsupported and oversized project files", () => {
    assert.match(
      getProjectDocumentFileError(
        createFakeFile({
          name: "requirements.pdf",
          type: "application/pdf",
        })
      ),
      /not supported/
    );
    assert.match(
      getProjectDocumentFileError(
        createFakeFile({
          name: "requirements.md",
          size: 1_000_001,
          type: "text/markdown",
        })
      ),
      /too large/
    );
  });

  it("rejects more than four files in one import", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      createFakeFile({
        name: `requirements-${index + 1}.md`,
      })
    );

    await assert.rejects(() => prepareProjectDocumentFiles(files), /up to 4 files/);
  });
});

function createFakeFile(
  overrides: {
    content?: string;
    name?: string;
    size?: number;
    type?: string;
  } = {}
) {
  const content = overrides.content ?? "Requirements";

  return {
    name: overrides.name || "requirements.md",
    size: overrides.size ?? content.length,
    type: overrides.type || "text/markdown",
    async text() {
      return content;
    },
  } as File;
}
