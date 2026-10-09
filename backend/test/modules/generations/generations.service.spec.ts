import {
  BadGatewayException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KieResponseCode } from '../../../src/externals/kieClient/kie-client.constants';
import { KieApiError } from '../../../src/externals/kieClient/kie-client.error';
import type { KieClientService } from '../../../src/externals/kieClient/kie-client.service';
import type {
  KieGenerateMusicInput,
  KieMusicCallbackPayload,
  KieMusicTaskRecord,
  KieMusicTrack,
} from '../../../src/externals/kieClient/types/kie-music.types';
import {
  GenerationState,
  type Track,
} from '../../../src/generated/prisma/client';
import type { CreateGenerationDto } from '../../../src/modules/generations/dto/create-generation.dto';
import type {
  CreateGenerationRecord,
  GenerationProgress,
  GenerationsRepository,
  GenerationWithTracks,
} from '../../../src/modules/generations/generations.repository';
import { GenerationsService } from '../../../src/modules/generations/generations.service';
import { silenceLogger, type LoggerSpies } from '../../support/silence-logger';

interface KieMock {
  generateMusic: jest.Mock<Promise<string>, [KieGenerateMusicInput]>;
  getMusicTask: jest.Mock<Promise<KieMusicTaskRecord>, [string]>;
  extractTracks: jest.Mock<KieMusicTrack[], [KieMusicTaskRecord]>;
}

interface RepositoryMock {
  create: jest.Mock<Promise<GenerationWithTracks>, [CreateGenerationRecord]>;
  findByTaskId: jest.Mock<Promise<GenerationWithTracks | null>, [string]>;
  applyProgress: jest.Mock<
    Promise<GenerationWithTracks | null>,
    [string, GenerationProgress]
  >;
}

const MINIMAL_DTO: CreateGenerationDto = {
  model: 'V5',
  instrumental: false,
  prompt: 'a slow piano ballad',
};

function generationRow(
  overrides: Partial<GenerationWithTracks> = {},
): GenerationWithTracks {
  return {
    id: 'gen-1',
    taskId: 'task-1',
    state: GenerationState.waiting,
    model: 'V5',
    instrumental: false,
    customMode: false,
    prompt: 'a slow piano ballad',
    title: null,
    style: null,
    lyrics: null,
    negativeTags: null,
    failReason: null,
    costTime: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    completedAt: null,
    tracks: [],
    ...overrides,
  };
}

function taskRecord(
  overrides: Partial<KieMusicTaskRecord> = {},
): KieMusicTaskRecord {
  return {
    taskId: 'task-1',
    model: 'ai-music-api/generate',
    state: 'success',
    param: '{}',
    resultJson: '',
    response: {},
    failCode: null,
    failMsg: null,
    costTime: null,
    completeTime: null,
    createTime: 1_767_139_200_000,
    creditsConsumed: null,
    ...overrides,
  };
}

