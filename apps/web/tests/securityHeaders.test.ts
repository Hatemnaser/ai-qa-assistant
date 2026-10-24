import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWebSecurityHeaders,
  buildNginxSecurityHeaders,
  resolveWebSecurityHeaderConfig,
} from "../build/securityHeaders.ts";

describe("static web security headers", () => {
  it("emits the same enforced policy for self-hosted Nginx including error responses", () => {
    const config = resolveWebSecurityHeaderConfig({
      VITE_API_BASE_URL: "https://api.example.test",
      VITE_BROWSER_VIEWER_ORIGIN: "https://browser.example.test",
    });
    const original = buildWebSecurityHeaders(config).split("\n").filter(line => line.startsWith("  "));
    const nginx = buildNginxSecurityHeaders(config).trim().split("\n");
    assert.equal(nginx.length, original.length);
    for (const line of original) {
      const separator = line.indexOf(": ");
      assert.ok(nginx.includes(`add_header ${line.slice(2, separator)} "${line.slice(separator + 2)}" always;`));
    }
    assert.match(nginx.join("\n"), /frame-src https:\/\/browser\.example\.test/);
    assert.doesNotMatch(nginx.join("\n"), /Report-Only|\*/);
  });
  it("generates an enforced CSP for the exact build API origin", () => {
    const headers = buildWebSecurityHeaders(
      resolveWebSecurityHeaderConfig({
        VITE_API_BASE_URL: "https://api-staging.example.com",
      })
    );

    assert.match(headers, /^\s*Content-Security-Policy:/m);
    assert.doesNotMatch(headers, /Content-Security-Policy-Report-Only/i);
    assert.match(headers, /frame-ancestors 'none'/);
    assert.match(headers, /frame-src 'none';/);
    assert.match(headers, /object-src 'none'/);
    assert.match(headers, /script-src 'self'/);
    assert.match(headers, /connect-src 'self' https:\/\/api-staging\.example\.com;/);
    assert.doesNotMatch(headers, /api\.oddpath\.eluthira\.com/);
    assert.doesNotMatch(headers, /r2\.cloudflarestorage\.com/);
  });

  it("permits only the configured HTTPS browser viewer without granting its origin API access", () => {
    const headers = buildWebSecurityHeaders(resolveWebSecurityHeaderConfig({
      VITE_API_BASE_URL: "https://api.example.com",
      VITE_BROWSER_VIEWER_ORIGIN: "https://browser.example.com",
    }));
    assert.match(headers, /frame-src https:\/\/browser\.example\.com;/);
    assert.match(headers, /frame-ancestors 'none';/);
    assert.match(headers, /connect-src 'self' https:\/\/api\.example\.com;/);
    assert.match(headers, /script-src 'self';/);
    assert.doesNotMatch(headers, /frame-src[^;]*\*/);
  });

  it("rejects unsafe browser viewer origins and retains disabled framing when omitted", () => {
    for (const origin of ["http://browser.example.com", "https://*.example.com", "https://user:pass@browser.example.com", "https://browser.example.com/", "https://browser.example.com/open", "https://browser.example.com?ticket=secret", "https://browser.example.com#secret", "https://browser.example.com https://other.example.com"]) {
      assert.throws(() => resolveWebSecurityHeaderConfig({
        VITE_API_BASE_URL: "https://api.example.com", VITE_BROWSER_VIEWER_ORIGIN: origin,
      }), /VITE_BROWSER_VIEWER_ORIGIN/);
    }
    for (const origin of [undefined, "", " "]) {
      assert.equal(resolveWebSecurityHeaderConfig({ VITE_API_BASE_URL: "https://api.example.com", VITE_BROWSER_VIEWER_ORIGIN: origin }).browserViewerOrigin, null);
    }
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
