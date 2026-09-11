import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);
const prismaRequire = createRequire(require.resolve("prisma/package.json"));
const mysqlRoot = dirname(prismaRequire.resolve("mysql2/package.json"));
const ajvRequire = createRequire(require.resolve("ajv"));
const expressRequire = createRequire(require.resolve("express"));
const uri = ajvRequire("fast-uri") as typeof import("fast-uri");
const qs = expressRequire("qs") as {
  parse(value: string, options: Record<string, unknown>): unknown;
  stringify(value: unknown): string;
};

interface CompressionConnection {
  write(): void;
  handlePacket(): void;
  _handleNetworkError(error: NodeJS.ErrnoException): void;
  _bumpCompressedSequenceId(): void;
  packetParser?: { execute(frame: Buffer): void };
}

// mysql2 exposes no public offline packet API. Resolve these two protocol
// boundaries from Prisma's installed driver without opening any connection.
const { enableCompression } = require(join(mysqlRoot, "lib/compressed_protocol.js")) as {
  enableCompression(connection: CompressionConnection): void;
};
const { authSwitchRequest } = require(join(mysqlRoot, "lib/commands/auth_switch.js")) as {
  authSwitchRequest(packet: { offset: number }, connection: object, command: object): void;
};
const AuthSwitchRequest = require(join(mysqlRoot, "lib/packets/auth_switch_request.js")) as {
  new (options: { pluginName: string; pluginData: Buffer }): {
    toPacket(): { offset: number };
  };
};

function inspectCompressedFrame(payload: Buffer, declaredLength: number) {
  const compressed = deflateSync(payload);
  const header = Buffer.alloc(7);
  header.writeUIntLE(compressed.length, 0, 3);
  header.writeUIntLE(declaredLength, 4, 3);

  return new Promise<NodeJS.ErrnoException | null>((resolve) => {
    const connection: CompressionConnection = {
      write() {},
      handlePacket() { resolve(null); },
      _handleNetworkError(error) { resolve(error); },
      _bumpCompressedSequenceId() {},
    };
    enableCompression(connection);
    assert.ok(connection.packetParser);
    connection.packetParser.execute(Buffer.concat([header, compressed]));
  });
}

describe("installed dependency security regressions", () => {
  it("rejects MySQL decompression beyond the declared packet size", { timeout: 2_000 }, async () => {
    // Only 4 KiB even with a regressed driver; never construct a real zip bomb.
    const error = await inspectCompressedFrame(Buffer.alloc(4_096), 10);
    assert.equal(error?.code, "ERR_BUFFER_TOO_LARGE");
  });

  it("still accepts a correctly bounded compressed MySQL packet", { timeout: 2_000 }, async () => {
    const packet = Buffer.from([1, 0, 0, 0, 0]);
    assert.equal(await inspectCompressedFrame(packet, packet.length), null);
  });

  it("rejects an unsolicited plaintext MySQL auth switch before writing credentials", () => {
    const packet = new AuthSwitchRequest({
      pluginName: "mysql_clear_password",
      pluginData: Buffer.alloc(0),
    }).toPacket();
    packet.offset = 4;
    let writes = 0;
    const connection = {
      config: { password: "dependency-regression-password" },
      writePacket() { writes += 1; },
    };

    assert.throws(
      () => authSwitchRequest(packet, connection, { emit() {} }),
      { code: "MYSQL_CLEAR_PASSWORD_NOT_ENABLED", fatal: true }
    );
    assert.equal(writes, 0);
  });

  it("canonicalizes scheme-relative IDN hosts consistently before use", () => {
    const resolved = uri.resolve("https://example.test/path", "//b\u00fccher.example/check");
    assert.equal(resolved, "https://xn--bcher-kva.example/check");
    assert.equal(uri.parse(resolved).host, new URL(resolved).hostname);
  });

  it("enforces comma array limits for bracket keys as well as flat keys", () => {
    const options = { comma: true, arrayLimit: 3, throwOnLimitExceeded: true };
    for (const query of ["a=1,2,3,4", "a[]=1,2,3,4"]) {
      assert.throws(() => qs.parse(query, options), RangeError);
    }
    assert.deepEqual(qs.parse("a[]=1,2,3", options), { a: [["1", "2", "3"]] });
  });

  it("safely round-trips a query containing a non-callable isBuffer property", () => {
    const query = "a[constructor][isBuffer]=not-callable";
    const parsed = qs.parse(query, { plainObjects: true });
    assert.equal(decodeURIComponent(qs.stringify(parsed)), query);
  });
});
