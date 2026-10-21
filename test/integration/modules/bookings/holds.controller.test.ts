import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { sha256Hex } from '../../../../src/common/crypto/hashing';
import { newHoldCode } from '../../../../src/modules/bookings/hold-code';
import { TestClock } from '../../../support/clock';
import { blockCustomer, registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, holdSeats } from '../../../support/holds';
import {
  cancelShowtime,
  createSchedulingFixture,
  scheduleShowtime,
  SHOWTIMES,
} from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { setTheaterStatus } from '../../../support/theaters';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');
const minutes = (count: number): Date => new Date(NOW.getTime() + count * 60_000);

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

/** Holds, release and booking reads over HTTP, real app and real Postgres (design §7.3, §10.4). */
describe('Holds (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  let mona: CustomerSessionFixture;
  let omar: CustomerSessionFixture;
  const clock = new TestClock(NOW);

  const getBooking = (
    reference: string,
    auth: { authorization?: string; holdCode?: string } = {},
  ) => {
    let request = testApp.http().get(`/api/v1/bookings/${reference}`);
    if (auth.authorization) request = request.set('Authorization', auth.authorization);
    if (auth.holdCode) request = request.set('X-Hold-Token', auth.holdCode);
    return request;
  };
  const release = (reference: string, auth: { authorization?: string; holdCode?: string } = {}) => {
    let request = testApp.http().delete(`/api/v1/holds/${reference}`);
    if (auth.authorization) request = request.set('Authorization', auth.authorization);
    if (auth.holdCode) request = request.set('X-Hold-Token', auth.holdCode);
    return request;
  };
  const takenSeats = async (showtimeId = showtime.showtimeId): Promise<string[]> => {
    const response = await testApp.http().get(`/api/v1/showtimes/${showtimeId}/seats`);
    return (response.body.seats as { label: string }[]).map((seat) => seat.label);
  };
  /** Moves the clock and signs everyone in again (access tokens are judged by the clock). */
  const moveClockTo = async (instant: Date): Promise<void> => {
    clock.set(instant);
    admin = await signInStaff(testApp, admin.email, admin.password);
    mona = await signInCustomer(testApp, mona.email, mona.password);
    omar = await signInCustomer(testApp, omar.email, omar.password);
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    mona = await registerCustomer(testApp, { fullName: 'Mona Adel' });
    omar = await registerCustomer(testApp);
  });

  beforeEach(async () => {
    await moveClockTo(NOW);
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('creating a hold', () => {
    it('holds a guest’s seats, priced by zone, with a hold code shown once and stored hashed', async () => {
      const key = randomUUID();
      const response = await holdSeats(testApp, showtime.showtimeId, ['D1', 'A2', 'B2'], { key });
      expect(response.status).toBe(201);
      const hold = response.body;
      expect(hold).toMatchObject({
        status: 'held',
        channel: 'online',
        owner: 'guest',
        seatCount: 3,
        total: { amount: 15000 + 19000 + 23000, currency: 'EGP' },
        holdExpiresAt: '2026-10-10T10:05:00+03:00',
        serverTime: '2026-10-10T10:00:00+03:00',
        createdAt: '2026-10-10T10:00:00+03:00',
        showtime: {
          id: showtime.showtimeId,
          startsAt: '2026-10-11T19:30:00+03:00',
          cinemaDate: '2026-10-11',
          movie: { id: showtime.movieId, title: showtime.movieTitle, ageRating: '12+' },
          theater: { id: showtime.theaterId },
          hall: { id: showtime.hallId },
        },
      });
      expect(hold.reference).toMatch(/^MQ-[2-9A-HJKMNP-Z]{6}$/);
      expect(hold.seats).toEqual([
        {
          label: 'A2',
          rowLabel: 'A',
          seatNumber: 2,
          zone: 'front',
          price: { amount: 15000, currency: 'EGP' },
          isWheelchair: false,
        },
        {
          label: 'B2',
          rowLabel: 'B',
          seatNumber: 2,
          zone: 'middle',
          price: { amount: 19000, currency: 'EGP' },
          isWheelchair: false,
        },
        {
          label: 'D1',
          rowLabel: 'D',
          seatNumber: 1,
          zone: 'back',
          price: { amount: 23000, currency: 'EGP' },
          isWheelchair: false,
        },
      ]);
      expect(hold.holdCode).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const row = await testApp.knex('bookings').where({ reference: hold.reference }).first();
      expect(row).toMatchObject({
        status: 'held',
        customer_id: null,
        hold_token_hash: sha256Hex(hold.holdCode),
        has_declined_payment: false,
        total_amount: 57000,
        contact_email: null,
      });
      expect(JSON.stringify(row)).not.toContain(hold.holdCode);

      const audit = await testApp.knex('audit_events').where({ booking_id: row.id });
      expect(audit).toEqual([
        expect.objectContaining({
          actor_kind: 'system',
          action: 'booking.held',
          entity_type: 'booking',
          entity_id: row.id,
          metadata: {
            showtimeId: showtime.showtimeId,
            seatCount: 3,
            channel: 'online',
            holder: 'guest',
          },
        }),
      ]);

      // A retry with the same key replays the first answer, hold code included.
      const replay = await holdSeats(testApp, showtime.showtimeId, ['D1', 'A2', 'B2'], { key });
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(hold);
      expectError(
        await holdSeats(testApp, showtime.showtimeId, ['C5'], { key }),
        422,
        'IDEMPOTENCY_KEY_REUSED',
      );
      const keyless = await testApp
        .http()
        .post(`/api/v1/showtimes/${showtime.showtimeId}/holds`)
        .send({ seats: ['C5'] });
      expectError(keyless, 400, 'IDEMPOTENCY_KEY_REQUIRED');
      expect(await testApp.knex('bookings').count({ n: '*' })).toEqual([{ n: 1 }]);
    });

    it.each([
      [[], 'seats'],
      [['A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B1', 'B2'], 'seats'],
      [['A2', 'A2'], 'seats'],
      [['I1'], 'seats'],
      [['A21'], 'seats'],
      [['a2'], 'seats'],
      [['A2', 'D8'], 'seats.1'],
      [['E1'], 'seats.0'],
    ])('refuses the seats %j with VALIDATION_FAILED on %s', async (seats, field) => {
      const response = await holdSeats(testApp, showtime.showtimeId, seats);
      expectError(response, 400, 'VALIDATION_FAILED');
      expect(
        (response.body.error.details.fields as { field: string }[]).map((entry) => entry.field),
      ).toContain(field);
      expect(await testApp.knex('bookings').count({ n: '*' })).toEqual([{ n: 0 }]);
    });

    it('answers NOT_FOUND for an unknown showtime and a draft theater’s, and refuses what cannot be held', async () => {
      expectError(await holdSeats(testApp, 999_999, ['A2']), 404, 'NOT_FOUND');
      expectError(
        await testApp
          .http()
          .post('/api/v1/showtimes/0/holds')
          .set('Idempotency-Key', randomUUID())
          .send({ seats: ['A2'] }),
        400,
        'VALIDATION_FAILED',
      );

      const draft = await createSchedulingFixture(testApp, admin);
      const unpublished = await scheduleShowtime(testApp, admin, draft, '2026-10-11', '19:30');
      expectError(await holdSeats(testApp, unpublished.id, ['A2']), 404, 'NOT_FOUND');

      const cancelled = await bookableShowtime(testApp, admin, {
        fixture: showtime,
        startTime: '13:00',
      });
      await cancelShowtime(testApp, admin, cancelled.showtimeId);
      const refused = await holdSeats(testApp, cancelled.showtimeId, ['A2']);
      expectError(refused, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(refused.body.error.details).toEqual({ reason: 'cancelled' });

      await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'sales_paused');
      try {
        const paused = await holdSeats(testApp, showtime.showtimeId, ['A2']);
        expectError(paused, 409, 'SHOWTIME_NOT_BOOKABLE');
        expect(paused.body.error.details).toEqual({ reason: 'sales_paused' });
      } finally {
        await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'active');
      }
      expect(await testApp.knex('bookings').count({ n: '*' })).toEqual([{ n: 0 }]);
    });

    it('refuses a blocked customer', async () => {
      const blocked = await registerCustomer(testApp);
      await blockCustomer(testApp, blocked.customerId);
      expectError(
        await holdSeats(testApp, showtime.showtimeId, ['A2'], {
          authorization: blocked.authorization,
        }),
        403,
        'ACCOUNT_BLOCKED',
      );
    });

    it('keeps the price it was held at when the showtime is re-priced', async () => {
      const hold = await expectHold(testApp, showtime.showtimeId, ['B5'], {
        authorization: mona.authorization,
      });
      const repriced = await testApp
        .http()
        .patch(`${SHOWTIMES}/${showtime.showtimeId}`)
        .set('Authorization', admin.authorization)
        .set('Idempotency-Key', randomUUID())
        .send({
          prices: {
            front: { amount: 16000, currency: 'EGP' },
            middle: { amount: 20000, currency: 'EGP' },
            back: { amount: 24000, currency: 'EGP' },
          },
        });
      expect(repriced.status).toBe(200);
      const read = await getBooking(hold.reference, { authorization: mona.authorization });
      expect(read.body.total).toEqual({ amount: 19000, currency: 'EGP' });
      const next = await expectHold(testApp, showtime.showtimeId, ['B6'], {
        authorization: omar.authorization,
      });
      expect(next.total).toEqual({ amount: 20000, currency: 'EGP' });
    });
  });

  describe('expiry, judged by the clock', () => {
    it('frees a seat the moment its hold ends, with no job running', async () => {
      const first = await expectHold(testApp, showtime.showtimeId, ['C1'], {
        authorization: mona.authorization,
      });
      await moveClockTo(new Date(minutes(5).getTime() - 1000));
      const early = await holdSeats(testApp, showtime.showtimeId, ['C1'], {
        authorization: omar.authorization,
      });
      expectError(early, 409, 'SEAT_TAKEN');
      expect(early.body.error.details).toEqual({ seats: ['C1'] });

      await moveClockTo(minutes(5));
      expect(await takenSeats()).toEqual([]);
      const taken = await holdSeats(testApp, showtime.showtimeId, ['C1'], {
        authorization: omar.authorization,
      });
      expect(taken.status).toBe(201);
      const mine = await getBooking(first.reference, { authorization: mona.authorization });
      expect(mine.status).toBe(200);
      expect(mine.body.status).toBe('abandoned');
      expect(await testApp.knex('hold_refusals').count({ n: '*' })).toEqual([{ n: 1 }]);
    });

    it('never holds past the start, and refuses once the showtime started', async () => {
      const soon = await bookableShowtime(testApp, admin, {
        fixture: showtime,
        startTime: '13:00',
      });
      await moveClockTo(new Date(soon.startsAt.getTime() - 3 * 60_000));
      const hold = await expectHold(testApp, soon.showtimeId, ['A3']);
      expect(hold.holdExpiresAt).toBe('2026-10-11T13:00:00+03:00');

      await moveClockTo(soon.startsAt);
      const late = await holdSeats(testApp, soon.showtimeId, ['A4']);
      expectError(late, 409, 'SHOWTIME_NOT_BOOKABLE');
      expect(late.body.error.details).toEqual({ reason: 'started' });
      await cancelShowtime(testApp, admin, soon.showtimeId).catch(() => undefined);
    });
  });

  describe('re-picking seats', () => {
    it('releases the customer’s earlier hold, on any showtime, keeping a seat both share', async () => {
      const first = await expectHold(testApp, showtime.showtimeId, ['C3', 'C4'], {
        authorization: mona.authorization,
      });
      const second = await expectHold(testApp, showtime.showtimeId, ['C4', 'C5'], {
        authorization: mona.authorization,
      });
      expect(await takenSeats()).toEqual(['C4', 'C5']);
      expect(
        (await getBooking(first.reference, { authorization: mona.authorization })).body.status,
      ).toBe('abandoned');

      const elsewhere = await bookableShowtime(testApp, admin, {
        fixture: showtime,
        startTime: '22:30',
      });
      await expectHold(testApp, elsewhere.showtimeId, ['A5'], {
        authorization: mona.authorization,
      });
      expect(await takenSeats()).toEqual([]);
      expect(
        (await getBooking(second.reference, { authorization: mona.authorization })).body.status,
      ).toBe('abandoned');
      const released = await testApp
        .knex('audit_events')
        .select<
          {
            actor_kind: string;
            actor_customer_id: number | null;
            booking_id: number | null;
            metadata: Record<string, unknown>;
          }[]
        >('actor_kind', 'actor_customer_id', 'booking_id', 'metadata')
        .where({ action: 'booking.released' })
        .orderBy('id');
      expect(
        released.map((row) => [row.actor_kind, row.actor_customer_id, row.metadata.reason]),
      ).toEqual([
        ['customer', mona.customerId, 'replaced'],
        ['customer', mona.customerId, 'replaced'],
      ]);
      expect(released.every((row) => row.booking_id !== null)).toBe(true);
    });

    it('keeps the earlier hold when the new one is refused', async () => {
      const first = await expectHold(testApp, showtime.showtimeId, ['C6'], {
        authorization: mona.authorization,
      });
      await expectHold(testApp, showtime.showtimeId, ['C7'], { authorization: omar.authorization });
      expectError(
        await holdSeats(testApp, showtime.showtimeId, ['C7', 'C8'], {
          authorization: mona.authorization,
        }),
        409,
        'SEAT_TAKEN',
      );
      expect(await takenSeats()).toEqual(['C6', 'C7']);
      expect(
        (await getBooking(first.reference, { authorization: mona.authorization })).body.status,
      ).toBe('held');
    });

    it('releases a guest’s earlier hold when it presents its code', async () => {
      const first = await expectHold(testApp, showtime.showtimeId, ['D2']);
      await expectHold(testApp, showtime.showtimeId, ['D3'], { holdCode: first.holdCode! });
      expect(await takenSeats()).toEqual(['D3']);
      // Without the code, a guest's new hold leaves the earlier one alone.
      await expectHold(testApp, showtime.showtimeId, ['D4']);
      expect(await takenSeats()).toEqual(['D3', 'D4']);
    });
  });

  describe('who may read and release a hold', () => {
    it('lets a guest read and release its hold with the code; anyone else gets NOT_FOUND', async () => {
      const hold = await expectHold(testApp, showtime.showtimeId, ['B7']);
      expect((await getBooking(hold.reference, { holdCode: hold.holdCode! })).status).toBe(200);
      for (const auth of [
        {},
        { holdCode: newHoldCode().code },
        { holdCode: 'short' },
        { authorization: mona.authorization },
      ]) {
        expectError(await getBooking(hold.reference, auth), 404, 'NOT_FOUND');
        expectError(await release(hold.reference, auth), 404, 'NOT_FOUND');
      }
      expect(await takenSeats()).toEqual(['B7']);

      expect((await release(hold.reference, { holdCode: hold.holdCode! })).status).toBe(204);
      expect(await takenSeats()).toEqual([]);
      // Released, the guest hold is gone for its guest too; releasing again changes nothing.
      expectError(await getBooking(hold.reference, { holdCode: hold.holdCode! }), 404, 'NOT_FOUND');
      expect((await release(hold.reference, { holdCode: hold.holdCode! })).status).toBe(204);
      const released = await testApp.knex('audit_events').where({ action: 'booking.released' });
      expect(released).toEqual([
        expect.objectContaining({
          actor_kind: 'system',
          metadata: expect.objectContaining({ reason: 'released', holder: 'guest' }),
        }),
      ]);
    });

    it('lets only its owner read and release a customer hold', async () => {
      const hold = await expectHold(testApp, showtime.showtimeId, ['B8'], {
        authorization: mona.authorization,
      });
      expect(hold.holdCode).toBeNull();
      for (const auth of [
        {},
        { authorization: omar.authorization },
        { holdCode: 'x'.repeat(43) },
      ]) {
        expectError(await getBooking(hold.reference, auth), 404, 'NOT_FOUND');
        expectError(await release(hold.reference, auth), 404, 'NOT_FOUND');
      }
      const mine = await getBooking(hold.reference, { authorization: mona.authorization });
      expect(mine.body).toMatchObject({
        reference: hold.reference,
        owner: 'customer',
        status: 'held',
      });

      expect((await release(hold.reference, { authorization: mona.authorization })).status).toBe(
        204,
      );
      const after = await getBooking(hold.reference, { authorization: mona.authorization });
      expect(after.body).toMatchObject({
        status: 'abandoned',
        holdExpiresAt: '2026-10-10T10:00:00+03:00',
      });
    });

    it('refuses releasing a paid booking', async () => {
      const hold = await expectHold(testApp, showtime.showtimeId, ['A6'], {
        authorization: mona.authorization,
      });
      // Confirmation comes with U11; the row is set as it will set it.
      await testApp
        .knex('bookings')
        .where({ reference: hold.reference })
        .update({ status: 'confirmed', confirmed_at: NOW, qr_version: 1 });
      expectError(
        await release(hold.reference, { authorization: mona.authorization }),
        409,
        'ALREADY_PAID',
      );
      expect(
        (await getBooking(hold.reference, { authorization: mona.authorization })).body.status,
      ).toBe('confirmed');
    });

    it('answers a staff token with UNAUTHENTICATED, an unknown reference with NOT_FOUND and a malformed one with 400', async () => {
      const boxOffice = await staffSession(testApp, 'box_office');
      expectError(
        await getBooking('MQ-222222', { authorization: boxOffice.authorization }),
        401,
        'UNAUTHENTICATED',
      );
      expectError(
        await holdSeats(testApp, showtime.showtimeId, ['A2'], {
          authorization: boxOffice.authorization,
        }),
        401,
        'UNAUTHENTICATED',
      );
      expectError(await getBooking('MQ-222222'), 404, 'NOT_FOUND');
      expectError(await getBooking('MQ-0OIL11'), 400, 'VALIDATION_FAILED');
      expectError(await release('mq-222222'), 400, 'VALIDATION_FAILED');
    });
  });
});
