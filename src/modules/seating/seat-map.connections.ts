import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { CLOSE_POLICY_VIOLATION, CLOSE_TRY_AGAIN_LATER } from './seating.constants';
import type {
  OutboundSeatMapMessage,
  SeatMapAdmission,
  SeatMapClientState,
  SnapshotReadWindow,
  SubscribeResult,
  SweepResult,
} from './types';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The seat map's bookkeeping (design §10.6, §12), free of any socket: which clients are open,
 * from which address, what each subscribed to, and which subscriptions still wait for their
 * snapshot.
 *
 * A subscription is pending from `subscribe()` until `markLive()`: events meanwhile are buffered
 * and handed back by `markLive()` in order, after the snapshot. The subscription is registered
 * before the snapshot is read, so no event committed in between is lost, and none is sent ahead
 * of an older snapshot. Each `subscribe()` that reads gets a new generation of its connection,
 * and only the latest one's snapshot is sent.
 *
 * Snapshot reads are what a client can make the database do, so they are bounded:
 *
 * - A `subscribe()` to a showtime whose snapshot is still being read reads nothing more: that
 *   snapshot and the events buffered behind it bring the client up to date (`pending`). A burst
 *   of subscribes costs one read.
 * - Each client address may start the `default` rate limit's number of reads per window (design
 *   §10.6, `RATE_LIMIT_DEFAULT`, the budget `GET /showtimes/{id}/seats` has too); beyond it a
 *   `subscribe()` is `rate_limited` until the window, judged from the `Clock`, has passed.
 */
@Injectable()
export class SeatMapConnections<Client extends object = object> {
  private readonly clients = new Map<Client, SeatMapClientState>();
  private readonly perAddress = new Map<string, number>();
  private readonly reads = new Map<string, SnapshotReadWindow>();
  private readonly connectionsPerIp: number;
  private readonly subscriptionsPerConnection: number;
  private readonly readsPerWindow: number;
  private readonly readWindowMs: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connectionsPerIp = config.seatMap.connectionsPerIp;
    this.subscriptionsPerConnection = config.seatMap.subscriptionsPerConnection;
    this.readsPerWindow = config.rateLimits.default.limit;
    this.readWindowMs = config.rateLimits.default.windowSeconds * MILLISECONDS_PER_SECOND;
  }

  /** Admits a new client from `address`: a missing or unknown origin, or too many from there, is refused. */
  admit(client: Client, address: string, originAllowed: boolean): SeatMapAdmission {
    if (!originAllowed) {
      return { admitted: false, code: 'FORBIDDEN', closeCode: CLOSE_POLICY_VIOLATION };
    }
    const open = this.perAddress.get(address) ?? 0;
    if (open >= this.connectionsPerIp) {
      return { admitted: false, code: 'RATE_LIMITED', closeCode: CLOSE_TRY_AGAIN_LATER };
    }
    this.perAddress.set(address, open + 1);
    this.clients.set(client, {
      address,
      alive: true,
      subscriptions: new Map(),
      lastGeneration: 0,
    });
    return { admitted: true };
  }

  /** Forgets a client and frees its address slot; unknown clients are ignored. */
  release(client: Client): void {
    const state = this.clients.get(client);
    if (!state) return;
    this.clients.delete(client);
    const open = (this.perAddress.get(state.address) ?? 1) - 1;
    if (open > 0) this.perAddress.set(state.address, open);
    else this.perAddress.delete(state.address);
  }

  isOpen(client: Client): boolean {
    return this.clients.has(client);
  }

  /**
   * Registers (or restarts) a subscription as pending and returns its generation: the caller
   * then reads the snapshot. Reads nothing (`pending`) while that showtime's snapshot is already
   * being read; refuses a new subscription beyond the connection's limit (`limit`) and any read
   * beyond the address's rate limit at `now` (`rate_limited`).
   */
  subscribe(client: Client, now: Date, showtimeId: number): SubscribeResult {
    const state = this.clients.get(client);
    if (!state) return { outcome: 'limit', generation: 0 };
    const existing = state.subscriptions.get(showtimeId);
    if (existing && !existing.live) return { outcome: 'pending', generation: existing.generation };
    if (!existing && state.subscriptions.size >= this.subscriptionsPerConnection) {
      return { outcome: 'limit', generation: 0 };
    }
    if (!this.takeRead(state.address, now)) return { outcome: 'rate_limited', generation: 0 };
    state.lastGeneration += 1;
    const generation = state.lastGeneration;
    state.subscriptions.set(showtimeId, { generation, live: false, pending: [] });
    return { outcome: existing ? 'refreshed' : 'subscribed', generation };
  }

  /**
   * Makes a pending subscription live once its snapshot went out, and returns the events it
   * buffered meanwhile, in order. Null when the subscription is gone or a newer `subscribe()`
   * started (that one sends its own snapshot): then the caller sends nothing.
   */
  markLive(
    client: Client,
    showtimeId: number,
    generation: number,
  ): OutboundSeatMapMessage[] | null {
    const subscription = this.clients.get(client)?.subscriptions.get(showtimeId);
    if (!subscription || subscription.generation !== generation) return null;
    const buffered = subscription.pending.splice(0);
    subscription.live = true;
    return buffered;
  }

  unsubscribe(client: Client, showtimeId: number): void {
    this.clients.get(client)?.subscriptions.delete(showtimeId);
  }

  /** The clients a showtime's event goes to now; pending subscriptions buffer it instead. */
  recipients(showtimeId: number, message: OutboundSeatMapMessage): Client[] {
    const now: Client[] = [];
    for (const [client, state] of this.clients) {
      const subscription = state.subscriptions.get(showtimeId);
      if (!subscription) continue;
      if (subscription.live) now.push(client);
      else subscription.pending.push(message);
    }
    return now;
  }

  /** Marks a client as having answered a ping. */
  markAlive(client: Client): void {
    const state = this.clients.get(client);
    if (state) state.alive = true;
  }

  /**
   * One liveness round: returns the clients that never answered the previous ping (to
   * terminate) and those to ping now, which are marked as waiting for an answer. Rate limit
   * windows that have passed at `now` are forgotten.
   */
  sweep(now: Date): SweepResult<Client> {
    const stale: Client[] = [];
    const ping: Client[] = [];
    for (const [client, state] of this.clients) {
      if (!state.alive) {
        stale.push(client);
        continue;
      }
      state.alive = false;
      ping.push(client);
    }
    for (const [address, window] of this.reads) {
      if (now.getTime() - window.startedAt >= this.readWindowMs) this.reads.delete(address);
    }
    return { stale, ping };
  }

  /** Counts one snapshot read for `address` at `now`; false when its window is used up. */
  private takeRead(address: string, now: Date): boolean {
    const at = now.getTime();
    const window = this.reads.get(address);
    if (!window || at - window.startedAt >= this.readWindowMs) {
      this.reads.set(address, { startedAt: at, count: 1 });
      return true;
    }
    if (window.count >= this.readsPerWindow) return false;
    window.count += 1;
    return true;
  }
}
