-- Additive only: record identities, content, timestamps and QA outcomes stay intact.
ALTER TABLE "Chat" ADD COLUMN "nextTimelinePosition" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Message" ADD COLUMN "timelinePosition" INTEGER;
ALTER TABLE "QaWorkflowEvent" ADD COLUMN "timelinePosition" INTEGER;
ALTER TABLE "TestSessionTurn" ADD COLUMN "providerStartedAt" TIMESTAMP(3);
ALTER TABLE "TestSessionTurn" ADD COLUMN "lastRetryKey" TEXT;

CREATE TEMPORARY TABLE oddpath_timeline_backfill AS
SELECT *, ROW_NUMBER() OVER (
  PARTITION BY "chatId" ORDER BY "createdAt", source, sequence, id
)::INTEGER AS position FROM (
  SELECT "chatId", "createdAt", 0 AS source, 0 AS sequence, id FROM "Message"
  UNION ALL
  SELECT r."testSessionId", e."createdAt", 1, e.sequence, e.id
  FROM "QaWorkflowEvent" e JOIN "QaRequest" r ON r.id = e."requestId"
  WHERE r."testSessionId" IS NOT NULL
) entries;
UPDATE "Message" m SET "timelinePosition" = b.position
FROM oddpath_timeline_backfill b WHERE b.source = 0 AND b.id = m.id;
UPDATE "QaWorkflowEvent" e SET "timelinePosition" = b.position
FROM oddpath_timeline_backfill b WHERE b.source = 1 AND b.id = e.id;
UPDATE "Chat" c SET "nextTimelinePosition" = b.next_position
FROM (SELECT "chatId", MAX(position) + 1 AS next_position
      FROM oddpath_timeline_backfill GROUP BY "chatId") b WHERE b."chatId" = c.id;
DROP TABLE oddpath_timeline_backfill;
CREATE INDEX "Message_chatId_timelinePosition_idx" ON "Message"("chatId", "timelinePosition");
