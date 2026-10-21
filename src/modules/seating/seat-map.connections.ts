import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { CLOSE_POLICY_VIOLATION, CLOSE_TRY_AGAIN_LATER } from './seating.constants';
import type {
  OutboundSeatMapMessage,
  SeatMapAdmission,
  SeatMapClientState,
  SubscribeResult,
  SweepResult,
} from './types';

/**
 * The seat map's bookkeeping (design §10.6, §12), free of any socket: which clients are open,
 * from which address, what each subscribed to, and which subscriptions still wait for their
 * snapshot.
 *
 * A subscription is pending from `subscribe()` until `markLive()`: events meanwhile are buffered
 * and handed back by `markLive()` in order, after the snapshot. The subscription is registered
 * before the snapshot is read, so no event committed in between is lost, and none is sent ahead
 * of an older snapshot. A second `subscribe()` to the same showtime starts over (a new
 * generation), and the snapshot of the older one is dropped.
 */
@Injectable()
export class SeatMapConnections<Client extends object = object> {
  private readonly clients = new Map<Client, SeatMapClientState>();
  private readonly perAddress = new Map<string, number>();
  private readonly connectionsPerIp: number;
  private readonly subscriptionsPerConnection: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connectionsPerIp = config.seatMap.connectionsPerIp;
    this.subscriptionsPerConnection = config.seatMap.subscriptionsPerConnection;
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
      generations: new Map(),
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
   * Registers (or restarts) a subscription as pending and returns its generation, or `limit`
   * when the connection already has as many subscriptions as allowed.
   */
  subscribe(client: Client, showtimeId: number): SubscribeResult {
    const state = this.clients.get(client);
    if (!state) return { outcome: 'limit', generation: 0 };
    const existing = state.subscriptions.has(showtimeId);
    if (!existing && state.subscriptions.size >= this.subscriptionsPerConnection) {
      return { outcome: 'limit', generation: 0 };
    }
    const generation = (state.generations.get(showtimeId) ?? 0) + 1;
    state.generations.set(showtimeId, generation);
    const previous = state.subscriptions.get(showtimeId);
    state.subscriptions.set(showtimeId, { live: false, pending: previous?.pending ?? [] });
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
    const state = this.clients.get(client);
    const subscription = state?.subscriptions.get(showtimeId);
    if (!state || !subscription || state.generations.get(showtimeId) !== generation) return null;
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
   * terminate) and those to ping now, which are marked as waiting for an answer.
   */
  sweep(): SweepResult<Client> {
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
    return { stale, ping };
  }
}
