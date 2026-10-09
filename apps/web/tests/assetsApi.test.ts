import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { resetCsrfTokenForTests } from "../src/api/csrf.ts";
import {
  clearAssetDownloadUrlCache,
  getAssetDownloadUrl,
  uploadAssetBytes,
} from "../src/features/assets/assetsApi.ts";
import type { InitiateAssetResponse } from "../src/features/assets/types.ts";
import { createCsrfAwareFetch } from "./helpers/csrfFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  clearAssetDownloadUrlCache();
  resetCsrfTokenForTests();
  globalThis.fetch = originalFetch;
});

describe("assets api", () => {
  it("passes every signed upload header and the original File to object storage", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const upload: InitiateAssetResponse["upload"] = {
      expiresAt: "2026-08-12T12:10:00.000Z",
      headers: {
        "content-length": String(file.size),
        "content-type": "text/plain",
        "if-none-match": "*",
        "x-amz-checksum-sha256": "checksum",
      },
      method: "PUT",
      url: "https://upload.invalid/signed",
    };
    globalThis.fetch = async (input, init) => {
      assert.equal(input, upload.url);
      assert.equal(init?.method, "PUT");
      assert.equal(init?.body, file);
      assert.deepEqual(init?.headers, upload.headers);
      return new Response(null, { status: 200 });
    };

    await uploadAssetBytes(upload, file);
  });

  it("caches only fresh temporary download URLs and refreshes on demand", async () => {
    let calls = 0;
    globalThis.fetch = createCsrfAwareFetch(async (input, init) => {
      assert.equal(input, "/api/assets/asset%2Fone/download");
      assert.equal(init?.credentials, "include");
      calls += 1;
      return jsonResponse({
        asset: {},
        download: {
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          url: `https://download.invalid/${calls}`,
        },
      });
    });

    assert.equal(await getAssetDownloadUrl("asset/one"), "https://download.invalid/1");
    assert.equal(await getAssetDownloadUrl("asset/one"), "https://download.invalid/1");
    assert.equal(
      await getAssetDownloadUrl("asset/one", { forceRefresh: true }),
      "https://download.invalid/2"
    );
    assert.equal(calls, 2);
  });

  it("rejects non-HTTP signed URL protocols before navigation", async () => {
    globalThis.fetch = createCsrfAwareFetch(async () => jsonResponse({
      asset: {},
      download: {
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        url: "javascript:alert(1)",
      },
    }));

    await assert.rejects(() => getAssetDownloadUrl("asset-1"), /unsupported protocol/);
  });

  for (const forceRefresh of [false, true]) {
    it(`rejects a late download URL after an account cache reset (forceRefresh=${forceRefresh})`, async () => {
      const previousOwner = deferred<Response>();
      let calls = 0;
      globalThis.fetch = createCsrfAwareFetch(async () => {
        calls += 1;
        if (calls === 1) return previousOwner.promise;
        return jsonResponse({
          download: {
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
            url: "https://download.invalid/current-owner",
          },
        });
      });

      const pending = getAssetDownloadUrl("shared-metadata-id", { forceRefresh });
      const rejected = assert.rejects(pending, /attachment scope changed/);
      clearAssetDownloadUrlCache();
      assert.equal(await getAssetDownloadUrl("shared-metadata-id"), "https://download.invalid/current-owner");
      previousOwner.resolve(jsonResponse({
        download: {
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          url: "https://download.invalid/previous-owner",
        },
      }));
      await rejected;

      assert.equal(await getAssetDownloadUrl("shared-metadata-id"), "https://download.invalid/current-owner");
      assert.equal(calls, 2, "the previous response must not overwrite the current owner's cache");
    });
  }

  it("also rejects an obsolete download URL when its response body completes after the cache reset", async () => {
    const body = deferred<unknown>();
    const bodyStarted = deferred<void>();
    globalThis.fetch = createCsrfAwareFetch(async () => {
      const response = jsonResponse({});
      response.json = () => {
        bodyStarted.resolve();
        return body.promise;
      };
      return response;
    });
    const pending = getAssetDownloadUrl("asset-1");
    const rejected = assert.rejects(pending, /attachment scope changed/);
    await bodyStarted.promise;
    clearAssetDownloadUrlCache();
    body.resolve({
      download: {
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        url: "https://download.invalid/previous-owner",
      },
    });
    await rejected;
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
