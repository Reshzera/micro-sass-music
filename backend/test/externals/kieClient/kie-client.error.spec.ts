import {
  KieResponseCode,
  KIE_RETRYABLE_CODES,
} from '../../../src/externals/kieClient/kie-client.constants';
import { KieApiError } from '../../../src/externals/kieClient/kie-client.error';

describe('KieApiError', () => {
  it('carries the envelope code, http status and task id', () => {
    const error = new KieApiError('boom', {
      kind: 'api',
      code: KieResponseCode.Unprocessable,
      httpStatus: 200,
      taskId: 'task-1',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('KieApiError');
    expect(error.message).toBe('boom');
    expect(error.kind).toBe('api');
    expect(error.code).toBe(KieResponseCode.Unprocessable);
    expect(error.httpStatus).toBe(200);
    expect(error.taskId).toBe('task-1');
  });

  it('keeps the underlying cause', () => {
    const cause = new Error('socket hang up');
    const error = new KieApiError('network down', { kind: 'network', cause });

    expect(error.cause).toBe(cause);
  });

  describe('isRetryable', () => {
    it.each(['network', 'timeout'] as const)(
      'is true for a %s failure regardless of code',
      (kind) => {
        expect(new KieApiError('x', { kind }).isRetryable).toBe(true);
      },
    );

    it.each(KIE_RETRYABLE_CODES)('is true for code %i', (code) => {
      expect(new KieApiError('x', { kind: 'api', code }).isRetryable).toBe(
        true,
      );
    });

    it.each([
      KieResponseCode.Unauthorized,
      KieResponseCode.InsufficientCredits,
      KieResponseCode.NotFound,
      KieResponseCode.Conflict,
      KieResponseCode.Unprocessable,
      KieResponseCode.Unavailable,
      KieResponseCode.GenerationFailed,
    ])('is false for code %i', (code) => {
      expect(new KieApiError('x', { kind: 'api', code }).isRetryable).toBe(
        false,
      );
    });

    it('is false when no code arrived at all', () => {
      expect(new KieApiError('x', { kind: 'malformed' }).isRetryable).toBe(
        false,
      );
    });
  });

  it('flags an auth failure only on 401', () => {
    expect(
      new KieApiError('x', { kind: 'api', code: KieResponseCode.Unauthorized })
        .isAuthFailure,
    ).toBe(true);
    expect(
      new KieApiError('x', { kind: 'api', code: KieResponseCode.NotFound })
        .isAuthFailure,
    ).toBe(false);
  });

  it('flags an empty balance only on 402', () => {
    expect(
      new KieApiError('x', {
        kind: 'api',
        code: KieResponseCode.InsufficientCredits,
      }).isOutOfCredits,
    ).toBe(true);
    expect(
      new KieApiError('x', { kind: 'api', code: KieResponseCode.ServerError })
        .isOutOfCredits,
    ).toBe(false);
  });
});
