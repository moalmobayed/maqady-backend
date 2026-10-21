import { TestClock } from '../../../support/clock';
import {
  bookableShowtime,
  expectHold,
  SMALL_LAYOUT_LABELS,
  SMALL_LAYOUT_SEATS,
} from '../../../support/holds';
import {
  cancelShowtime,
  createSchedulingFixture,
  scheduleShowtime,
} from '../../../support/showtimes';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import { setTheaterStatus } from '../../../support/theaters';
import type { BookableShowtimeFixture, StaffSession, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/** The public seat page (PRD C6; design §11, §12): header, layout, prices and the snapshot. */
describe('The seat page (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);

  const header = (id: number) => testApp.http().get(`/api/v1/showtimes/${id}`);
  const seats = (id: number) => testApp.http().get(`/api/v1/showtimes/${id}/seats`);

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
  });

  beforeEach(async () => {
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('shows the header, the hall’s own layout and the zone prices, never cached', async () => {
    const response = await header(showtime.showtimeId);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toMatchObject({
      id: showtime.showtimeId,
      startsAt: '2026-10-11T19:30:00+03:00',
      endsAt: '2026-10-11T21:30:00+03:00',
      cinemaDate: '2026-10-11',
      movie: {
        id: showtime.movieId,
        title: showtime.movieTitle,
        ageRating: '12+',
        runtimeMinutes: 120,
        poster: null,
      },
      theater: { id: showtime.theaterId },
      hall: { id: showtime.hallId },
      prices: {
        front: { amount: 15000, currency: 'EGP' },
        middle: { amount: 19000, currency: 'EGP' },
        back: { amount: 23000, currency: 'EGP' },
      },
      fromPrice: { amount: 15000, currency: 'EGP' },
      seatCapacity: SMALL_LAYOUT_SEATS,
      layout: {
        hallId: showtime.hallId,
        rowCount: 4,
        seatsPerRow: 8,
        aisleAfter: [4],
        rows: [
          { label: 'A', zone: 'front' },
          { label: 'B', zone: 'middle' },
          { label: 'C', zone: 'middle' },
          { label: 'D', zone: 'back' },
        ],
        seatMarks: [
          { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
          { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
        ],
        seatCount: SMALL_LAYOUT_SEATS,
      },
      bookable: true,
      notBookableReason: null,
      maxSeatsPerHold: 8,
      holdMinutes: 5,
    });
  });

  it('keeps showing a started, cancelled or paused showtime with its reason; hides a draft theater’s', async () => {
    clock.set(showtime.startsAt);
    expect((await header(showtime.showtimeId)).body).toMatchObject({
      bookable: false,
      notBookableReason: 'started',
    });
    clock.set(NOW);
    admin = await signInStaff(testApp, admin.email, admin.password);

    await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'sales_paused');
    try {
      expect((await header(showtime.showtimeId)).body.notBookableReason).toBe('sales_paused');
      expect((await seats(showtime.showtimeId)).status).toBe(200);
    } finally {
      await setTheaterStatus(testApp, admin.authorization, showtime.theaterId, 'active');
    }

    const cancelled = await bookableShowtime(testApp, admin, {
      fixture: showtime,
      startTime: '13:00',
    });
    await cancelShowtime(testApp, admin, cancelled.showtimeId);
    expect((await header(cancelled.showtimeId)).body).toMatchObject({
      bookable: false,
      notBookableReason: 'cancelled',
    });

    const draft = await createSchedulingFixture(testApp, admin);
    const hidden = await scheduleShowtime(testApp, admin, draft, '2026-10-11', '19:30');
    for (const response of [
      await header(hidden.id),
      await seats(hidden.id),
      await header(999_999),
    ]) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    expect((await header(0)).status).toBe(400);
  });

  it('lists live holds with their end and sold seats, leaving out ended and released holds', async () => {
    await expectHold(testApp, showtime.showtimeId, ['B2', 'B3']);
    const released = await expectHold(testApp, showtime.showtimeId, ['C1']);
    expect(
      (
        await testApp
          .http()
          .delete(`/api/v1/holds/${released.reference}`)
          .set('X-Hold-Token', released.holdCode!)
      ).status,
    ).toBe(204);
    clock.set(new Date(NOW.getTime() + 60_000));
    const sold = await expectHold(testApp, showtime.showtimeId, ['A2']);
    // Confirmation comes with U11: it sets the claims to NULL (sold) exactly like this.
    await testApp
      .knex('seat_claims')
      .whereIn(
        'booking_id',
        testApp.knex('bookings').select('id').where({ reference: sold.reference }),
      )
      .update({ claimed_until: null });

    const response = await seats(showtime.showtimeId);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      showtimeId: showtime.showtimeId,
      serverTime: '2026-10-10T10:01:00+03:00',
      seats: [
        { label: 'A2', state: 'booked', heldUntil: null },
        { label: 'B2', state: 'held', heldUntil: '2026-10-10T10:05:00+03:00' },
        { label: 'B3', state: 'held', heldUntil: '2026-10-10T10:05:00+03:00' },
      ],
      availableCount: SMALL_LAYOUT_SEATS - 3,
      soldOut: false,
    });

    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    expect((await seats(showtime.showtimeId)).body.seats).toEqual([
      { label: 'A2', state: 'booked', heldUntil: null },
    ]);
  });

  it('says sold out when every seat is held, and not once a hold ends', async () => {
    for (let start = 0; start < SMALL_LAYOUT_LABELS.length; start += 8) {
      await expectHold(testApp, showtime.showtimeId, SMALL_LAYOUT_LABELS.slice(start, start + 8));
    }
    expect((await seats(showtime.showtimeId)).body).toMatchObject({
      availableCount: 0,
      soldOut: true,
    });
    clock.set(new Date(NOW.getTime() + 5 * 60_000));
    expect((await seats(showtime.showtimeId)).body).toMatchObject({
      availableCount: SMALL_LAYOUT_SEATS,
      soldOut: false,
    });
  });
});
