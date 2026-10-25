import { Prisma } from '../../generated/prisma/client.js';

/** Attempts own their window. Only the unused part of an active hold is added. */
export async function aggregateQuotaUsage(tx:Prisma.TransactionClient,input:{since:Date;actions:readonly string[];userId?:string;guestId?:string;ipHash?:string}) {
  const identity=input.userId?Prisma.sql`AND e."userId"=${input.userId}`
    :input.guestId?Prisma.sql`AND e."guestId"=${input.guestId}`
    :input.ipHash?Prisma.sql`AND e."ipHash"=${input.ipHash}`:Prisma.empty;
  const [row]=await tx.$queryRaw<Array<{units:bigint;requests:bigint}>>(Prisma.sql`
    WITH scoped AS (
      SELECT e.* FROM "UsageEvent" e WHERE e."action" IN (${Prisma.join([...input.actions])}) ${identity}
      AND (e."createdAt">=${input.since} OR (e."reservationPolicy" IS NOT NULL AND
        (e."status"='reserved' OR EXISTS (SELECT 1 FROM "UsageProviderAttempt" recent WHERE recent."eventId"=e."id" AND recent."startedAt">=${input.since}))))
    ), attempts AS (
      SELECT a."eventId", MIN(a."startedAt") AS first_at,
        SUM(COALESCE(r."credits",a."creditsUsed",a."creditsReserved")) AS total,
        COALESCE(SUM(COALESCE(r."credits",a."creditsUsed",a."creditsReserved")) FILTER (WHERE a."startedAt">=${input.since}),0) AS window_units,
        COUNT(*) FILTER (WHERE a."startedAt">=${input.since}) AS window_requests
      FROM "UsageProviderAttempt" a JOIN scoped e ON e."id"=a."eventId"
      LEFT JOIN "UsageSettlementReceipt" r ON r."attemptId"=a."id"
      GROUP BY a."eventId"
    )
    SELECT COALESCE(SUM(CASE WHEN e."reservationPolicy" IS NULL
      THEN CASE WHEN e."createdAt">=${input.since} THEN e."units" ELSE 0 END
      ELSE COALESCE(a.window_units,0)
        + CASE WHEN a.first_at>=${input.since} THEN e."fixedCredits" ELSE 0 END
        + CASE WHEN e."status"='reserved'
          THEN GREATEST(e."units"-COALESCE(a.total,0)-CASE WHEN a."eventId" IS NOT NULL THEN e."fixedCredits" ELSE 0 END,0)
          ELSE 0 END END),0)::bigint AS units,
      COALESCE(SUM(CASE WHEN e."reservationPolicy" IS NULL
        THEN CASE WHEN e."createdAt">=${input.since} THEN GREATEST(e."providerAttempts",1) ELSE 0 END
        ELSE COALESCE(a.window_requests,0)+CASE WHEN e."status"='reserved' AND a."eventId" IS NULL THEN 1 ELSE 0 END END),0)::bigint AS requests
    FROM scoped e LEFT JOIN attempts a ON a."eventId"=e."id"
  `);
  if(!row)throw new Error('Quota aggregation returned no result.');
  return {unitsUsed:Number(row.units),requestCount:Number(row.requests)};
}
