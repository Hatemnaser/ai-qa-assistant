const SAFE_DATABASE_NAME = /(?:^|[-_])(ci|test)(?:[-_]|$)/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

export interface PostgresIntegrationTarget {
  connectionString: string;
  databaseName: string;
  hostname: string;
  schema: "public";
}

/**
 * Fail closed before a database integration test opens a connection.
 *
 * The acknowledgement flag alone is intentionally insufficient: callers must
 * also name the disposable database, and that name must contain a clear
 * `test`/`ci` segment. Remote targets require a second, explicit opt-in.
 */
export function assertPostgresIntegrationTarget(
  environment: NodeJS.ProcessEnv
): PostgresIntegrationTarget {
  if (environment.ODDPATH_DB_INTEGRATION_TESTS !== "1") {
    throw new Error(
      "Refusing to mutate the database. Set ODDPATH_DB_INTEGRATION_TESTS=1 only for a disposable test database."
    );
  }

  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      "PostgreSQL integration tests require an explicit DATABASE_URL pointing to a disposable test database."
    );
  }

  const expectedDatabaseName = environment.ODDPATH_DB_INTEGRATION_DATABASE?.trim();
  if (!expectedDatabaseName) {
    throw new Error(
      "Set ODDPATH_DB_INTEGRATION_DATABASE to the exact disposable database name."
    );
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("DATABASE_URL must identify exactly one PostgreSQL database.");
  }
  if (databaseName !== expectedDatabaseName) {
    throw new Error(
      `DATABASE_URL targets ${databaseName}, not ODDPATH_DB_INTEGRATION_DATABASE=${expectedDatabaseName}.`
    );
  }
  if (!SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      "The integration database name must contain a distinct test or ci segment."
    );
  }

  const schema = url.searchParams.get("schema") || "public";
  if (schema !== "public") {
    throw new Error("PostgreSQL integration tests require schema=public.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    !LOOPBACK_HOSTS.has(hostname) &&
    environment.ODDPATH_DB_INTEGRATION_ALLOW_REMOTE !== "1"
  ) {
    throw new Error(
      "Remote integration databases require ODDPATH_DB_INTEGRATION_ALLOW_REMOTE=1."
    );
  }

  return {
    connectionString,
    databaseName,
    hostname,
    schema: "public",
  };
}
