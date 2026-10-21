import { AuditService } from '../../../../src/common/audit/audit.service';
import { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import { TestClock } from '../../../support/clock';
import { FoundationsProbeModule } from '../../../support/foundations-probe.module';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, heldBookingIds } from '../../../support/holds';
import { createStaffMember, signInStaff } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { TestApp } from '../../../support/types';

const COLUMNS = [
  'occurred_at',
  'actor_kind',
  'actor_staff_user_id',
  'actor_customer_id',
  'action',
  'entity_type',
  'entity_id',
  'booking_id',
  'changed_fields',
  'metadata',
];

describe('AuditService (integration)', () => {
  let testApp: TestApp;
  const clock = new TestClock(new Date('2026-10-16T16:30:00Z'));

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [FoundationsProbeModule] });
  });

  beforeEach(async () => {
    await testApp.knex('audit_events').truncate();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('commits a record with the request that wrote it: field names only, sorted', async () => {
    const response = await testApp.http().post('/api/v1/test-foundations/audit-events').send({});
    expect(response.status).toBe(201);

    const rows = await testApp.knex('audit_events').select(...COLUMNS);
    expect(rows).toEqual([
      {
        occurred_at: clock.now(),
        actor_kind: 'system',
        actor_staff_user_id: null,
        actor_customer_id: null,
        action: 'probe.recorded',
        entity_type: 'probe',
        entity_id: 7,
        booking_id: null,
        changed_fields: ['status', 'title'],
        metadata: { seatCount: 2, method: 'cash' },
      },
    ]);
  });

  it('disappears with the rollback of its request', async () => {
    const response = await testApp
      .http()
      .post('/api/v1/test-foundations/audit-events')
      .send({ fail: true });
    expect(response.status).toBe(409);
    expect(await testApp.knex('audit_events').count({ n: '*' })).toEqual([{ n: 0 }]);
  });

  it('records staff and customer actors in their own columns, inside a service transaction', async () => {
    // The actor columns reference staff_users (U2a) and customers (U9), and booking_id bookings
    // (U10), so the actors and the booking are real.
    const staff = await createStaffMember(testApp, { role: 'admin' });
    const { customerId } = await registerCustomer(testApp);
    const admin = await signInStaff(testApp, staff.email, staff.password);
    const showtime = await bookableShowtime(testApp, admin, { cinemaDate: '2026-10-17' });
    const bookingId = (await heldBookingIds(testApp, showtime.showtimeId, 1))[0]!;
    await testApp.knex('audit_events').truncate();
    const audit = testApp.app.get(AuditService);
    await testApp.app.get(TransactionRepository).run(async () => {
      await audit.record({
        actor: { kind: 'staff', id: staff.id },
        action: 'booking.refunded',
        entity: { type: 'booking', id: bookingId },
        bookingId,
      });
      await audit.record({
        actor: { kind: 'customer', id: customerId },
        action: 'booking.claimed',
        entity: { type: 'booking', id: bookingId },
        bookingId,
      });
    });
    const rows = await testApp
      .knex('audit_events')
      .select('actor_kind', 'actor_staff_user_id', 'actor_customer_id', 'booking_id')
      .orderBy('id');
    expect(rows).toEqual([
      {
        actor_kind: 'staff',
        actor_staff_user_id: staff.id,
        actor_customer_id: null,
        booking_id: bookingId,
      },
      {
        actor_kind: 'customer',
        actor_staff_user_id: null,
        actor_customer_id: customerId,
        booking_id: bookingId,
      },
    ]);
  });

  it('refuses metadata that suggests personal data, writing nothing', async () => {
    const audit = testApp.app.get(AuditService);
    await expect(
      audit.record({
        actor: { kind: 'system' },
        action: 'customer.updated',
        entity: { type: 'customer', id: 1 },
        metadata: { contactEmail: 'mona@example.com' },
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(await testApp.knex('audit_events').count({ n: '*' })).toEqual([{ n: 0 }]);
  });
});
