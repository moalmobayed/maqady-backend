import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ActivityQuery } from '../../../../../src/modules/activity/dto/activity.query';

async function check(query: Record<string, unknown>) {
  const instance = plainToInstance(ActivityQuery, query);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('ActivityQuery', () => {
  it('accepts every filter together, the ids from query text', async () => {
    const { instance, fields } = await check({
      staffUserId: '7',
      actorKind: 'staff',
      entityType: 'theater_special_date',
      entityId: '81',
      action: 'booking.ticket_downloaded',
      dateFrom: '2026-10-10',
      dateTo: '2026-10-16',
      cursor: 'WyIyMDI2LTEwLTE2VDE5OjMwOjAwKzAzOjAwIiw0Ml0',
      limit: '50',
    });
    expect(fields).toEqual([]);
    expect(instance).toMatchObject({ staffUserId: 7, entityId: 81, limit: 50 });
    expect((await check({})).fields).toEqual([]);
  });

  it.each([
    [{ staffUserId: '0' }, 'staffUserId'],
    [{ staffUserId: 'mona' }, 'staffUserId'],
    [{ actorKind: 'admin' }, 'actorKind'],
    [{ entityType: 'Booking' }, 'entityType'],
    [{ entityType: 'booking;drop' }, 'entityType'],
    [{ entityType: 'a'.repeat(33) }, 'entityType'],
    [{ entityId: '-1' }, 'entityId'],
    [{ action: 'refunded' }, 'action'],
    [{ action: `booking.${'a'.repeat(60)}` }, 'action'],
    [{ dateFrom: '2026-02-30' }, 'dateFrom'],
    [{ dateTo: '16/10/2026' }, 'dateTo'],
    [{ limit: '101' }, 'limit'],
    [{ q: 'nadia' }, 'q'],
  ])('refuses %j on %s', async (query, field) => {
    expect((await check(query)).fields).toEqual([field]);
  });
});
