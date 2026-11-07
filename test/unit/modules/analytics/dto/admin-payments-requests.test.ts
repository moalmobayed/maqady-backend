import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdminPaymentsQuery,
  AdminPaymentsSummaryQuery,
} from '../../../../../src/modules/analytics/dto/admin-payments.query';

async function check<T extends object>(type: new () => T, query: Record<string, unknown>) {
  const instance = plainToInstance(type, query);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('AdminPaymentsQuery', () => {
  it('accepts every filter together, the theater id from query text', async () => {
    const { instance, fields } = await check(AdminPaymentsQuery, {
      kind: 'refund',
      method: 'cash',
      channel: 'counter',
      status: 'pending',
      theaterId: '3',
      dateFrom: '2026-10-10',
      dateTo: '2026-10-16',
      cursor: 'WyIyMDI2LTEwLTE2VDE5OjMwOjAwKzAzOjAwIiw0Ml0',
      limit: '50',
    });
    expect(fields).toEqual([]);
    expect(instance).toMatchObject({ theaterId: 3, limit: 50 });
    expect((await check(AdminPaymentsQuery, {})).fields).toEqual([]);
  });

  it.each([
    [{ kind: 'payout' }, 'kind'],
    [{ method: 'cheque' }, 'method'],
    [{ channel: 'phone' }, 'channel'],
    [{ status: 'processing' }, 'status'],
    [{ status: 'declined' }, 'status'],
    [{ theaterId: '0' }, 'theaterId'],
    [{ theaterId: 'one' }, 'theaterId'],
    [{ dateFrom: '2026-02-30' }, 'dateFrom'],
    [{ dateTo: '16/10/2026' }, 'dateTo'],
    [{ limit: '0' }, 'limit'],
    [{ q: 'MQ-7K3P9Q' }, 'q'],
  ])('refuses %j on %s', async (query, field) => {
    expect((await check(AdminPaymentsQuery, query)).fields).toEqual([field]);
  });
});

describe('AdminPaymentsSummaryQuery', () => {
  it('takes an optional cinema-date period', async () => {
    expect(
      (await check(AdminPaymentsSummaryQuery, { dateFrom: '2026-10-10', dateTo: '2026-10-16' }))
        .fields,
    ).toEqual([]);
    expect((await check(AdminPaymentsSummaryQuery, {})).fields).toEqual([]);
  });

  it.each([
    [{ dateFrom: '2026-13-01' }, 'dateFrom'],
    [{ dateTo: 'today' }, 'dateTo'],
    [{ cursor: 'abc' }, 'cursor'],
  ])('refuses %j on %s', async (query, field) => {
    expect((await check(AdminPaymentsSummaryQuery, query)).fields).toEqual([field]);
  });
});
