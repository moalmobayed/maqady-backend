import { activityConditions } from '../../../../src/modules/activity/activity.sql';

describe('activityConditions', () => {
  it('is empty without filters: every event', () => {
    expect(activityConditions({})).toEqual([]);
  });

  it('binds every filter, the cinema dates as 06:00 Cairo instants (dateTo inclusive)', () => {
    expect(
      activityConditions({
        staffUserId: 7,
        actorKind: 'staff',
        entityType: 'booking',
        entityId: 512,
        action: 'booking.refunded',
        dateFrom: '2026-10-10',
        dateTo: '2026-10-16',
      }),
    ).toEqual([
      { sql: 'e.actor_staff_user_id = ?', bindings: [7] },
      { sql: 'e.actor_kind = ?', bindings: ['staff'] },
      { sql: 'e.entity_type = ?', bindings: ['booking'] },
      { sql: 'e.entity_id = ?', bindings: [512] },
      { sql: 'e.action = ?', bindings: ['booking.refunded'] },
      { sql: 'e.occurred_at >= ?', bindings: [new Date('2026-10-10T06:00:00+03:00')] },
      { sql: 'e.occurred_at < ?', bindings: [new Date('2026-10-17T06:00:00+03:00')] },
    ]);
  });

  it('follows the Cairo offset: a winter cinema day starts at 06:00 UTC+2', () => {
    expect(activityConditions({ dateFrom: '2026-01-15', dateTo: '2026-01-15' })).toEqual([
      { sql: 'e.occurred_at >= ?', bindings: [new Date('2026-01-15T06:00:00+02:00')] },
      { sql: 'e.occurred_at < ?', bindings: [new Date('2026-01-16T06:00:00+02:00')] },
    ]);
  });
});
