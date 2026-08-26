import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWebSecurityHeaders,
  resolveWebSecurityHeaderConfig,
} from "../build/securityHeaders.ts";

describe("static web security headers", () => {
  it("generates an enforced CSP for the exact build API origin", () => {
    const headers = buildWebSecurityHeaders(
      resolveWebSecurityHeaderConfig({
        VITE_API_BASE_URL: "https://api-staging.example.com",
      })
    );

    assert.match(headers, /^\s*Content-Security-Policy:/m);
    assert.doesNotMatch(headers, /Content-Security-Policy-Report-Only/i);
    assert.match(headers, /frame-ancestors 'none'/);
    assert.match(headers, /object-src 'none'/);
    assert.match(headers, /script-src 'self'/);
    assert.match(headers, /connect-src 'self' https:\/\/api-staging\.example\.com;/);
    assert.doesNotMatch(headers, /api\.oddpath\.eluthira\.com/);
    assert.doesNotMatch(headers, /r2\.cloudflarestorage\.com/);
  });

  it("adds only the exact configured EU R2 transport origin", () => {
    const r2Origin = "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com";
    const headers = buildWebSecurityHeaders(
      resolveWebSecurityHeaderConfig({
        VITE_API_BASE_URL: "https://api.oddpath.eluthira.com",
        VITE_R2_ENDPOINT: r2Origin,
      })
    );

    assert.match(
      headers,
      new RegExp(
        `connect-src 'self' https:\\/\\/api\\.oddpath\\.eluthira\\.com ${escapeRegex(r2Origin)};`
      )
    );
    assert.match(headers, new RegExp(`img-src[^;]*${escapeRegex(r2Origin)};`));
    assert.doesNotMatch(headers, /https:\/\/\*/);
  });

  it("fails closed for missing, non-origin, or non-EU build values", () => {
    for (const invalidApiOrigin of [
      undefined,
      "http://api.example.com",
      "https://*.example.com",
      "https://api.example.com/",
      "https://api.example.com/path",
    ]) {
      assert.throws(
        () => resolveWebSecurityHeaderConfig({ VITE_API_BASE_URL: invalidApiOrigin }),
        /VITE_API_BASE_URL/
      );
    }

    for (const invalidR2Origin of [
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
      "https://*.r2.cloudflarestorage.com",
      "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com/bucket",
      "https://not-an-account-id.eu.r2.cloudflarestorage.com",
    ]) {
      assert.throws(
        () =>
          resolveWebSecurityHeaderConfig({
            VITE_API_BASE_URL: "https://api.example.com",
            VITE_R2_ENDPOINT: invalidR2Origin,
          }),
        /VITE_R2_ENDPOINT/
      );
    }
  });
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
