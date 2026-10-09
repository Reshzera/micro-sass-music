/** Default KIE API host. Override with `KIE_API_BASE_URL`. */
export const KIE_DEFAULT_BASE_URL = 'https://api.kie.ai';

/** Default per-request timeout in milliseconds. Override with `KIE_REQUEST_TIMEOUT_MS`. */
export const KIE_DEFAULT_TIMEOUT_MS = 30_000;

/** Generic async job endpoints shared by every KIE model. */
export const KIE_CREATE_TASK_PATH = '/api/v1/jobs/createTask';
export const KIE_RECORD_INFO_PATH = '/api/v1/jobs/recordInfo';

/**
 * Task models accepted by `createTask`. `generate` is the one wired up here;
 * the rest follow the same `ai-music-api/<task>` naming and are listed so
 * callers can reach them through `createTask` without a new constant.
 */
export const KieMusicTaskModel = {
  Generate: 'ai-music-api/generate',
  Extend: 'ai-music-api/extend',
  Cover: 'ai-music-api/cover',
  Sounds: 'ai-music-api/sounds',
  UploadAndCover: 'ai-music-api/upload-and-cover',
  UploadAndExtend: 'ai-music-api/upload-and-extend',
  SeparateVocals: 'ai-music-api/separate-vocals',
  CreateMusicVideo: 'ai-music-api/create-music-video',
} as const;

export type KieMusicTaskModel =
  (typeof KieMusicTaskModel)[keyof typeof KieMusicTaskModel];

/** KIE returns HTTP 200 with the real outcome in the envelope `code`. */
export const KieResponseCode = {
  Success: 200,
  Unauthorized: 401,
  InsufficientCredits: 402,
  NotFound: 404,
  Conflict: 409,
  Unprocessable: 422,
  RateLimited: 429,
  Unavailable: 451,
  GenerationFailed: 455,
  ServerError: 500,
} as const;

/** Codes worth retrying with backoff; everything else is a hard failure. */
export const KIE_RETRYABLE_CODES: readonly number[] = [
  KieResponseCode.RateLimited,
  KieResponseCode.ServerError,
];
