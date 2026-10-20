import type { AuditRepository } from '../../../../src/common/audit/audit.repository';
import { AuditService } from '../../../../src/common/audit/audit.service';
import type { AuditEventInput } from '../../../../src/common/audit/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T16:30:00Z');

describe('AuditService', () => {
  let repository: jest.Mocked<AuditRepository>;
  let service: AuditService;

  beforeEach(() => {
    repository = {
      insert: jest.fn().mockResolvedValue(41),
    } as unknown as jest.Mocked<AuditRepository>;
    service = new AuditService(repository, new TestClock(NOW));
  });

  const event = (overrides: Partial<AuditEventInput> = {}): AuditEventInput => ({
    actor: { kind: 'staff', id: 3 },
    action: 'booking.refunded',
    entity: { type: 'booking', id: 12 },
    ...overrides,
  });

  it('writes the row with the Clock time, the actor in its own column, and field names sorted once', async () => {
    await expect(
      service.record(
        event({
          bookingId: 12,
          changedFields: ['status', 'contactEmail', 'status'],
          metadata: { method: 'cash', seatCount: 2 },
        }),
      ),
    ).resolves.toBe(41);
    expect(repository.insert).toHaveBeenCalledWith({
      occurred_at: NOW,
      actor_kind: 'staff',
      actor_staff_user_id: 3,
      actor_customer_id: null,
      action: 'booking.refunded',
      entity_type: 'booking',
      entity_id: 12,
      booking_id: 12,
      changed_fields: ['contactEmail', 'status'],
      metadata: { method: 'cash', seatCount: 2 },
    });
  });

  it('defaults to no booking, no changed fields and empty metadata', async () => {
    await service.record(event({ actor: { kind: 'customer', id: 9 } }));
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_staff_user_id: null,
        actor_customer_id: 9,
        booking_id: null,
        changed_fields: [],
        metadata: {},
      }),
    );
  });

  it.each<[string, Partial<AuditEventInput>]>([
    ['an action that is not noun.verb', { action: 'Refunded' }],
    ['an entity type that is not a lower-case name', { entity: { type: 'Booking', id: 1 } }],
    ['a changed "field" that is a value', { changedFields: ['mona@example.com'] }],
    ['metadata under a personal-data key', { metadata: { customerEmail: 'x' } }],
    ['metadata under a phone key', { metadata: { phone: '010' } }],
    ['nested metadata', { metadata: { seats: ['C4'] } as never }],
  ])('refuses %s with INTERNAL, writing nothing', async (_case, overrides) => {
    await expect(service.record(event(overrides))).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(repository.insert).not.toHaveBeenCalled();
  });
});