function trackRow(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-a',
    generationId: 'gen-1',
    title: 'Take A',
    tags: 'synthwave',
    duration: 121.5,
    audioUrl: 'https://cdn.test/a.mp3',
    streamAudioUrl: 'https://cdn.test/a.stream',
    imageUrl: 'https://cdn.test/a.png',
    modelName: 'chirp-v5',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function callback(
  overrides: Partial<KieMusicCallbackPayload['data']> = {},
  code: number = KieResponseCode.Success,
  msg?: string,
): KieMusicCallbackPayload {
  return {
    code,
    msg,
    data: { callbackType: 'complete', task_id: 'task-1', ...overrides },
  };
}

describe('GenerationsService', () => {
  let kieClient: KieMock;
  let repository: RepositoryMock;
  let service: GenerationsService;
  let logger: LoggerSpies;

  beforeEach(() => {
    logger = silenceLogger();
    kieClient = {
      generateMusic: jest.fn<Promise<string>, [KieGenerateMusicInput]>(),
      getMusicTask: jest.fn<Promise<KieMusicTaskRecord>, [string]>(),
      extractTracks: jest
        .fn<KieMusicTrack[], [KieMusicTaskRecord]>()
        .mockReturnValue([]),
    };
    repository = {
      create: jest
        .fn<Promise<GenerationWithTracks>, [CreateGenerationRecord]>()
        .mockResolvedValue(generationRow()),
      findByTaskId: jest.fn<Promise<GenerationWithTracks | null>, [string]>(),
      applyProgress: jest
        .fn<
          Promise<GenerationWithTracks | null>,
          [string, GenerationProgress]
        >()
        .mockResolvedValue(generationRow()),
    };

    service = new GenerationsService(
      kieClient as unknown as KieClientService,
      repository as unknown as GenerationsRepository,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    beforeEach(() => {
      kieClient.generateMusic.mockResolvedValue('task-1');
    });

    it('queues the task and hands back its id', async () => {
      await expect(service.create(MINIMAL_DTO)).resolves.toEqual({
        taskId: 'task-1',
      });
    });

    it('translates the request body into KIE snake_case input', async () => {
      await service.create({
        model: 'V6',
        instrumental: true,
        customMode: true,
        title: 'Nightdrive',
        style: 'synthwave',
        lyrics: 'neon on the dashboard',
        negativeTags: 'country',
        vocalGender: 'f',
        styleWeight: 0.6,
        weirdnessConstraint: 0.3,
        audioWeight: 0.4,
        variety: 2,
        personaId: 'persona-1',
        personaModel: 'voice_persona',
        duration: 180,
        imageUrls: ['https://cdn.test/ref.png'],
        videoUrls: ['https://cdn.test/ref.mp4'],
        audioUrls: ['https://cdn.test/ref.mp3'],
      });

      expect(kieClient.generateMusic).toHaveBeenCalledWith({
        custom_mode: true,
        instrumental: true,
        model: 'V6',
        prompt: undefined,
        lyrics: 'neon on the dashboard',
        style: 'synthwave',
        title: 'Nightdrive',
        negative_tags: 'country',
        vocal_gender: 'f',
        style_weight: 0.6,
        weirdness_constraint: 0.3,
        audio_weight: 0.4,
        variety: 2,
        persona_id: 'persona-1',
        persona_model: 'voice_persona',
        duration: 180,
        image_urls: ['https://cdn.test/ref.png'],
        video_urls: ['https://cdn.test/ref.mp4'],
        audio_urls: ['https://cdn.test/ref.mp3'],
      });
    });

    it('persists the task, defaulting customMode to false', async () => {
      await service.create(MINIMAL_DTO);

      expect(repository.create).toHaveBeenCalledWith({
        taskId: 'task-1',
        model: 'V5',
        instrumental: false,
        customMode: false,
        prompt: 'a slow piano ballad',
        title: undefined,
        style: undefined,
        lyrics: undefined,
        negativeTags: undefined,
      });
    });

    it('does not touch the database when KIE rejects the task', async () => {
      kieClient.generateMusic.mockRejectedValue(
        new KieApiError('nope', {
          kind: 'api',
          code: KieResponseCode.Unprocessable,
        }),
      );

      await expect(service.create(MINIMAL_DTO)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('logs the orphaned task id when the write fails', async () => {
      repository.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(MINIMAL_DTO)).rejects.toThrow(
        'connection lost',
      );
      expect(logger.error).toHaveBeenCalledWith(
        'KIE task task-1 was accepted but could not be stored',
        expect.any(String),
      );
    });

    describe('upstream failure mapping', () => {
      it.each([
        [
          'an invalid request (422)',
          KieResponseCode.Unprocessable,
          BadRequestException,
        ],
        [
          'an unknown resource (404)',
          KieResponseCode.NotFound,
          NotFoundException,
        ],
        [
          'an empty balance (402)',
          KieResponseCode.InsufficientCredits,
          ServiceUnavailableException,
        ],
        [
          'a rejected API key (401)',
          KieResponseCode.Unauthorized,
          ServiceUnavailableException,
        ],
        [
          'rate limiting (429)',
          KieResponseCode.RateLimited,
          ServiceUnavailableException,
        ],
        [
          'an upstream fault (451)',
          KieResponseCode.Unavailable,
          BadGatewayException,
        ],
      ])('maps %s', async (_label, code, expected) => {
        kieClient.generateMusic.mockRejectedValue(
          new KieApiError('upstream said no', { kind: 'api', code }),
        );

        await expect(service.create(MINIMAL_DTO)).rejects.toBeInstanceOf(
          expected,
        );
      });

      it('maps a transport failure to 503', async () => {
        kieClient.generateMusic.mockRejectedValue(
          new KieApiError('socket hang up', { kind: 'network' }),
        );

        await expect(service.create(MINIMAL_DTO)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
      });

      it('passes a non-KIE error through untouched', async () => {
        const boom = new TypeError('bug in our own code');
        kieClient.generateMusic.mockRejectedValue(boom);

        await expect(service.create(MINIMAL_DTO)).rejects.toBe(boom);
      });
    });
  });

  describe('findOne', () => {
    it('404s for a task we never stored', async () => {
      repository.findByTaskId.mockResolvedValue(null);

      await expect(service.findOne('ghost')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(kieClient.getMusicTask).not.toHaveBeenCalled();
    });

    it.each([GenerationState.success, GenerationState.fail])(
      'serves a %s generation straight from the database',
      async (state) => {
        repository.findByTaskId.mockResolvedValue(
          generationRow({ state, tracks: [trackRow()] }),
        );

        const status = await service.findOne('task-1');

        expect(kieClient.getMusicTask).not.toHaveBeenCalled();
        expect(status.state).toBe(state);
      },
    );

    it('maps nullable columns onto the API shape', async () => {
      repository.findByTaskId.mockResolvedValue(
        generationRow({
          state: GenerationState.success,
          costTime: 42,
          completedAt: new Date('2026-01-02T00:00:00.000Z'),
          tracks: [
            trackRow(),
            trackRow({
              id: 'track-b',
              title: null,
              tags: null,
              duration: null,
              audioUrl: null,
              streamAudioUrl: null,
              imageUrl: null,
              modelName: null,
            }),
          ],
        }),
      );

      const status = await service.findOne('task-1');

      expect(status).toEqual({
        taskId: 'task-1',
        state: GenerationState.success,
        failReason: null,
        costTime: 42,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-02T00:00:00.000Z'),
        tracks: [
          {
            id: 'track-a',
            title: 'Take A',
            tags: 'synthwave',
            duration: 121.5,
            audioUrl: 'https://cdn.test/a.mp3',
            streamAudioUrl: 'https://cdn.test/a.stream',
            imageUrl: 'https://cdn.test/a.png',
            modelName: 'chirp-v5',
          },
          {
            id: 'track-b',
            title: undefined,
            tags: undefined,
            duration: undefined,
            audioUrl: undefined,
            streamAudioUrl: undefined,
            imageUrl: undefined,
            modelName: undefined,
          },
        ],
      });
    });

    it('reconciles an in-flight generation against KIE and stores the result', async () => {
      repository.findByTaskId.mockResolvedValue(
        generationRow({ state: GenerationState.generating }),
      );
      kieClient.getMusicTask.mockResolvedValue(
        taskRecord({ costTime: 42, completeTime: 1_767_225_600_000 }),
      );
      kieClient.extractTracks.mockReturnValue([
        { id: 'track-a', audio_url: 'https://cdn.test/a.mp3', title: 'Take A' },
      ]);
      const reconciled = generationRow({
        state: GenerationState.success,
        costTime: 42,
        tracks: [trackRow()],
      });
      repository.applyProgress.mockResolvedValue(reconciled);

      const status = await service.findOne('task-1');

      expect(repository.applyProgress).toHaveBeenCalledWith('task-1', {
        state: GenerationState.success,
        failReason: null,
        costTime: 42,
        completedAt: new Date(1_767_225_600_000),
        tracks: [
          {
            id: 'track-a',
            title: 'Take A',
            tags: undefined,
            duration: undefined,
            audioUrl: 'https://cdn.test/a.mp3',
            streamAudioUrl: undefined,
            imageUrl: undefined,
            modelName: undefined,
          },
        ],
      });
      expect(status.state).toBe(GenerationState.success);
    });

    it('prefers failMsg over failCode, and nulls completedAt while unfinished', async () => {
      repository.findByTaskId.mockResolvedValue(
        generationRow({ state: GenerationState.queuing }),
      );
      kieClient.getMusicTask.mockResolvedValue(
        taskRecord({
          state: 'fail',
          failCode: '455',
          failMsg: 'generation failed',
        }),
      );

      await service.findOne('task-1');

      expect(repository.applyProgress).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          state: GenerationState.fail,
          failReason: 'generation failed',
          completedAt: null,
        }),
      );
    });

    it('falls back to failCode when KIE sends no message', async () => {
      repository.findByTaskId.mockResolvedValue(
        generationRow({ state: GenerationState.queuing }),
      );
      kieClient.getMusicTask.mockResolvedValue(
        taskRecord({ state: 'fail', failCode: '455' }),
      );

      await service.findOne('task-1');

      expect(repository.applyProgress).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ failReason: '455' }),
      );
    });

    it('serves the stored row when the reconciliation read fails', async () => {
      const stored = generationRow({ state: GenerationState.generating });
      repository.findByTaskId.mockResolvedValue(stored);
      kieClient.getMusicTask.mockRejectedValue(
        new KieApiError('upstream down', { kind: 'network' }),
      );

      const status = await service.findOne('task-1');

      expect(status.state).toBe(GenerationState.generating);
      expect(repository.applyProgress).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'Could not reconcile KIE task task-1: upstream down',
      );
    });

    it('serves the stored row when reconciliation finds nothing to update', async () => {
      repository.findByTaskId.mockResolvedValue(
        generationRow({ state: GenerationState.generating }),
      );
      kieClient.getMusicTask.mockResolvedValue(
        taskRecord({ state: 'generating' }),
      );
      repository.applyProgress.mockResolvedValue(null);

      await expect(service.findOne('task-1')).resolves.toMatchObject({
        state: GenerationState.generating,
      });
    });
  });

  describe('handleCallback', () => {
    it.each([
      ['text', GenerationState.generating],
      ['first', GenerationState.generating],
    ] as const)('keeps a %s delivery in progress', async (stage, state) => {
      await service.handleCallback(callback({ callbackType: stage }));

      expect(repository.applyProgress).toHaveBeenCalledWith('task-1', {
        state,
        failReason: null,
        completedAt: undefined,
        tracks: [],
      });
    });

    it('finishes the generation on the complete delivery', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-02-01T12:00:00.000Z'));

      await service.handleCallback(callback({ callbackType: 'complete' }));

      expect(repository.applyProgress).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          state: GenerationState.success,
          completedAt: new Date('2026-02-01T12:00:00.000Z'),
        }),
      );

      jest.useRealTimers();
    });

    it('maps KIE track fields onto our camelCase shape', async () => {
      const event = await service.handleCallback(
        callback({
          callbackType: 'complete',
          data: [
            {
              id: 'track-a',
              audio_url: 'https://cdn.test/a.mp3',
              stream_audio_url: 'https://cdn.test/a.stream',
              image_url: 'https://cdn.test/a.png',
              model_name: 'chirp-v5',
              title: 'Take A',
              tags: 'synthwave',
              duration: 121.5,
            },
          ],
        }),
      );

      expect(event.tracks).toEqual([
        {
          id: 'track-a',
          title: 'Take A',
          tags: 'synthwave',
          duration: 121.5,
          audioUrl: 'https://cdn.test/a.mp3',
          streamAudioUrl: 'https://cdn.test/a.stream',
          imageUrl: 'https://cdn.test/a.png',
          modelName: 'chirp-v5',
        },
      ]);
    });

    it('fails the generation when the envelope code is not success', async () => {
      const event = await service.handleCallback(
        callback(
          { callbackType: 'first' },
          KieResponseCode.GenerationFailed,
          'model refused the prompt',
        ),
      );

      expect(event).toMatchObject({
        ok: false,
        failReason: 'model refused the prompt',
      });
      expect(repository.applyProgress).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          state: GenerationState.fail,
          failReason: 'model refused the prompt',
          completedAt: expect.any(Date) as Date,
        }),
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('synthesises a reason when the failure carries no message', async () => {
      const event = await service.handleCallback(
        callback({}, KieResponseCode.ServerError),
      );

      expect(event.failReason).toBe('KIE code 500');
    });

    it('reports the delivery it handled', async () => {
      const event = await service.handleCallback(
        callback({ callbackType: 'text' }),
      );

      expect(event).toEqual({
        taskId: 'task-1',
        stage: 'text',
        ok: true,
        failReason: null,
        tracks: [],
      });
    });

    it('warns but does not throw for a task that is not on record', async () => {
      repository.applyProgress.mockResolvedValue(null);

      await expect(
        service.handleCallback(callback({ callbackType: 'complete' })),
      ).resolves.toMatchObject({ taskId: 'task-1' });
      expect(logger.warn).toHaveBeenCalledWith(
        'KIE task task-1 is not on record — dropping its complete delivery',
      );
    });

    it('lets a write failure surface so KIE redelivers', async () => {
      repository.applyProgress.mockRejectedValue(new Error('deadlock'));

      await expect(service.handleCallback(callback())).rejects.toThrow(
        'deadlock',
      );
    });
  });
});
