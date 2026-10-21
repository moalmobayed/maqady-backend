import type { AppConfig } from '../../../../src/common/config/types';
import { SeatMapConnections } from '../../../../src/modules/seating/seat-map.connections';
import type { OutboundSeatMapMessage } from '../../../../src/modules/seating/types';

const CONFIG = {
  seatMap: { connectionsPerIp: 20, subscriptionsPerConnection: 3 },
  rateLimits: { default: { limit: 300, windowSeconds: 60 } },
} as AppConfig;
const NOW = new Date('2026-10-16T19:00:00+03:00');
const later = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);
const held = (label: string): OutboundSeatMapMessage => ({
  event: 'seat.held',
  data: { showtimeId: 7, labels: [label], heldUntil: '2026-10-16T19:05:00+03:00' },
});

describe('SeatMapConnections', () => {
  let connections: SeatMapConnections;

  beforeEach(() => {
    connections = new SeatMapConnections(CONFIG);
  });

  it('refuses a missing or foreign origin with FORBIDDEN and close 1008', () => {
    expect(connections.admit({}, '1.1.1.1', false)).toEqual({
      admitted: false,
      code: 'FORBIDDEN',
      closeCode: 1008,
    });
  });

  it('refuses the 21st connection of an address with close 1013, and frees a slot on release', () => {
    const clients = Array.from({ length: 20 }, () => ({}));
    for (const client of clients) {
      expect(connections.admit(client, '1.1.1.1', true)).toEqual({ admitted: true });
    }
    expect(connections.admit({}, '1.1.1.1', true)).toEqual({
      admitted: false,
      code: 'RATE_LIMITED',
      closeCode: 1013,
    });
    expect(connections.admit({}, '2.2.2.2', true)).toEqual({ admitted: true });
    connections.release(clients[0]!);
    connections.release(clients[0]!);
    expect(connections.admit({}, '1.1.1.1', true)).toEqual({ admitted: true });
    expect(connections.admit({}, '1.1.1.1', true).admitted).toBe(false);
  });

  it('allows 3 subscriptions per connection; subscribing again refreshes one', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    expect(connections.subscribe(client, NOW, 1)).toEqual({ outcome: 'subscribed', generation: 1 });
    expect(connections.subscribe(client, NOW, 2).outcome).toBe('subscribed');
    expect(connections.subscribe(client, NOW, 3).outcome).toBe('subscribed');
    expect(connections.subscribe(client, NOW, 4).outcome).toBe('limit');
    connections.markLive(client, 2, 2);
    expect(connections.subscribe(client, NOW, 2)).toEqual({ outcome: 'refreshed', generation: 4 });
    connections.unsubscribe(client, 3);
    expect(connections.subscribe(client, NOW, 4).outcome).toBe('subscribed');
    expect(connections.subscribe({}, NOW, 1).outcome).toBe('limit');
  });

  it('buffers events while the snapshot is read and hands them back in order', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    const { generation } = connections.subscribe(client, NOW, 7);
    expect(connections.recipients(7, held('A1'))).toEqual([]);
    expect(connections.recipients(7, held('A2'))).toEqual([]);
    expect(connections.recipients(8, held('B1'))).toEqual([]);
    expect(connections.markLive(client, 7, generation)).toEqual([held('A1'), held('A2')]);
    expect(connections.recipients(7, held('A3'))).toEqual([client]);
    expect(connections.markLive(client, 7, generation)).toEqual([]);
  });

  it('drops the snapshot of a subscription that was replaced after an unsubscribe', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    const first = connections.subscribe(client, NOW, 7);
    connections.unsubscribe(client, 7);
    const second = connections.subscribe(client, NOW, 7);
    connections.recipients(7, held('A1'));
    expect(connections.markLive(client, 7, first.generation)).toBeNull();
    expect(connections.markLive(client, 7, second.generation)).toEqual([held('A1')]);
    connections.unsubscribe(client, 7);
    expect(connections.markLive(client, 7, second.generation)).toBeNull();
  });

  it('starts no second snapshot read while one is pending, and refreshes a live subscription', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    const first = connections.subscribe(client, NOW, 7);
    expect(first.outcome).toBe('subscribed');
    connections.recipients(7, held('A1'));
    // A burst of subscribes to the same showtime: the pending snapshot (and its buffer) answers all.
    for (let index = 0; index < 100; index += 1) {
      expect(connections.subscribe(client, NOW, 7)).toEqual({
        outcome: 'pending',
        generation: first.generation,
      });
    }
    connections.recipients(7, held('A2'));
    expect(connections.markLive(client, 7, first.generation)).toEqual([held('A1'), held('A2')]);
    const refreshed = connections.subscribe(client, NOW, 7);
    expect(refreshed.outcome).toBe('refreshed');
    expect(refreshed.generation).not.toBe(first.generation);
    expect(connections.markLive(client, 7, first.generation)).toBeNull();
    expect(connections.markLive(client, 7, refreshed.generation)).toEqual([]);
  });

  it('keeps nothing of a showtime once it is unsubscribed', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    for (let showtimeId = 1; showtimeId <= 1000; showtimeId += 1) {
      const { generation } = connections.subscribe(client, NOW, showtimeId);
      connections.markLive(client, showtimeId, generation);
      connections.unsubscribe(client, showtimeId);
    }
    const state = (connections as unknown as { clients: Map<object, object> }).clients.get(client);
    const perShowtime = Object.values(state ?? {}).filter((value) => value instanceof Map);
    expect(perShowtime.map((map) => (map as Map<unknown, unknown>).size)).toEqual(
      perShowtime.map(() => 0),
    );
  });

  it('limits the snapshot reads of one address with the default rate limit', () => {
    connections = new SeatMapConnections({
      ...CONFIG,
      rateLimits: { default: { limit: 3, windowSeconds: 60 } },
    } as AppConfig);
    const first = {};
    const second = {};
    connections.admit(first, '1.1.1.1', true);
    connections.admit(second, '1.1.1.1', true);
    const elsewhere = {};
    connections.admit(elsewhere, '2.2.2.2', true);
    for (const showtimeId of [1, 2]) {
      const { generation } = connections.subscribe(first, NOW, showtimeId);
      connections.markLive(first, showtimeId, generation);
    }
    expect(connections.subscribe(second, NOW, 1).outcome).toBe('subscribed');
    // The address used its 3 reads: a refresh or a new subscription is refused, on any connection.
    expect(connections.subscribe(first, later(59), 1)).toEqual({
      outcome: 'rate_limited',
      generation: 0,
    });
    expect(connections.subscribe(second, later(59), 3).outcome).toBe('rate_limited');
    expect(connections.markLive(first, 1, 1)).toEqual([]);
    expect(connections.subscribe(elsewhere, later(59), 1).outcome).toBe('subscribed');
    // A new window starts once the old one has passed.
    expect(connections.subscribe(first, later(60), 1).outcome).toBe('refreshed');
  });

  it('terminates a client that missed a ping and pings the others', () => {
    const quiet = {};
    const lively = {};
    connections.admit(quiet, '1.1.1.1', true);
    connections.admit(lively, '1.1.1.1', true);
    expect(connections.sweep(NOW)).toEqual({ stale: [], ping: [quiet, lively] });
    connections.markAlive(lively);
    expect(connections.sweep(NOW)).toEqual({ stale: [quiet], ping: [lively] });
  });
});
