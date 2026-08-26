import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";

let baseUrl: string;
let server: Server;

before(async () => {
  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

describe("API security headers", () => {
  it("sets safe baseline headers without exposing Express", async () => {
    const response = await fetch(baseUrl);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("content-security-policy"),
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    assert.equal(
      response.headers.get("permissions-policy"),
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()"
    );
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("strict-transport-security"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.match(response.headers.get("x-request-id") || "", /^[a-f0-9-]{36}$/i);
  });

  it("uses the explicit proxy hop count and adds HSTS only for production", async () => {
    const productionApp = createApp({
      nodeEnv: "production",
      trustProxyHops: 1,
    });

    assert.equal(productionApp.get("trust proxy"), 1);

    const productionServer = await new Promise<Server>((resolve) => {
      const listeningServer = productionApp.listen(0, "127.0.0.1", () => resolve(listeningServer));
    });

    try {
      const address = productionServer.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}`);

      assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000");
    } finally {
      await new Promise<void>((resolve, reject) => {
        productionServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
