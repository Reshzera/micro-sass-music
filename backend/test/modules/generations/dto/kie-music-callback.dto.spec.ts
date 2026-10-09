import { ValidationPipe } from '@nestjs/common';
import { KieMusicCallbackDto } from '../../../../src/modules/generations/dto/kie-music-callback.dto';

/**
 * The controller validates webhook bodies with a relaxed pipe on purpose:
 * rejecting a delivery because KIE added a field would lose the audio.
 */
const pipe = new ValidationPipe({
  expectedType: KieMusicCallbackDto,
  transform: true,
});

const METADATA = { type: 'body' as const, metatype: Object };

function validate(body: unknown): Promise<KieMusicCallbackDto> {
  return pipe.transform(body, METADATA) as Promise<KieMusicCallbackDto>;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    code: 200,
    msg: 'success',
    data: { callbackType: 'complete', task_id: 'task-1' },
    ...overrides,
  };
}

describe('KieMusicCallbackDto', () => {
  it('accepts a delivery with no tracks yet', async () => {
    await expect(validate(payload())).resolves.toMatchObject({
      code: 200,
      data: { callbackType: 'complete', task_id: 'task-1' },
    });
  });

  it('accepts a delivery carrying tracks', async () => {
    const result = await validate(
      payload({
        data: {
          callbackType: 'first',
          task_id: 'task-1',
          data: [
            {
              id: 'track-a',
              audio_url: 'https://cdn.test/a.mp3',
              duration: 121.5,
            },
          ],
        },
      }),
    );

    expect(result.data.data?.[0]).toMatchObject({
      id: 'track-a',
      audio_url: 'https://cdn.test/a.mp3',
      duration: 121.5,
    });
  });

  it('tolerates fields KIE has added since we wrote this', async () => {
    await expect(
      validate(
        payload({
          unexpectedTopLevel: 'whatever',
          data: {
            callbackType: 'complete',
            task_id: 'task-1',
            unexpectedNested: 42,
          },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it.each(['text', 'first', 'complete'])(
    'accepts the %s stage',
    async (callbackType) => {
      await expect(
        validate(payload({ data: { callbackType, task_id: 'task-1' } })),
      ).resolves.toBeDefined();
    },
  );

  it('rejects an unknown stage', async () => {
    await expect(
      validate(payload({ data: { callbackType: 'halfway', task_id: 't' } })),
    ).rejects.toThrow();
  });

  it.each([
    ['no code', { msg: 'x', data: { callbackType: 'complete', task_id: 't' } }],
    ['no data', { code: 200 }],
    ['no task_id', { code: 200, data: { callbackType: 'complete' } }],
    [
      'a track with no id',
      {
        code: 200,
        data: {
          callbackType: 'complete',
          task_id: 't',
          data: [{ audio_url: 'https://cdn.test/a.mp3' }],
        },
      },
    ],
  ])('rejects a delivery with %s', async (_label, body) => {
    await expect(validate(body)).rejects.toThrow();
  });
});
