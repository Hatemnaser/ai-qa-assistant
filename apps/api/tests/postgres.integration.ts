import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { Pool } from "pg";

import type { ExecutionTaskV1, RunnerRegistrationV1 } from "@oddpath/qa-execution-contract";
import type { SubmitQaExecutionRecipeCommand } from "../src/modules/qa-requests/qa-execution-recipes.types.ts";
import { assertPostgresIntegrationTarget } from "./helpers/postgresIntegrationTarget.ts";

process.env.NODE_ENV = "test";
// Prisma writes timestamp-without-time-zone values in UTC. Keep node-postgres
// fixture inserts and reads on the same clock so these invariants are
// independent of the machine running the suite (for example Berlin vs UTC).
process.env.TZ = "UTC";

const target = assertPostgresIntegrationTarget(process.env);
await import("./test-sessions.postgres.integration.ts");
const pool = new Pool({
  connectionString: target.connectionString,
  max: 6,
});
const runId = `dbit-${randomUUID()}`;
const trackedAssetIds: string[] = [];
const trackedGuestIds: string[] = [];
const trackedObjectKeys: string[] = [];
const trackedProjectIds: string[] = [];
const trackedUserIds: string[] = [];
let applicationDatabaseWasLoaded = false;
let sequence = 0;

before(async () => {
  const identity = await pool.query<{
    databaseName: string;
    schemaName: string;
    serverVersion: string;
  }>(
    `SELECT current_database() AS "databaseName",
            current_schema() AS "schemaName",
            current_setting('server_version_num') AS "serverVersion"`
  );
  const databaseIdentity = identity.rows[0];
  assert.ok(databaseIdentity, "PostgreSQL did not return its database identity.");
  assert.equal(databaseIdentity.databaseName, target.databaseName);
  assert.equal(databaseIdentity.schemaName, target.schema);
  assert.ok(
    Number(databaseIdentity.serverVersion) >= 160_000,
    "PostgreSQL integration tests require PostgreSQL 16 or newer."
  );

  const migrationDirectory = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
  const migrationEntries = await readdir(migrationDirectory, { withFileTypes: true });
  const expectedMigrations = migrationEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const applied = await pool.query<{ migrationName: string }>(
    `SELECT "migration_name" AS "migrationName"
     FROM "_prisma_migrations"
     WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
     ORDER BY "migration_name" ASC`
  );
  const incomplete = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS "count"
     FROM "_prisma_migrations"
     WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL`
  );

  assert.deepEqual(
    applied.rows.map((row) => row.migrationName),
    expectedMigrations,
    "The disposable database must contain exactly the committed migration history."
  );
  assert.equal(incomplete.rows[0]?.count, "0");
});

describe("real PostgreSQL invariants", { concurrency: false }, () => {
  it("enforces the terms-acceptance pair constraint", async () => {
    await assertPostgresError(
      insertUser({
        acceptedTermsAt: null,
        acceptedTermsVersion: "2026-08",
        id: uniqueId("terms-version-only"),
      }),
      "23514"
    );
    await assertPostgresError(
      insertUser({
        acceptedTermsAt: new Date(),
        acceptedTermsVersion: null,
        id: uniqueId("terms-date-only"),
      }),
      "23514"
    );
    await assertPostgresError(
      insertUser({
        acceptedTermsAt: new Date(),
        acceptedTermsVersion: "",
        id: uniqueId("terms-empty-version"),
      }),
      "23514"
    );

    const validUserId = uniqueId("terms-valid");
    const acceptedAt = new Date("2026-08-19T12:00:00.000Z");
    await insertUser({
      acceptedTermsAt: acceptedAt,
      acceptedTermsVersion: "2026-08",
      id: validUserId,
      track: true,
    });

    const stored = await pool.query<{
      acceptedTermsAt: Date;
      acceptedTermsVersion: string;
    }>(
      `SELECT "acceptedTermsAt", "acceptedTermsVersion"
       FROM "User"
       WHERE "id" = $1`,
      [validUserId]
    );

    assert.equal(stored.rows[0]?.acceptedTermsVersion, "2026-08");
    assert.ok(stored.rows[0]?.acceptedTermsAt instanceof Date);
  });

  it("enforces stored-asset ownership, uniqueness, and project deletion semantics", async () => {
    const userId = uniqueId("asset-owner");
    const projectId = uniqueId("asset-project");
    const assetId = uniqueId("asset");
    const duplicateAssetId = uniqueId("asset-duplicate");
    const objectKey = `${runId}/assets/source.txt`;

    await insertUser({ id: userId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [projectId, userId, "DB integration project"]
    );

    trackedAssetIds.push(assetId);
    trackedObjectKeys.push(objectKey);
    await insertStoredAsset({ assetId, objectKey, projectId, userId });

    await assertPostgresError(
      insertStoredAsset({
        assetId: duplicateAssetId,
        objectKey,
        projectId,
        userId,
      }),
      "23505"
    );
    await assertPostgresError(
      pool.query(`DELETE FROM "User" WHERE "id" = $1`, [userId]),
      "23503"
    );

    await pool.query(`DELETE FROM "Project" WHERE "id" = $1`, [projectId]);
    const storedAsset = await pool.query<{ projectId: string | null }>(
      `SELECT "projectId" FROM "StoredAsset" WHERE "id" = $1`,
      [assetId]
    );

    assert.equal(storedAsset.rows[0]?.projectId, null);
  });

  it("enforces auth-email outbox kind, payload-state, and attempt constraints", async () => {
    const userId = uniqueId("outbox-user");
    const tokenId = uniqueId("verification-token");
    const tokenHash = uniqueId("verification-hash");
    const invalidKindJobId = uniqueId("outbox-invalid-kind");
    const invalidPayloadJobId = uniqueId("outbox-invalid-payload");
    const invalidAttemptsJobId = uniqueId("outbox-invalid-attempts");
    const validJobId = uniqueId("outbox-valid");
    const expiresAt = new Date(Date.now() + 60_000);

    await insertUser({ id: userId, track: true });
    await pool.query(
      `INSERT INTO "EmailVerificationToken"
         ("id", "userId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, $4)`,
      [tokenId, userId, tokenHash, expiresAt]
    );

    await assertPostgresError(
      insertEmailJob({
        emailVerificationTokenId: tokenId,
        id: invalidKindJobId,
        kind: "PASSWORD_RESET",
        status: "PENDING",
        encryptedPayload: "ciphertext",
        expiresAt,
      }),
      "23514"
    );
    await assertPostgresError(
      insertEmailJob({
        emailVerificationTokenId: tokenId,
        encryptedPayload: "ciphertext",
        expiresAt,
        id: invalidPayloadJobId,
        kind: "EMAIL_VERIFICATION",
        status: "SENT",
      }),
      "23514"
    );
    await assertPostgresError(
      insertEmailJob({
        attempts: -1,
        emailVerificationTokenId: tokenId,
        encryptedPayload: "ciphertext",
        expiresAt,
        id: invalidAttemptsJobId,
        kind: "EMAIL_VERIFICATION",
        status: "PENDING",
      }),
      "23514"
    );

    await insertEmailJob({
      emailVerificationTokenId: tokenId,
      encryptedPayload: "ciphertext",
      expiresAt,
      id: validJobId,
      kind: "EMAIL_VERIFICATION",
      status: "PENDING",
    });
    await assertPostgresError(
      pool.query(
        `UPDATE "AuthEmailJob"
         SET "status" = 'SENT', "sentAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = $1`,
        [validJobId]
      ),
      "23514"
    );
    await pool.query(
      `UPDATE "AuthEmailJob"
       SET "encryptedPayload" = NULL,
           "sentAt" = CURRENT_TIMESTAMP,
           "status" = 'SENT',
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [validJobId]
    );

    const storedJob = await pool.query<{ encryptedPayload: string | null; status: string }>(
      `SELECT "encryptedPayload", "status" FROM "AuthEmailJob" WHERE "id" = $1`,
      [validJobId]
    );
    assert.deepEqual(storedJob.rows[0], {
      encryptedPayload: null,
      status: "SENT",
    });

    await pool.query(`DELETE FROM "EmailVerificationToken" WHERE "id" = $1`, [tokenId]);
    const cascadeResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count" FROM "AuthEmailJob" WHERE "id" = $1`,
      [validJobId]
    );
    assert.equal(cascadeResult.rows[0]?.count, "0");
  });

  it("serializes concurrent usage reservations through the real advisory-lock transaction", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaUsageRepository } = await import(
      "../src/modules/usage/usage.repository.ts"
    );
    const repository = createPrismaUsageRepository();
    const guestId = uniqueId("usage-guest");
    trackedGuestIds.push(guestId);
    const since = new Date(Date.now() - 60_000);
    const reservation = {
      action: "chat_message",
      event: {
        action: "chat_message",
        guestId,
        status: "reserved",
        units: 1,
      },
      guestId,
      isSignedIn: false,
      limit: 1,
      requestedUnits: 1,
      since,
    } as const;

    const results = await Promise.all([
      repository.reserveUsage(reservation),
      repository.reserveUsage(reservation),
    ]);
    const accepted = results.filter((result) => result.accepted);
    const rejected = results.filter((result) => !result.accepted);

    assert.equal(accepted.length, 1);
    assert.equal(accepted[0]?.usedBefore, 0);
    assert.equal(accepted[0]?.usedAfter, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.rejectionReason, "identity_limit");
    assert.equal(rejected[0]?.usedBefore, 1);

    const persisted = await pool.query<{ count: string; units: string }>(
      `SELECT COUNT(*)::text AS "count", COALESCE(SUM("units"), 0)::text AS "units"
       FROM "UsageEvent"
       WHERE "guestId" = $1 AND "action" = 'chat_message'`,
      [guestId]
    );
    assert.deepEqual(persisted.rows[0], { count: "1", units: "1" });
  });

  it("serializes concurrent project creation at the per-user quota", async () => {
    applicationDatabaseWasLoaded = true;
    const [{ DATA_LIMITS }, { createPrismaProjectsRepository }] = await Promise.all([
      import("../src/config/data-limits.ts"),
      import("../src/modules/projects/projects.repository.ts"),
    ]);
    const repository = createPrismaProjectsRepository();
    const userId = uniqueId("project-quota-user");
    await insertUser({ id: userId, track: true });

    for (let index = 0; index < DATA_LIMITS.projectsPerUser - 1; index += 1) {
      await pool.query(
        `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [uniqueId(`project-quota-seed-${index}`), userId, `Seed project ${index}`]
      );
    }

    const results = await Promise.allSettled([
      repository.createUserProject({ description: null, name: "Concurrent A", ownerId: userId }),
      repository.createUserProject({ description: null, name: "Concurrent B", ownerId: userId }),
    ]);
    const { fulfilled, rejected } = partitionSettled(results);

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(getErrorCode(rejected[0]?.reason), "PROJECT_LIMIT_REACHED");

    const persisted = await pool.query<{ memberships: string; projects: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "Project" WHERE "ownerId" = $1) AS "projects",
         (SELECT COUNT(*)::text FROM "ProjectMember"
          WHERE "userId" = $1 AND "role" = 'OWNER') AS "memberships"`,
      [userId]
    );
    assert.deepEqual(persisted.rows[0], {
      memberships: "1",
      projects: String(DATA_LIMITS.projectsPerUser),
    });
  });

  it("serializes concurrent chat creation at the per-user quota", async () => {
    applicationDatabaseWasLoaded = true;
    const [{ DATA_LIMITS }, { createPrismaChatHistoryRepository }] = await Promise.all([
      import("../src/config/data-limits.ts"),
      import("../src/modules/chat-history/chat-history.repository.ts"),
    ]);
    const repository = createPrismaChatHistoryRepository();
    const userId = uniqueId("chat-quota-user");
    await insertUser({ id: userId, track: true });

    for (let index = 0; index < DATA_LIMITS.chatsPerUser - 1; index += 1) {
      await pool.query(
        `INSERT INTO "Chat" ("id", "userId", "title", "updatedAt")
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [uniqueId(`chat-quota-seed-${index}`), userId, `Seed chat ${index}`]
      );
    }

    const now = new Date();
    const saveInput = (suffix: string) => ({
      chat: {
        id: uniqueId(`concurrent-chat-${suffix}`),
        messages: [],
        mode: "general",
        model: "gemini-2.5-flash",
        projectId: null,
        title: `Concurrent ${suffix}`,
      },
      createdAt: now,
      messages: [{
        assetAttachments: [],
        content: "Quota transaction",
        createdAt: now,
        id: uniqueId(`concurrent-message-${suffix}`),
        mode: "general",
        model: "gemini-2.5-flash",
        role: "USER" as const,
      }],
      updatedAt: now,
      userId,
    });
    const results = await Promise.allSettled([
      repository.saveUserChat(saveInput("A")),
      repository.saveUserChat(saveInput("B")),
    ]);
    const { fulfilled, rejected } = partitionSettled(results);

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(getErrorCode(rejected[0]?.reason), "CHAT_LIMIT_REACHED");

    const persisted = await pool.query<{ chats: string; messages: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "Chat" WHERE "userId" = $1) AS "chats",
         (SELECT COUNT(*)::text FROM "Message"
          WHERE "chatId" IN (SELECT "id" FROM "Chat" WHERE "userId" = $1)) AS "messages"`,
      [userId]
    );
    assert.deepEqual(persisted.rows[0], {
      chats: String(DATA_LIMITS.chatsPerUser),
      messages: "1",
    });
  });

  it("serializes concurrent document creation at the per-project quota", async () => {
    applicationDatabaseWasLoaded = true;
    const [{ DATA_LIMITS }, { createPrismaProjectDocumentsRepository }] = await Promise.all([
      import("../src/config/data-limits.ts"),
      import("../src/modules/project-documents/project-documents.repository.ts"),
    ]);
    const repository = createPrismaProjectDocumentsRepository();
    const userId = uniqueId("document-quota-user");
    const projectId = uniqueId("document-quota-project");
    await insertUser({ id: userId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, 'Document quota project', CURRENT_TIMESTAMP)`,
      [projectId, userId]
    );

    for (let index = 0; index < DATA_LIMITS.documentsPerProject - 1; index += 1) {
      await pool.query(
        `INSERT INTO "ProjectDocument"
           ("id", "projectId", "title", "content", "updatedAt")
         VALUES ($1, $2, $3, 'seed', CURRENT_TIMESTAMP)`,
        [uniqueId(`document-quota-seed-${index}`), projectId, `Seed document ${index}`]
      );
    }

    const results = await Promise.allSettled([
      repository.createProjectDocument({ content: "A", projectId, title: "Concurrent A" }),
      repository.createProjectDocument({ content: "B", projectId, title: "Concurrent B" }),
    ]);
    const { fulfilled, rejected } = partitionSettled(results);

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(getErrorCode(rejected[0]?.reason), "PROJECT_DOCUMENT_LIMIT_REACHED");

    const persisted = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
       FROM "ProjectDocument"
       WHERE "projectId" = $1`,
      [projectId]
    );
    assert.equal(persisted.rows[0]?.count, String(DATA_LIMITS.documentsPerProject));
  });

  it("serializes concurrent stored-asset reservations at the byte quota", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaAssetsRepository } = await import(
      "../src/modules/assets/assets.repository.ts"
    );
    const repository = createPrismaAssetsRepository();
    const userId = uniqueId("asset-quota-user");
    await insertUser({ id: userId, track: true });
    const expiresAt = new Date(Date.now() + 60_000);
    const reservation = (suffix: string) => ({
      checksumSha256: "b".repeat(64),
      declaredMimeType: "text/plain",
      expectedSizeBytes: 600,
      maxPendingPerUser: 10,
      objectKey: `${runId}/quota/${suffix}.txt`,
      originalName: `${suffix}.txt`,
      ownerId: userId,
      projectId: null,
      purpose: "CHAT_ATTACHMENT" as const,
      uploadExpiresAt: expiresAt,
      userQuotaBytes: 1_000,
    });

    const results = await Promise.allSettled([
      repository.createPendingAssetReservation(reservation("a")),
      repository.createPendingAssetReservation(reservation("b")),
    ]);
    const { fulfilled, rejected } = partitionSettled(results);
    trackedAssetIds.push(...fulfilled.map((result) => result.value.id));

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(getErrorCode(rejected[0]?.reason), "ASSET_QUOTA_REACHED");

    const persisted = await pool.query<{ bytes: string; count: string }>(
      `SELECT COUNT(*)::text AS "count",
              COALESCE(SUM("expectedSizeBytes"), 0)::text AS "bytes"
       FROM "StoredAsset"
       WHERE "ownerId" = $1`,
      [userId]
    );
    assert.deepEqual(persisted.rows[0], { bytes: "600", count: "1" });
  });

  it("keeps project mutations owner-scoped in real repository transactions", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaProjectsRepository } = await import(
      "../src/modules/projects/projects.repository.ts"
    );
    const repository = createPrismaProjectsRepository();
    const ownerId = uniqueId("project-owner");
    const otherUserId = uniqueId("project-other-user");
    const projectId = uniqueId("owned-project");
    await insertUser({ id: ownerId, track: true });
    await insertUser({ id: otherUserId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, 'Private project', CURRENT_TIMESTAMP)`,
      [projectId, ownerId]
    );

    const updated = await repository.updateOwnedProject({
      description: "Unauthorized change",
      name: "Stolen project",
      projectId,
      userId: otherUserId,
    });
    const deleted = await repository.deleteOwnedProject(otherUserId, projectId);

    assert.equal(updated, null);
    assert.equal(deleted, 0);
    const persisted = await pool.query<{ name: string; ownerId: string }>(
      `SELECT "name", "ownerId" FROM "Project" WHERE "id" = $1`,
      [projectId]
    );
    assert.deepEqual(persisted.rows[0], {
      name: "Private project",
      ownerId,
    });
  });

  it("atomically restores a staged binary attachment with its imported project", async () => {
    applicationDatabaseWasLoaded = true;
    const [
      { createBinaryAssetRestoreService },
      { createPrismaBinaryAssetRestoreRepository },
      { createPrismaDataPortabilityRepository },
    ] = await Promise.all([
      import("../src/modules/data-portability/binary-asset-restore.service.ts"),
      import("../src/modules/data-portability/binary-asset-restore.repository.ts"),
      import("../src/modules/data-portability/data-portability.repository.ts"),
    ]);
    const userId = uniqueId("binary-restore-user");
    const assetId = uniqueId("binary-restore-asset");
    const objectKey = `${runId}/restores/success.txt`;
    await insertUser({ id: userId, track: true });
    trackedAssetIds.push(assetId);
    trackedObjectKeys.push(objectKey);

    const packageData = createBinaryProjectImportPackage();
    const restoreStartedAt = new Date();
    const restore = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50 * 1024 * 1024, privateAssetsEnabled: true },
      createAssetId: () => assetId,
      createObjectKey: () => objectKey,
      now: () => new Date(restoreStartedAt.getTime()),
      repository: createPrismaBinaryAssetRestoreRepository(),
      storage: inMemoryRestoreStorage(),
    });
    const repository = createPrismaDataPortabilityRepository();

    const imported = await restore.runWithPreparedAssets(
      userId,
      packageData.project.binaryAssets,
      (uploadedAssets) =>
        repository.createImportedProject(userId, packageData, uploadedAssets)
    );
    trackedProjectIds.push(imported.projectId);

    const persisted = await pool.query<{
      assetProjectId: string;
      assetStatus: string;
      deletionJobs: string;
      messageId: string;
      ordinal: number;
    }>(
      `SELECT asset."projectId" AS "assetProjectId",
              asset."status"::text AS "assetStatus",
              attachment."messageId" AS "messageId",
              attachment."ordinal" AS "ordinal",
              (SELECT COUNT(*)::text FROM "ObjectDeletionJob" job
               WHERE job."objectKey" = asset."objectKey") AS "deletionJobs"
       FROM "StoredAsset" asset
       JOIN "MessageAttachment" attachment ON attachment."assetId" = asset."id"
       WHERE asset."id" = $1`,
      [assetId]
    );

    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0]?.assetProjectId, imported.projectId);
    assert.equal(persisted.rows[0]?.assetStatus, "READY");
    assert.equal(persisted.rows[0]?.ordinal, 0);
    assert.ok(persisted.rows[0]?.messageId);
    assert.equal(persisted.rows[0]?.deletionJobs, "0");
    assert.equal(imported.counts.assets, 1);
  });

  it("rolls back imported rows and durably quarantines staged objects when binary finalization fails", async () => {
    applicationDatabaseWasLoaded = true;
    const [
      { createBinaryAssetRestoreService },
      { createPrismaBinaryAssetRestoreRepository },
      { createPrismaDataPortabilityRepository },
    ] = await Promise.all([
      import("../src/modules/data-portability/binary-asset-restore.service.ts"),
      import("../src/modules/data-portability/binary-asset-restore.repository.ts"),
      import("../src/modules/data-portability/data-portability.repository.ts"),
    ]);
    const userId = uniqueId("binary-rollback-user");
    const assetId = uniqueId("binary-rollback-asset");
    const objectKey = `${runId}/restores/rollback.txt`;
    const deletedKeys: string[] = [];
    await insertUser({ id: userId, track: true });
    trackedAssetIds.push(assetId);
    trackedObjectKeys.push(objectKey);

    const packageData = createBinaryProjectImportPackage();
    const restoreStartedAt = new Date();
    const restore = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50 * 1024 * 1024, privateAssetsEnabled: true },
      createAssetId: () => assetId,
      createObjectKey: () => objectKey,
      now: () => new Date(restoreStartedAt.getTime()),
      repository: createPrismaBinaryAssetRestoreRepository(),
      storage: inMemoryRestoreStorage(deletedKeys),
    });
    const repository = createPrismaDataPortabilityRepository();

    await assert.rejects(
      () =>
        restore.runWithPreparedAssets(
          userId,
          packageData.project.binaryAssets,
          async (uploadedAssets) => {
            await pool.query(
              `UPDATE "StoredAsset" SET "checksumSha256" = $1, "updatedAt" = CURRENT_TIMESTAMP
               WHERE "id" = $2`,
              ["invalid-staged-checksum", assetId]
            );
            return repository.createImportedProject(
              userId,
              packageData,
              uploadedAssets
            );
          }
        ),
      (error: unknown) => getErrorCode(error) === "ASSET_RESTORE_STATE_INVALID"
    );

    const persisted = await pool.query<{
      assets: string;
      assetStatus: string | null;
      deletionJobs: string;
      projects: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "Project" WHERE "ownerId" = $1) AS "projects",
         (SELECT COUNT(*)::text FROM "StoredAsset" WHERE "id" = $2) AS "assets",
         (SELECT "status"::text FROM "StoredAsset" WHERE "id" = $2) AS "assetStatus",
         (SELECT COUNT(*)::text FROM "ObjectDeletionJob" WHERE "objectKey" = $3) AS "deletionJobs"`,
      [userId, assetId, objectKey]
    );
    assert.deepEqual(persisted.rows[0], {
      assets: "1",
      assetStatus: "DELETE_PENDING",
      deletionJobs: "1",
      projects: "0",
    });
    assert.deepEqual(deletedKeys, []);
  });

  it("never leases a PENDING restore job but still leases a detached account-deletion job", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaAssetsRepository } = await import(
      "../src/modules/assets/assets.repository.ts"
    );
    const userId = uniqueId("cleanup-eligibility-user");
    const pendingAssetId = uniqueId("cleanup-pending-asset");
    const deletableAssetId = uniqueId("cleanup-deletable-asset");
    const pendingObjectKey = `${runId}/cleanup/pending.txt`;
    const deletableObjectKey = `${runId}/cleanup/delete-pending.txt`;
    const detachedObjectKey = `${runId}/cleanup/account-deleted.txt`;
    const pendingJobId = uniqueId("cleanup-pending-job");
    const deletableJobId = uniqueId("cleanup-deletable-job");
    const detachedJobId = uniqueId("cleanup-detached-job");
    const now = new Date("2026-08-23T12:00:00.000Z");
    const leaseUntil = new Date("2026-08-23T12:15:00.000Z");

    await insertUser({ id: userId, track: true });
    trackedAssetIds.push(pendingAssetId, deletableAssetId);
    trackedObjectKeys.push(pendingObjectKey, deletableObjectKey, detachedObjectKey);
    await pool.query(
      `INSERT INTO "StoredAsset"
         ("id", "ownerId", "objectKey", "purpose", "status", "originalName",
          "declaredMimeType", "expectedSizeBytes", "checksumSha256",
          "uploadExpiresAt", "updatedAt")
       VALUES
         ($1, $2, $3, 'CHAT_ATTACHMENT', 'PENDING', 'pending.txt',
          'text/plain', 4, $6, $7, CURRENT_TIMESTAMP),
         ($4, $2, $5, 'CHAT_ATTACHMENT', 'DELETE_PENDING', 'delete.txt',
          'text/plain', 4, $6, NULL, CURRENT_TIMESTAMP)`,
      [
        pendingAssetId,
        userId,
        pendingObjectKey,
        deletableAssetId,
        deletableObjectKey,
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
        new Date("2026-08-23T13:00:00.000Z"),
      ]
    );
    await pool.query(
      `INSERT INTO "ObjectDeletionJob"
         ("id", "objectKey", "nextAttemptAt", "updatedAt")
       VALUES
         ($1, $2, $7, CURRENT_TIMESTAMP),
         ($3, $4, $7, CURRENT_TIMESTAMP),
         ($5, $6, $7, CURRENT_TIMESTAMP)`,
      [
        pendingJobId,
        pendingObjectKey,
        deletableJobId,
        deletableObjectKey,
        detachedJobId,
        detachedObjectKey,
        new Date("2026-08-23T11:00:00.000Z"),
      ]
    );

    const batch = await createPrismaAssetsRepository().claimCleanupBatch(
      now,
      leaseUntil,
      10
    );

    assert.equal(batch.lockAcquired, true, JSON.stringify(batch));
    assert.deepEqual(
      new Set(batch.jobs.map((job) => job.id)),
      new Set([deletableJobId, detachedJobId]),
      JSON.stringify(batch)
    );
    const schedules = await pool.query<{ id: string; nextAttemptAt: Date }>(
      `SELECT "id", "nextAttemptAt" FROM "ObjectDeletionJob"
       WHERE "id" = ANY($1::text[]) ORDER BY "id"`,
      [[pendingJobId, deletableJobId, detachedJobId]]
    );
    const scheduleById = new Map(
      schedules.rows.map((row) => [row.id, row.nextAttemptAt.toISOString()])
    );
    assert.equal(
      scheduleById.get(pendingJobId),
      "2026-08-23T11:00:00.000Z"
    );
    assert.equal(scheduleById.get(deletableJobId), leaseUntil.toISOString());
    assert.equal(scheduleById.get(detachedJobId), leaseUntil.toISOString());
  });

  it("fences concurrent cleanup instances by the exact database lease token", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaAssetsRepository } = await import(
      "../src/modules/assets/assets.repository.ts"
    );
    const userId = uniqueId("cleanup-fence-user");
    const assetId = uniqueId("cleanup-fence-asset");
    const jobId = uniqueId("cleanup-fence-job");
    const objectKey = `${runId}/cleanup/fenced-delete.txt`;
    const now = new Date("2026-08-23T14:00:00.000Z");
    const leaseA = new Date("2026-08-23T14:15:00.000Z");
    const leaseB = new Date("2026-08-23T14:16:00.000Z");
    const renewedLease = new Date("2026-08-23T14:30:00.000Z");

    await insertUser({ id: userId, track: true });
    trackedAssetIds.push(assetId);
    trackedObjectKeys.push(objectKey);
    await pool.query(
      `INSERT INTO "StoredAsset"
         ("id", "ownerId", "objectKey", "purpose", "status", "originalName",
          "declaredMimeType", "expectedSizeBytes", "checksumSha256", "updatedAt")
       VALUES
         ($1, $2, $3, 'CHAT_ATTACHMENT', 'DELETE_PENDING', 'delete.txt',
          'text/plain', 4, $4, CURRENT_TIMESTAMP)`,
      [
        assetId,
        userId,
        objectKey,
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=",
      ]
    );
    await pool.query(
      `INSERT INTO "ObjectDeletionJob"
         ("id", "objectKey", "nextAttemptAt", "updatedAt")
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [jobId, objectKey, new Date("2026-08-23T13:00:00.000Z")]
    );

    const firstRepository = createPrismaAssetsRepository();
    const secondRepository = createPrismaAssetsRepository();
    const batches = await Promise.all([
      firstRepository.claimCleanupBatch(now, leaseA, 10),
      secondRepository.claimCleanupBatch(now, leaseB, 10),
    ]);
    assert.equal(batches.filter((batch) => batch.lockAcquired).length, 1, JSON.stringify(batches));
    const claims = batches.flatMap((batch) => batch.jobs).filter((job) => job.id === jobId);
    assert.equal(claims.length, 1, JSON.stringify(batches));
    const claimedLease = claims[0]?.leaseUntil;
    assert.ok(claimedLease);
    assert.ok(
      [leaseA.toISOString(), leaseB.toISOString()].includes(claimedLease.toISOString())
    );

    assert.equal(
      await firstRepository.renewDeletionClaim(
        jobId,
        objectKey,
        claimedLease,
        renewedLease
      ),
      true
    );
    assert.equal(
      await secondRepository.recordDeletionFailure(
        jobId,
        objectKey,
        claimedLease,
        1,
        new Date("2026-08-23T14:31:00.000Z"),
        "Error:Timeout"
      ),
      false
    );
    assert.equal(
      await secondRepository.removeDeletedObject(jobId, objectKey, claimedLease),
      false
    );

    const beforeCompletion = await pool.query<{
      assets: string;
      jobs: string;
      nextAttemptAt: Date;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "StoredAsset" WHERE "id" = $1) AS "assets",
         (SELECT COUNT(*)::text FROM "ObjectDeletionJob" WHERE "id" = $2) AS "jobs",
         (SELECT "nextAttemptAt" FROM "ObjectDeletionJob" WHERE "id" = $2) AS "nextAttemptAt"`,
      [assetId, jobId]
    );
    assert.equal(beforeCompletion.rows[0]?.assets, "1");
    assert.equal(beforeCompletion.rows[0]?.jobs, "1");
    assert.equal(
      beforeCompletion.rows[0]?.nextAttemptAt.toISOString(),
      renewedLease.toISOString()
    );

    const completions = await Promise.all([
      firstRepository.removeDeletedObject(jobId, objectKey, renewedLease),
      secondRepository.removeDeletedObject(jobId, objectKey, renewedLease),
    ]);
    assert.deepEqual([...completions].sort(), [false, true]);

    const afterCompletion = await pool.query<{ assets: string; jobs: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM "StoredAsset" WHERE "id" = $1) AS "assets",
         (SELECT COUNT(*)::text FROM "ObjectDeletionJob" WHERE "id" = $2) AS "jobs"`,
      [assetId, jobId]
    );
    assert.deepEqual(afterCompletion.rows[0], { assets: "0", jobs: "0" });
  });

  it("rolls back a project document when its source asset ownership is invalid", async () => {
    applicationDatabaseWasLoaded = true;
    const { createPrismaProjectDocumentsRepository } = await import(
      "../src/modules/project-documents/project-documents.repository.ts"
    );
    const repository = createPrismaProjectDocumentsRepository();
    const projectOwnerId = uniqueId("document-project-owner");
    const assetOwnerId = uniqueId("document-asset-owner");
    const projectId = uniqueId("document-project");
    const assetId = uniqueId("foreign-source-asset");
    const objectKey = `${runId}/documents/foreign-source.txt`;
    await insertUser({ id: projectOwnerId, track: true });
    await insertUser({ id: assetOwnerId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, 'Document project', CURRENT_TIMESTAMP)`,
      [projectId, projectOwnerId]
    );
    trackedAssetIds.push(assetId);
    await insertStoredAsset({ assetId, objectKey, projectId, userId: assetOwnerId });

    await assert.rejects(
      () => repository.createProjectDocuments([{
        content: "private source",
        mimeType: "text/plain",
        projectId,
        source: "IMPORTED",
        sourceAssetId: assetId,
        sourceAssetOwnerId: projectOwnerId,
        title: "foreign-source.txt",
      }]),
      (error: unknown) => getErrorCode(error) === "ASSET_NOT_FOUND"
    );

    const persisted = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS "count"
       FROM "ProjectDocument"
       WHERE "projectId" = $1`,
      [projectId]
    );
    assert.equal(persisted.rows[0]?.count, "0");
  });

  it("persists the complete QA control-plane lifecycle with evidence and human review", async () => {
    const userId = uniqueId("qa-owner");
    const projectId = uniqueId("qa-project");
    await insertUser({ id: userId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, 'Checkout QA', CURRENT_TIMESTAMP)`,
      [projectId, userId]
    );

    applicationDatabaseWasLoaded = true;
    const { createPrismaQaRequestRepository } = await import(
      "../src/modules/qa-requests/qa-requests.repository.ts"
    );
    const { prisma } = await import("../src/db/prisma.ts");
    const repository = createPrismaQaRequestRepository(prisma);
    const actor = { kind: "USER" as const, transport: "WEB" as const, userId };
    const requestId = await repository.createRequest({
      actor,
      checklistMode: "AGENT_PROVIDED",
      objective: "Prove that checkout creates one order and keeps reviewable evidence.",
      projectId,
      snapshot: {
        degraded: false,
        payload: { project: { memory: "Checkout uses idempotency keys." } },
        payloadHash: createHash("sha256").update("qa-context").digest("hex"),
        retrievalMode: "LEXICAL_INDEXED",
        sourceManifest: { documents: [] },
      },
      title: "Checkout idempotency",
    });
    const artifactId = await repository.submitChecklist({
      actor,
      checklist: {
        items: [{
          clientRef: "checkout-double-submit",
          evidenceRequirements: [{
            description: "Observed order count and response",
            kind: "TEXT",
          }],
          expectedResult: "Exactly one order is created.",
          preconditions: ["An empty test cart exists"],
          steps: ["Submit checkout twice with the same idempotency key"],
          title: "Double submit",
        }],
        title: "Checkout checklist",
      },
      origin: "AGENT_PROVIDED",
      projectId,
      requestId,
    });
    await repository.completeChecklistAssessment({
      actor: { kind: "SYSTEM", transport: "SYSTEM" },
      artifactId,
      projectId,
      requestId,
      status: "PASSED",
      suggestions: [],
    });
    const lateArtifactId = await repository.submitChecklist({
      actor,
      checklist: {
        items: [{
          clientRef: "checkout-double-submit-revision",
          evidenceRequirements: [{
            description: "Observed order count and response",
            kind: "TEXT",
          }],
          expectedResult: "Exactly one order is created.",
          preconditions: ["An empty test cart exists"],
          steps: ["Submit checkout twice with the same idempotency key"],
          title: "Double submit revision",
        }],
        title: "Checkout checklist revision",
      },
      origin: "AGENT_PROVIDED",
      projectId,
      requestId,
      supersedesArtifactId: artifactId,
    });

    let detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    await repository.selectArtifact({
      actor,
      artifactId,
      expectedRequestVersion: detail.version,
      projectId,
      requestId,
    });
    const runId = await repository.startRun({
      actor,
      externalRunRef: "integration-run-001",
      projectId,
      requestId,
      sourceLabel: "PostgreSQL integration",
    });
    assert.equal(await repository.startRun({
      actor,
      externalRunRef: "integration-run-001",
      projectId,
      requestId,
      sourceLabel: "PostgreSQL integration",
    }), runId);

    await repository.completeChecklistAssessment({
      actor: { kind: "SYSTEM", transport: "SYSTEM" },
      artifactId: lateArtifactId,
      projectId,
      requestId,
      status: "PASSED",
      suggestions: [],
    });

    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    assert.equal(detail.phase, "RUNNING");
    const item = detail.artifacts.find((artifact) => artifact.id === artifactId)?.items[0];
    const requirement = item?.evidenceRequirements[0];
    const activeRun = detail.runs.find((run) => run.id === runId);
    assert.ok(item && requirement && activeRun);
    await repository.recordCheckResult({
      actor,
      checklistItemId: item.id,
      expectedVersion: activeRun.version,
      observedResult: "One order was persisted.",
      projectId,
      requestId,
      runId,
      status: "PASS",
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    await repository.finishRun({
      actor,
      expectedVersion: detail.runs.find((run) => run.id === runId)!.version,
      projectId,
      requestId,
      runId,
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    assert.equal(detail.phase, "EVIDENCE_NEEDED");
    await repository.addEvidence({
      actor,
      assetIds: [],
      checklistItemId: item.id,
      kind: "TEXT",
      projectId,
      requestId,
      requirementId: requirement.id,
      runId,
      textContent: "orders=1; response=200",
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    const reviewableRun = detail.runs.find((run) => run.id === runId)!;
    assert.equal(detail.phase, "READY_FOR_REVIEW");
    await repository.reviewRun({
      actor,
      decision: "CHANGES_REQUESTED",
      expectedRunVersion: reviewableRun.version,
      projectId,
      requestId,
      runId,
    });

    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    assert.equal(detail.phase, "CHANGES_REQUESTED");
    const secondRunId = await repository.startRun({
      actor,
      externalRunRef: "integration-run-002",
      projectId,
      requestId,
      sourceLabel: "PostgreSQL integration rerun",
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    await repository.recordCheckResult({
      actor,
      checklistItemId: item.id,
      expectedVersion: detail.runs.find((run) => run.id === secondRunId)!.version,
      observedResult: "One order was persisted on the rerun.",
      projectId,
      requestId,
      runId: secondRunId,
      status: "PASS",
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    await repository.finishRun({
      actor,
      expectedVersion: detail.runs.find((run) => run.id === secondRunId)!.version,
      projectId,
      requestId,
      runId: secondRunId,
    });
    await assert.rejects(
      () => repository.addEvidence({
        actor,
        assetIds: [],
        checklistItemId: item.id,
        kind: "TEXT",
        projectId,
        requestId,
        requirementId: requirement.id,
        runId,
        textContent: "stale evidence",
      }),
      (error: unknown) => getErrorCode(error) === "QA_RUN_SUPERSEDED"
    );
    await repository.addEvidence({
      actor,
      assetIds: [],
      checklistItemId: item.id,
      kind: "TEXT",
      projectId,
      requestId,
      requirementId: requirement.id,
      runId: secondRunId,
      textContent: "orders=1; response=200; rerun=true",
    });
    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    assert.equal(detail.phase, "READY_FOR_REVIEW");
    await assert.rejects(
      () => repository.reviewRun({
        actor,
        decision: "APPROVED",
        expectedRunVersion: detail.runs.find((run) => run.id === runId)!.version,
        projectId,
        requestId,
        runId,
      }),
      (error: unknown) => getErrorCode(error) === "QA_RUN_SUPERSEDED"
    );
    await repository.reviewRun({
      actor,
      decision: "APPROVED",
      expectedRunVersion: detail.runs.find((run) => run.id === secondRunId)!.version,
      projectId,
      requestId,
      runId: secondRunId,
    });

    detail = await repository.getRequest(projectId, requestId) as QaLifecycleDetail;
    assert.equal(detail.phase, "APPROVED");
    assert.equal(detail.runs[0]?.outcome, "PASS");
    assert.equal(detail.reviews[0]?.decision, "APPROVED");
    assert.equal(detail.reviews[1]?.decision, "CHANGES_REQUESTED");
    assert.deepEqual(
      detail.events.map((event) => event.sequence),
      detail.events.map((_event, index) => index + 1)
    );
  });

  it("retries a failed Recipe review, enforces approval boundaries, executes a claimed job, and deletes its project graph", async (t) => {
    const userId = uniqueId("harness-owner");
    const projectId = uniqueId("harness-project");
    await insertUser({ id: userId, track: true });
    trackedProjectIds.push(projectId);
    await pool.query(
      `INSERT INTO "Project" ("id", "ownerId", "name", "updatedAt")
       VALUES ($1, $2, 'Harness project', CURRENT_TIMESTAMP)`,
      [projectId, userId]
    );

    applicationDatabaseWasLoaded = true;
    const { prisma } = await import("../src/db/prisma.ts");
    const { createPrismaQaRequestRepository } = await import(
      "../src/modules/qa-requests/qa-requests.repository.ts"
    );
    const {
      createQaExecutionRecipeRepository,
      resolveProfileManifest,
    } = await import("../src/modules/qa-requests/qa-execution-recipes.repository.ts");
    const { createQaRunnerRepository } = await import(
      "../src/modules/qa-requests/qa-runner.repository.ts"
    );
    const { createQaExecutionRepository } = await import(
      "../src/modules/qa-requests/qa-execution.repository.ts"
    );
    const { createPrismaProjectsRepository } = await import(
      "../src/modules/projects/projects.repository.ts"
    );

    const requestRepository = createPrismaQaRequestRepository(prisma);
    const actor = { kind: "USER" as const, transport: "WEB" as const, userId };
    const requestId = await requestRepository.createRequest({
      actor,
      checklistMode: "AGENT_PROVIDED",
      objective: "Exercise the immutable recipe and runner lease lifecycle.",
      projectId,
      snapshot: {
        degraded: false,
        payload: { project: { name: "Harness project" } },
        payloadHash: createHash("sha256").update("harness-context").digest("hex"),
        retrievalMode: "LEXICAL_INDEXED",
        sourceManifest: { documents: [] },
      },
      title: "Execution harness",
    });
    const artifactId = await requestRepository.submitChecklist({
      actor,
      checklist: {
        items: [{
          clientRef: "checkout-visible",
          evidenceRequirements: [{
            description: "Record the visible checkout heading.",
            kind: "TEXT",
            required: true,
          }],
          expectedResult: "The checkout heading is visible.",
          preconditions: [],
          steps: ["Open checkout and observe its heading."],
          title: "Checkout is visible",
        }],
        title: "Harness checklist",
      },
      origin: "AGENT_PROVIDED",
      projectId,
      requestId,
    });
    await requestRepository.completeChecklistAssessment({
      actor: { kind: "SYSTEM", transport: "SYSTEM" },
      artifactId,
      projectId,
      requestId,
      status: "PASSED",
      suggestions: [],
    });
    let detail = await requestRepository.getRequest(projectId, requestId) as QaLifecycleDetail;
    await requestRepository.selectArtifact({
      actor,
      artifactId,
      expectedRequestVersion: detail.version,
      projectId,
      requestId,
    });
    detail = await requestRepository.getRequest(projectId, requestId) as QaLifecycleDetail;
    const checklistItem = detail.artifacts.find(({ id }) => id === artifactId)!.items[0]!;
    const requirement = checklistItem.evidenceRequirements[0]!;

    const connection = await prisma.projectConnectionToken.create({
      data: {
        name: "Integration runner",
        ownerId: userId,
        projectId,
        scopes: ["evidence:write", "execution:claim", "execution:write", "qa:read"],
        tokenHash: createHash("sha256").update(uniqueId("runner-token")).digest("hex"),
        tokenPrefix: "odp_live_integration",
      },
    });
    const profile = resolveProfileManifest({
      environmentKind: "TEST",
      evidenceKinds: ["TEXT"],
      executorKey: "playwright",
      label: "Disposable PostgreSQL",
      profileKey: "postgres.test",
      recipeSchemaVersions: [1],
      schemaVersion: 1,
      valueReferences: [],
    });
    const runnerRepository = createQaRunnerRepository(prisma);
    const registration: RunnerRegistrationV1 = {
      displayName: "PostgreSQL runner",
      executorKeys: ["playwright"],
      instanceId: "postgres-runner-1",
      profiles: [profile],
      protocolVersions: [1],
      runnerVersion: "0.1.0-test",
      schemaVersion: 1,
    };
    const runner = await runnerRepository.upsertRegistration({
      connectionTokenId: connection.id,
      projectId,
      registration,
    });
    const submitRecipeInput: SubmitQaExecutionRecipeCommand = {
      actor: {
        connectionTokenId: connection.id,
        kind: "INTEGRATION",
        transport: "REST",
        userId,
      },
      artifactId,
      bundle: {
        engine: "playwright",
        items: [{
          checklistItemId: checklistItem.id,
          steps: [
            {
              action: "navigate",
              path: "/checkout",
              ref: "open-checkout",
              waitUntil: "domcontentloaded",
            },
            {
              action: "expect",
              expectation: {
                kind: "visible",
                locator: { by: "role", name: "Checkout", role: "heading" },
              },
              ref: "see-checkout",
            },
          ],
        }],
        schemaVersion: 1,
      },
      origin: "AGENT_PROVIDED",
      profileManifest: profile,
      projectId,
      requestId,
      title: "Checkout recipe",
    };
    const recipeRepository = createQaExecutionRecipeRepository(prisma);
    const recipeId = await recipeRepository.submitRecipe(submitRecipeInput);
    const originalReview = await prisma.qaGenerationExecution.findFirstOrThrow({
      where: { recipeId, kind: "EXECUTION_RECIPE_REVIEW" },
    });
    const oldProcessing = { executionId: originalReview.id, leaseToken: "original-review-lease" };
    await prisma.qaGenerationExecution.update({
      data: {
        attempts: 3, leaseExpiresAt: new Date(Date.now() + 60_000),
        leaseToken: oldProcessing.leaseToken, status: "PROCESSING",
      },
      where: { id: originalReview.id },
    });
    await recipeRepository.failAssessment({
      actor, errorCode: "QA_RECIPE_REVIEW_INVALID", processing: oldProcessing,
      projectId, recipeId, requestId,
    });
    const failedAssessment = await prisma.qaExecutionRecipeAssessment.findFirstOrThrow({ where: { recipeId } });
    const failedOperation = await prisma.qaGenerationExecution.findUniqueOrThrow({ where: { id: originalReview.id } });
    const immutableRecipe = await prisma.qaExecutionRecipe.findUniqueOrThrow({
      include: { items: true }, where: { id: recipeId },
    });
    const executionRepository = createQaExecutionRepository(prisma);
    const startInput = {
      actor,
      confirmProduction: false,
      expectedRequestVersion: detail.version,
      profileKey: profile.profileKey,
      projectId,
      recipeHash: immutableRecipe.recipeHash,
      recipeId,
      requestId,
      runnerRegistrationId: runner.id,
    };
    await assert.rejects(executionRepository.start(startInput),
      (error: unknown) => getErrorCode(error) === "QA_RECIPE_ASSESSMENT_FAILED");
    const retryInput = { actor, assessmentId: failedAssessment.id, projectId, recipeId, requestId };
    await assert.rejects(recipeRepository.queueReviewRetry({
      ...retryInput, actor: { ...actor, userId: "another-owner" },
    }), (error: unknown) => getErrorCode(error) === "QA_REQUEST_NOT_FOUND");
    await assert.rejects(recipeRepository.queueReviewRetry({
      ...retryInput, actor: { ...actor, kind: "INTEGRATION", transport: "REST" },
    }), (error: unknown) => getErrorCode(error) === "QA_RECIPE_REVIEW_OWNER_REQUIRED");
    await assert.rejects(recipeRepository.queueReviewRetry({ ...retryInput, assessmentId: "stale-assessment" }),
      (error: unknown) => getErrorCode(error) === "QA_RECIPE_REVIEW_RETRY_INVALID");

    // Exercise a real transaction rollback after both retry records have been inserted.
    const rollbackRepository = createQaExecutionRecipeRepository({
      $transaction: (action: (tx: unknown) => Promise<unknown>) => prisma.$transaction(async (tx) => action(
        new Proxy(tx, {
          get(target, key) {
            if (key !== "qaWorkflowEvent") return Reflect.get(target, key);
            return new Proxy(tx.qaWorkflowEvent, {
              get(events, method) {
                if (method === "create") return async () => { throw new Error("synthetic retry audit failure"); };
                return Reflect.get(events, method);
              },
            });
          },
        })
      )),
    } as unknown as typeof prisma);
    await assert.rejects(rollbackRepository.queueReviewRetry(retryInput), /synthetic retry audit failure/);
    assert.equal(await prisma.qaExecutionRecipeAssessment.count({ where: { recipeId } }), 1);
    assert.equal(await prisma.qaGenerationExecution.count({ where: { recipeId } }), 1);

    const retryIds = await Promise.all(Array.from({ length: 5 }, () => recipeRepository.queueReviewRetry(retryInput)));
    assert.equal(new Set(retryIds).size, 1);
    const retryId = retryIds[0]!;
    const retryOperation = await prisma.qaGenerationExecution.findUniqueOrThrow({ where: { id: retryId } });
    assert.equal(retryOperation.recipeId, immutableRecipe.id);
    assert.equal(retryOperation.artifactId, immutableRecipe.artifactId);
    assert.equal(retryOperation.attempts, 0);
    assert.match(retryOperation.idempotencyKeyHash!, /^[a-f0-9]{64}$/);
    assert.deepEqual(retryOperation.profileManifest, immutableRecipe.profileManifest);
    assert.equal(retryOperation.profileManifestHash, immutableRecipe.profileManifestHash);
    assert.equal(await prisma.qaExecutionRecipeAssessment.count({ where: { recipeId } }), 2);
    assert.equal(await prisma.qaGenerationExecution.count({ where: { recipeId } }), 2);
    assert.equal(await prisma.qaWorkflowEvent.count({ where: { requestId, type: "EXECUTION_RECIPE_REVIEW_RETRIED" } }), 1);
    assert.equal(await prisma.qaExecutionAuthorization.count({ where: { recipeId } }), 0);
    assert.equal(await prisma.qaRun.count({ where: { requestId } }), 0);
    assert.deepEqual(await prisma.qaExecutionRecipe.findUniqueOrThrow({ include: { items: true }, where: { id: recipeId } }), immutableRecipe);
    const pending = await prisma.qaExecutionRecipeAssessment.findFirstOrThrow({
      orderBy: { createdAt: "desc" }, where: { recipeId },
    });
    assert.notEqual(pending.id, failedAssessment.id);
    assert.equal(pending.status, "PENDING");
    await assert.rejects(executionRepository.start(startInput),
      (error: unknown) => getErrorCode(error) === "QA_RECIPE_ASSESSMENT_PENDING");
    assert.equal(await prisma.qaExecutionAuthorization.count({ where: { recipeId } }), 0);
    assert.equal(await prisma.qaRun.count({ where: { requestId } }), 0);
    const retryProcessing = { executionId: retryId, leaseToken: "new-review-lease" };
    await prisma.qaGenerationExecution.update({
      data: {
        attempts: 1, leaseExpiresAt: new Date(Date.now() + 60_000),
        leaseToken: retryProcessing.leaseToken, status: "PROCESSING",
      },
      where: { id: retryId },
    });
    await assert.rejects(recipeRepository.completeAssessment({
      actor, processing: oldProcessing, projectId, recipeId, requestId, status: "PASSED", suggestions: [],
    }), (error: unknown) => getErrorCode(error) === "QA_PROCESSING_LEASE_LOST");
    await assert.rejects(recipeRepository.failAssessment({
      actor, errorCode: "STALE_FAILURE", processing: oldProcessing, projectId, recipeId, requestId,
    }), (error: unknown) => getErrorCode(error) === "QA_PROCESSING_LEASE_LOST");
    await recipeRepository.completeAssessment({
      actor, processing: retryProcessing, projectId, recipeId, requestId, status: "PASSED", suggestions: [],
    });
    assert.equal(await recipeRepository.queueReviewRetry(retryInput), retryId);
    assert.equal(await prisma.qaGenerationExecution.count({ where: { recipeId } }), 2);
    assert.deepEqual(await prisma.qaExecutionRecipeAssessment.findUniqueOrThrow({ where: { id: failedAssessment.id } }), failedAssessment);
    assert.deepEqual(await prisma.qaGenerationExecution.findUniqueOrThrow({ where: { id: originalReview.id } }), failedOperation);
    assert.equal((await prisma.qaExecutionRecipeAssessment.findUniqueOrThrow({ where: { id: pending.id } })).status, "PASSED");
    await t.test("deduplicates concurrent submissions by both Recipe and immutable profile", async () => {
      const repeatedIds = await Promise.all(Array.from({ length: 4 }, () =>
        recipeRepository.submitRecipe(submitRecipeInput)));
      assert.deepEqual(repeatedIds, Array(4).fill(recipeId));
      const stagingProfile = resolveProfileManifest({
        ...profile, environmentKind: "STAGING", manifestHash: undefined,
      });
      const stagingIds = await Promise.all(Array.from({ length: 4 }, () =>
        recipeRepository.submitRecipe({ ...submitRecipeInput, profileManifest: stagingProfile })));
      assert.equal(new Set(stagingIds).size, 1);
      assert.notEqual(stagingIds[0], recipeId);
      const stagingRecipe = await prisma.qaExecutionRecipe.findUniqueOrThrow({
        include: { assessments: true }, where: { id: stagingIds[0]! },
      });
      assert.equal(stagingRecipe.revision, immutableRecipe.revision + 1);
      assert.equal(stagingRecipe.recipeHash, immutableRecipe.recipeHash);
      assert.equal(stagingRecipe.profileManifestHash, stagingProfile.manifestHash);
      assert.notEqual(stagingRecipe.profileManifestHash, immutableRecipe.profileManifestHash);
      assert.equal(stagingRecipe.assessments.length, 1);
      assert.equal(stagingRecipe.assessments[0]?.status, "PENDING");
      assert.equal(await prisma.qaGenerationExecution.count({ where: { recipeId: stagingRecipe.id } }), 1);
      assert.equal(await prisma.qaExecutionRecipe.count({ where: { artifactId } }), 2);
      assert.equal(await prisma.qaExecutionRecipeAssessment.count({ where: { recipeId } }), 2);
      assert.equal((await prisma.qaExecutionRecipeAssessment.findUniqueOrThrow({ where: { id: pending.id } })).status, "PASSED");
      assert.deepEqual(await prisma.qaExecutionRecipe.findUniqueOrThrow({
        include: { items: true }, where: { id: recipeId },
      }), immutableRecipe);
    });

    const integrationActor = {
      connectionTokenId: connection.id,
      kind: "INTEGRATION" as const,
      transport: "REST" as const,
      userId,
    };
    const productionProfile = resolveProfileManifest({
      ...profile, environmentKind: "PRODUCTION", manifestHash: undefined,
    });
    const setRunnerProfile = (changed: boolean) => runnerRepository.upsertRegistration({
      connectionTokenId: connection.id,
      projectId,
      registration: { ...registration, profiles: [changed ? productionProfile : profile] },
    });
    const startReviewedRun = async () => {
      const request = await prisma.qaRequest.findUniqueOrThrow({ where: { id: requestId } });
      const started = await executionRepository.start({
        ...startInput, expectedRequestVersion: request.version,
      });
      return { ...started, requestVersion: request.version };
    };
    const claimRun = (leaseToken: string) => executionRepository.claim({
      actor: integrationActor,
      connectionTokenId: connection.id,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseToken,
      request: { instanceId: registration.instanceId, registrationId: runner.id },
    });
    const assertApprovalFailurePersisted = async (started: {
      executionId: string; runId: string; requestVersion: number;
    }) => {
      const job = await prisma.qaExecutionJob.findUniqueOrThrow({
        include: { authorization: true, run: true }, where: { id: started.executionId },
      });
      assert.equal(job.status, "FAILED");
      assert.equal(job.errorCode, "QA_PROFILE_MANIFEST_CHANGED");
      assert.equal(job.leaseExpiresAt, null);
      assert.equal(job.leaseTokenHash, null);
      assert.ok(job.completedAt);
      assert.equal(job.run.status, "CANCELLED");
      assert.equal(job.run.version, 2);
      assert.equal(job.authorization.productionConfirmed, false);
      assert.equal(job.authorization.profileManifestHash, profile.manifestHash);
      assert.equal(job.profileManifestHash, profile.manifestHash);
      const request = await prisma.qaRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.equal(request.phase, "READY_TO_RUN");
      assert.equal(request.version, started.requestVersion + 2);
      assert.equal(await prisma.qaCheckResult.count({ where: { runId: started.runId } }), 0);
      assert.equal(await prisma.qaEvidence.count({ where: { runId: started.runId } }), 0);
      const failureEvents = await prisma.qaWorkflowEvent.findMany({
        where: { requestId, type: "EXECUTION_FAILED" },
      });
      assert.equal(failureEvents.filter((event) =>
        (event.metadata as { executionId?: string } | null)?.executionId === started.executionId).length, 1);
    };

    await t.test("cannot claim a TEST approval as PRODUCTION after re-registration", async () => {
      const started = await startReviewedRun();
      await setRunnerProfile(true);
      assert.equal(await claimRun("changed-profile-before-claim-token"), null);
      await assertApprovalFailurePersisted(started);
      await setRunnerProfile(false);
    });

    await t.test("commits terminal failure before rejecting acceptance after a profile change", async () => {
      const started = await startReviewedRun();
      const leaseToken = "changed-profile-after-claim-token";
      const claimed = await claimRun(leaseToken) as QaExecutionClaimResult;
      assert.equal(claimed.claim.executionId, started.executionId);
      assert.deepEqual(claimed.task.profile, profile);
      await setRunnerProfile(true);
      await assert.rejects(executionRepository.accept({
        actor: integrationActor, connectionTokenId: connection.id, executionId: started.executionId,
        lease: { claimId: claimed.claim.claimId, leaseToken },
      }), (error: unknown) => getErrorCode(error) === "QA_PROFILE_MANIFEST_CHANGED");
      await assertApprovalFailurePersisted(started);
      await setRunnerProfile(false);
    });

    await t.test("revalidates the immutable profile before reclaiming an expired running lease", async () => {
      const started = await startReviewedRun();
      const leaseToken = "expired-running-lease-profile-token";
      const claimed = await claimRun(leaseToken) as QaExecutionClaimResult;
      assert.equal(claimed.claim.executionId, started.executionId);
      await executionRepository.accept({
        actor: integrationActor, connectionTokenId: connection.id, executionId: started.executionId,
        lease: { claimId: claimed.claim.claimId, leaseToken },
      });
      // Only this test-owned job is expired; no clock wait or user record is needed.
      await prisma.qaExecutionJob.update({
        data: { leaseExpiresAt: new Date(Date.now() - 1_000) }, where: { id: started.executionId },
      });
      await setRunnerProfile(true);
      assert.equal(await claimRun("replacement-lease-must-not-get-a-task"), null);
      await assertApprovalFailurePersisted(started);
      assert.equal((await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: started.executionId } })).attempts, 2);
      await setRunnerProfile(false);
    });

    const started = await startReviewedRun();
    const agentConnection = await prisma.projectConnectionToken.create({
      data: {
        name: "Unassigned QA agent", ownerId: userId, projectId,
        scopes: ["qa:read", "qa:write", "evidence:write"],
        tokenHash: createHash("sha256").update(uniqueId("agent-token")).digest("hex"),
        tokenPrefix: "odp_live_test_agent",
      },
    });
    const genericActors = [
      actor,
      { ...integrationActor, connectionTokenId: agentConnection.id },
      { ...integrationActor, connectionTokenId: agentConnection.id, transport: "MCP" as const },
    ];
    const mutationSnapshot = async () => ({
      request: await prisma.qaRequest.findUniqueOrThrow({ where: { id: requestId } }),
      run: await prisma.qaRun.findUniqueOrThrow({ where: { id: started.runId } }),
      job: await prisma.qaExecutionJob.findUniqueOrThrow({ where: { id: started.executionId } }),
      results: await prisma.qaCheckResult.findMany({ where: { runId: started.runId } }),
      evidence: await prisma.qaEvidence.findMany({ where: { runId: started.runId } }),
      eventCount: await prisma.qaWorkflowEvent.count({ where: { requestId } }),
    });
    const assertGenericMutationsRejected = async () => {
      const before = await mutationSnapshot();
      for (const genericActor of genericActors) {
        const runInput = { actor: genericActor, projectId, requestId, runId: started.runId };
        await assert.rejects(requestRepository.recordCheckResult({
          ...runInput, checklistItemId: checklistItem.id, expectedVersion: before.run.version, status: "PASS",
        }), (error: unknown) => getErrorCode(error) === "QA_EXECUTION_PROTOCOL_REQUIRED");
        await assert.rejects(requestRepository.addEvidence({
          ...runInput, assetIds: [], checklistItemId: checklistItem.id, kind: "TEXT",
          requirementId: requirement.id, textContent: "Generic writes must not alter an approved execution.",
        }), (error: unknown) => getErrorCode(error) === "QA_EXECUTION_PROTOCOL_REQUIRED");
        await assert.rejects(requestRepository.finishRun({
          ...runInput, expectedVersion: before.run.version,
        }), (error: unknown) => getErrorCode(error) === "QA_EXECUTION_PROTOCOL_REQUIRED");
      }
      assert.deepEqual(await mutationSnapshot(), before);
    };
    for (const status of ["CREATED", "ACTIVE"] as const) {
      await t.test(`rejects owner and generic REST/MCP writes without side effects for ${status} runs`, async () => {
        // Start creates ACTIVE runs; also cover the supported CREATED enum with test-owned fixture state.
        await prisma.qaRun.update({ data: { status }, where: { id: started.runId } });
        await assertGenericMutationsRejected();
      });
    }

    const leaseToken = "integration-lease-token-that-is-long-enough";
    const claimed = await executionRepository.claim({
      actor: integrationActor,
      connectionTokenId: connection.id,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseToken,
      request: { instanceId: "postgres-runner-1", registrationId: runner.id },
    }) as QaExecutionClaimResult;
    assert.equal(claimed.claim.executionId, started.executionId);
    assert.deepEqual(claimed.task.profile, profile);
    const lease = { claimId: claimed.claim.claimId, leaseToken };
    await executionRepository.accept({
      actor: integrationActor,
      connectionTokenId: connection.id,
      executionId: started.executionId,
      lease,
    });
    const itemReceipt = await executionRepository.recordItem({
      actor: integrationActor,
      checklistItemId: checklistItem.id,
      connectionTokenId: connection.id,
      executionId: started.executionId,
      lease,
      submission: {
        evidence: [{
          kind: "TEXT",
          requirementId: requirement.id,
          textContent: "Checkout heading was visible in the disposable test.",
        }],
        expectedRunVersion: claimed.task.runVersion,
        observedResult: "Checkout heading is visible.",
        status: "PASS",
      },
    }) as { runVersion: number };
    await t.test("keeps generic mutations fenced even when Runner results and required proof are complete", async () => {
      await assertGenericMutationsRejected();
    });
    await executionRepository.finish({
      actor: integrationActor,
      connectionTokenId: connection.id,
      executionId: started.executionId,
      finish: { expectedRunVersion: itemReceipt.runVersion },
      lease,
    });
    const finishedJob = await prisma.qaExecutionJob.findUniqueOrThrow({
      where: { id: started.executionId },
    });
    assert.equal(finishedJob.status, "SUCCEEDED");

    // The alternative-profile subtest deliberately queued a review without a
    // provider. Active durable work must now fence project deletion.
    await assert.rejects(
      createPrismaProjectsRepository(prisma).deleteOwnedProject(userId, projectId),
      (error: unknown) => getErrorCode(error) === "PROJECT_TEST_WORK_ACTIVE"
    );
    const pendingReviews = await prisma.qaGenerationExecution.findMany({
      where: { requestId, kind: "EXECUTION_RECIPE_REVIEW", status: "PENDING" },
    });
    assert.equal(pendingReviews.length, 1);
    for (const operation of pendingReviews) {
      // Terminalize only this fixture's unexecuted alternate-profile review.
      await prisma.qaExecutionRecipeAssessment.updateMany({
        where: { recipeId: operation.recipeId!, status: "PENDING" },
        data: { status: "FAILED", errorCode: "DB_TEST_PROVIDER_NOT_RUN", completedAt: new Date() },
      });
      await prisma.qaGenerationExecution.update({
        where: { id: operation.id }, data: { status: "FAILED", errorCode: "DB_TEST_PROVIDER_NOT_RUN", completedAt: new Date() },
      });
    }
    const deleted = await createPrismaProjectsRepository(prisma).deleteOwnedProject(userId, projectId);
    assert.equal(deleted, 1);
    assert.equal(await prisma.qaExecutionJob.count({ where: { projectId } }), 0);
    assert.equal(await prisma.qaRequest.count({ where: { projectId } }), 0);
  });
});

interface QaLifecycleDetail {
  phase: string;
  version: number;
  artifacts: Array<{
    id: string;
    items: Array<{
      id: string;
      evidenceRequirements: Array<{ id: string }>;
    }>;
  }>;
  runs: Array<{ id: string; outcome: string; version: number }>;
  reviews: Array<{ decision: string }>;
  events: Array<{ sequence: number }>;
}

interface QaExecutionClaimResult {
  claim: { claimId: string; executionId: string };
  task: ExecutionTaskV1;
}

after(async () => {
  if (trackedGuestIds.length > 0) {
    await pool.query(`DELETE FROM "UsageEvent" WHERE "guestId" = ANY($1::text[])`, [
      trackedGuestIds,
    ]);
  }
  if (trackedProjectIds.length > 0) {
    await pool.query(`DELETE FROM "Project" WHERE "id" = ANY($1::text[])`, [
      trackedProjectIds,
    ]);
  }
  if (trackedAssetIds.length > 0) {
    await pool.query(`DELETE FROM "MessageAttachment" WHERE "assetId" = ANY($1::text[])`, [
      trackedAssetIds,
    ]);
    await pool.query(`DELETE FROM "StoredAsset" WHERE "id" = ANY($1::text[])`, [
      trackedAssetIds,
    ]);
  }
  if (trackedUserIds.length > 0) {
    await pool.query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [trackedUserIds]);
  }
  if (trackedObjectKeys.length > 0) {
    await pool.query(`DELETE FROM "ObjectDeletionJob" WHERE "objectKey" = ANY($1::text[])`, [
      trackedObjectKeys,
    ]);
  }

  if (applicationDatabaseWasLoaded) {
    const { prisma } = await import("../src/db/prisma.ts");
    await prisma.$disconnect();
  }
  await pool.end();
});

async function insertUser({
  acceptedTermsAt = null,
  acceptedTermsVersion = null,
  id,
  track = false,
}: {
  acceptedTermsAt?: Date | null;
  acceptedTermsVersion?: string | null;
  id: string;
  track?: boolean;
}) {
  if (track) trackedUserIds.push(id);

  return pool.query(
    `INSERT INTO "User"
       ("id", "email", "acceptedTermsAt", "acceptedTermsVersion", "updatedAt")
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
    [id, `${id}@integration.invalid`, acceptedTermsAt, acceptedTermsVersion]
  );
}

function insertStoredAsset({
  assetId,
  objectKey,
  projectId,
  userId,
}: {
  assetId: string;
  objectKey: string;
  projectId: string;
  userId: string;
}) {
  return pool.query(
    `INSERT INTO "StoredAsset"
       ("id", "ownerId", "projectId", "objectKey", "purpose", "status",
        "originalName", "declaredMimeType", "expectedSizeBytes", "checksumSha256", "updatedAt")
     VALUES ($1, $2, $3, $4, 'PROJECT_DOCUMENT_SOURCE', 'READY',
             'source.txt', 'text/plain', 4, $5, CURRENT_TIMESTAMP)`,
    [assetId, userId, projectId, objectKey, "a".repeat(64)]
  );
}

function insertEmailJob({
  attempts = 0,
  emailVerificationTokenId,
  encryptedPayload,
  expiresAt,
  id,
  kind,
  status,
}: {
  attempts?: number;
  emailVerificationTokenId: string;
  encryptedPayload: string | null;
  expiresAt: Date;
  id: string;
  kind: "EMAIL_VERIFICATION" | "PASSWORD_RESET";
  status: "PENDING" | "SENT";
}) {
  return pool.query(
    `INSERT INTO "AuthEmailJob"
       ("id", "userId", "kind", "status", "encryptedPayload",
        "emailVerificationTokenId", "attempts", "expiresAt", "updatedAt")
     SELECT $1, "userId", $2::"AuthEmailKind", $3::"AuthEmailJobStatus", $4,
            "id", $5, $6, CURRENT_TIMESTAMP
     FROM "EmailVerificationToken"
     WHERE "id" = $7`,
    [id, kind, status, encryptedPayload, attempts, expiresAt, emailVerificationTokenId]
  );
}

async function assertPostgresError(promise: Promise<unknown>, expectedCode: string) {
  await assert.rejects(promise, (error: unknown) => {
    const actualCode = getPostgresErrorCode(error);
    assert.equal(
      actualCode,
      expectedCode,
      `Expected PostgreSQL SQLSTATE ${expectedCode}, received ${actualCode || "no SQLSTATE"}`
    );
    return true;
  });
}

function getPostgresErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function getErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function partitionSettled<T>(results: PromiseSettledResult<T>[]) {
  return {
    fulfilled: results.filter(
      (result): result is PromiseFulfilledResult<T> => result.status === "fulfilled"
    ),
    rejected: results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    ),
  };
}

function uniqueId(label: string) {
  sequence += 1;
  return `${runId}-${label}-${sequence}`;
}

function createBinaryProjectImportPackage() {
  const bytes = new TextEncoder().encode("portable postgres restore");
  const checksumSha256 = createHash("sha256").update(bytes).digest("base64");
  const now = new Date("2026-08-23T12:00:00.000Z");

  return {
    formatVersion: "2.0" as const,
    packageDigest: createHash("sha256").update("postgres-package").digest("hex"),
    project: {
      binaryAssets: [
        {
          binding: {
            kind: "message_attachment" as const,
            ordinal: 0,
            sourceMessageId: "source-message-1",
          },
          bytes,
          checksumSha256,
          file: {
            path: "assets/001-restore.txt",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            sizeBytes: bytes.byteLength,
          },
          mimeType: "text/plain",
          originalName: "restore.txt",
          purpose: "CHAT_ATTACHMENT" as const,
          sizeBytes: bytes.byteLength,
          sourceAssetId: "source-asset-1",
          sourceProjectId: "source-project-1",
        },
      ],
      chats: [
        {
          createdAt: now,
          messages: [
            {
              attachments: [
                { mimeType: "text/plain", name: "restore.txt", type: "file" as const },
              ],
              content: "Restore this attachment.",
              createdAt: now,
              isError: false,
              mode: "general",
              model: "gemini-3.1-flash-lite",
              role: "user" as const,
              sourceId: "source-message-1",
            },
          ],
          mode: "general",
          model: "gemini-3.1-flash-lite",
          sourceId: "source-chat-1",
          title: "Binary restore",
          updatedAt: now,
        },
      ],
      description: null,
      documents: [],
      instructions: null,
      memory: null,
      name: "Binary restore project",
      sourceId: "source-project-1",
    },
    unsupported: [],
    warnings: [],
  };
}

function inMemoryRestoreStorage(deletedKeys: string[] = []) {
  return {
    async deleteObject(objectKey: string) {
      deletedKeys.push(objectKey);
    },
    async writeObject(input: {
      bytes: Uint8Array;
      checksumSha256: string;
      contentType: string;
    }) {
      return {
        checksumSha256: input.checksumSha256,
        contentLength: input.bytes.byteLength,
        contentType: input.contentType,
        etag: "postgres-integration-etag",
      };
    },
  };
}
