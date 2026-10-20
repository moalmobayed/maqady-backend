import { AppError } from '../../../../src/common/errors/app-error';
import { ERROR_CATALOGUE } from '../../../../src/common/errors/error-catalogue';

describe('AppError', () => {
  it('takes its status and default message from the catalogue', () => {
    const error = new AppError('NOT_FOUND');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AppError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe(ERROR_CATALOGUE.NOT_FOUND.message);
    expect(error.details).toBeNull();
    expect(error.retryAfterSeconds).toBeUndefined();
    expect('cause' in error).toBe(false);
  });

  it('keeps a custom message, details, cause and retry time', () => {
    const cause = new Error('socket closed');
    const error = new AppError(
      'RATE_LIMITED',
      'Slow down.',
      { limit: 5 },
      { cause, retryAfterSeconds: 42 },
    );
    expect(error.status).toBe(429);
    expect(error.message).toBe('Slow down.');
    expect(error.details).toEqual({ limit: 5 });
    expect(error.cause).toBe(cause);
    expect(error.retryAfterSeconds).toBe(42);
  });

  it('gives every catalogue code exactly one HTTP error status and a message', () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOGUE)) {
      expect(code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThan(600);
      expect(definition.message.length).toBeGreaterThan(0);
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });
});
