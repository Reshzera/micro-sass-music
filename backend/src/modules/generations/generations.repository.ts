import { Injectable } from '@nestjs/common';
import type {
  Generation,
  GenerationState,
  Track,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { GenerationTrack } from './types/generation.types';

/** A generation row with the tracks its webhooks have delivered so far. */
export type GenerationWithTracks = Generation & { tracks: Track[] };

/** The part of a queued generation worth keeping — mirrors the request body. */
export interface CreateGenerationRecord {
  taskId: string;
  model: string;
  instrumental: boolean;
  customMode: boolean;
  prompt?: string;
  title?: string;
  style?: string;
  lyrics?: string;
  negativeTags?: string;
}

/**
 * Everything one webhook delivery (or one reconciliation read) can teach us
 * about a generation. Omitted fields are left as they are in the row, so a
 * `text` delivery carrying no audio never blanks out a `first` delivery.
 */
export interface GenerationProgress {
  state?: GenerationState;
  failReason?: string | null;
  costTime?: number | null;
  completedAt?: Date | null;
  tracks?: GenerationTrack[];
}

/** Tracks come back oldest first so the response order is stable. */
const WITH_TRACKS = {
  tracks: { orderBy: { createdAt: 'asc' } },
} as const;

/**
 * Every Postgres read and write for the generations module.
 *
 * Keeps `GenerationsService` free of Prisma: the service talks KIE and HTTP,
 * this talks rows.
 */
@Injectable()
export class GenerationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Record a task KIE has just accepted. Starts out in `waiting`. */
  create(record: CreateGenerationRecord): Promise<GenerationWithTracks> {
    return this.prisma.generation.create({
      data: record,
      include: WITH_TRACKS,
    });
  }

  findByTaskId(taskId: string): Promise<GenerationWithTracks | null> {
    return this.prisma.generation.findUnique({
      where: { taskId },
      include: WITH_TRACKS,
    });
  }

  /**
   * Fold one delivery into the stored generation, returning the row as it now
   * stands — or `null` if no such task is on record.
   *
   * KIE fires up to three webhooks per task and retries them, so this has to
   * be idempotent: tracks are upserted on their KIE id, which is stable across
   * the `first` and `complete` deliveries.
   */
  applyProgress(
    taskId: string,
    progress: GenerationProgress,
  ): Promise<GenerationWithTracks | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.generation.findUnique({
        where: { taskId },
        select: { id: true },
      });

      if (!existing) {
        return null;
      }

      for (const track of progress.tracks ?? []) {
        // Undefined fields are skipped by Prisma, which is what we want: a
        // re-delivery that drops a field must not erase what we already have.
        const fields = {
          title: track.title,
          tags: track.tags,
          duration: track.duration,
          audioUrl: track.audioUrl,
          streamAudioUrl: track.streamAudioUrl,
          imageUrl: track.imageUrl,
          modelName: track.modelName,
        };

        await tx.track.upsert({
          where: { id: track.id },
          create: { id: track.id, generationId: existing.id, ...fields },
          update: fields,
        });
      }

      return tx.generation.update({
        where: { id: existing.id },
        data: {
          state: progress.state,
          failReason: progress.failReason,
          costTime: progress.costTime,
          completedAt: progress.completedAt,
        },
        include: WITH_TRACKS,
      });
    });
  }
}
