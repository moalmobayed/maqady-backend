import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminOverviewQuery } from '../../../../../src/modules/analytics/dto/admin-overview.query';
import { AlertReadsRequest } from '../../../../../src/modules/analytics/dto/alert-reads.request';

async function check<T extends object>(type: new () => T, input: Record<string, unknown>) {
  const instance = plainToInstance(type, input);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('AdminOverviewQuery', () => {
  it('accepts a preset, dates and the theater id from query text', async () => {
    expect((await check(AdminOverviewQuery, {})).fields).toEqual([]);
    for (const period of ['today', '7d', '30d']) {
      expect((await check(AdminOverviewQuery, { period })).fields).toEqual([]);
    }
    const { instance, fields } = await check(AdminOverviewQuery, {
      dateFrom: '2026-10-04',
      dateTo: '2026-10-10',
      theaterId: '3',
    });
    expect(fields).toEqual([]);
    expect(instance.theaterId).toBe(3);
  });

  it.each([
    [{ period: 'week' }, 'period'],
    [{ period: '1d' }, 'period'],
    [{ dateFrom: '2026-02-30' }, 'dateFrom'],
    [{ dateTo: '10/10/2026' }, 'dateTo'],
    [{ theaterId: '0' }, 'theaterId'],
    [{ theaterId: 'three' }, 'theaterId'],
    [{ hallId: '1' }, 'hallId'],
  ])('refuses %j on %s', async (input, field) => {
    expect((await check(AdminOverviewQuery, input)).fields).toEqual([field]);
  });
});

describe('AlertReadsRequest', () => {
  it('takes no keys (all current) or up to 200 alert keys', async () => {
    expect((await check(AlertReadsRequest, {})).fields).toEqual([]);
    expect(
      (
        await check(AlertReadsRequest, {
          keys: ['failed-payments:2026-10-10:6', 'low-sales:81', 'hall-gap:40:2026-10-17'],
        })
      ).fields,
    ).toEqual([]);
    expect(
      (
        await check(AlertReadsRequest, {
          keys: Array.from({ length: 200 }, (_, index) => `low-sales:${index + 1}`),
        })
      ).fields,
    ).toEqual([]);
  });

  it.each([
    [{ keys: [] }],
    [{ keys: null }],
    [{ keys: 'low-sales:81' }],
    [{ keys: ['Low-Sales:81'] }],
    [{ keys: ['low sales'] }],
    [{ keys: [81] }],
    [{ keys: ['x'.repeat(201)] }],
    [{ keys: Array.from({ length: 201 }, (_, index) => `low-sales:${index + 1}`) }],
  ])('refuses %j', async (input) => {
    expect((await check(AlertReadsRequest, input)).fields).toEqual(['keys']);
  });
});
