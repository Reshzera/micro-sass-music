-- CreateEnum
CREATE TYPE "GenerationState" AS ENUM ('waiting', 'queuing', 'generating', 'success', 'fail');

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "state" "GenerationState" NOT NULL DEFAULT 'waiting',
    "model" TEXT NOT NULL,
    "instrumental" BOOLEAN NOT NULL DEFAULT false,
    "customMode" BOOLEAN NOT NULL DEFAULT false,
    "prompt" TEXT,
    "title" TEXT,
    "style" TEXT,
    "lyrics" TEXT,
    "negativeTags" TEXT,
    "failReason" TEXT,
    "costTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "title" TEXT,
    "tags" TEXT,
    "duration" DOUBLE PRECISION,
    "audioUrl" TEXT,
    "streamAudioUrl" TEXT,
    "imageUrl" TEXT,
    "modelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Generation_taskId_key" ON "Generation"("taskId");

-- CreateIndex
CREATE INDEX "Generation_state_idx" ON "Generation"("state");

-- CreateIndex
CREATE INDEX "Generation_createdAt_idx" ON "Generation"("createdAt");

-- CreateIndex
CREATE INDEX "Track_generationId_idx" ON "Track"("generationId");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
