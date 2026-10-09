import { KIE_RETRYABLE_CODES, KieResponseCode } from './kie-client.constants';

export type KieApiErrorKind =
  | 'api' // KIE answered with a non-200 envelope code
  | 'network' // request never completed
  | 'timeout' // aborted locally
  | 'malformed' // body was not the expected envelope
  | 'task_failed'; // task reached state `fail`

export interface KieApiErrorOptions {
  kind: KieApiErrorKind;
  /** Envelope `code`, when KIE sent one. */
  code?: number;
  /** Transport-level status, when a response arrived. */
  httpStatus?: number;
  taskId?: string;
  cause?: unknown;
}

/**
 * Transport-agnostic failure from the KIE API. Deliberately not an
 * `HttpException`: mapping an upstream failure onto one of our own status
 * codes is the calling module's decision, not the client's.
 */
export class KieApiError extends Error {
  readonly kind: KieApiErrorKind;
  readonly code?: number;
  readonly httpStatus?: number;
  readonly taskId?: string;

  constructor(message: string, options: KieApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'KieApiError';
    this.kind = options.kind;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.taskId = options.taskId;
  }

  /** True when the same request has a reasonable chance of succeeding later. */
  get isRetryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') {
      return true;
    }
    return this.code !== undefined && KIE_RETRYABLE_CODES.includes(this.code);
  }

  get isAuthFailure(): boolean {
    return this.code === KieResponseCode.Unauthorized;
  }

  get isOutOfCredits(): boolean {
    return this.code === KieResponseCode.InsufficientCredits;
  }
}
