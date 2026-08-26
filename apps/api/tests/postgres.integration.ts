import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { Pool } from "pg";

import { assertPostgresIntegrationTarget } from "./helpers/postgresIntegrationTarget.ts";

process.env.NODE_ENV = "test";

const target = assertPostgresIntegrationTarget(process.env);
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
    const restore = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50 * 1024 * 1024, privateAssetsEnabled: true },
      createAssetId: () => assetId,
      createObjectKey: () => objectKey,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
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
    const restore = createBinaryAssetRestoreService({
      config: { assetUserQuotaBytes: 50 * 1024 * 1024, privateAssetsEnabled: true },
      createAssetId: () => assetId,
      createObjectKey: () => objectKey,
      now: () => new Date("2026-08-23T12:00:00.000Z"),
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

    assert.deepEqual(
      new Set(batch.jobs.map((job) => job.id)),
      new Set([deletableJobId, detachedJobId])
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
    const claims = batches.flatMap((batch) => batch.jobs).filter((job) => job.id === jobId);
    assert.equal(claims.length, 1);
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
});

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
