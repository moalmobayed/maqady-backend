import type { AppConfig } from '../../../../src/common/config/types';
import { SeatMapConnections } from '../../../../src/modules/seating/seat-map.connections';
import type { OutboundSeatMapMessage } from '../../../../src/modules/seating/types';

const CONFIG = { seatMap: { connectionsPerIp: 20, subscriptionsPerConnection: 3 } } as AppConfig;
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
    expect(connections.subscribe(client, 1)).toEqual({ outcome: 'subscribed', generation: 1 });
    expect(connections.subscribe(client, 2).outcome).toBe('subscribed');
    expect(connections.subscribe(client, 3).outcome).toBe('subscribed');
    expect(connections.subscribe(client, 4).outcome).toBe('limit');
    expect(connections.subscribe(client, 2)).toEqual({ outcome: 'refreshed', generation: 2 });
    connections.unsubscribe(client, 3);
    expect(connections.subscribe(client, 4).outcome).toBe('subscribed');
    expect(connections.subscribe({}, 1).outcome).toBe('limit');
  });

  it('buffers events while the snapshot is read and hands them back in order', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    const { generation } = connections.subscribe(client, 7);
    expect(connections.recipients(7, held('A1'))).toEqual([]);
    expect(connections.recipients(7, held('A2'))).toEqual([]);
    expect(connections.recipients(8, held('B1'))).toEqual([]);
    expect(connections.markLive(client, 7, generation)).toEqual([held('A1'), held('A2')]);
    expect(connections.recipients(7, held('A3'))).toEqual([client]);
    expect(connections.markLive(client, 7, generation)).toEqual([]);
  });

  it('drops the snapshot of a subscription a newer subscribe replaced', () => {
    const client = {};
    connections.admit(client, '1.1.1.1', true);
    const first = connections.subscribe(client, 7);
    connections.recipients(7, held('A1'));
    const second = connections.subscribe(client, 7);
    expect(connections.markLive(client, 7, first.generation)).toBeNull();
    expect(connections.markLive(client, 7, second.generation)).toEqual([held('A1')]);
    connections.unsubscribe(client, 7);
    expect(connections.markLive(client, 7, second.generation)).toBeNull();
  });

  it('terminates a client that missed a ping and pings the others', () => {
    const quiet = {};
    const lively = {};
    connections.admit(quiet, '1.1.1.1', true);
    connections.admit(lively, '1.1.1.1', true);
    expect(connections.sweep()).toEqual({ stale: [], ping: [quiet, lively] });
    connections.markAlive(lively);
    expect(connections.sweep()).toEqual({ stale: [quiet], ping: [lively] });
  });
});
