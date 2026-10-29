import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { BookingShowtimeService } from '../../../../src/modules/bookings/booking-showtime.service';
import type { BookingsRepository } from '../../../../src/modules/bookings/bookings.repository';
import type { QrCodeService } from '../../../../src/modules/bookings/qr-code.service';
import { ScanService } from '../../../../src/modules/bookings/scan.service';
import type { BookingRow, ShowtimeContext } from '../../../../src/modules/bookings/types';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T19:10:00+03:00');
const EARLIER = new Date('2026-10-16T19:02:00+03:00');
const STAFF: StaffPrincipal = { kind: 'staff', id: 7, role: 'box_office', sessionId: 3 };
const HEADER = { id: 81, theater: { id: 3, name: 'Galaxy' } };

const CONTEXT = {
  view: {
    id: 81,
    theaterId: 3,
    status: 'scheduled',
    startsAt: new Date('2026-10-16T19:30:00+03:00'),
    endsAt: new Date('2026-10-16T21:30:00+03:00'),
  },
  theaterStatus: 'active',
  movieStatus: 'now_showing',
  header: HEADER,
} as unknown as ShowtimeContext;

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 100,
    reference: 'MQ-7K3P9Q',
    showtime_id: 81,
    status: 'confirmed',
    channel: 'online',
    customer_id: 12,
    created_by_staff_id: null,
    hold_token_hash: null,
    hold_expires_at: new Date('2026-10-15T12:05:00+03:00'),
    has_declined_payment: false,
    seat_count: 2,
    total_amount: 38000,
    currency: 'EGP',
    contact_name: 'Mona Adel',
    contact_email: 'mona@example.com',
    contact_phone: null,
    confirmed_at: new Date('2026-10-15T12:01:00+03:00'),
    refunded_at: null,
    qr_version: 1,
    checked_in_at: null,
    checked_in_by_staff_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('ScanService', () => {
  const calls: string[] = [];
  const logged = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  let theaters: { findById: jest.Mock };
  let qrCodes: { verify: jest.Mock };
  let bookings: Record<'findByReference' | 'checkIn' | 'seatsOf', jest.Mock>;
  let showtimes: { lockedBookingContext: jest.Mock };
  let audit: { record: jest.Mock };
  let service: ScanService;

  beforeEach(() => {
    calls.length = 0;
    theaters = { findById: logged('theater', { id: 3 }) };
    qrCodes = { verify: jest.fn().mockReturnValue({ reference: 'MQ-7K3P9Q', version: 1 }) };
    bookings = {
      findByReference: logged('find booking', row()),
      checkIn: logged('check in', NOW),
      seatsOf: logged('seats', [
        { booking_id: 100, seat_label: 'F7' },
        { booking_id: 100, seat_label: 'F8' },
      ]),
    };
    showtimes = { lockedBookingContext: logged('lock showtime', CONTEXT) };
    audit = { record: logged('audit', 1) };
    service = new ScanService(
      theaters as unknown as TheaterReadService,
      qrCodes as unknown as QrCodeService,
      bookings as unknown as BookingsRepository,
      showtimes as unknown as BookingShowtimeService,
      { run: jest.fn((fn: () => Promise<unknown>) => fn()) } as unknown as TransactionRepository,
      audit as unknown as AuditService,
      new TestClock(NOW),
    );
  });

  it('admits a genuine QR code once: showtime lock, conditional check-in, audit', async () => {
    const outcome = await service.scan(STAFF, { theaterId: 3, via: 'qr', code: 'MQ1.x' });
    expect(calls).toEqual([
      'theater',
      'find booking',
      'lock showtime',
      'check in',
      'audit',
      'seats',
    ]);
    expect(qrCodes.verify).toHaveBeenCalledWith('MQ1.x');
    expect(bookings.checkIn).toHaveBeenCalledWith(100, 1, 7, NOW);
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'staff', id: 7 },
      action: 'booking.checked_in',
      entity: { type: 'booking', id: 100 },
      bookingId: 100,
      metadata: { theaterId: 3, via: 'qr' },
    });
    expect(outcome).toEqual({
      result: 'VALID',
      reason: null,
      admits: 2,
      checkedInAt: NOW,
      scannedAt: NOW,
      booking: {
        reference: 'MQ-7K3P9Q',
        status: 'confirmed',
        seats: ['F7', 'F8'],
        seatCount: 2,
        contactName: 'Mona Adel',
        showtime: HEADER,
      },
    });
  });

  it('answers NOT_FOUND without a booking for a code that does not verify, reading nothing', async () => {
    qrCodes.verify.mockReturnValue(null);
    const outcome = await service.scan(STAFF, { theaterId: 3, via: 'qr', code: 'forged' });
    expect(outcome).toEqual({
      result: 'NOT_FOUND',
      reason: null,
      admits: null,
      checkedInAt: null,
      scannedAt: NOW,
      booking: null,
    });
    expect(bookings.findByReference).not.toHaveBeenCalled();
    expect(bookings.checkIn).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for a verified code or typed reference of no booking', async () => {
    bookings.findByReference.mockResolvedValue(undefined);
    for (const input of [
      { theaterId: 3, via: 'qr', code: 'MQ1.x' },
      { theaterId: 3, via: 'reference', reference: 'MQ-222222', confirm: true },
    ] as const) {
      expect((await service.scan(STAFF, input)).result).toBe('NOT_FOUND');
    }
    expect(showtimes.lockedBookingContext).not.toHaveBeenCalled();
  });

  it('fails an unknown theater with NOT_FOUND before reading the ticket', async () => {
    theaters.findById.mockResolvedValue(null);
    await expect(service.scan(STAFF, { theaterId: 9, via: 'qr', code: 'MQ1.x' })).rejects.toEqual(
      new AppError('NOT_FOUND'),
    );
    expect(qrCodes.verify).not.toHaveBeenCalled();
  });

  it('writes nothing for a refusal, and shows the first check-in time when already used', async () => {
    bookings.findByReference.mockResolvedValue(row({ checked_in_at: EARLIER }));
    const outcome = await service.scan(STAFF, { theaterId: 3, via: 'qr', code: 'MQ1.x' });
    expect(outcome).toMatchObject({ result: 'ALREADY_USED', admits: 2, checkedInAt: EARLIER });
    const wrong = await service.scan(STAFF, { theaterId: 4, via: 'qr', code: 'MQ1.x' });
    expect(wrong).toMatchObject({
      result: 'WRONG_SHOWTIME',
      reason: 'other_theater',
      admits: null,
      checkedInAt: null,
    });
    expect(bookings.checkIn).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('shows a typed reference and admits it only with confirm, without a QR version', async () => {
    const shown = await service.scan(STAFF, {
      theaterId: 3,
      via: 'reference',
      reference: 'MQ-7K3P9Q',
      confirm: false,
    });
    expect(shown).toMatchObject({ result: 'CONFIRM_REQUIRED', admits: 2, checkedInAt: null });
    expect(bookings.checkIn).not.toHaveBeenCalled();
    expect(qrCodes.verify).not.toHaveBeenCalled();

    const admitted = await service.scan(STAFF, {
      theaterId: 3,
      via: 'reference',
      reference: 'MQ-7K3P9Q',
      confirm: true,
    });
    expect(admitted.result).toBe('VALID');
    expect(bookings.checkIn).toHaveBeenCalledWith(100, null, 7, NOW);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { theaterId: 3, via: 'reference' } }),
    );
  });

  it('answers what the row says now when another scan admitted it first', async () => {
    bookings.checkIn.mockResolvedValue(undefined);
    bookings.findByReference
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ checked_in_at: EARLIER, checked_in_by_staff_id: 8 }));
    const outcome = await service.scan(STAFF, { theaterId: 3, via: 'qr', code: 'MQ1.x' });
    expect(outcome).toMatchObject({ result: 'ALREADY_USED', checkedInAt: EARLIER });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('fails loudly if a refused admission still reads as admissible', async () => {
    bookings.checkIn.mockResolvedValue(undefined);
    await expect(
      service.scan(STAFF, { theaterId: 3, via: 'qr', code: 'MQ1.x' }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
