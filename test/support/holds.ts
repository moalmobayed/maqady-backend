import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Response } from 'supertest';
import { WebSocket } from 'ws';
import { HALLS } from './halls';
import { createSchedulingFixture, scheduleShowtime } from './showtimes';
import { TEST_CORS_ORIGIN } from './test-config';
import { setTheaterStatus } from './theaters';
import type {
  BookableShowtimeFixture,
  BookableShowtimeOptions,
  HoldRequestOptions,
  SeatMapMessage,
  SeatMapTestClient,
  StaffSession,
  TestApp,
} from './types';

/**
 * Holds fixtures for integration tests (U10), built through the real admin and public routes, so
 * every rule, lock and audit row applies. Later units (checkout, box office, admin bookings) use
 * `bookableShowtime()` and `holdSeats()` for holds to pay, sell and refund.
 *
 * @example
 * const admin = await staffSession(testApp, 'admin');
 * const showtime = await bookableShowtime(testApp, admin);
 * const hold = await holdSeats(testApp, showtime.showtimeId, ['B2', 'B3']);
 */

/**
 * The small hall every holds suite uses: 4 rows of 8 seats (A front, B and C middle, D back),
 * `A1` a wheelchair space and `D8` a gap, so 31 seats.
 */
export const SMALL_LAYOUT = {
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [
    { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
    { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
  ],
};
export const SMALL_LAYOUT_SEATS = 31;

/** Every seat label of `SMALL_LAYOUT`, front row first. */
export const SMALL_LAYOUT_LABELS: readonly string[] = ['A', 'B', 'C', 'D'].flatMap((row) =>
  Array.from({ length: 8 }, (_, index) => `${row}${index + 1}`).filter((label) => label !== 'D8'),
);

/**
 * A showtime that can be held: a published theater open 12:00–01:00 with the default prices
 * (front 150, middle 190, back 230 EGP), its active hall with `SMALL_LAYOUT`, a Now showing
 * movie of 120 minutes, scheduled on `cinemaDate` at `startTime` (by default 2026-10-11 19:30,
 * so the suite's clock must be earlier). With `fixture`, another showtime in that same hall.
 */
export async function bookableShowtime(
  testApp: TestApp,
  admin: StaffSession,
  options: BookableShowtimeOptions = {},
): Promise<BookableShowtimeFixture> {
  let fixture = options.fixture;
  if (!fixture) {
    fixture = await createSchedulingFixture(testApp, admin);
    const layout = await testApp
      .http()
      .put(`${HALLS}/${fixture.hallId}/layout`)
      .set('Authorization', admin.authorization)
      .send(SMALL_LAYOUT);
    if (layout.status !== 200) {
      throw new Error(`bookableShowtime layout: ${layout.status} ${JSON.stringify(layout.body)}`);
    }
    await setTheaterStatus(testApp, admin.authorization, fixture.theaterId, 'active');
  }
  const showtime = await scheduleShowtime(
    testApp,
    admin,
    fixture,
    options.cinemaDate ?? '2026-10-11',
    options.startTime ?? '19:30',
  );
  return {
    ...fixture,
    showtimeId: showtime.id,
    startsAt: new Date(showtime.startsAt as string),
  };
}

/** `POST /showtimes/{id}/holds`, as a guest unless `authorization` is given. */
export function holdSeats(
  testApp: TestApp,
  showtimeId: number,
  seats: readonly string[],
  options: HoldRequestOptions = {},
): Promise<Response> {
  let request = testApp
    .http()
    .post(`/api/v1/showtimes/${showtimeId}/holds`)
    .set('Idempotency-Key', options.key ?? randomUUID());
  if (options.authorization) request = request.set('Authorization', options.authorization);
  if (options.holdCode) request = request.set('X-Hold-Token', options.holdCode);
  return request.send({ seats });
}

/** Like `holdSeats()`, expecting `201`; returns the hold's body. */
export async function expectHold(
  testApp: TestApp,
  showtimeId: number,
  seats: readonly string[],
  options: HoldRequestOptions = {},
): Promise<Record<string, unknown> & { reference: string; holdCode: string | null }> {
  const response = await holdSeats(testApp, showtimeId, seats, options);
  if (response.status !== 201) {
    throw new Error(`expectHold: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body as Record<string, unknown> & { reference: string; holdCode: string | null };
}

/** The test app's HTTP server, listening on a free port (the seat map needs a real socket). */
export async function listeningPort(testApp: TestApp): Promise<number> {
  const server = testApp.app.getHttpServer();
  if (!server.listening) await testApp.app.listen(0, '127.0.0.1');
  return (server.address() as AddressInfo).port;
}

/**
 * A seat map client on `/ws`, sending `Origin: TEST_CORS_ORIGIN` unless `headers` say otherwise
 * (an `origin` of null sends none). Resolves once the socket is open.
 */
export async function seatMapClient(
  testApp: TestApp,
  headers: Record<string, string | null> = {},
): Promise<SeatMapTestClient> {
  const port = await listeningPort(testApp);
  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries({ origin: TEST_CORS_ORIGIN, ...headers })) {
    if (value !== null) sent[name] = value;
  }
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: sent });
  const queue: SeatMapMessage[] = [];
  const waiters: ((message: SeatMapMessage) => void)[] = [];
  let closeCode: number | undefined;
  const closeWaiters: ((code: number) => void)[] = [];

  socket.on('message', (raw: Buffer) => {
    const message = JSON.parse(raw.toString()) as SeatMapMessage;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  socket.on('close', (code: number) => {
    closeCode = code;
    for (const waiter of closeWaiters.splice(0)) waiter(code);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  return {
    socket,
    send: (event, data) => socket.send(JSON.stringify({ event, data })),
    next: (timeoutMs = 5_000) => {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('No seat map message arrived in time')),
          timeoutMs,
        );
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    closed: () =>
      closeCode !== undefined
        ? Promise.resolve(closeCode)
        : new Promise((resolve) => closeWaiters.push(resolve)),
    pending: () => [...queue],
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const done = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      socket.close();
      await done;
    },
  };
}

/**
 * The ids of `count` real guest holds on a published showtime (one seat each, `A1`, `A2`, …), for
 * suites whose seams take booking ids (U7's ticket holders), so every foreign key is satisfied.
 */
export async function heldBookingIds(
  testApp: TestApp,
  showtimeId: number,
  count: number,
): Promise<number[]> {
  const ids: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    const hold = await expectHold(testApp, showtimeId, [`A${index}`]);
    const row = await testApp
      .knex('bookings')
      .select<{ id: number }[]>('id')
      .where({ reference: hold.reference })
      .first();
    ids.push(row!.id);
  }
  return ids;
}
