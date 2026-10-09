import { Logger } from '@nestjs/common';

export interface LoggerSpies {
  log: jest.SpyInstance;
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
}

/**
 * Keep Nest's logger out of the test output, and hand back the spies so a
 * spec can assert on what a service logged.
 *
 * Call inside `beforeEach`; `restoreMocks`/`jest.restoreAllMocks()` undoes it.
 */
export function silenceLogger(): LoggerSpies {
  return {
    log: jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined),
    warn: jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined),
    error: jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined),
  };
}
