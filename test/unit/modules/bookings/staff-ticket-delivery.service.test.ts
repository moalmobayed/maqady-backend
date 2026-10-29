import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import { StaffTicketDeliveryService } from '../../../../src/modules/bookings/staff-ticket-delivery.service';
import type { TicketsService } from '../../../../src/modules/bookings/tickets.service';
import type { ShowtimeReadService } from '../../../../src/modules/showtimes/showtime-read.service';
import { ADMIN_NOW, confirmedRow } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const STAFF = { kind: 'staff', id: 4, sessionId: 40, role: 'box_office' } as const;
const LATER = new Date('2026-10-11T19:00:00Z');

describe('StaffTicketDeliveryService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn((..._args: unknown[]) => {
      calls.push(name);
      return Promise.resolve(value);
    });
  let bookings: { findByReference: jest.Mock; lockForUpdate: jest.Mock };
  let tickets: { queueTickets: jest.Mock };
  let audit: { record: jest.Mock };
  let service: StaffTicketDeliveryService;

  const build = (row = confirmedRow()) => {
    bookings = { findByReference: logged('find', row), lockForUpdate: logged('lock', [row]) };
    tickets = { queueTickets: logged('queue', undefined) };
    audit = { record: logged('audit', undefined) };
    service = new StaffTicketDeliveryService(
      bookings as unknown as BookingsRepository,
      {
        findByIds: logged('showtime', new Map([[81, { id: 81, endsAt: LATER }]])),
      } as unknown as ShowtimeReadService,
      tickets as unknown as TicketsService,
      audit as unknown as AuditService,
      { run: <T>(work: () => Promise<T>) => work() } as unknown as TransactionRepository,
      new TestClock(ADMIN_NOW),
    );
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it('queues the email and SMS under the booking lock and records the resend', async () => {
    build();
    expect(await service.resend(STAFF, 'MQ-7K3P9Q')).toEqual({
      channels: ['email', 'sms'],
      queuedAt: ADMIN_NOW,
    });
    expect(calls).toEqual(['find', 'lock', 'showtime', 'queue', 'audit']);
    expect(tickets.queueTickets).toHaveBeenCalledWith([100], { sms: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { kind: 'staff', id: 4 },
        action: 'booking.tickets_resent',
        metadata: { channels: 'email,sms', by: 'staff' },
      }),
    );
  });

  it('sends by email alone when no phone is on file', async () => {
    build(confirmedRow({ contact_phone: null }));
    expect((await service.resend(STAFF, 'MQ-7K3P9Q')).channels).toEqual(['email']);
  });

  it('refuses a walk-in with no contact, a booking without a ticket, and an unknown one', async () => {
    build(confirmedRow({ contact_email: null, contact_phone: null }));
    await expect(service.resend(STAFF, 'MQ-7K3P9Q')).rejects.toMatchObject({
      code: 'NO_CONTACT_DETAILS',
    });
    build(confirmedRow({ status: 'refunded', refunded_at: ADMIN_NOW }));
    await expect(service.resend(STAFF, 'MQ-7K3P9Q')).rejects.toMatchObject({
      code: 'TICKET_NOT_AVAILABLE',
      details: { status: 'refunded' },
    });
    expect(tickets.queueTickets).not.toHaveBeenCalled();
    build();
    bookings.findByReference = logged('find', undefined);
    await expect(service.resend(STAFF, 'MQ-ZZZZZZ')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(bookings.lockForUpdate).not.toHaveBeenCalled();
  });
});
