import { GenerationState } from '../../../src/generated/prisma/client';
import { GenerationsRepository } from '../../../src/modules/generations/generations.repository';
import type { PrismaService } from '../../../src/prisma/prisma.service';

/** Shapes of the Prisma arguments the repository builds, for assertions. */
interface TrackUpsertArgs {
  where: { id: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface GenerationUpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
  include: unknown;
}

interface PrismaMock {
  generation: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock<Promise<unknown>, [GenerationUpdateArgs]>;
  };
  track: { upsert: jest.Mock<Promise<unknown>, [TrackUpsertArgs]> };
  $transaction: jest.Mock;
}

/** Tracks always come back oldest first so the API response order is stable. */
const WITH_TRACKS = { tracks: { orderBy: { createdAt: 'asc' } } };

describe('GenerationsRepository', () => {
  let prisma: PrismaMock;
  let repository: GenerationsRepository;

  beforeEach(() => {
    prisma = {
      generation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn() as PrismaMock['generation']['update'],
      },
      track: { upsert: jest.fn() as PrismaMock['track']['upsert'] },
      // The real client hands the callback a transactional client; the mock
      // is its own, which is all the repository needs.
      $transaction: jest.fn((fn: (tx: PrismaMock) => unknown) => fn(prisma)),
    };

    repository = new GenerationsRepository(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('stores the task and returns it with its (empty) track list', async () => {
      const row = { id: 'gen-1', taskId: 'task-1', tracks: [] };
      prisma.generation.create.mockResolvedValue(row);

      const created = await repository.create({
        taskId: 'task-1',
        model: 'V5',
        instrumental: false,
        customMode: true,
        title: 'Nightdrive',
        style: 'synthwave',
      });

      expect(created).toBe(row);
      expect(prisma.generation.create).toHaveBeenCalledWith({
        data: {
          taskId: 'task-1',
          model: 'V5',
          instrumental: false,
          customMode: true,
          title: 'Nightdrive',
          style: 'synthwave',
        },
        include: WITH_TRACKS,
      });
    });
  });

  describe('findByTaskId', () => {
    it('looks the row up on the KIE task id, tracks included', async () => {
      prisma.generation.findUnique.mockResolvedValue(null);

      await expect(repository.findByTaskId('task-1')).resolves.toBeNull();
      expect(prisma.generation.findUnique).toHaveBeenCalledWith({
        where: { taskId: 'task-1' },
        include: WITH_TRACKS,
      });
    });
  });

  describe('applyProgress', () => {
    it('writes nothing and returns null for an unknown task', async () => {
      prisma.generation.findUnique.mockResolvedValue(null);

      const result = await repository.applyProgress('ghost', {
        state: GenerationState.success,
        tracks: [{ id: 'track-1' }],
      });

      expect(result).toBeNull();
      expect(prisma.track.upsert).not.toHaveBeenCalled();
      expect(prisma.generation.update).not.toHaveBeenCalled();
    });

    it('runs the whole fold inside one transaction', async () => {
      prisma.generation.findUnique.mockResolvedValue({ id: 'gen-1' });
      prisma.generation.update.mockResolvedValue({ id: 'gen-1', tracks: [] });

      await repository.applyProgress('task-1', {
        state: GenerationState.generating,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('upserts each track against the generation it belongs to', async () => {
      prisma.generation.findUnique.mockResolvedValue({ id: 'gen-1' });
      prisma.generation.update.mockResolvedValue({ id: 'gen-1', tracks: [] });

      await repository.applyProgress('task-1', {
        state: GenerationState.success,
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
          { id: 'track-b' },
        ],
      });

      expect(prisma.track.upsert).toHaveBeenCalledTimes(2);

      const fields = {
        title: 'Take A',
        tags: 'synthwave',
        duration: 121.5,
        audioUrl: 'https://cdn.test/a.mp3',
        streamAudioUrl: 'https://cdn.test/a.stream',
        imageUrl: 'https://cdn.test/a.png',
        modelName: 'chirp-v5',
      };
      expect(prisma.track.upsert).toHaveBeenNthCalledWith(1, {
        where: { id: 'track-a' },
        create: { id: 'track-a', generationId: 'gen-1', ...fields },
        update: fields,
      });
    });

    it('leaves absent track fields undefined so Prisma skips them', async () => {
      prisma.generation.findUnique.mockResolvedValue({ id: 'gen-1' });
      prisma.generation.update.mockResolvedValue({ id: 'gen-1', tracks: [] });

      // The `first` delivery carries audio but repeats no title; a re-delivery
      // must not blank out what the `text` delivery already stored.
      await repository.applyProgress('task-1', {
        tracks: [{ id: 'track-a', audioUrl: 'https://cdn.test/a.mp3' }],
      });

      const { update } = prisma.track.upsert.mock.calls[0][0];

      expect(update.audioUrl).toBe('https://cdn.test/a.mp3');
      expect(update.title).toBeUndefined();
      expect(update.imageUrl).toBeUndefined();
    });

    it('updates the generation by id and returns the refreshed row', async () => {
      const completedAt = new Date('2026-01-01T00:00:00.000Z');
      const refreshed = { id: 'gen-1', state: 'success', tracks: [] };
      prisma.generation.findUnique.mockResolvedValue({ id: 'gen-1' });
      prisma.generation.update.mockResolvedValue(refreshed);

      const result = await repository.applyProgress('task-1', {
        state: GenerationState.success,
        failReason: null,
        costTime: 42,
        completedAt,
      });

      expect(result).toBe(refreshed);
      expect(prisma.generation.update).toHaveBeenCalledWith({
        where: { id: 'gen-1' },
        data: {
          state: GenerationState.success,
          failReason: null,
          costTime: 42,
          completedAt,
        },
        include: WITH_TRACKS,
      });
    });

    it('omits fields the caller did not supply', async () => {
      prisma.generation.findUnique.mockResolvedValue({ id: 'gen-1' });
      prisma.generation.update.mockResolvedValue({ id: 'gen-1', tracks: [] });

      await repository.applyProgress('task-1', {
        state: GenerationState.generating,
      });

      expect(prisma.generation.update.mock.calls[0][0].data).toEqual({
        state: GenerationState.generating,
        failReason: undefined,
        costTime: undefined,
        completedAt: undefined,
      });
    });
  });
});
