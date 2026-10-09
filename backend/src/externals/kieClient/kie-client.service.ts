import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KIE_CREATE_TASK_PATH,
  KIE_DEFAULT_BASE_URL,
  KIE_DEFAULT_TIMEOUT_MS,
  KIE_RECORD_INFO_PATH,
  KieMusicTaskModel,
  KieResponseCode,
} from './kie-client.constants';
import { KieApiError } from './kie-client.error';
import type {
  KieCreateTaskData,
  KieEnvelope,
} from './types/kie-envelope.types';
import type {
  KieGenerateMusicInput,
  KieMusicTaskRecord,
  KieMusicTaskResponse,
  KieMusicTrack,
} from './types/kie-music.types';
import type { KieTaskRecord } from './types/kie-task.types';

interface RequestOptions {
  query?: Record<string, string>;
  body?: unknown;
}

export interface CreateTaskOptions {
  /**
   * Webhook KIE calls as the task progresses. Falls back to
   * `KIE_CALLBACK_URL`.
   */
  callBackUrl?: string;
}

/**
 * Thin client over the KIE async jobs API (https://docs.kie.ai).
 *
 * Every generation model shares two endpoints: `createTask` hands back a
 * `taskId` immediately, then KIE posts the result to `callBackUrl`.
 * `getTask` reads the current record for reconciliation, but the webhook is
 * the delivery path — see `GenerationsController`.
 */
@Injectable()
export class KieClientService {
  private readonly logger = new Logger(KieClientService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly defaultCallbackUrl?: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('KIE_API_KEY');
    if (!apiKey) {
      throw new Error(
        'KIE_API_KEY is not set. Add it to your environment before starting the API.',
      );
    }

    this.apiKey = apiKey;
    this.baseUrl =
      config.get<string>('KIE_API_BASE_URL') ?? KIE_DEFAULT_BASE_URL;
    this.timeoutMs =
      config.get<number>('KIE_REQUEST_TIMEOUT_MS') ?? KIE_DEFAULT_TIMEOUT_MS;
    this.defaultCallbackUrl = config.get<string>('KIE_CALLBACK_URL');
  }

  /**
   * Queue a music generation task. Resolves as soon as KIE accepts it — the
   * audio is not ready yet; it arrives on the callback.
   */
  async generateMusic(
    input: KieGenerateMusicInput,
    options: CreateTaskOptions = {},
  ): Promise<string> {
    return this.createTask(KieMusicTaskModel.Generate, input, options);
  }

  /** Queue any KIE task model and return its `taskId`. */
  async createTask(
    model: string,
    input: unknown,
    options: CreateTaskOptions = {},
  ): Promise<string> {
    const callBackUrl = options.callBackUrl ?? this.defaultCallbackUrl;
    const data = await this.request<KieCreateTaskData>(
      'POST',
      KIE_CREATE_TASK_PATH,
      { body: { model, input, ...(callBackUrl ? { callBackUrl } : {}) } },
    );

    if (!data?.taskId) {
      throw new KieApiError(`KIE accepted the ${model} task without a taskId`, {
        kind: 'malformed',
      });
    }

    this.logger.log(`Created KIE task ${data.taskId} (${model})`);
    return data.taskId;
  }

  /** Current record of a task, whatever its model. */
  async getTask<TResponse = unknown>(
    taskId: string,
  ): Promise<KieTaskRecord<TResponse>> {
    return this.request<KieTaskRecord<TResponse>>('GET', KIE_RECORD_INFO_PATH, {
      query: { taskId },
    });
  }

  /** `getTask` narrowed to a music task. */
  async getMusicTask(taskId: string): Promise<KieMusicTaskRecord> {
    return this.getTask<KieMusicTaskResponse>(taskId);
  }

  /**
   * Tracks of a finished music task. KIE inlines them on `response`, but
   * falls back to the `resultJson` string on some task models.
   */
  extractTracks(record: KieMusicTaskRecord): KieMusicTrack[] {
    const inlined = record.response?.data;
    if (Array.isArray(inlined)) {
      return inlined;
    }

    const parsed = this.parseResultJson<KieMusicTaskResponse>(record);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  /** `resultJson` is delivered as a string; returns undefined if unparseable. */
  parseResultJson<TResult>(
    record: Pick<KieTaskRecord, 'resultJson' | 'taskId'>,
  ): TResult | undefined {
    if (!record.resultJson) {
      return undefined;
    }

    try {
      return JSON.parse(record.resultJson) as TResult;
    } catch {
      this.logger.warn(
        `Could not parse resultJson for KIE task ${record.taskId}`,
      );
      return undefined;
    }
  }

  private async request<TData>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<TData> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      const aborted = controller.signal.aborted;
      throw new KieApiError(
        aborted
          ? `KIE request to ${path} timed out after ${this.timeoutMs}ms`
          : `KIE request to ${path} failed`,
        { kind: aborted ? 'timeout' : 'network', cause },
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    let envelope: KieEnvelope<TData> | undefined;
    try {
      envelope = raw ? (JSON.parse(raw) as KieEnvelope<TData>) : undefined;
    } catch {
      envelope = undefined;
    }

    if (!envelope || typeof envelope.code !== 'number') {
      throw new KieApiError(
        `KIE returned an unexpected body for ${path} (HTTP ${response.status})`,
        { kind: 'malformed', httpStatus: response.status },
      );
    }

    if (envelope.code !== KieResponseCode.Success) {
      throw new KieApiError(
        envelope.msg ?? `KIE rejected ${path} with code ${envelope.code}`,
        { kind: 'api', code: envelope.code, httpStatus: response.status },
      );
    }

    return envelope.data;
  }
}
