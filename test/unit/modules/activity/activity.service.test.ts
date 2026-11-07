import { AppError } from '../../../../src/common/errors/app-error';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import type { ActivityRepository } from '../../../../src/modules/activity/activity.repository';
import { ActivityService } from '../../../../src/modules/activity/activity.service';
import type { ActivityRow } from '../../../../src/modules/activity/types';
import type { StaffService } from '../../../../src/modules/staff/staff.service';
import type { StaffMember } from '../../../../src/modules/staff/types';

function eventRow(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 90,
    occurred_at: new Date('2026-10-16T19:02:10+03:00'),
    actor_kind: 'staff',
    actor_staff_user_id: 7,
    actor_customer_id: null,
    action: 'booking.refunded',
    entity_type: 'booking',
    entity_id: 512,
    booking_id: 512,
    booking_reference: 'MQ-7K3P9Q',
    changed_fields: ['status'],
    metadata: { amount: 38000 },
    ...overrides,
  };
}

const member = (id: number, fullName: string) => ({ id, fullName }) as unknown as StaffMember;

describe('ActivityService', () => {
  const repository = { page: jest.fn(), count: jest.fn() };
  const staff = { findByIds: jest.fn() };
  const service = new ActivityService(
    repository as unknown as ActivityRepository,
    staff as unknown as StaffService,
  );

  beforeEach(() => {
    repository.count.mockResolvedValue(3);
    staff.findByIds.mockResolvedValue(new Map([[7, member(7, 'Mona Saeed')]]));
  });

  it('answers a page with the staff names read once, a customer by id only', async () => {
    repository.page.mockResolvedValue([
      eventRow(),
      eventRow({
        id: 89,
        actor_kind: 'customer',
        actor_staff_user_id: null,
        actor_customer_id: 42,
        action: 'booking.held',
        changed_fields: null,
        metadata: null,
      }),
      eventRow({ id: 88, actor_staff_user_id: 7 }),
    ]);
    const page = await service.list({ entityType: 'booking' }, { limit: 2 });

    expect(repository.page).toHaveBeenCalledWith(
      { entityType: 'booking' },
      { after: null, limit: 2 },
    );
    expect(repository.count).toHaveBeenCalledWith({ entityType: 'booking' });
    expect(staff.findByIds).toHaveBeenCalledTimes(1);
    expect(staff.findByIds).toHaveBeenCalledWith([7]);
    expect(page.total).toBe(3);
    expect(page.items).toEqual([
      {
        id: 90,
        occurredAt: new Date('2026-10-16T19:02:10+03:00'),
        action: 'booking.refunded',
        actor: { kind: 'staff', staff: { id: 7, fullName: 'Mona Saeed' }, customerId: null },
        entity: { type: 'booking', id: 512 },
        bookingReference: 'MQ-7K3P9Q',
        changedFields: ['status'],
        metadata: { amount: 38000 },
      },
      {
        id: 89,
        occurredAt: new Date('2026-10-16T19:02:10+03:00'),
        action: 'booking.held',
        actor: { kind: 'customer', staff: null, customerId: 42 },
        entity: { type: 'booking', id: 512 },
        bookingReference: 'MQ-7K3P9Q',
        changedFields: [],
        metadata: {},
      },
    ]);
    expect(page.nextCursor).toBe(encodeCursor({ sortKey: '2026-10-16T16:02:10.000Z', id: 89 }));
  });

  it('passes the cursor on as the position after which to read', async () => {
    repository.page.mockResolvedValue([]);
    const cursor = encodeCursor({ sortKey: '2026-10-16T16:02:10.000Z', id: 89 });
    const page = await service.list({}, { cursor });
    expect(repository.page).toHaveBeenCalledWith(
      {},
      { after: { sortKey: '2026-10-16T16:02:10.000Z', id: 89 }, limit: 20 },
    );
    expect(staff.findByIds).not.toHaveBeenCalled();
    expect(page).toEqual({ items: [], nextCursor: null, total: 3 });
  });

  it('shows a staff member it cannot name as no staff', async () => {
    repository.page.mockResolvedValue([eventRow({ actor_staff_user_id: 99 })]);
    const page = await service.list({}, {});
    expect(page.items[0]?.actor).toEqual({ kind: 'staff', staff: null, customerId: null });
  });

  it.each([
    [{ entityId: 512 }, {}, 'entityId'],
    [{ dateFrom: '2026-10-16', dateTo: '2026-10-10' }, {}, 'dateTo'],
    [{}, { cursor: encodeCursor({ sortKey: 'not a time', id: 1 }) }, 'cursor'],
    [{}, { cursor: encodeCursor({ sortKey: null, id: 1 }) }, 'cursor'],
    [{}, { limit: 101 }, 'limit'],
  ])('refuses %j %j on %s, before reading', async (filter, query, field) => {
    const refusal = service.list(filter, query);
    await expect(refusal).rejects.toBeInstanceOf(AppError);
    await expect(refusal).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [expect.objectContaining({ field })] },
    });
    expect(repository.page).not.toHaveBeenCalled();
  });
});
