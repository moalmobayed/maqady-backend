import type { CallHandler } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AppError } from '../../../../src/common/errors/app-error';
import { DiscoveryCacheInterceptor } from '../../../../src/modules/discovery/discovery-cache.interceptor';
import { fakeContext } from '../../../support/execution-context';

function setup() {
  const headers = new Map<string, string>();
  const response = { setHeader: (name: string, value: string) => headers.set(name, value) };
  const context = fakeContext({ response });
  return { headers, context, interceptor: new DiscoveryCacheInterceptor() };
}

describe('DiscoveryCacheInterceptor', () => {
  it('lets a shared cache keep a successful read for 60 seconds', async () => {
    const { headers, context, interceptor } = setup();
    const ok: CallHandler = { handle: () => of({ items: [] }) };
    await expect(lastValueFrom(interceptor.intercept(context, ok))).resolves.toEqual({
      items: [],
    });
    expect(headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it.each([
    ['NOT_FOUND', new AppError('NOT_FOUND')],
    ['VALIDATION_FAILED', new AppError('VALIDATION_FAILED')],
    ['SERVICE_UNAVAILABLE (the database is down)', new AppError('SERVICE_UNAVAILABLE')],
    ['an unexpected error', new Error('boom')],
  ])('marks %s no-store and passes the error on unchanged', async (_name, error) => {
    const { headers, context, interceptor } = setup();
    const failing: CallHandler = { handle: () => throwError(() => error) };
    await expect(lastValueFrom(interceptor.intercept(context, failing))).rejects.toBe(error);
    expect(headers.get('Cache-Control')).toBe('no-store');
  });
});
