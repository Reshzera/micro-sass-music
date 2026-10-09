import { ValidationPipe } from '@nestjs/common';
import { CreateGenerationDto } from '../../../../src/modules/generations/dto/create-generation.dto';

/** The configuration `main.ts` installs globally, so the DTO is exercised as it ships. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const METADATA = { type: 'body' as const, metatype: CreateGenerationDto };

function validate(body: unknown): Promise<CreateGenerationDto> {
  return pipe.transform(body, METADATA) as Promise<CreateGenerationDto>;
}

const DESCRIBED = {
  model: 'V5',
  instrumental: false,
  prompt: 'a piano ballad',
};
const CUSTOM = {
  model: 'V5',
  instrumental: false,
  customMode: true,
  title: 'Nightdrive',
  style: 'synthwave',
};

describe('CreateGenerationDto', () => {
  it('accepts a described-mode request', async () => {
    await expect(validate(DESCRIBED)).resolves.toMatchObject(DESCRIBED);
  });

  it('accepts a custom-mode request', async () => {
    await expect(validate(CUSTOM)).resolves.toMatchObject(CUSTOM);
  });

  it.each([
    ['model', { instrumental: false, prompt: 'x' }],
    ['instrumental', { model: 'V5', prompt: 'x' }],
  ])('requires %s', async (_field, body) => {
    await expect(validate(body)).rejects.toThrow();
  });

  it('rejects an unknown Suno model', async () => {
    await expect(validate({ ...DESCRIBED, model: 'V3' })).rejects.toThrow();
  });

  it('requires a prompt in described mode', async () => {
    await expect(
      validate({ model: 'V5', instrumental: false }),
    ).rejects.toThrow();
  });

  it.each(['title', 'style'])('requires %s in custom mode', async (field) => {
    const body: Record<string, unknown> = { ...CUSTOM };
    delete body[field];

    await expect(validate(body)).rejects.toThrow();
  });

  it('does not require title or style in described mode', async () => {
    await expect(validate(DESCRIBED)).resolves.toBeDefined();
  });

  it.each([
    ['prompt over 3000 chars', { ...DESCRIBED, prompt: 'x'.repeat(3001) }],
    ['title over 80 chars', { ...CUSTOM, title: 'x'.repeat(81) }],
    ['style over 1000 chars', { ...CUSTOM, style: 'x'.repeat(1001) }],
    ['lyrics over 5000 chars', { ...CUSTOM, lyrics: 'x'.repeat(5001) }],
  ])('rejects a %s', async (_label, body) => {
    await expect(validate(body)).rejects.toThrow();
  });

  it.each([
    ['styleWeight', 1.5],
    ['weirdnessConstraint', -0.1],
    ['audioWeight', 2],
  ])('keeps %s inside 0-1', async (field, value) => {
    await expect(validate({ ...DESCRIBED, [field]: value })).rejects.toThrow();
    await expect(
      validate({ ...DESCRIBED, [field]: 0.5 }),
    ).resolves.toMatchObject({ [field]: 0.5 });
  });

  it('keeps variety inside 0-4', async () => {
    await expect(validate({ ...DESCRIBED, variety: 5 })).rejects.toThrow();
    await expect(validate({ ...DESCRIBED, variety: 1.5 })).rejects.toThrow();
    await expect(validate({ ...DESCRIBED, variety: 4 })).resolves.toBeDefined();
  });

  it('keeps duration inside 10-360 seconds', async () => {
    await expect(validate({ ...CUSTOM, duration: 9 })).rejects.toThrow();
    await expect(validate({ ...CUSTOM, duration: 361 })).rejects.toThrow();
    await expect(validate({ ...CUSTOM, duration: 180 })).resolves.toBeDefined();
  });

  it.each(['vocalGender', 'personaModel'])(
    'rejects an unknown %s',
    async (field) => {
      await expect(
        validate({ ...DESCRIBED, [field]: 'nope' }),
      ).rejects.toThrow();
    },
  );

  it('requires reference media to be URLs', async () => {
    await expect(
      validate({ ...DESCRIBED, imageUrls: ['not-a-url'] }),
    ).rejects.toThrow();
    await expect(
      validate({ ...DESCRIBED, imageUrls: ['https://cdn.test/ref.png'] }),
    ).resolves.toBeDefined();
  });

  it('rejects a field it does not know', async () => {
    await expect(
      validate({ ...DESCRIBED, callBackUrl: 'https://evil.test' }),
    ).rejects.toThrow();
  });
});
