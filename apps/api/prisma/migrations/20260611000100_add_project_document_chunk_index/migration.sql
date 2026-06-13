-- CreateEnum
CREATE TYPE "ProjectDocumentIndexStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ProjectDocumentEmbeddingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "ProjectDocument"
ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT '',
ADD COLUMN "chunkingVersion" TEXT NOT NULL DEFAULT '',
ADD COLUMN "indexStatus" "ProjectDocumentIndexStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "indexError" TEXT,
ADD COLUMN "indexedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProjectDocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "embeddingDimensions" INTEGER,
    "embeddingStatus" "ProjectDocumentEmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "embeddingError" TEXT,
    "embeddedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_indexStatus_idx" ON "ProjectDocument"("projectId", "indexStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDocumentChunk_documentId_chunkIndex_key" ON "ProjectDocumentChunk"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "ProjectDocumentChunk_documentId_embeddingStatus_idx" ON "ProjectDocumentChunk"("documentId", "embeddingStatus");

-- AddForeignKey
ALTER TABLE "ProjectDocumentChunk"
ADD CONSTRAINT "ProjectDocumentChunk_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
