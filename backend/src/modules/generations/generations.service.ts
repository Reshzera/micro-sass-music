import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KieResponseCode } from '../../externals/kieClient/kie-client.constants';
import { KieApiError } from '../../externals/kieClient/kie-client.error';
import { KieClientService } from '../../externals/kieClient/kie-client.service';
import type {
  KieGenerateMusicInput,
  KieMusicCallbackPayload,
  KieMusicTaskRecord,
  KieMusicTrack,
} from '../../externals/kieClient/types/kie-music.types';
import type { KieTaskState } from '../../externals/kieClient/types/kie-task.types';
import { GenerationState, type Track } from '../../generated/prisma/client';
import { CreateGenerationDto } from './dto/create-generation.dto';
import type {
  GenerationProgress,
  GenerationWithTracks,
} from './generations.repository';
import { GenerationsRepository } from './generations.repository';
import type {
  GenerationAccepted,
  GenerationCallbackEvent,
  GenerationStatus,
  GenerationTrack,
} from './types/generation.types';

/** KIE's task states are spelled exactly like our enum, so the map is 1:1. */
const STATE_BY_KIE_STATE = {
  waiting: GenerationState.waiting,
  queuing: GenerationState.queuing,
  generating: GenerationState.generating,
  success: GenerationState.success,
  fail: GenerationState.fail,
} satisfies Record<KieTaskState, GenerationState>;

/** Once a generation reaches one of these, KIE has nothing left to tell us. */
const TERMINAL_STATES: GenerationState[] = [
  GenerationState.success,
  GenerationState.fail,
];

function toGenerationTrack(track: KieMusicTrack): GenerationTrack {
  return {
    id: track.id,
    title: track.title,
    tags: track.tags,
    duration: track.duration,
    audioUrl: track.audio_url,
    streamAudioUrl: track.stream_audio_url,
    imageUrl: track.image_url,
    modelName: track.model_name,
  };
}

/** Columns are nullable; the API shape leaves absent fields out instead. */
function toGenerationTrackFromRow(track: Track): GenerationTrack {
  return {
    id: track.id,
    title: track.title ?? undefined,
    tags: track.tags ?? undefined,
    duration: track.duration ?? undefined,
    audioUrl: track.audioUrl ?? undefined,
    streamAudioUrl: track.streamAudioUrl ?? undefined,
    imageUrl: track.imageUrl ?? undefined,
    modelName: track.modelName ?? undefined,
  };
}

function toGenerationStatus(
  generation: GenerationWithTracks,
): GenerationStatus {
  return {
    taskId: generation.taskId,
    state: generation.state,
    tracks: generation.tracks.map(toGenerationTrackFromRow),
    failReason: generation.failReason,
    costTime: generation.costTime,
    createdAt: generation.createdAt,
    completedAt: generation.completedAt,
  };
}

/**
 * Consumer of `KieClientService`, and owner of what we keep about a task.
 *
 * Handles the translation between our camelCase API and KIE's snake_case
 * `input`, persists every task through `GenerationsRepository`, and maps
 * `KieApiError` onto HTTP responses — the client itself stays
 * framework-agnostic.
 */
@Injectable()
export class GenerationsService {
  private readonly logger = new Logger(GenerationsService.name);

  constructor(
    private readonly kieClient: KieClientService,
    private readonly repository: GenerationsRepository,
  ) {}

