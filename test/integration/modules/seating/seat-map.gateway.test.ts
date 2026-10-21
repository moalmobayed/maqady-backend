import { randomUUID } from 'node:crypto';
import { SeatMapGateway } from '../../../../src/modules/seating/seat-map.gateway';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime, expectHold, holdSeats, seatMapClient } from '../../../support/holds';
import { SeatMapProbeModule } from '../../../support/seat-map-probe.module';
import { staffSession } from '../../../support/staff-auth';
import { buildTestConfig } from '../../../support/test-config';
import { createTestApp } from '../../../support/test-app';
import type { BookableShowtimeFixture, SeatMapTestClient, TestApp } from '../../../support/types';

jest.setTimeout(120_000);

const NOW = new Date('2026-10-10T10:00:00+03:00');

/**
 * The live seat map at `/ws` (design §12; PRD "Live seat map"), over real sockets against the
 * listening app and real Postgres. Clients wait for messages, never for time.
 */
describe('The seat map gateway (integration)', () => {
  let testApp: TestApp;
  let showtime: BookableShowtimeFixture;
  let other: BookableShowtimeFixture;
  const clock = new TestClock(NOW);
  const clients: SeatMapTestClient[] = [];

  const connect = async (
    headers: Record<string, string | null> = {},
  ): Promise<SeatMapTestClient> => {
    const client = await seatMapClient(testApp, headers);
    clients.push(client);
    return client;
  };
  const subscribed = async (showtimeId: number): Promise<SeatMapTestClient> => {
    const client = await connect();
    client.send('subscribe', { showtimeId });
    expect((await client.next()).event).toBe('snapshot');
    return client;
  };

  beforeAll(async () => {
    testApp = await createTestApp({ clock, imports: [SeatMapProbeModule] });
    const admin = await staffSession(testApp, 'admin');
    showtime = await bookableShowtime(testApp, admin);
    other = await bookableShowtime(testApp, admin, { fixture: showtime, startTime: '13:00' });
  });

  beforeEach(async () => {
    clock.set(NOW);
    await testApp.knex.raw(
      'TRUNCATE seat_claims, booking_seats, bookings, hold_refusals, audit_events, idempotency_keys CASCADE',
    );
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('opens a subscription with the same snapshot as GET /seats', async () => {
    await expectHold(testApp, showtime.showtimeId, ['B4', 'A3']);
    const client = await connect();
    client.send('subscribe', { showtimeId: showtime.showtimeId });
    const snapshot = await client.next();
    const rest = await testApp.http().get(`/api/v1/showtimes/${showtime.showtimeId}/seats`);
    expect(snapshot).toEqual({
      event: 'snapshot',
      data: {
        showtimeId: showtime.showtimeId,
        serverTime: rest.body.serverTime,
        seats: [
          { label: 'A3', state: 'held', heldUntil: '2026-10-10T10:05:00+03:00' },
          { label: 'B4', state: 'held', heldUntil: '2026-10-10T10:05:00+03:00' },
        ],
      },
    });
    expect((rest.body.seats as { label: string }[]).map((seat) => seat.label)).toEqual([
      'A3',
      'B4',
    ]);
    // An unknown showtime simply has no seats.
    client.send('subscribe', { showtimeId: 987_654 });
    expect(await client.next()).toMatchObject({
      event: 'snapshot',
      data: { showtimeId: 987_654, seats: [] },
    });
  });

  it('pushes seat.held and seat.released to subscribers of that showtime only', async () => {
    const watcher = await subscribed(showtime.showtimeId);
    const elsewhere = await subscribed(other.showtimeId);

    const hold = await expectHold(testApp, showtime.showtimeId, ['C2', 'C1']);
    expect(await watcher.next()).toEqual({
      event: 'seat.held',
      data: {
        showtimeId: showtime.showtimeId,
        labels: ['C1', 'C2'],
        heldUntil: '2026-10-10T10:05:00+03:00',
      },
    });
    const released = await testApp
      .http()
      .delete(`/api/v1/holds/${hold.reference}`)
      .set('X-Hold-Token', hold.holdCode!);
    expect(released.status).toBe(204);
    expect(await watcher.next()).toEqual({
      event: 'seat.released',
      data: { showtimeId: showtime.showtimeId, labels: ['C1', 'C2'] },
    });

    // The other showtime's subscriber got nothing of that: its next message is its own event.
    await expectHold(testApp, other.showtimeId, ['D1']);
    expect(await elsewhere.next()).toMatchObject({
      event: 'seat.held',
      data: { showtimeId: other.showtimeId, labels: ['D1'] },
    });

    // After unsubscribing, nothing more arrives for that showtime.
    watcher.send('unsubscribe', { showtimeId: showtime.showtimeId });
    watcher.send('subscribe', { showtimeId: other.showtimeId });
    expect((await watcher.next()).event).toBe('snapshot');
    await expectHold(testApp, showtime.showtimeId, ['D2']);
    await expectHold(testApp, other.showtimeId, ['D3']);
    expect(await watcher.next()).toMatchObject({ event: 'seat.held', data: { labels: ['D3'] } });
  });

  it('sends nothing for a transaction that rolled back', async () => {
    const watcher = await subscribed(showtime.showtimeId);
    const rolledBack = await testApp
      .http()
      .post('/api/v1/test-seat-map/rolled-back-events')
      .set('Idempotency-Key', randomUUID())
      .send({ showtimeId: showtime.showtimeId, labels: ['A8'] });
    expect(rolledBack.status).toBe(409);

    // A refused re-pick rolls back the release of the customer's earlier hold too.
    const customer = await registerCustomer(testApp);
    await expectHold(testApp, showtime.showtimeId, ['B6'], {
      authorization: customer.authorization,
    });
    expect(await watcher.next()).toMatchObject({ event: 'seat.held', data: { labels: ['B6'] } });
    await expectHold(testApp, showtime.showtimeId, ['B7']);
    expect(await watcher.next()).toMatchObject({ event: 'seat.held', data: { labels: ['B7'] } });
    const refused = await holdSeats(testApp, showtime.showtimeId, ['B7', 'B8'], {
      authorization: customer.authorization,
    });
    expect(refused.status).toBe(409);

    await expectHold(testApp, showtime.showtimeId, ['C8']);
    expect(await watcher.next()).toMatchObject({ event: 'seat.held', data: { labels: ['C8'] } });
    expect(watcher.pending()).toEqual([]);
  });

  it('refuses a missing or foreign origin, and a 21st connection from one address', async () => {
    for (const origin of ['https://evil.example', null]) {
      const refused = await connect({ origin });
      expect(await refused.next()).toEqual({ event: 'error', data: { code: 'FORBIDDEN' } });
      expect(await refused.closed()).toBe(1008);
    }
    const address = { 'x-forwarded-for': '203.0.113.7' };
    for (let index = 0; index < 20; index += 1) await connect(address);
    const crowded = await connect(address);
    expect(await crowded.next()).toEqual({ event: 'error', data: { code: 'RATE_LIMITED' } });
    expect(await crowded.closed()).toBe(1013);
    // Another address is still welcome, and a closed connection frees its slot.
    await subscribed(showtime.showtimeId);
    await clients[clients.length - 3]!.close();
    // The server frees the slot when it sees the close; until then a newcomer may still be refused.
    let admitted = false;
    for (let attempt = 0; attempt < 50 && !admitted; attempt += 1) {
      const again = await connect(address);
      again.send('subscribe', { showtimeId: showtime.showtimeId });
      admitted = (await again.next()).event === 'snapshot';
    }
    expect(admitted).toBe(true);
  });

  it('limits subscriptions, refuses bad ids, ignores unknown messages and closes on oversized ones', async () => {
    const client = await connect();
    client.send('nonsense', { showtimeId: 1 });
    client.socket.send('not json at all');
    client.send('subscribe', { showtimeId: 'x' });
    expect(await client.next()).toEqual({ event: 'error', data: { code: 'VALIDATION_FAILED' } });
    for (const showtimeId of [1, 2, 3]) {
      client.send('subscribe', { showtimeId });
      expect((await client.next()).event).toBe('snapshot');
    }
    client.send('subscribe', { showtimeId: 4 });
    expect(await client.next()).toEqual({ event: 'error', data: { code: 'RATE_LIMITED' } });
    // The connection is kept, and subscribing again to one it has refreshes it.
    client.send('subscribe', { showtimeId: 2 });
    expect(await client.next()).toMatchObject({ event: 'snapshot', data: { showtimeId: 2 } });

    client.socket.send(
      JSON.stringify({ event: 'subscribe', data: { showtimeId: 1, pad: 'x'.repeat(5_000) } }),
    );
    expect(await client.closed()).toBe(1009);
  });

  it('answers a burst of subscribes to one showtime with one snapshot read', async () => {
    let reads = 0;
    const onQuery = (query: { sql: string }) => {
      if (query.sql.includes('FROM seat_claims')) reads += 1;
    };
    testApp.knex.on('query', onQuery);
    try {
      const client = await connect();
      for (let index = 0; index < 200; index += 1) {
        client.send('subscribe', { showtimeId: showtime.showtimeId });
      }
      expect((await client.next()).event).toBe('snapshot');
      // Once that snapshot is out, one more subscribe is a fresh read: every message is handled.
      client.send('subscribe', { showtimeId: showtime.showtimeId });
      expect((await client.next()).event).toBe('snapshot');
      expect(client.pending()).toEqual([]);
      expect(reads).toBeLessThanOrEqual(3);
    } finally {
      testApp.knex.off('query', onQuery);
    }
  });

  it('drops a client that did not answer the previous ping', async () => {
    const gateway = testApp.app.get(SeatMapGateway);
    const lively = await subscribed(showtime.showtimeId);
    gateway.sweepConnections();
    // The ping was answered (ws answers by itself) before this snapshot was sent.
    lively.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await lively.next()).event).toBe('snapshot');
    gateway.sweepConnections();
    lively.send('subscribe', { showtimeId: showtime.showtimeId });
    expect((await lively.next()).event).toBe('snapshot');

    // Two rounds with no chance to answer in between: terminated.
    const quiet = await subscribed(showtime.showtimeId);
    gateway.sweepConnections();
    gateway.sweepConnections();
    expect(await quiet.closed()).toBe(1006);
  });
});

