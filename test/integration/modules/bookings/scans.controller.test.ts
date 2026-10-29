import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { QrCodeService } from '../../../../src/modules/bookings/qr-code.service';
import { counterHold, counterSale, scanTicket } from '../../../support/box-office';
import { customerHold, pay } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { bookableShowtime } from '../../../support/holds';
import { SHOWTIMES } from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

/** Sales happen the day before; scans on the evening of the 19:30 showtime (ends 21:30). */
const SALE_TIME = new Date('2026-10-10T10:00:00+03:00');
const STARTS_AT = new Date('2026-10-11T19:30:00+03:00');
const OPENS_AT = new Date('2026-10-11T18:30:00+03:00');
const AT_DOOR = new Date('2026-10-11T19:12:40+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/**
 * Ticket scanning at the entrance (design §7.9; PRD "Scan tickets", "Tickets and QR codes"):
 * the QR signature and version, the theater, the showtime's status and window, one check-in per
 * booking, and typed references that admit only on a confirmed second request. Real app and
 * Postgres, nothing replaced; refunds and edits (U14) are reproduced on the row they change.
 */
describe('Ticket scanning (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let seller: StaffSession;
  let scanner: StaffSession;
  let showtime: BookableShowtimeFixture;
  let elsewhere: BookableShowtimeFixture;
  let late: BookableShowtimeFixture;
  let endsAt: Date;
  const clock = new TestClock(SALE_TIME);

  /** Moves the clock and signs the scanner in again, since access tokens are short-lived. */
  const at = async (instant: Date): Promise<StaffSession> => {
    clock.set(instant);
    scanner = await signInStaff(testApp, scanner.email, scanner.password);
    return scanner;
  };
  const scan = (body: Record<string, unknown>) => scanTicket(testApp, scanner.authorization, body);
  const sold = async (seats: string[], theater = showtime) => {
    clock.set(SALE_TIME);
    const fresh = await signInStaff(testApp, seller.email, seller.password);
    const sale = await counterSale(testApp, fresh.authorization, theater.showtimeId, seats, {
      method: 'cash',
      customer: { kind: 'contact', fullName: 'Karim Mostafa' },
    });
    return {
      reference: sale.body.booking.reference as string,
      code: sale.body.booking.ticket.qrCode as string,
    };
  };
  const checkIn = (reference: string) =>
    testApp
      .knex('bookings')
      .select('checked_in_at', 'checked_in_by_staff_id')
      .where({ reference })
      .first();

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    seller = await staffSession(testApp, 'box_office');
    scanner = await staffSession(testApp, 'box_office');
    showtime = await bookableShowtime(testApp, admin);
    elsewhere = await bookableShowtime(testApp, admin);
    late = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '22:00' });
    const row = (await testApp
      .knex('showtimes')
      .select('ends_at')
      .where({ id: showtime.showtimeId })
      .first()) as { ends_at: Date };
    endsAt = row.ends_at;
  });

  beforeEach(async () => {
    clock.set(SALE_TIME);
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('checks a QR code in once; the second scan says already used, with the first time', async () => {
    const { reference, code } = await sold(['B2', 'B3']);
    await at(AT_DOOR);

    const first = await scan({ theaterId: showtime.theaterId, code });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      result: 'VALID',
      reason: null,
      admits: 2,
      checkedInAt: '2026-10-11T19:12:40+03:00',
      scannedAt: '2026-10-11T19:12:40+03:00',
      booking: {
        reference,
        status: 'confirmed',
        seats: ['B2', 'B3'],
        seatCount: 2,
        contactName: 'Karim Mostafa',
        showtime: { id: showtime.showtimeId, theater: { id: showtime.theaterId } },
      },
    });
    expect(await checkIn(reference)).toEqual({
      checked_in_at: AT_DOOR,
      checked_in_by_staff_id: scanner.staffUserId,
    });

    await at(new Date('2026-10-11T19:20:00+03:00'));
    const second = await scan({ theaterId: showtime.theaterId, code });
    expect(second.body).toMatchObject({
      result: 'ALREADY_USED',
      reason: null,
      admits: 2,
      checkedInAt: '2026-10-11T19:12:40+03:00',
      scannedAt: '2026-10-11T19:20:00+03:00',
    });
    expect(await checkIn(reference)).toEqual({
      checked_in_at: AT_DOOR,
      checked_in_by_staff_id: scanner.staffUserId,
    });
    const events = await testApp
      .knex('audit_events')
      .select('action', 'actor_kind', 'actor_staff_user_id', 'metadata')
      .where({ action: 'booking.checked_in' });
    expect(events).toEqual([
      {
        action: 'booking.checked_in',
        actor_kind: 'staff',
        actor_staff_user_id: scanner.staffUserId,
        metadata: { theaterId: showtime.theaterId, via: 'qr' },
      },
    ]);
  });

  it("scans a customer's online ticket the same way", async () => {
    clock.set(SALE_TIME);
    const online = await customerHold(testApp, showtime.showtimeId, ['C4']);
    const paid = await pay(testApp, online.customer.authorization, online.reference);
    await at(AT_DOOR);
    const response = await scan({
      theaterId: showtime.theaterId,
      code: paid.body.booking.ticket.qrCode as string,
    });
    expect(response.body).toMatchObject({ result: 'VALID', admits: 1 });
  });

  it('refuses a forged or tampered QR code, or any other text, as NOT_FOUND and writes nothing', async () => {
    const { reference, code } = await sold(['B4']);
    await at(AT_DOOR);
    const [prefix, ref, version, signature] = code.split('.') as [string, string, string, string];
    const forged = testApp.app.get(QrCodeService);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    for (const text of [
      `${prefix}.${ref}.${version}.${flipped}`,
      `${prefix}.${ref}.2.${signature}`,
      `${prefix}.MQ-222222.${version}.${signature}`,
      reference,
      'https://example.com/not-a-ticket',
      forged.payloadFor('MQ-222222', 1),
    ]) {
      const response = await scan({ theaterId: showtime.theaterId, code: text });
      expect({ text, status: response.status, body: response.body }).toEqual({
        text,
        status: 200,
        body: {
          result: 'NOT_FOUND',
          reason: null,
          admits: null,
          checkedInAt: null,
          scannedAt: '2026-10-11T19:12:40+03:00',
          booking: null,
        },
      });
    }
    expect(await checkIn(reference)).toEqual({ checked_in_at: null, checked_in_by_staff_id: null });
    expect(
      await testApp.knex('audit_events').count<{ n: number }[]>({ n: '*' }).where({
        action: 'booking.checked_in',
      }),
    ).toEqual([{ n: 0 }]);
  });

  it("refuses another theater's ticket and a cancelled showtime as WRONG_SHOWTIME", async () => {
    const there = await sold(['C1'], elsewhere);
    const cancelledSale = await sold(['C2'], late);
    const fresh = await signInStaff(testApp, admin.email, admin.password);
    const cancelled = await testApp
      .http()
      .patch(`${SHOWTIMES}/${late.showtimeId}`)
      .set('Authorization', fresh.authorization)
      .set('Idempotency-Key', randomUUID())
      .send({ status: 'cancelled', cancelReason: 'technical_issue' });
    expect(cancelled.status).toBe(200);

    await at(new Date('2026-10-11T21:30:00+03:00'));
    const wrong = await scan({ theaterId: showtime.theaterId, code: there.code });
    expect(wrong.body).toMatchObject({
      result: 'WRONG_SHOWTIME',
      reason: 'other_theater',
      admits: null,
      booking: { reference: there.reference, showtime: { theater: { id: elsewhere.theaterId } } },
    });
    const response = await scan({ theaterId: showtime.theaterId, code: cancelledSale.code });
    expect(response.body).toMatchObject({
      result: 'WRONG_SHOWTIME',
      reason: 'cancelled',
      booking: { reference: cancelledSale.reference },
    });
    for (const reference of [there.reference, cancelledSale.reference]) {
      expect((await checkIn(reference)).checked_in_at).toBeNull();
    }
  });

  it('opens 60 minutes before the start and closes when the showtime ends', async () => {
    const { reference, code } = await sold(['D1']);
    await at(new Date(OPENS_AT.getTime() - 1000));
    expect((await scan({ theaterId: showtime.theaterId, code })).body).toMatchObject({
      result: 'WRONG_SHOWTIME',
      reason: 'not_open_yet',
    });
    await at(endsAt);
    expect((await scan({ theaterId: showtime.theaterId, code })).body).toMatchObject({
      result: 'WRONG_SHOWTIME',
      reason: 'ended',
    });
    expect((await checkIn(reference)).checked_in_at).toBeNull();
    await at(OPENS_AT);
    expect((await scan({ theaterId: showtime.theaterId, code })).body).toMatchObject({
      result: 'VALID',
    });
    expect(STARTS_AT.getTime() - OPENS_AT.getTime()).toBe(60 * 60 * 1000);
  });

  it('refuses a refunded booking, and a QR code an edit replaced', async () => {
    const refunded = await sold(['A2']);
    const edited = await sold(['A3']);
    // U14 refunds and edits; reproduce the rows they leave behind.
    await testApp
      .knex('bookings')
      .where({ reference: refunded.reference })
      .update({ status: 'refunded', refunded_at: SALE_TIME });
    await testApp.knex('bookings').where({ reference: edited.reference }).update({ qr_version: 2 });
    await at(AT_DOOR);

    expect((await scan({ theaterId: showtime.theaterId, code: refunded.code })).body).toMatchObject(
      { result: 'NOT_VALID', reason: 'refunded', booking: { status: 'refunded' } },
    );
    expect((await scan({ theaterId: showtime.theaterId, code: edited.code })).body).toMatchObject({
      result: 'NOT_VALID',
      reason: 'replaced',
    });
    const current = testApp.app.get(QrCodeService).payloadFor(edited.reference, 2);
    expect((await scan({ theaterId: showtime.theaterId, code: current })).body).toMatchObject({
      result: 'VALID',
    });
    expect((await checkIn(refunded.reference)).checked_in_at).toBeNull();
  });

  describe('typed references', () => {
    it('shows the booking first and admits it only on the confirmed second request', async () => {
      const { reference } = await sold(['B6', 'B7']);
      await at(AT_DOOR);
      const typed = ` ${reference.toLowerCase()} `;

      const shown = await scan({ theaterId: showtime.theaterId, reference: typed });
      expect(shown.status).toBe(200);
      expect(shown.body).toMatchObject({
        result: 'CONFIRM_REQUIRED',
        reason: null,
        admits: 2,
        checkedInAt: null,
        booking: { reference, seats: ['B6', 'B7'], contactName: 'Karim Mostafa' },
      });
      const notYet = await scan({ theaterId: showtime.theaterId, reference, confirm: false });
      expect(notYet.body.result).toBe('CONFIRM_REQUIRED');
      expect((await checkIn(reference)).checked_in_at).toBeNull();

      const admitted = await scan({ theaterId: showtime.theaterId, reference, confirm: true });
      expect(admitted.body).toMatchObject({ result: 'VALID', admits: 2 });
      expect((await checkIn(reference)).checked_in_by_staff_id).toBe(scanner.staffUserId);
      const event = await testApp
        .knex('audit_events')
        .select('metadata')
        .where({ action: 'booking.checked_in' })
        .first();
      expect(event).toEqual({ metadata: { theaterId: showtime.theaterId, via: 'reference' } });

      const again = await scan({ theaterId: showtime.theaterId, reference, confirm: true });
      expect(again.body).toMatchObject({
        result: 'ALREADY_USED',
        checkedInAt: '2026-10-11T19:12:40+03:00',
      });
    });

    it('refuses a wrong reference, an unpaid hold and a reference of another theater', async () => {
      const there = await sold(['B1'], elsewhere);
      const fresh = await signInStaff(testApp, seller.email, seller.password);
      const hold = await counterHold(testApp, fresh.authorization, showtime.showtimeId, ['B8']);
      await at(AT_DOOR);

      const wrong = await scan({
        theaterId: showtime.theaterId,
        reference: 'MQ-222222',
        confirm: true,
      });
      expect(wrong.body).toMatchObject({ result: 'NOT_FOUND', booking: null });
      const unpaid = await scan({
        theaterId: showtime.theaterId,
        reference: hold.body.reference as string,
        confirm: true,
      });
      expect(unpaid.body).toMatchObject({ result: 'NOT_VALID', reason: 'not_paid', admits: null });
      const other = await scan({
        theaterId: showtime.theaterId,
        reference: there.reference,
        confirm: true,
      });
      expect(other.body).toMatchObject({ result: 'WRONG_SHOWTIME', reason: 'other_theater' });
      expect((await checkIn(there.reference)).checked_in_at).toBeNull();
    });
  });

  it('answers NOT_FOUND for an unknown theater and validates the body', async () => {
    const { code } = await sold(['D2']);
    await at(AT_DOOR);
    expectError(await scan({ theaterId: 999_999, code }), 404, 'NOT_FOUND');
    for (const body of [
      { theaterId: showtime.theaterId },
      { theaterId: showtime.theaterId, code, reference: 'MQ-222222' },
      { theaterId: showtime.theaterId, code, confirm: true },
      { theaterId: showtime.theaterId, code: '' },
      { theaterId: showtime.theaterId, code: 'x'.repeat(513) },
      { theaterId: showtime.theaterId, reference: 'MQ-0000' },
      { code },
    ]) {
      expectError(await scan(body), 400, 'VALIDATION_FAILED');
    }
  });
});
