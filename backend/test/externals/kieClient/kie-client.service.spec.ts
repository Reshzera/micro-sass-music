import type { ConfigService } from '@nestjs/config';
import {
  KIE_CREATE_TASK_PATH,
  KIE_DEFAULT_BASE_URL,
  KIE_RECORD_INFO_PATH,
  KieMusicTaskModel,
  KieResponseCode,
} from '../../../src/externals/kieClient/kie-client.constants';
import { KieApiError } from '../../../src/externals/kieClient/kie-client.error';
import { KieClientService } from '../../../src/externals/kieClient/kie-client.service';
import type {
  KieGenerateMusicInput,
  KieMusicTaskRecord,
} from '../../../src/externals/kieClient/types/kie-music.types';
import { silenceLogger } from '../../support/silence-logger';

type ConfigValues = Record<string, string | number | undefined>;

/** The slice of `RequestInit` the client actually sets. */
interface FetchInit {
  method: 'GET' | 'POST';
  signal: AbortSignal;
  headers: Record<string, string>;
  body?: string;
}

interface FetchResponse {
  status: number;
  text: () => Promise<string>;
}

type FetchMock = jest.Mock<Promise<FetchResponse>, [URL, FetchInit]>;

const BASE_CONFIG: ConfigValues = { KIE_API_KEY: 'test-key' };

function configOf(values: ConfigValues): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

