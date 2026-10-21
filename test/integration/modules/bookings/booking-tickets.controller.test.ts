import { randomUUID } from 'node:crypto';
import { create as createQrCode } from 'qrcode';
import type { Response } from 'supertest';
import { QrCodeService } from '../../../../src/modules/bookings/qr-code.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { formatCairoDisplay } from '../../../../src/common/time/time';
import { customerHold, pay, pdfRectangleCount, pdfTextRuns, VISA } from '../../../support/checkout';
import { CheckoutProbeModule } from '../../../support/checkout-probe.module';
import { TestClock } from '../../../support/clock';
import { registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, seatMapClient } from '../../../support/holds';
import { RecordingEmailSender, waitFor } from '../../../support/messaging/recording-email-sender';
import { readMessages } from '../../../support/messaging/messages';
import { SHOWTIMES } from '../../../support/showtimes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { TEST_FRONTEND_BASE_URL } from '../../../support/test-config';
import type {
  BookableShowtimeFixture,
  CustomerHoldFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const REDACTED = '[one-time link hidden]';

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/** The status and error of a download answered with a JSON error (read as raw bytes). */
function jsonOf(response: Response): { status: number; code: string; details?: unknown } {
  const body = JSON.parse((response.body as Buffer).toString('utf8')) as {
    error: { code: string; details: unknown };
  };
  return { status: response.status, code: body.error.code, details: body.error.details };
}

/**
 * A confirmed booking's tickets (design §7.9, §13.1; PRD "Tickets and QR codes", "Email and
 * SMS", C9): the tickets email and SMS queued with the confirmation and sent after commit with
 * no QR payload in any stored copy, the signed QR payload, the PDF ticket and the calendar file,
 * and U7's ticket holders. Real app and Postgres; only Resend is replaced (`RecordingEmailSender`).
 */
describe('Tickets (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let theater: { name: string; address: string; district: string; city: string };
  let hallName: string;
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  const paidHold = async (
    seats: string[],
    options: { phone?: string } = {},
  ): Promise<CustomerHoldFixture & { qrCode: string; paid: Response }> => {
    const fixture = await customerHold(testApp, showtime.showtimeId, seats, options);
    const paid = await pay(testApp, fixture.customer.authorization, fixture.reference);
    expect(paid.status).toBe(201);
    return { ...fixture, qrCode: paid.body.booking.ticket.qrCode as string, paid };
  };
  const download = (reference: string, file: string, authorization?: string) => {
    let request = testApp.http().get(`/api/v1/bookings/${reference}/${file}`);
    if (authorization) request = request.set('Authorization', authorization);
    return request.buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  };
  /** The tickets emails handed to the sender (registration also sends a verification email). */
  const ticketEmails = () =>
    sender.calls.filter((email) => email.subject.startsWith('Your Maqady tickets'));
  const ticketMessages = async (bookingId: number) =>
    (await readMessages(testApp.knex)).filter(
      (message) => message.related_booking_id === bookingId,
    );

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      imports: [CheckoutProbeModule],
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    theater = (await testApp
      .knex('theaters')
      .select('name', 'address', 'district', 'city')
      .where({ id: showtime.theaterId })
      .first()) as typeof theater;
    hallName = (
      (await testApp.knex('halls').select('name').where({ id: showtime.hallId }).first()) as {
        name: string;
      }
    ).name;
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
    sender.reset();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('the tickets email and SMS', () => {
    it('queues them with the confirmation and sends the email after commit with the real ticket link', async () => {
      const { customer, bookingId, qrCode, reference } = await paidHold(['B2', 'B3'], {
        phone: '01012345678',
      });

      const messages = await ticketMessages(bookingId);
      expect(messages.map((message) => [message.template, message.channel])).toEqual([
        ['booking.tickets', 'email'],
        ['booking.tickets_sms', 'sms'],
      ]);
      for (const message of messages) {
        expect(message.related_customer_id).toBe(customer.customerId);
      }
      expect(messages[0]!.recipient).toBe(customer.email);
      expect(messages[1]!.recipient).toBe('+201012345678');
      expect(messages[0]!.subject).toBe(`Your Maqady tickets · ${reference}`);

      await waitFor(() => ticketEmails().length === 1);
      const [email] = ticketEmails();
      const link = `${TEST_FRONTEND_BASE_URL}/ticket?token=${encodeURIComponent(qrCode)}`;
      expect(email!.to).toBe(customer.email);
      expect(email!.text).toContain(link);
      expect(email!.html).toContain(`href="${link}"`);
      expect(email!.text).toContain(`${TEST_FRONTEND_BASE_URL}/my-bookings/${reference}`);
      expect(email!.text).toContain('Seats B2, B3');
      expect(email!.text).toContain('Admits 2');
      expect(email!.text).toContain('EGP 380');
      expect(email!.text).toContain(formatCairoDisplay(showtime.startsAt));
    });

    it('keeps the QR payload out of every stored copy and of the Message log', async () => {
      const { bookingId, qrCode } = await paidHold(['B4'], { phone: '+201098765432' });
      const forms = [qrCode, encodeURIComponent(qrCode), qrCode.split('.').pop()!];
      const messages = await ticketMessages(bookingId);
      expect(messages).toHaveLength(2);
      for (const message of messages) {
        const stored = [message.subject ?? '', message.body_text, message.body_html ?? ''].join(
          '\n',
        );
        expect(stored).toContain(REDACTED);
        for (const form of forms) expect(stored).not.toContain(form);
        const logged = await testApp
          .http()
          .get(`/api/v1/admin/messages/${message.id}`)
          .set('Authorization', admin.authorization);
        expect(logged.status).toBe(200);
        for (const form of forms) expect(JSON.stringify(logged.body)).not.toContain(form);
      }
    });

    it('sends no SMS without a phone, and nothing more on a replayed payment', async () => {
      const fixture = await customerHold(testApp, showtime.showtimeId, ['B5']);
      const key = randomUUID();
      expect(
        (await pay(testApp, fixture.customer.authorization, fixture.reference, VISA, key)).status,
      ).toBe(201);
      const replay = await pay(
        testApp,
        fixture.customer.authorization,
        fixture.reference,
        VISA,
        key,
      );
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect((await ticketMessages(fixture.bookingId)).map((message) => message.template)).toEqual([
        'booking.tickets',
      ]);
    });

    it('queues and announces nothing when the confirming transaction rolls back', async () => {
      const fixture = await customerHold(testApp, showtime.showtimeId, ['B6', 'B7']);
      const map = await seatMapClient(testApp);
      map.send('subscribe', { showtimeId: showtime.showtimeId });
      expect((await map.next()).event).toBe('snapshot');

      const response = await testApp
        .http()
        .post('/api/v1/test-checkout/confirm-then-fail')
        .set('Authorization', fixture.customer.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          bookingId: fixture.bookingId,
          showtimeId: showtime.showtimeId,
          labels: ['B6', 'B7'],
        });

      expectError(response, 409, 'CONFLICT');
      expect(await ticketMessages(fixture.bookingId)).toEqual([]);
      const row = await testApp
        .knex('bookings')
        .select('status', 'qr_version')
        .where({ id: fixture.bookingId })
        .first();
      expect(row).toEqual({ status: 'held', qr_version: null });
      const claims = await testApp
        .knex('seat_claims')
        .select<{ claimed_until: Date | null }[]>('claimed_until')
        .where({ booking_id: fixture.bookingId });
      expect(claims.every((claim) => claim.claimed_until !== null)).toBe(true);
      await expect(map.next(300)).rejects.toThrow('No seat map message arrived in time');
      expect(ticketEmails()).toEqual([]);
      await map.close();
    });
  });

  describe('the QR payload', () => {
    it('verifies the payload of a confirmed booking and refuses every tampered form', async () => {
      const { reference, qrCode } = await paidHold(['C2']);
      const qr = testApp.app.get(QrCodeService);
      expect(qr.verify(qrCode)).toEqual({ reference, version: 1 });

      const [prefix, ref, version, signature] = qrCode.split('.') as [
        string,
        string,
        string,
        string,
      ];
      const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
      const otherRef = ref === 'MQ-222222' ? 'MQ-333333' : 'MQ-222222';
      for (const tampered of [
        `${prefix}.${ref}.${version}.${flipped}`,
        `${prefix}.${ref}.2.${signature}`,
        `${prefix}.${otherRef}.${version}.${signature}`,
        `mq1.${ref}.${version}.${signature}`,
        `${qrCode}.x`,
        reference,
      ]) {
        expect(qr.verify(tampered)).toBeNull();
      }
    });

    it('gives a held booking no ticket', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['C3']);
      const held = await testApp
        .http()
        .get(`/api/v1/bookings/${reference}`)
        .set('Authorization', customer.authorization);
      expect(held.body).toMatchObject({ status: 'held', ticket: null, paymentStatus: 'unpaid' });
    });
  });

  describe('downloads', () => {
    it('builds the PDF ticket for its owner with the showtime, seats, reference and QR code', async () => {
      const { customer, reference, qrCode } = await paidHold(['C4', 'C5']);
      const response = await download(reference, 'ticket.pdf', customer.authorization);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="maqady-ticket-${reference}.pdf"`,
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      const pdf = response.body as Buffer;
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const text = pdfTextRuns(pdf).join('\n');
      for (const expected of [
        showtime.movieTitle,
        theater.name,
        theater.address,
        hallName,
        formatCairoDisplay(showtime.startsAt),
        'Seats C4 (Middle), C5 (Middle)',
        'Admits 2',
        `Booking ${reference}`,
      ]) {
        expect(text).toContain(expected);
      }
      const { modules } = createQrCode(qrCode, { errorCorrectionLevel: 'M' });
      let dark = 0;
      for (let row = 0; row < modules.size; row += 1) {
        for (let column = 0; column < modules.size; column += 1) dark += modules.get(row, column);
      }
      expect(pdfRectangleCount(pdf)).toBe(dark);
    });

    it('builds the calendar file with the showtime in UTC and the theater address', async () => {
      const { customer, reference } = await paidHold(['C6']);
      const response = await download(reference, 'calendar.ics', customer.authorization);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="maqady-${reference}.ics"`,
      );
      expect(response.headers['cache-control']).toBe('private, no-store');
      const ics = (response.body as Buffer).toString('utf8');
      expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      const lines = ics.replace(/\r\n /g, '').split('\r\n');
      const endsAt = new Date(showtime.startsAt.getTime() + showtime.runtimeMinutes * 60_000);
      const stamp = (instant: Date) =>
        instant
          .toISOString()
          .replace(/\.\d{3}Z$/, 'Z')
          .replace(/[-:]/g, '');
      expect(lines).toEqual(
        expect.arrayContaining([
          'BEGIN:VCALENDAR',
          'BEGIN:VEVENT',
          `UID:${reference}@maqady`,
          `DTSTAMP:${stamp(NOW)}`,
          `DTSTART:${stamp(showtime.startsAt)}`,
          `DTEND:${stamp(endsAt)}`,
          'END:VEVENT',
          'END:VCALENDAR',
        ]),
      );
      expect(stamp(showtime.startsAt)).toBe('20261011T163000Z');
      const escape = (value: string) =>
        value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
      expect(lines).toContain(`SUMMARY:${escape(`${showtime.movieTitle} · ${theater.name}`)}`);
      expect(lines).toContain(
        `LOCATION:${escape([theater.name, theater.address, theater.district, theater.city].join(', '))}`,
      );
      expect(lines.find((line) => line.startsWith('DESCRIPTION:'))).toContain(
        `Booking ${reference}`,
      );
    });

    it('still serves a completed booking after its showtime ended', async () => {
      const { customer, reference } = await paidHold(['C7']);
      clock.set(new Date(showtime.startsAt.getTime() + 3 * 3_600_000));
      const again = await signInCustomer(testApp, customer.email, customer.password);
      const booking = await testApp
        .http()
        .get(`/api/v1/bookings/${reference}`)
        .set('Authorization', again.authorization);
      expect(booking.body).toMatchObject({ status: 'completed', ticket: { admits: 1 } });
      expect((await download(reference, 'ticket.pdf', again.authorization)).status).toBe(200);
      expect((await download(reference, 'calendar.ics', again.authorization)).status).toBe(200);
    });

    it('answers TICKET_NOT_AVAILABLE without a ticket, NOT_FOUND to anyone else, 401 without a token', async () => {
      const { customer, reference } = await customerHold(testApp, showtime.showtimeId, ['D2']);
      for (const file of ['ticket.pdf', 'calendar.ics']) {
        const held = jsonOf(await download(reference, file, customer.authorization));
        expect(held).toEqual({
          status: 409,
          code: 'TICKET_NOT_AVAILABLE',
          details: { status: 'held' },
        });
      }
      clock.advance({ minutes: 5 });
      expect(jsonOf(await download(reference, 'ticket.pdf', customer.authorization))).toEqual({
        status: 409,
        code: 'TICKET_NOT_AVAILABLE',
        details: { status: 'abandoned' },
      });

      clock.set(NOW);
      const paid = await paidHold(['D3']);
      const guestHold = await expectHold(testApp, showtime.showtimeId, ['D4']);
      const stranger = await registerCustomer(testApp);
      for (const file of ['ticket.pdf', 'calendar.ics']) {
        for (const ref of [paid.reference, 'MQ-222222', guestHold.reference]) {
          expect(jsonOf(await download(ref, file, stranger.authorization))).toMatchObject({
            status: 404,
            code: 'NOT_FOUND',
          });
        }
        expect(jsonOf(await download(paid.reference, file))).toMatchObject({
          status: 401,
          code: 'UNAUTHENTICATED',
        });
        expect(jsonOf(await download('mq-222222', file, stranger.authorization))).toMatchObject({
          status: 400,
          code: 'VALIDATION_FAILED',
        });
      }
    });
  });

  describe("U7's ticket holders", () => {
    it('notifies the confirmed booking of a moved showtime, not a live hold', async () => {
      const other = await bookableShowtime(testApp, admin, {
        fixture: showtime,
        startTime: '15:00',
      });
      const confirmed = await customerHold(testApp, other.showtimeId, ['A2'], {
        phone: '01011112222',
      });
      expect(
        (await pay(testApp, confirmed.customer.authorization, confirmed.reference)).status,
      ).toBe(201);
      const held = await customerHold(testApp, other.showtimeId, ['A3']);

      const moved = await testApp
        .http()
        .patch(`${SHOWTIMES}/${other.showtimeId}`)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({ startTime: '15:30' });
      expect(moved.status).toBe(200);

      const notices = (await readMessages(testApp.knex)).filter((message) =>
        message.template.startsWith('showtime.moved'),
      );
      expect(
        notices.map((message) => [message.template, message.related_booking_id, message.recipient]),
      ).toEqual([
        ['showtime.moved', confirmed.bookingId, confirmed.customer.email],
        ['showtime.moved_sms', confirmed.bookingId, '+201011112222'],
      ]);
      expect(notices.some((message) => message.related_booking_id === held.bookingId)).toBe(false);
    });
  });
});
