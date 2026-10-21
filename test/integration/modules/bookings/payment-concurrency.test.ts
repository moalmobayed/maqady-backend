import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { SQLSTATE } from '../../../../src/common/database/postgres-errors';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { customerHold, pay, readPayments } from '../../../support/checkout';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, holdSeats, seatMapClient } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, SeatMapMessage, TestApp } from '../../../support/types';

jest.setTimeout(180_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/**
 * Payments racing each other and the hold's other writers against real Postgres (design §6.3,
 * §7.1, §7.5; PRD Payments 3 "Pressing Pay twice never charges twice"). Nothing of ours is mocked;
 * the tests listen to Knex's `query-error` events so a deadlock is seen whether or not the write
 * interceptor's retry hid it.
 */
describe('Concurrent payments (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const deadlocks: unknown[] = [];
  const onQueryError = (error: { code?: string }) => {
    if (error.code === SQLSTATE.DEADLOCK_DETECTED) deadlocks.push(error);
  };

  const count = async (table: string, where: Record<string, unknown>): Promise<number> => {
    const [row] = await testApp.knex(table).where(where).count<{ n: number }[]>({ n: '*' });
    return Number(row?.n ?? 0);
  };
  const release = (reference: string, authorization: string) =>
    testApp.http().delete(`/api/v1/holds/${reference}`).set('Authorization', authorization);

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: new RecordingEmailSender() }],
    });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
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

  it('confirms once when Pay is pressed 10 times with different keys: one charge, one confirmation, one tickets email, one seat.booked', async () => {
    const map = await seatMapClient(testApp);
    map.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await map.next()).event).toBe('snapshot');
    const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
      'C2',
      'C3',
    ]);
    expect((await map.next()).event).toBe('seat.held');

    const responses: Response[] = await Promise.all(
      Array.from({ length: 10 }, () => pay(testApp, customer.authorization, reference)),
    );

    const statuses = responses.map((response) =>
      String(response.status === 201 ? response.body.payment.status : response.body.error.code),
    );
    expect(statuses.filter((status) => status === 'succeeded')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'ALREADY_PAID')).toHaveLength(9);
    expect(await readPayments(testApp.knex, bookingId)).toHaveLength(1);
    expect(
      await count('audit_events', { booking_id: bookingId, action: 'booking.confirmed' }),
    ).toBe(1);
    expect(
      await count('messages', { related_booking_id: bookingId, template: 'booking.tickets' }),
    ).toBe(1);
    const booked: SeatMapMessage = await map.next();
    expect(booked).toEqual({
      event: 'seat.booked',
      data: { showtimeId: showtime.showtimeId, labels: ['C2', 'C3'] },
    });
    await expect(map.next(300)).rejects.toThrow('No seat map message arrived in time');
    expect(deadlocks).toEqual([]);
    await map.close();
  });

  it('runs one payment when the same key is sent 10 times at once; the others replay it', async () => {
    const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
      'C4',
    ]);
    const key = randomUUID();
    const responses: Response[] = await Promise.all(
      Array.from({ length: 10 }, () =>
        pay(testApp, customer.authorization, reference, undefined, key),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(201));
    expect(
      responses.filter((response) => response.headers['idempotent-replayed'] === 'true'),
    ).toHaveLength(9);
    const [first] = responses;
    for (const response of responses) expect(response.body).toEqual(first!.body);
    expect(first!.body.booking.status).toBe('confirmed');
    expect(await readPayments(testApp.knex, bookingId)).toHaveLength(1);
    expect(
      await count('messages', { related_booking_id: bookingId, template: 'booking.tickets' }),
    ).toBe(1);
    expect(deadlocks).toEqual([]);
  });

  it('never both pays and releases a hold when its owner presses Pay and Release at once (20 rounds)', async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 20; round += 1) {
      await testApp.knex.raw('TRUNCATE payments, seat_claims, booking_seats, bookings CASCADE');
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        `D${(round % 7) + 1}`,
      ]);
      const [paid, released] = await Promise.all([
        pay(testApp, customer.authorization, reference),
        release(reference, customer.authorization),
      ]);
      const outcome = `${paid.status}:${paid.body.error?.code ?? paid.body.payment.status} ${released.status}:${released.body?.error?.code ?? ''}`;
      expect(['201:succeeded 409:ALREADY_PAID', '409:HOLD_EXPIRED 204:']).toContain(outcome);
      outcomes.add(outcome);

      const [claim] = await testApp
        .knex('seat_claims')
        .select<{ claimed_until: Date | null }[]>('claimed_until')
        .where({ booking_id: bookingId });
      if (paid.status === 201) {
        expect(claim!.claimed_until).toBeNull();
      } else {
        expect(claim!.claimed_until!.getTime()).toBeLessThanOrEqual(clock.now().getTime());
        expect(await readPayments(testApp.knex, bookingId)).toEqual([]);
      }
      clock.advance({ seconds: 1 });
    }
    expect(outcomes.size).toBeGreaterThan(0);
    expect(deadlocks).toEqual([]);
  });

  it('never sells a seat twice when a payment races a rival hold and the payer re-picking (10 rounds)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const label = `B${(round % 8) + 1}`;
      await testApp.knex.raw('TRUNCATE payments, seat_claims, booking_seats, bookings CASCADE');
      const { customer, reference, bookingId } = await customerHold(testApp, showtime.showtimeId, [
        label,
      ]);
      const rival = await registerCustomer(testApp);
      const [paid, rivalHold, repick] = await Promise.all([
        pay(testApp, customer.authorization, reference),
        holdSeats(testApp, showtime.showtimeId, [label], { authorization: rival.authorization }),
        holdSeats(testApp, showtime.showtimeId, ['A2'], { authorization: customer.authorization }),
      ]);
      // The re-pick always succeeds: it releases the hold unless the payment confirmed it first.
      expect(repick.status).toBe(201);
      if (paid.status === 201) {
        expect(paid.body.booking.status).toBe('confirmed');
        expect(rivalHold.body.error).toMatchObject({
          code: 'SEAT_TAKEN',
          details: { seats: [label] },
        });
      } else {
        // The re-pick released the hold first: the payment finds it ended, and the seat is free.
        expect(paid.body.error.code).toBe('HOLD_EXPIRED');
        expect(await readPayments(testApp.knex, bookingId)).toEqual([]);
      }
      const owners = await testApp
        .knex('seat_claims')
        .select<{ booking_id: number; claimed_until: Date | null }[]>('booking_id', 'claimed_until')
        .where({ showtime_id: showtime.showtimeId, seat_label: label });
      const live = owners.filter(
        (claim) => claim.claimed_until === null || claim.claimed_until > clock.now(),
      );
      expect(live.length).toBeLessThanOrEqual(1);
      if (paid.status === 201)
        expect(live).toEqual([{ booking_id: bookingId, claimed_until: null }]);
      if (rivalHold.status === 201) expect(paid.status).toBe(409);
    }
    expect(deadlocks).toEqual([]);
  });
});
