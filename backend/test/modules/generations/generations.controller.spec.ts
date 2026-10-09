import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { KieMusicCallbackPayload } from '../../../src/externals/kieClient/types/kie-music.types';
import { GenerationState } from '../../../src/generated/prisma/client';
import type { CreateGenerationDto } from '../../../src/modules/generations/dto/create-generation.dto';
import { GenerationsController } from '../../../src/modules/generations/generations.controller';
import type { GenerationsService } from '../../../src/modules/generations/generations.service';
import type { GenerationStatus } from '../../../src/modules/generations/types/generation.types';

interface ServiceMock {
  create: jest.Mock;
  findOne: jest.Mock;
  handleCallback: jest.Mock;
}

const PAYLOAD: KieMusicCallbackPayload = {
  code: 200,
  data: { callbackType: 'complete', task_id: 'task-1' },
};

describe('GenerationsController', () => {
  let service: ServiceMock;

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({ taskId: 'task-1' }),
      findOne: jest.fn(),
      handleCallback: jest.fn().mockResolvedValue({
        taskId: 'task-1',
        stage: 'complete',
        ok: true,
        failReason: null,
        tracks: [],
      }),
    };
  });

  function controllerWith(callbackSecret?: string): GenerationsController {
    const config = {
      get: jest.fn((key: string) =>
        key === 'KIE_CALLBACK_SECRET' ? callbackSecret : undefined,
      ),
    } as unknown as ConfigService;

    return new GenerationsController(
      service as unknown as GenerationsService,
      config,
    );
  }

  describe('POST /generations', () => {
    it('hands the body to the service and returns its result', async () => {
      const dto: CreateGenerationDto = {
        model: 'V5',
        instrumental: false,
        prompt: 'a slow piano ballad',
      };

      await expect(controllerWith().create(dto)).resolves.toEqual({
        taskId: 'task-1',
      });
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('GET /generations/:taskId', () => {
    it('delegates to the service', async () => {
      const status: GenerationStatus = {
        taskId: 'task-1',
        state: GenerationState.success,
        tracks: [],
        failReason: null,
        costTime: 42,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      service.findOne.mockResolvedValue(status);

      await expect(controllerWith().findOne('task-1')).resolves.toBe(status);
      expect(service.findOne).toHaveBeenCalledWith('task-1');
    });
  });

  describe('POST /generations/webhook', () => {
    it('processes the delivery and acknowledges it', async () => {
      await expect(
        controllerWith('s3cret').handleWebhook(PAYLOAD, 's3cret'),
      ).resolves.toEqual({ received: true });
      expect(service.handleCallback).toHaveBeenCalledWith(PAYLOAD);
    });

    it('skips the check when no secret is configured', async () => {
      await expect(
        controllerWith(undefined).handleWebhook(PAYLOAD),
      ).resolves.toEqual({ received: true });
      expect(service.handleCallback).toHaveBeenCalledWith(PAYLOAD);
    });

    it.each([
      ['a wrong secret of equal length', 'wrong!!'],
      ['a wrong secret of a different length', 'nope'],
      ['no secret at all', undefined],
      ['an empty secret', ''],
    ])('rejects %s without processing the delivery', async (_label, secret) => {
      await expect(
        controllerWith('s3cret').handleWebhook(PAYLOAD, secret),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(service.handleCallback).not.toHaveBeenCalled();
    });

    it('acknowledges a delivery that reports a failed generation', async () => {
      // A 2xx here is deliberate: the task failed, but we did handle the
      // delivery, and a non-2xx would only make KIE send it again.
      service.handleCallback.mockResolvedValue({
        taskId: 'task-1',
        stage: 'complete',
        ok: false,
        failReason: 'model refused the prompt',
        tracks: [],
      });

      await expect(
        controllerWith().handleWebhook({ ...PAYLOAD, code: 455 }),
      ).resolves.toEqual({ received: true });
    });

    it('lets a write failure bubble up so KIE redelivers', async () => {
      service.handleCallback.mockRejectedValue(new Error('deadlock'));

      await expect(controllerWith().handleWebhook(PAYLOAD)).rejects.toThrow(
        'deadlock',
      );
    });
  });
});
