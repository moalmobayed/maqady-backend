import type { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DrainOutboxAfterResponse } from '../../../../src/modules/messaging/drain-after-response.decorator';
import { OutboxDrainInterceptor } from '../../../../src/modules/messaging/outbox-drain.interceptor';
import type { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { fakeContext } from '../../../support/execution-context';

class Routes {
  @DrainOutboxAfterResponse()
  ready(): void {}

  plain(): void {}
}

function setup() {
  const drain = { requestDrain: jest.fn() };
  const interceptor = new OutboxDrainInterceptor(
    new Reflector(),
    drain as unknown as OutboxDrainService,
  );
  return { drain, interceptor };
}

const ok: CallHandler = { handle: () => of({ ok: true }) };
const failing: CallHandler = { handle: () => throwError(() => new Error('handler failed')) };

describe('OutboxDrainInterceptor', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'requests a batch drain after a successful %s',
    async (method) => {
      const { drain, interceptor } = setup();
      const context = fakeContext({ request: { method }, handler: Routes.prototype.plain });
      const result$ = interceptor.intercept(context, ok);
      expect(drain.requestDrain).not.toHaveBeenCalled();
      await expect(lastValueFrom(result$)).resolves.toEqual({ ok: true });
      expect(drain.requestDrain).toHaveBeenCalledWith('batch');
    },
  );

  it('requests a flush after a marked GET, and nothing after an unmarked one', async () => {
    const marked = setup();
    await lastValueFrom(
      marked.interceptor.intercept(
        fakeContext({ request: { method: 'GET' }, handler: Routes.prototype.ready }),
        ok,
      ),
    );
    expect(marked.drain.requestDrain).toHaveBeenCalledWith('flush');

    const plain = setup();
    await lastValueFrom(
      plain.interceptor.intercept(
        fakeContext({ request: { method: 'GET' }, handler: Routes.prototype.plain }),
        ok,
      ),
    );
    expect(plain.drain.requestDrain).not.toHaveBeenCalled();
  });

  it('requests nothing when the handler fails', async () => {
    const { drain, interceptor } = setup();
    const result$ = interceptor.intercept(
      fakeContext({ request: { method: 'POST' }, handler: Routes.prototype.plain }),
      failing,
    );
    await expect(lastValueFrom(result$)).rejects.toThrow('handler failed');
    expect(drain.requestDrain).not.toHaveBeenCalled();
  });

  it('passes WebSocket contexts straight through', async () => {
    const { drain, interceptor } = setup();
    await lastValueFrom(
      interceptor.intercept(fakeContext({ type: 'ws', handler: Routes.prototype.ready }), ok),
    );
    expect(drain.requestDrain).not.toHaveBeenCalled();
  });
});
