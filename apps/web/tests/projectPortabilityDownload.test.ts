import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  createProjectExportFileName,
  downloadProjectExport,
} from "../src/features/projects/projectPortabilityDownload.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("project portability downloads", () => {
  it("creates a safe project ZIP filename", () => {
    assert.equal(
      createProjectExportFileName('Checkout: QA / "Release"'),
      "Checkout-QA-Release-export.zip"
    );
    assert.equal(createProjectExportFileName("   "), "project-export.zip");
  });

  it("downloads the exported ZIP blob", () => {
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    let clicked = false;
    const link = {
      download: "",
      href: "",
      click() {
        clicked = true;
      },
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        document: {
          body: {
            appendChild(element: unknown) {
              appended.push(element);
            },
            removeChild(element: unknown) {
              removed.push(element);
            },
          },
          createElement(tagName: string) {
            assert.equal(tagName, "a");
            return link;
          },
        },
      },
    });

    downloadProjectExport(
      new Blob(["portable-project"], {
        type: "application/zip",
      }),
      "Checkout QA"
    );

    assert.equal(clicked, true);
    assert.equal(link.download, "Checkout-QA-export.zip");
    assert.match(link.href, /^blob:/);
    assert.deepEqual(appended, [link]);
    assert.deepEqual(removed, [link]);
  });
});
