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
  KieMusicTrack,
} from '../../externals/kieClient/types/kie-music.types';
import { CreateGenerationDto } from './dto/create-generation.dto';
import type {
  GenerationAccepted,
  GenerationCallbackEvent,
  GenerationStatus,
  GenerationTrack,
} from './types/generation.types';

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

/**
 * Consumer of `KieClientService`.
 *
 * Owns the translation between our camelCase API and KIE's snake_case
 * `input`, and maps `KieApiError` onto HTTP responses — the client itself
 * stays framework-agnostic.
 */
@Injectable()
export class GenerationsService {
  private readonly logger = new Logger(GenerationsService.name);

  constructor(private readonly kieClient: KieClientService) {}

  /**
   * Queue a track. Returns as soon as KIE accepts the task; the audio arrives
   * later on the webhook handled by `GenerationsController`.
   */
  async create(dto: CreateGenerationDto): Promise<GenerationAccepted> {
    try {
      const taskId = await this.kieClient.generateMusic(this.toKieInput(dto));
      return { taskId };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  /** Read-through to KIE for reconciliation when a webhook never landed. */
  async findOne(taskId: string): Promise<GenerationStatus> {
    try {
      const record = await this.kieClient.getMusicTask(taskId);

      return {
        taskId: record.taskId,
        state: record.state,
        tracks: this.kieClient.extractTracks(record).map(toGenerationTrack),
        failReason: record.failMsg ?? record.failCode ?? null,
        costTime: record.costTime,
        createdAt: record.createTime,
        completedAt: record.completeTime,
      };
    } catch (error) {
      throw this.toHttpException(error);
    }
  }

  /**
   * Normalize one webhook delivery.
   *
   * KIE fires up to three times per task (`text`, `first`, `complete`) and
   * retries on failure, so this must stay idempotent — it reports what the
   * delivery contained and never assumes it is the first one seen.
   */
  handleCallback(payload: KieMusicCallbackPayload): GenerationCallbackEvent {
    const { callbackType, task_id: taskId, data } = payload.data;
    const ok = payload.code === KieResponseCode.Success;
    const tracks = (data ?? []).map(toGenerationTrack);

    if (ok) {
      this.logger.log(
        `KIE task ${taskId}: ${callbackType} delivery with ${tracks.length} track(s)`,
      );
    } else {
      this.logger.error(
        `KIE task ${taskId}: ${callbackType} delivery failed with code ${payload.code} — ${payload.msg ?? 'no message'}`,
      );
    }

    return {
      taskId,
      stage: callbackType,
      ok,
      failReason: ok ? null : (payload.msg ?? `KIE code ${payload.code}`),
      tracks,
    };
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
