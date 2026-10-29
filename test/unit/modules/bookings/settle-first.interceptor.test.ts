import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { SettleFirst } from '../../../../src/modules/bookings/settle-first.decorator';
import { SettleFirstInterceptor } from '../../../../src/modules/bookings/settle-first.interceptor';
import type { SettlementService } from '../../../../src/modules/bookings/settlement.service';
import { fakeContext } from '../../../support/execution-context';

class Routes {
  @SettleFirst('booking')
  booking(): void {}

  @SettleFirst('showtime')
  showtime(): void {}

  @SettleFirst('customer')
  customer(): void {}

  @SettleFirst('showtime', 'body')
  showtimeInBody(): void {}

  @SettleFirst('booking', 'body')
  bookingInBody(): void {}

  plain(): void {}
}

const handler = (name: keyof Routes) =>
  Object.getOwnPropertyDescriptor(Routes.prototype, name)!.value as () => void;

describe('SettleFirstInterceptor', () => {
  const calls: string[] = [];
  let settlement: { settleDue: jest.Mock };
  let interceptor: SettleFirstInterceptor;
  const next = {
    handle: jest.fn(() => {
      calls.push('handler');
      return of('result');
    }),
  };

  const run = (name: keyof Routes, request: object, type = 'http') =>
    lastValueFrom(
      interceptor.intercept(
        fakeContext({ handler: handler(name), request: request, type: type as never }),
        next,
      ),
    );

  beforeEach(() => {
    calls.length = 0;
    next.handle.mockClear();
    settlement = {
      settleDue: jest.fn(() => {
        calls.push('settle');
        return Promise.resolve({ confirmed: 0, declined: 0, refunded: 0 });
      }),
    };
    interceptor = new SettleFirstInterceptor(
      new Reflector(),
      settlement as unknown as SettlementService,
    );
  });

  it("settles the booking and the calling customer's payments before the handler runs", async () => {
    await expect(
      run('booking', { params: { ref: 'MQ-7K3P9Q' }, principal: { kind: 'customer', id: 12 } }),
    ).resolves.toBe('result');
    expect(settlement.settleDue).toHaveBeenCalledWith({
      bookingReference: 'MQ-7K3P9Q',
      customerId: 12,
    });
    expect(calls).toEqual(['settle', 'handler']);
  });

  it("settles only the calling customer's payments for 'customer', and nothing for anyone else", async () => {
    await run('customer', { params: {}, principal: { kind: 'customer', id: 12 } });
    expect(settlement.settleDue).toHaveBeenCalledWith({ customerId: 12 });
    expect(calls).toEqual(['settle', 'handler']);

    settlement.settleDue.mockClear();
    calls.length = 0;
    await run('customer', { params: {}, principal: { kind: 'staff', id: 3 } });
    await run('customer', { params: {} });
    expect(settlement.settleDue).not.toHaveBeenCalled();
    expect(calls).toEqual(['handler', 'handler']);
  });

  it('settles a showtime, without a customer for a guest or a staff member', async () => {
    await run('showtime', { params: { id: '81' } });
    expect(settlement.settleDue).toHaveBeenLastCalledWith({ showtimeId: 81 });
    await run('showtime', { params: { id: '81' }, principal: { kind: 'staff', id: 3 } });
    expect(settlement.settleDue).toHaveBeenLastCalledWith({ showtimeId: 81 });
  });

  it('settles nothing for a malformed parameter, a route without the decorator or a WebSocket', async () => {
    for (const ref of ['mq-7k3p9q', 'MQ-0OIL11', undefined]) {
      await run('booking', { params: { ref } });
    }
    for (const id of ['0', '-1', '1.5', 'abc', '99999999999999999999']) {
      await run('showtime', { params: { id } });
    }
    await run('plain', { params: { ref: 'MQ-7K3P9Q' } });
    await run('booking', { params: { ref: 'MQ-7K3P9Q' } }, 'ws');
    expect(settlement.settleDue).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(10);
  });

  it("settles the body's showtimeId for a route that names it there (U13), and nothing else", async () => {
    await run('showtimeInBody', { params: { id: '5' }, body: { showtimeId: 81 } });
    expect(settlement.settleDue).toHaveBeenLastCalledWith({ showtimeId: 81 });
    settlement.settleDue.mockClear();
    for (const body of [
      undefined,
      null,
      'text',
      {},
      { showtimeId: '81' },
      { showtimeId: 0 },
      { showtimeId: -3 },
      { showtimeId: 1.5 },
      { showtimeId: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      await run('showtimeInBody', { params: { id: '5' }, body });
    }
    expect(settlement.settleDue).not.toHaveBeenCalled();
  });

  it("settles the body's typed reference for a route that names it there (U13), and nothing else", async () => {
    await run('bookingInBody', { params: {}, body: { reference: '  mq-7k3p9q ' } });
    expect(settlement.settleDue).toHaveBeenLastCalledWith({ bookingReference: 'MQ-7K3P9Q' });
    settlement.settleDue.mockClear();
    for (const body of [
      undefined,
      null,
      'text',
      {},
      { code: 'MQ1.MQ-7K3P9Q.1.x' },
      { reference: 42 },
      { reference: 'MQ-0OIL11' },
      { reference: 'MQ-7K3P9QQ' },
    ]) {
      await run('bookingInBody', { params: { ref: 'MQ-7K3P9Q' }, body });
    }
    expect(settlement.settleDue).not.toHaveBeenCalled();
  });

  it('fails the request when settlement fails, without running the handler', async () => {
    settlement.settleDue.mockRejectedValue(new Error('database down'));
    await expect(run('booking', { params: { ref: 'MQ-7K3P9Q' } })).rejects.toThrow('database down');
    expect(next.handle).not.toHaveBeenCalled();
  });
});
