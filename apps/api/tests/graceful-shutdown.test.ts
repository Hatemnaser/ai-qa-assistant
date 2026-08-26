import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGracefulShutdown } from "../src/graceful-shutdown.ts";

describe("graceful shutdown", () => {
  it("stops accepting requests once, then disconnects the database", async () => {
    const events: string[] = [];
    const shutdown = createGracefulShutdown({
      async disconnectDatabase() {
        events.push("database disconnected");
      },
      logger: {
        error(message) {
          events.push(String(message));
        },
        log(message) {
          events.push(String(message));
        },
      },
      server: {
        close(callback) {
          events.push("server closed");
          callback?.();
          return this as never;
        },
      },
    });

    const firstShutdown = shutdown("SIGTERM");
    const duplicateShutdown = shutdown("SIGINT");

    assert.equal(duplicateShutdown, firstShutdown);
    await firstShutdown;
    assert.deepEqual(events, [
      "Received SIGTERM; stopping new requests.",
      "server closed",
      "database disconnected",
    ]);
  });

  it("sets a failing exit code without exposing provider errors", async () => {
    const errors: string[] = [];
    const exitCodes: number[] = [];
    const shutdown = createGracefulShutdown({
      async disconnectDatabase() {
        throw new Error("private database detail");
      },
      logger: {
        error(message) {
          errors.push(String(message));
        },
        log() {},
      },
      server: {
        close(callback) {
          callback?.(new Error("private server detail"));
          return this as never;
        },
      },
      setExitCode(code) {
        exitCodes.push(code);
      },
    });

    await shutdown("SIGTERM");

    assert.deepEqual(errors, [
      "HTTP server shutdown failed.",
      "Database disconnect failed during shutdown.",
    ]);
    assert.deepEqual(exitCodes, [1]);
    assert.doesNotMatch(errors.join(" "), /private/);
  });
});
