import type { KieTaskRecord } from './kie-task.types';

/** Suno engine versions accepted by `input.model`. */
export type KieSunoModel =
  | 'V4'
  | 'V4_5'
  | 'V4_5PLUS'
  | 'V4_5ALL'
  | 'V5'
  | 'V5_5'
  | 'V6'
  | 'V6_MINI'
  | 'V6_WILD';

export type KieVocalGender = 'm' | 'f';

export type KiePersonaModel = 'style_persona' | 'voice_persona';

/**
 * `input` body for `ai-music-api/generate`.
 *
 * Field names are snake_case because that is what the API expects.
 * In custom mode `title` and `style` are required and `lyrics` carries the
 * words; otherwise `prompt` alone describes the track.
 */
export interface KieGenerateMusicInput {
  custom_mode: boolean;
  instrumental: boolean;
  model: KieSunoModel;
  /** Free-form description, max 3000 chars. Used when `custom_mode` is false. */
  prompt?: string;
  /** Lyrics for custom mode, max 5000 chars on V6. */
  lyrics?: string;
  /** Style tags, max 1000 chars on V6. */
  style?: string;
  /** Max 80 chars. Required when `custom_mode` is true. */
  title?: string;
  negative_tags?: string;
  vocal_gender?: KieVocalGender;
  /** 0–1, two decimals. */
  style_weight?: number;
  /** 0–1, two decimals. */
  weirdness_constraint?: number;
  /** 0–1, two decimals. */
  audio_weight?: number;
  /** 0–4, defaults to 1. */
  variety?: number;
  persona_id?: string;
  persona_model?: KiePersonaModel;
  /** 10–360 seconds. Custom mode only, on V5_5 and the V6 family. */
  duration?: number;
  /** Up to 5 images, 10 MB each. */
  image_urls?: string[];
  /** Up to 1 video, 100 MB / 241s. */
  video_urls?: string[];
  /** Reference audio, 6s–30min. */
  audio_urls?: string[];
}

/**
 * One generated track. KIE normally returns two per task.
 *
 * Audio and artwork are absent on the `text` callback, which fires as soon as
 * the lyrics exist — before anything has been rendered.
 */
export interface KieMusicTrack {
  id: string;
  audio_url?: string;
  stream_audio_url?: string;
  image_url?: string;
  prompt?: string;
  model_name?: string;
  title?: string;
  tags?: string;
  /** Unix epoch milliseconds. */
  createTime?: number;
  /** Seconds. */
  duration?: number;
}

/** `response` / parsed `resultJson` of a finished music task. */
export interface KieMusicTaskResponse {
  taskId?: string;
  task_id?: string;
  data?: KieMusicTrack[];
}

export type KieMusicTaskRecord = KieTaskRecord<KieMusicTaskResponse>;

/**
 * Body KIE POSTs to `callBackUrl`. It fires up to three times per task:
 * `text` once lyrics exist, `first` once one track is ready, `complete`
 * once every track is ready — so treat it as idempotent.
 */
export interface KieMusicCallbackPayload {
  code: number;
  msg?: string;
  data: {
    callbackType: 'text' | 'first' | 'complete';
    task_id: string;
    data?: KieMusicTrack[];
  };
}