/** Minimal stand-in for the bits of `Response` the client touches. */
function respondWith(body: unknown, status = 200): FetchResponse {
  return {
    status,
    text: () =>
      Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function okEnvelope(data: unknown): FetchResponse {
  return respondWith({ code: KieResponseCode.Success, msg: 'success', data });
}

const MUSIC_INPUT: KieGenerateMusicInput = {
  custom_mode: false,
  instrumental: false,
  model: 'V5',
  prompt: 'a slow piano ballad',
};

function recordOf(overrides: Partial<KieMusicTaskRecord> = {}) {
  return {
    taskId: 'task-1',
    model: KieMusicTaskModel.Generate,
    state: 'success',
    param: '{}',
    resultJson: '',
    response: {},
    failCode: null,
    failMsg: null,
    costTime: 42,
    completeTime: 1_700_000_000_000,
    createTime: 1_699_999_000_000,
    creditsConsumed: 10,
    ...overrides,
  } as KieMusicTaskRecord;
}

describe('KieClientService', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    silenceLogger();
    fetchMock = jest.fn() as FetchMock;
    // `FetchResponse` is only the slice of `Response` the client reads.
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function serviceWith(values: ConfigValues = {}): KieClientService {
    return new KieClientService(configOf({ ...BASE_CONFIG, ...values }));
  }

  /** The JSON body of the nth outgoing request. */
  function sentBody(call = 0): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[call][1].body ?? '{}') as Record<
      string,
      unknown
    >;
  }

  /** Await a call that must reject, and hand back the `KieApiError` it threw. */
  async function rejection(promise: Promise<unknown>): Promise<KieApiError> {
    try {
      await promise;
    } catch (error) {
      return error as KieApiError;
    }
    throw new Error('expected the call to reject');
  }

  describe('construction', () => {
    it('refuses to start without an API key', () => {
      expect(() => new KieClientService(configOf({}))).toThrow(
        /KIE_API_KEY is not set/,
      );
    });

    it('falls back to the documented host', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));
      await serviceWith().generateMusic(MUSIC_INPUT);

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        `${KIE_DEFAULT_BASE_URL}${KIE_CREATE_TASK_PATH}`,
      );
    });

    it('honours a base URL override', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));
      await serviceWith({
        KIE_API_BASE_URL: 'https://staging.kie.test',
      }).generateMusic(MUSIC_INPUT);

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        `https://staging.kie.test${KIE_CREATE_TASK_PATH}`,
      );
    });
  });

  describe('createTask', () => {
    it('posts the model and input, and returns the task id', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-42' }));

      const taskId = await serviceWith().generateMusic(MUSIC_INPUT);

      expect(taskId).toBe('task-42');
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
      expect(sentBody()).toEqual({
        model: KieMusicTaskModel.Generate,
        input: MUSIC_INPUT,
      });
    });

    it('attaches the configured callback URL', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));

      await serviceWith({
        KIE_CALLBACK_URL: 'https://app.test/generations/webhook?secret=s3cret',
      }).generateMusic(MUSIC_INPUT);

      expect(sentBody().callBackUrl).toBe(
        'https://app.test/generations/webhook?secret=s3cret',
      );
    });

    it('lets the caller override the callback URL per task', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));

      await serviceWith({
        KIE_CALLBACK_URL: 'https://app.test/default',
      }).generateMusic(MUSIC_INPUT, {
        callBackUrl: 'https://app.test/override',
      });

      expect(sentBody().callBackUrl).toBe('https://app.test/override');
    });

    it('omits callBackUrl entirely when none is configured', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));

      await serviceWith().generateMusic(MUSIC_INPUT);

      expect(sentBody()).not.toHaveProperty('callBackUrl');
    });

    it('reaches any task model through createTask', async () => {
      fetchMock.mockResolvedValue(okEnvelope({ taskId: 'task-1' }));

      await serviceWith().createTask(KieMusicTaskModel.Cover, { foo: 'bar' });

      expect(sentBody()).toEqual({
        model: KieMusicTaskModel.Cover,
        input: { foo: 'bar' },
      });
    });

    it('rejects an acceptance that carries no task id', async () => {
      fetchMock.mockResolvedValue(okEnvelope({}));

      await expect(serviceWith().generateMusic(MUSIC_INPUT)).rejects.toThrow(
        expect.objectContaining({
          name: 'KieApiError',
          kind: 'malformed',
        }) as Error,
      );
    });
  });

  describe('getTask', () => {
    it('reads recordInfo with the task id as a query param', async () => {
      fetchMock.mockResolvedValue(okEnvelope(recordOf()));

      const record = await serviceWith().getMusicTask('task-1');

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(String(url)).toBe(
        `${KIE_DEFAULT_BASE_URL}${KIE_RECORD_INFO_PATH}?taskId=task-1`,
      );
      expect(record.taskId).toBe('task-1');
    });
  });

  describe('error mapping', () => {
    it('turns a non-success envelope code into an api error', async () => {
      fetchMock.mockResolvedValue(
        respondWith({
          code: KieResponseCode.Unprocessable,
          msg: 'prompt too long',
          data: null,
        }),
      );

      await expect(serviceWith().generateMusic(MUSIC_INPUT)).rejects.toThrow(
        expect.objectContaining({
          name: 'KieApiError',
          kind: 'api',
          code: KieResponseCode.Unprocessable,
          httpStatus: 200,
          message: 'prompt too long',
        }) as Error,
      );
    });

    it('falls back to a generated message when KIE sends no msg', async () => {
      fetchMock.mockResolvedValue(
        respondWith({ code: KieResponseCode.ServerError, data: null }),
      );

      await expect(serviceWith().generateMusic(MUSIC_INPUT)).rejects.toThrow(
        `KIE rejected ${KIE_CREATE_TASK_PATH} with code ${KieResponseCode.ServerError}`,
      );
    });

    it('reports a failed request as a network error', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const error = await rejection(serviceWith().generateMusic(MUSIC_INPUT));

      expect(error.kind).toBe('network');
      expect(error.isRetryable).toBe(true);
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('reports a request that outlives the timeout as a timeout', async () => {
      // Reject only once the client's own AbortController fires, which is the
      // signal `request` uses to tell a timeout from a dropped connection.
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );

      const error = await rejection(
        serviceWith({ KIE_REQUEST_TIMEOUT_MS: 5 }).generateMusic(MUSIC_INPUT),
      );

      expect(error.kind).toBe('timeout');
      expect(error.message).toMatch(/timed out after 5ms/);
      expect(error.isRetryable).toBe(true);
    });

    it.each([
      ['a body that is not JSON', 'not json at all'],
      ['an empty body', ''],
      ['an envelope without a numeric code', { msg: 'hi', data: null }],
    ])('rejects %s as malformed', async (_label, body) => {
      fetchMock.mockResolvedValue(respondWith(body, 502));

      const error = await rejection(serviceWith().generateMusic(MUSIC_INPUT));

      expect(error.kind).toBe('malformed');
      expect(error.httpStatus).toBe(502);
    });
  });

  describe('extractTracks', () => {
    it('prefers the inlined response data', () => {
      const tracks = serviceWith().extractTracks(
        recordOf({
          response: { data: [{ id: 'a' }] },
          resultJson: JSON.stringify({ data: [{ id: 'ignored' }] }),
        }),
      );

      expect(tracks).toEqual([{ id: 'a' }]);
    });

    it('falls back to parsing resultJson', () => {
      const tracks = serviceWith().extractTracks(
        recordOf({
          response: {},
          resultJson: JSON.stringify({ data: [{ id: 'b' }, { id: 'c' }] }),
        }),
      );

      expect(tracks.map((track) => track.id)).toEqual(['b', 'c']);
    });

    it('returns nothing when neither source holds an array', () => {
      expect(
        serviceWith().extractTracks(
          recordOf({ response: { data: undefined }, resultJson: '{}' }),
        ),
      ).toEqual([]);
      expect(
        serviceWith().extractTracks(recordOf({ response: {}, resultJson: '' })),
      ).toEqual([]);
    });
  });

  describe('parseResultJson', () => {
    it('parses a well-formed payload', () => {
      expect(
        serviceWith().parseResultJson({
          taskId: 'task-1',
          resultJson: '{"data":[]}',
        }),
      ).toEqual({ data: [] });
    });

    it('returns undefined for an empty string', () => {
      expect(
        serviceWith().parseResultJson({ taskId: 'task-1', resultJson: '' }),
      ).toBeUndefined();
    });

    it('warns instead of throwing on unparseable JSON', () => {
      const spies = silenceLogger();

      expect(
        serviceWith().parseResultJson({
          taskId: 'task-1',
          resultJson: '{oops',
        }),
      ).toBeUndefined();
      expect(spies.warn).toHaveBeenCalledWith(
        'Could not parse resultJson for KIE task task-1',
      );
    });
  });
});
