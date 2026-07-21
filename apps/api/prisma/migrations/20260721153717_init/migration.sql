-- CreateEnum
CREATE TYPE "FileType" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ValueRecommendation" AS ENUM ('KEEP', 'OPTIMIZE', 'ARCHIVE', 'RETIRE');

-- CreateEnum
CREATE TYPE "DataType" AS ENUM ('STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PiiCategory" AS ENUM ('EMAIL', 'PHONE', 'ID_NUMBER', 'CREDIT_CARD', 'DATE_OF_BIRTH', 'NAME', 'ADDRESS', 'IP_ADDRESS', 'POSTAL_CODE', 'NONE', 'OTHER');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('AUTO_REGEX', 'AUTO_AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "QualityCheckType" AS ENUM ('MISSING_VALUES', 'DUPLICATE_ROWS', 'INVALID_VALUES', 'TYPE_MISMATCH', 'EMPTY_COLUMN', 'DUPLICATE_HEADER');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "AccessType" AS ENUM ('VIEW', 'DETAIL_VIEW', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "AccessSource" AS ENUM ('SEED', 'LIVE');

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "fileType" "FileType" NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "columnCount" INTEGER NOT NULL,
    "status" "DatasetStatus" NOT NULL DEFAULT 'PROCESSING',
    "qualityScore" DOUBLE PRECISION,
    "trustScore" DOUBLE PRECISION,
    "valueScore" DOUBLE PRECISION,
    "valueRecommendation" "ValueRecommendation",
    "scoreBreakdown" JSONB,
    "healthNarrative" TEXT,
    "sampleRows" JSONB,
    "errorMessage" TEXT,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Column" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "dataType" "DataType" NOT NULL,
    "missingCount" INTEGER NOT NULL,
    "missingPct" DOUBLE PRECISION NOT NULL,
    "distinctCount" INTEGER NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL,
    "validity" DOUBLE PRECISION NOT NULL,
    "sampleValues" JSONB NOT NULL,

    CONSTRAINT "Column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationTag" (
    "id" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "category" "PiiCategory" NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL,
    "source" "TagSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassificationTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCheck" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "columnId" TEXT,
    "checkType" "QualityCheckType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "affectedCount" INTEGER NOT NULL,
    "affectedPct" DOUBLE PRECISION NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessEvent" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "type" "AccessType" NOT NULL,
    "source" "AccessSource" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "trustScore" DOUBLE PRECISION NOT NULL,
    "valueScore" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Column_datasetId_position_key" ON "Column"("datasetId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationTag_columnId_key" ON "ClassificationTag"("columnId");

-- CreateIndex
CREATE INDEX "QualityCheck_datasetId_idx" ON "QualityCheck"("datasetId");

-- CreateIndex
CREATE INDEX "AccessEvent_datasetId_occurredAt_idx" ON "AccessEvent"("datasetId", "occurredAt");

-- CreateIndex
CREATE INDEX "AccessEvent_occurredAt_idx" ON "AccessEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_datasetId_capturedAt_idx" ON "ScoreSnapshot"("datasetId", "capturedAt");

-- AddForeignKey
ALTER TABLE "Column" ADD CONSTRAINT "Column_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationTag" ADD CONSTRAINT "ClassificationTag_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCheck" ADD CONSTRAINT "QualityCheck_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessEvent" ADD CONSTRAINT "AccessEvent_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
