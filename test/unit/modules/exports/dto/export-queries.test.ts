import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExportBookingsQuery } from '../../../../../src/modules/exports/dto/export-bookings.query';
import { ExportCustomersQuery } from '../../../../../src/modules/exports/dto/export-customers.query';
import { ExportPaymentsQuery } from '../../../../../src/modules/exports/dto/export-payments.query';

async function check<T extends object>(type: new () => T, query: Record<string, unknown>) {
  const instance = plainToInstance(type, query);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('export queries', () => {
  it("take their list's filters, validated the same way", async () => {
    const bookings = await check(ExportBookingsQuery, {
      q: '  MQ-7K3P9Q ',
      theaterId: '3',
      movieId: '12',
      status: 'completed',
      channel: 'online',
      method: 'wallet',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-16',
      customerId: '42',
    });
    expect(bookings.fields).toEqual([]);
    expect(bookings.instance).toMatchObject({ q: 'MQ-7K3P9Q', theaterId: 3, customerId: 42 });
    expect((await check(ExportCustomersQuery, { q: 'layla', status: 'blocked' })).fields).toEqual(
      [],
    );
    expect(
      (
        await check(ExportPaymentsQuery, {
          kind: 'refund',
          method: 'cash',
          channel: 'counter',
          status: 'pending',
          theaterId: '3',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-16',
        })
      ).fields,
    ).toEqual([]);
  });

  it.each([
    [ExportBookingsQuery, { status: 'paid' }, 'status'],
    [ExportBookingsQuery, { q: 'a' }, 'q'],
    [ExportCustomersQuery, { status: 'anonymised' }, 'status'],
    [ExportPaymentsQuery, { kind: 'payout' }, 'kind'],
  ] as const)('refuses a bad filter (%p %j)', async (type, query, field) => {
    expect((await check(type as new () => object, query)).fields).toEqual([field]);
  });

  it.each([ExportBookingsQuery, ExportCustomersQuery, ExportPaymentsQuery])(
    'refuses cursor and limit: an export is the whole list (%p)',
    async (type) => {
      expect(
        (await check(type as new () => object, { cursor: 'WyJ4IiwxXQ', limit: '10' })).fields,
      ).toEqual(['cursor', 'limit']);
    },
  );
});
