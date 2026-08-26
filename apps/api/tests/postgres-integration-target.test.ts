import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertPostgresIntegrationTarget } from "./helpers/postgresIntegrationTarget.ts";

const SAFE_ENV = {
  DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/oddpath_test?schema=public",
  ODDPATH_DB_INTEGRATION_DATABASE: "oddpath_test",
  ODDPATH_DB_INTEGRATION_TESTS: "1",
};

describe("PostgreSQL integration target guard", () => {
  it("accepts an explicitly named loopback test database", () => {
    const target = assertPostgresIntegrationTarget(SAFE_ENV);

    assert.deepEqual(target, {
      connectionString: SAFE_ENV.DATABASE_URL,
      databaseName: "oddpath_test",
      hostname: "127.0.0.1",
      schema: "public",
    });

    assert.equal(
      assertPostgresIntegrationTarget({
        ...SAFE_ENV,
        DATABASE_URL: "postgresql://postgres:secret@[::1]:5432/oddpath_test?schema=public",
      }).hostname,
      "[::1]"
    );
  });

  it("requires the mutation acknowledgement and exact database name", () => {
    assert.throws(
      () => assertPostgresIntegrationTarget({ ...SAFE_ENV, ODDPATH_DB_INTEGRATION_TESTS: "0" }),
      /Refusing to mutate/
    );
    assert.throws(
      () => assertPostgresIntegrationTarget({ ...SAFE_ENV, ODDPATH_DB_INTEGRATION_DATABASE: "other_test" }),
      /targets oddpath_test, not ODDPATH_DB_INTEGRATION_DATABASE=other_test/
    );
  });

  it("refuses a production-like database name even when it is acknowledged", () => {
    assert.throws(
      () => assertPostgresIntegrationTarget({
        ...SAFE_ENV,
        DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/oddpath",
        ODDPATH_DB_INTEGRATION_DATABASE: "oddpath",
      }),
      /distinct test or ci segment/
    );
  });

  it("requires an additional opt-in for a remote test database", () => {
    const remoteEnvironment = {
      ...SAFE_ENV,
      DATABASE_URL: "postgresql://postgres:secret@db.internal:5432/oddpath_test?schema=public",
    };

    assert.throws(
      () => assertPostgresIntegrationTarget(remoteEnvironment),
      /ODDPATH_DB_INTEGRATION_ALLOW_REMOTE=1/
    );
    assert.equal(
      assertPostgresIntegrationTarget({
        ...remoteEnvironment,
        ODDPATH_DB_INTEGRATION_ALLOW_REMOTE: "1",
      }).hostname,
      "db.internal"
    );
  });

  it("rejects non-PostgreSQL URLs and non-public schemas", () => {
    assert.throws(
      () => assertPostgresIntegrationTarget({ ...SAFE_ENV, DATABASE_URL: "https://example.test/oddpath_test" }),
      /postgres or postgresql protocol/
    );
    assert.throws(
      () => assertPostgresIntegrationTarget({
        ...SAFE_ENV,
        DATABASE_URL: "postgresql://postgres:secret@127.0.0.1:5432/oddpath_test?schema=private",
      }),
      /schema=public/
    );
  });
});