  /**
   * Queue a track. Returns as soon as KIE accepts the task; the audio arrives
   * later on the webhook handled by `GenerationsController`.
   */
  async create(dto: CreateGenerationDto): Promise<GenerationAccepted> {
    let taskId: string;
    try {
      taskId = await this.kieClient.generateMusic(this.toKieInput(dto));
    } catch (error) {
      throw this.toHttpException(error);
    }

    try {
      await this.repository.create({
        taskId,
        model: dto.model,
        instrumental: dto.instrumental,
        customMode: dto.customMode ?? false,
        prompt: dto.prompt,
        title: dto.title,
        style: dto.style,
        lyrics: dto.lyrics,
        negativeTags: dto.negativeTags,
      });
    } catch (error) {
      // The task is already queued and billed upstream, so surface the id in
      // the logs — its webhooks will arrive with nothing to attach them to.
      this.logger.error(
        `KIE task ${taskId} was accepted but could not be stored`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }

    return { taskId };
  }

  /**
   * Stored state of a task. While it is still in flight we reconcile against
   * KIE first, which covers a webhook that never landed.
   */
  async findOne(taskId: string): Promise<GenerationStatus> {
    const stored = await this.repository.findByTaskId(taskId);
    if (!stored) {
      throw new NotFoundException(`No generation for task ${taskId}`);
    }

    if (TERMINAL_STATES.includes(stored.state)) {
      return toGenerationStatus(stored);
    }

    const reconciled = await this.reconcile(taskId);
    return toGenerationStatus(reconciled ?? stored);
  }

  /**
   * Persist one webhook delivery.
   *
   * KIE fires up to three times per task (`text`, `first`, `complete`) and
   * retries on failure, so this must stay idempotent — it reports what the
   * delivery contained and never assumes it is the first one seen.
   */
  async handleCallback(
    payload: KieMusicCallbackPayload,
  ): Promise<GenerationCallbackEvent> {
    const { callbackType, task_id: taskId, data } = payload.data;
    const ok = payload.code === KieResponseCode.Success;
    const tracks = (data ?? []).map(toGenerationTrack);
    const failReason = ok ? null : (payload.msg ?? `KIE code ${payload.code}`);

    if (ok) {
      this.logger.log(
        `KIE task ${taskId}: ${callbackType} delivery with ${tracks.length} track(s)`,
      );
    } else {
      this.logger.error(
        `KIE task ${taskId}: ${callbackType} delivery failed with code ${payload.code} — ${payload.msg ?? 'no message'}`,
      );
    }

    const finished = !ok || callbackType === 'complete';
    const updated = await this.repository.applyProgress(taskId, {
      state: ok
        ? callbackType === 'complete'
          ? GenerationState.success
          : GenerationState.generating
        : GenerationState.fail,
      failReason,
      completedAt: finished ? new Date() : undefined,
      tracks,
    });

    if (!updated) {
      this.logger.warn(
        `KIE task ${taskId} is not on record — dropping its ${callbackType} delivery`,
      );
    }

    return { taskId, stage: callbackType, ok, failReason, tracks };
  }

  /**
   * Pull the current record from KIE and fold it into our row. Best effort:
   * an upstream hiccup should not stop us from serving what we already have.
   */
  private async reconcile(
    taskId: string,
  ): Promise<GenerationWithTracks | null> {
    let record: KieMusicTaskRecord;
    try {
      record = await this.kieClient.getMusicTask(taskId);
    } catch (error) {
      this.logger.warn(
        `Could not reconcile KIE task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    const progress: GenerationProgress = {
      state: STATE_BY_KIE_STATE[record.state],
      failReason: record.failMsg ?? record.failCode ?? null,
      costTime: record.costTime,
      completedAt: record.completeTime ? new Date(record.completeTime) : null,
      tracks: this.kieClient.extractTracks(record).map(toGenerationTrack),
    };

    return this.repository.applyProgress(taskId, progress);
  }

  private toKieInput(dto: CreateGenerationDto): KieGenerateMusicInput {
    return {
      custom_mode: dto.customMode ?? false,
      instrumental: dto.instrumental,
      model: dto.model,
      prompt: dto.prompt,
      lyrics: dto.lyrics,
      style: dto.style,
      title: dto.title,
      negative_tags: dto.negativeTags,
      vocal_gender: dto.vocalGender,
      style_weight: dto.styleWeight,
      weirdness_constraint: dto.weirdnessConstraint,
      audio_weight: dto.audioWeight,
      variety: dto.variety,
      persona_id: dto.personaId,
      persona_model: dto.personaModel,
      duration: dto.duration,
      image_urls: dto.imageUrls,
      video_urls: dto.videoUrls,
      audio_urls: dto.audioUrls,
    };
  }

  /**
   * An upstream failure is not our caller's fault, so only genuinely
   * caller-driven codes surface as 4xx.
   */
  private toHttpException(error: unknown): Error {
    if (!(error instanceof KieApiError)) {
      return error instanceof Error ? error : new Error(String(error));
    }

    if (error.code === KieResponseCode.Unprocessable) {
      return new BadRequestException(error.message);
    }

    if (error.code === KieResponseCode.NotFound) {
      return new NotFoundException(error.message);
    }

    if (error.isOutOfCredits) {
      this.logger.error(`KIE account is out of credits: ${error.message}`);
      return new ServiceUnavailableException('Music generation is unavailable');
    }

    if (error.isAuthFailure) {
      this.logger.error(`KIE rejected our API key: ${error.message}`);
      return new ServiceUnavailableException('Music generation is unavailable');
    }

    if (error.isRetryable) {
      return new ServiceUnavailableException(
        'Music generation is busy, retry shortly',
      );
    }

    return new BadGatewayException(error.message);
  }
}
