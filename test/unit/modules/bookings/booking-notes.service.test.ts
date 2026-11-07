import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { encodeCursor } from '../../../../src/common/pagination/cursor';
import type { BookingNotesRepository } from '../../../../src/modules/bookings/booking-notes.repository';
import { BookingNotesService } from '../../../../src/modules/bookings/booking-notes.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { StaffService } from '../../../../src/modules/staff/staff.service';
import { ADMIN_NOW, confirmedRow } from '../../../support/booking-rows-admin';
import { TestClock } from '../../../support/clock';

const STAFF = { kind: 'staff', id: 4, sessionId: 40, role: 'box_office' } as const;

describe('BookingNotesService', () => {
  let notes: Record<'insert' | 'pageOf' | 'countOf' | 'deleteForCustomer', jest.Mock>;
  let bookings: { findByReference: jest.Mock };
  let audit: { record: jest.Mock };
  let active: boolean;
  let service: BookingNotesService;

  const note = (id: number, body: string) => ({
    id,
    booking_id: 100,
    staff_user_id: 4,
    body,
    created_at: ADMIN_NOW,
  });

  beforeEach(() => {
    active = true;
    notes = {
      insert: jest.fn((row: object) => Promise.resolve({ id: 12, ...row })),
      pageOf: jest.fn().mockResolvedValue([note(2, 'Called back.'), note(1, 'Late.')]),
      countOf: jest.fn().mockResolvedValue(2),
      deleteForCustomer: jest.fn().mockResolvedValue(3),
    };
    bookings = { findByReference: jest.fn().mockResolvedValue(confirmedRow()) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new BookingNotesService(
      notes as unknown as BookingNotesRepository,
      bookings as unknown as BookingsRepository,
      {
        findByIds: jest.fn().mockResolvedValue(new Map([[4, { id: 4, fullName: 'Hany Adel' }]])),
      } as unknown as StaffService,
      audit as unknown as AuditService,
      { run: <T>(work: () => Promise<T>) => work() } as unknown as TransactionRepository,
      { isActive: () => active } as unknown as TransactionContext,
      new TestClock(ADMIN_NOW),
    );
  });

  it('adds a note by the signed-in member and audits it without its text', async () => {
    const added = await service.add(STAFF, 'MQ-7K3P9Q', 'Will arrive late.');
    expect(notes.insert).toHaveBeenCalledWith({
      booking_id: 100,
      staff_user_id: 4,
      body: 'Will arrive late.',
      created_at: ADMIN_NOW,
    });
    expect(added).toEqual({
      id: 12,
      body: 'Will arrive late.',
      author: { id: 4, fullName: 'Hany Adel' },
      createdAt: ADMIN_NOW,
    });
    const [event] = audit.record.mock.calls[0] as [Record<string, unknown>];
    expect(event).toMatchObject({ action: 'booking.note_added', metadata: { noteId: 12 } });
    expect(JSON.stringify(event)).not.toContain('late');
  });

  it('lists a page with the authors and a cursor when more remain', async () => {
    const page = await service.list('MQ-7K3P9Q', { limit: 1 });
    expect(page.items).toEqual([
      {
        id: 2,
        body: 'Called back.',
        author: { id: 4, fullName: 'Hany Adel' },
        createdAt: ADMIN_NOW,
      },
    ]);
    expect(page.total).toBe(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('refuses an unknown booking and a cursor of another list', async () => {
    bookings.findByReference.mockResolvedValue(undefined);
    await expect(service.list('MQ-ZZZZZZ', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.add(STAFF, 'MQ-ZZZZZZ', 'x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(notes.insert).not.toHaveBeenCalled();
    await expect(
      service.list('MQ-7K3P9Q', { cursor: encodeCursor({ sortKey: null, id: 1 }) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('deletes a customer’s notes only inside a transaction', async () => {
    expect(await service.deleteForCustomer(42)).toBe(3);
    active = false;
    await expect(service.deleteForCustomer(42)).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
