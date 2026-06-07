-- CreateTable
CREATE TABLE "ProjectInstruction" (
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInstruction_pkey" PRIMARY KEY ("projectId")
);

-- Migrate existing project-scoped memory into one instruction record per project.
INSERT INTO "ProjectInstruction" ("projectId", "content", "createdAt", "updatedAt")
SELECT
    "projectId",
    string_agg("content", E'\n\n' ORDER BY "updatedAt" ASC),
    MIN("createdAt"),
    MAX("updatedAt")
FROM "Memory"
WHERE "scope" = 'PROJECT' AND "projectId" IS NOT NULL
GROUP BY "projectId";

-- Project instructions replace project-scoped memory records.
DELETE FROM "Memory"
WHERE "scope" = 'PROJECT';

-- AddForeignKey
ALTER TABLE "ProjectInstruction" ADD CONSTRAINT "ProjectInstruction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
