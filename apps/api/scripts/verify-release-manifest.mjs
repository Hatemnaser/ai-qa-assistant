/** Maintained suites only; the core entry already imports its accounting suites. */
export const releaseManifest = Object.freeze([
  { id: 'managed-routing', file: 'managed-routing.postgres.integration.ts', expectedTests: 10 },
  { id: 'managed-routing-auth', file: 'managed-routing-auth.postgres.integration.ts', expectedTests: 2 },
  { id: 'core-postgres', file: 'postgres.integration.ts', expectedTests: 165 },
  { id: 'quota-retention', file: 'quota-retention.postgres.integration.ts', expectedTests: 7 },
  { id: 'quota-identity-retention', file: 'quota-identity-retention.postgres.integration.ts', expectedTests: 8 },
  { id: 'quota-http', file: 'quota-final-http.postgres.integration.ts', expectedTests: 4 },
  { id: 'quota-identity-http', file: 'quota-identity-retention-http.postgres.integration.ts', expectedTests: 1 },
  { id: 'auth-postgres', file: 'auth-public.postgres.integration.ts', expectedTests: 6 },
  { id: 'auth-http', file: 'auth-public-http.postgres.integration.ts', expectedTests: 7 },
  { id: 'auth-activation', file: 'auth-activation.postgres.integration.ts', expectedTests: 8 },
  { id: 'auth-activation-races', file: 'auth-activation-races.postgres.integration.ts', expectedTests: 14 },
  { id: 'auth-smtp', file: 'auth-mail.postgres.integration.ts', expectedTests: 2 },
  { id: 'readiness', file: 'readiness.postgres.integration.ts', expectedTests: 16 },
  { id: 'readiness-consistency', file: 'readiness-consistency.postgres.integration.ts', expectedTests: 15 },
  { id: 'quota-upgrade', file: 'quota-migration.postgres.integration.ts', expectedTests: 1, upgradeFlag: 'ODDPATH_QUOTA_UPGRADE_TEST' },
  { id: 'auth-upgrade', file: 'auth-migration.postgres.integration.ts', expectedTests: 1, upgradeFlag: 'ODDPATH_AUTH_UPGRADE_TEST' },
  { id: 'readiness-upgrade', file: 'readiness-migration.postgres.integration.ts', expectedTests: 1, emptyDatabase: true },
].map(entry => Object.freeze(entry)));

export function parseTapSummary(output, expectedTests) {
  const summary = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`Missing or ambiguous TAP ${key} summary`);
    summary[key] = Number(matches[0][1]);
  }
  if (!Number.isSafeInteger(expectedTests) || expectedTests < 1 || summary.tests !== expectedTests || summary.pass !== expectedTests) {
    throw new Error(`Unexpected TAP coverage: expected ${expectedTests}, tests=${summary.tests}, pass=${summary.pass}`);
  }
  if (['fail', 'cancelled', 'skipped', 'todo'].some(key => summary[key] !== 0) || /^Bail out!/m.test(output)) {
    throw new Error('Release suite contains failed, cancelled, skipped or todo tests');
  }
  return summary;
}

const SYSTEM_ENV = new Set([
  'path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'tmpdir',
  'home', 'userprofile', 'appdata', 'localappdata', 'programdata', 'systemdrive',
]);

/** Do not inherit application credentials, NODE_OPTIONS, proxy settings or a DB URL. */
export function systemEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && SYSTEM_ENV.has(key.toLowerCase())));
}

export function testEnvironment(source, { databaseUrl, databaseName, guardUrl, upgradeFlag }) {
  return {
    ...systemEnvironment(source),
    NODE_ENV: 'test', TZ: 'UTC', FORCE_COLOR: '0', NO_COLOR: '1',
    DATABASE_URL: databaseUrl,
    ODDPATH_DB_INTEGRATION_DATABASE: databaseName,
    ODDPATH_DB_INTEGRATION_TESTS: '1',
    ODDPATH_DB_INTEGRATION_ALLOW_REMOTE: '0',
    ODDPATH_RELEASE_NETWORK_GUARD: '1',
    NODE_OPTIONS: `--import=${guardUrl}`,
    AI_ENABLED: 'false', GUEST_AI_ENABLED: 'false', GEMINI_API_KEY: '',
    GEMINI_PAID_SERVICE_CONFIRMED: 'false', AI_WORKFLOW_ROUTER_ENABLED: 'false',
    PROJECT_DOCUMENT_EMBEDDINGS_ENABLED: 'false', PRIVATE_ASSETS_ENABLED: 'false',
    EMAIL_PROVIDER: 'noop', EMAIL_FROM: 'fixture@example.test',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_USER: '', SMTP_PASS: '',
    ...(upgradeFlag ? { [upgradeFlag]: '1' } : {}),
  };
}

export function sanitizeOutput(value, secrets = []) {
  let result = String(value).replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[REDACTED_DATABASE_URL]');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

export function ownsContainer(inspected, name, token, expectedId) {
  return inspected?.Name === `/${name}` &&
    inspected.Config?.Labels?.['com.oddpath.release-run'] === token &&
    typeof inspected.Id === 'string' && /^[a-f0-9]{64}$/.test(inspected.Id) &&
    (!expectedId || inspected.Id === expectedId);
}
