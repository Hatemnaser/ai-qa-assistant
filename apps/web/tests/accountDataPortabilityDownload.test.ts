import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ACCOUNT_DATA_EXPORT_FILENAME,
  downloadAccountDataExport,
} from "../src/features/data-portability/accountDataPortabilityDownload.ts";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
});

describe("Account Data portability download", () => {
  it("downloads the full account ZIP with a safe fixed filename", () => {
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
            appendChild() {},
            removeChild() {},
          },
          createElement() {
            return link;
          },
        },
      },
    });

    downloadAccountDataExport(
      new Blob(["account-data"], {
        type: "application/zip",
      })
    );

    assert.equal(clicked, true);
    assert.equal(link.download, ACCOUNT_DATA_EXPORT_FILENAME);
    assert.equal(link.download, "account-data-export.zip");
    assert.match(link.href, /^blob:/);
  });
});
