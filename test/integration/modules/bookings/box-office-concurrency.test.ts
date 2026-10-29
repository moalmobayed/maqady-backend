import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { SQLSTATE } from '../../../../src/common/database/postgres-errors';
import { CASH_WALK_IN, counterHold, counterPay, scanTicket } from '../../../support/box-office';
import { TestClock } from '../../../support/clock';
import { registerCustomer, signInCustomer } from '../../../support/customer-auth';
import { bookableShowtime, holdSeats } from '../../../support/holds';
import { signInStaff, staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/**
 * The box office racing the website and itself, against real Postgres with nothing mocked
 * (design §6.3, §7.1, §7.2, §7.9): a counter hold competes for seats through the same claim
 * statement as an online hold, so exactly one of them wins a seat; a double press of "Take
 * payment" records one payment; two scans of one ticket admit it once; and no lock cycle forms.
 */
describe('Box office concurrency (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  let members: StaffSession[];
  let customers: CustomerSessionFixture[];
  const clock = new TestClock(NOW);
  const deadlocks: unknown[] = [];
  const onQueryError = (error: { code?: string }) => {
    if (error.code === SQLSTATE.DEADLOCK_DETECTED) deadlocks.push(error);
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    members = [admin];
    for (let index = 0; index < 5; index += 1) {
      members.push(await staffSession(testApp, 'box_office'));
    }
    customers = [];
    for (let index = 0; index < 6; index += 1) customers.push(await registerCustomer(testApp));
    testApp.knex.on('query-error', onQueryError);
  });

  beforeEach(async () => {
    clock.set(NOW);
    deadlocks.length = 0;
    await testApp.knex.raw(
      'TRUNCATE payments, seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys, messages CASCADE',
    );
  });

  afterAll(async () => {
    testApp.knex.off('query-error', onQueryError);
    await testApp.close();
  });

  it('gives exactly one winner when a counter hold and a customer hold race for the same seat', async () => {
    for (let round = 0; round < 8; round += 1) {
      const seat = `B${round + 1}`;
      const [counter, online] = await Promise.all([
        counterHold(testApp, members[1]!.authorization, showtime.showtimeId, [seat, 'C1']),
        holdSeats(testApp, showtime.showtimeId, [seat], {
          authorization: customers[0]!.authorization,
        }),
      ]);
      const statuses = [counter.status, online.status].sort();
      expect({ round, statuses }).toEqual({ round, statuses: [201, 409] });
      const loser = counter.status === 409 ? counter : online;
      expect(loser.body.error.code).toBe('SEAT_TAKEN');
      expect(loser.body.error.details.seats).toEqual([seat]);

      const claims = await testApp
        .knex('seat_claims as c')
        .join('bookings as b', 'b.id', 'c.booking_id')
        .select<{ channel: string }[]>('b.channel')
        .where({ 'c.showtime_id': showtime.showtimeId, 'c.seat_label': seat })
        .andWhere('c.claimed_until', '>', NOW);
      expect(claims).toEqual([{ channel: counter.status === 201 ? 'counter' : 'online' }]);
    }
    const refusals = await testApp.knex('hold_refusals').count<{ n: number }[]>({ n: '*' });
    expect(refusals).toEqual([{ n: 8 }]);
    expect(deadlocks).toEqual([]);
  });

  it('keeps one live claim per seat when members and customers race for overlapping seats', async () => {
    const requests: { seats: string[]; call: () => Promise<Response> }[] = [];
    for (let index = 0; index < 12; index += 1) {
      const start = (index % 5) + 1;
      const seats = [`C${start}`, `C${start + 1}`, `C${start + 2}`];
      requests.push({
        seats,
        call:
          index % 2 === 0
            ? () =>
                counterHold(testApp, members[index / 2]!.authorization, showtime.showtimeId, seats)
            : () =>
                holdSeats(testApp, showtime.showtimeId, seats, {
                  authorization: customers[(index - 1) / 2]!.authorization,
                }),
      });
    }
    const responses = await Promise.all(requests.map((request) => request.call()));
    expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    const won = responses.flatMap((response, index) =>
      response.status === 201 ? requests[index]!.seats : [],
    );
    expect(won.length).toBeGreaterThan(0);
    expect(new Set(won).size).toBe(won.length);
    const live = await testApp
      .knex('seat_claims')
      .select<{ seat_label: string }[]>('seat_label')
      .where({ showtime_id: showtime.showtimeId })
      .andWhere('claimed_until', '>', NOW);
    expect(live.map((claim) => claim.seat_label).sort()).toEqual([...won].sort());
    expect(deadlocks).toEqual([]);
  });

  it('records one payment when "Take payment" is pressed twice at once with different keys', async () => {
    const member = members[2]!;
    const hold = await counterHold(testApp, member.authorization, showtime.showtimeId, ['D1']);
    const reference = hold.body.reference as string;
    const responses = await Promise.all([
      counterPay(testApp, member.authorization, reference, CASH_WALK_IN, randomUUID()),
      counterPay(testApp, member.authorization, reference, CASH_WALK_IN, randomUUID()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)!.body.error.code).toBe(
      'ALREADY_PAID',
    );
    const payments = await testApp
      .knex('payments as p')
      .join('bookings as b', 'b.id', 'p.booking_id')
      .count<{ n: number }[]>({ n: '*' })
      .where({ 'b.reference': reference });
    expect(payments).toEqual([{ n: 1 }]);
    expect(deadlocks).toEqual([]);
  });

  it('admits a ticket once when two entrances scan it at the same moment', async () => {
    const member = members[3]!;
    const hold = await counterHold(testApp, member.authorization, showtime.showtimeId, [
      'D2',
      'D3',
    ]);
    const sale = await counterPay(testApp, member.authorization, hold.body.reference as string);
    const code = sale.body.booking.ticket.qrCode as string;

    clock.set(new Date('2026-10-11T19:00:00+03:00'));
    const scanners = [
      await signInStaff(testApp, members[4]!.email, members[4]!.password),
      await signInStaff(testApp, members[5]!.email, members[5]!.password),
    ];
    const results = await Promise.all(
      scanners.map((scanner) =>
        scanTicket(testApp, scanner.authorization, { theaterId: showtime.theaterId, code }),
      ),
    );
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(results.map((response) => response.body.result as string).sort()).toEqual([
      'ALREADY_USED',
      'VALID',
    ]);
    for (const response of results) {
      expect(response.body.admits).toBe(2);
      expect(response.body.checkedInAt).toBe('2026-10-11T19:00:00+03:00');
    }
    const events = await testApp
      .knex('audit_events')
      .count<{ n: number }[]>({ n: '*' })
      .where({ action: 'booking.checked_in' });
    expect(events).toEqual([{ n: 1 }]);
    expect(deadlocks).toEqual([]);
  });

  it('never deadlocks when a customer and a member keep swapping the same seats', async () => {
    const member = members[1]!;
    const customer = await signInCustomer(testApp, customers[5]!.email, customers[5]!.password);
    for (let round = 0; round < 10; round += 1) {
      const [mine, theirs] =
        round % 2 === 0
          ? [
              ['A2', 'A3'],
              ['A3', 'A2'],
            ]
          : [
              ['A3', 'A2'],
              ['A2', 'A3'],
            ];
      const responses = await Promise.all([
        counterHold(testApp, member.authorization, showtime.showtimeId, mine),
        holdSeats(testApp, showtime.showtimeId, theirs, { authorization: customer.authorization }),
      ]);
      expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    }
    expect(deadlocks).toEqual([]);
  });
});