describe('The seat map gateway under the default rate limit (integration)', () => {
  let testApp: TestApp;
  const clients: SeatMapTestClient[] = [];

  beforeAll(async () => {
    const config = buildTestConfig();
    testApp = await createTestApp({
      clock: new TestClock(NOW),
      config: {
        ...config,
        rateLimits: { ...config.rateLimits, default: { limit: 3, windowSeconds: 60 } },
      },
    });
  });

  afterAll(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await testApp.close();
  });

  it('refuses snapshot reads beyond the default limit of one address, keeping the connection', async () => {
    const first = await seatMapClient(testApp);
    const second = await seatMapClient(testApp);
    clients.push(first, second);
    for (const showtimeId of [1, 2]) {
      first.send('subscribe', { showtimeId });
      expect((await first.next()).event).toBe('snapshot');
    }
    second.send('subscribe', { showtimeId: 1 });
    expect((await second.next()).event).toBe('snapshot');
    second.send('subscribe', { showtimeId: 3 });
    expect(await second.next()).toEqual({ event: 'error', data: { code: 'RATE_LIMITED' } });
    first.send('subscribe', { showtimeId: 1 });
    expect(await first.next()).toEqual({ event: 'error', data: { code: 'RATE_LIMITED' } });
    expect(first.socket.readyState).toBe(first.socket.OPEN);
  });
});
