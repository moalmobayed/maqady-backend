import type { IncomingMessage } from 'node:http';
import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { WebSocket } from 'ws';
import { Public } from '../../common/auth/access.decorators';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { Clock } from '../../common/time/clock';
import { clientAddressOf } from './client-address';
import { SeatAvailabilityService } from './seat-availability.service';
import { SeatEventBus } from './seat-event.bus';
import { SeatMapConnections } from './seat-map.connections';
import { errorMessage, eventMessage, parseShowtimeId, snapshotMessage } from './seat-map.messages';
import {
  SEAT_MAP_MAX_PAYLOAD_BYTES,
  SEAT_MAP_PATH,
  SEAT_MAP_PING_INTERVAL_MS,
} from './seating.constants';
import type { OutboundSeatMapMessage, SeatEvent } from './types';

/**
 * The live seat map (design §12): a plain WebSocket at `/ws` (`@nestjs/platform-ws`), messages
 * in Nest's `{ "event", "data" }` shape. No sign-in: seat labels are public and nothing says who
 * holds a seat. The global guards pass WebSocket contexts through, so this gateway enforces its
 * own rules:
 *
 * - **Admission.** The `Origin` header must be one of `CORS_ORIGINS` (else `error FORBIDDEN`, close
 *   `1008`), and one client address may hold `WS_CONNECTIONS_PER_IP` connections (else
 *   `error RATE_LIMITED`, close `1013`). Inbound messages over 4 KB close the socket (`1009`).
 * - **`subscribe { showtimeId }`.** A positive integer id (else `error VALIDATION_FAILED`), at most
 *   `WS_SUBSCRIPTIONS_PER_CONNECTION` per connection (else `error RATE_LIMITED`, connection kept).
 *   The answer is a `snapshot` of the taken seats and the server time; events committed while it
 *   is read follow it, in order. Subscribing again sends a fresh snapshot, except while one is
 *   still being read (that one answers). Snapshot reads per address follow the `default` rate
 *   limit (`RATE_LIMIT_DEFAULT`), else `error RATE_LIMITED`. Any positive id is accepted, an
 *   unknown one simply has no seats, so seating depends on no other module.
 * - **Events.** `seat.held`, `seat.released` and `seat.booked`, from the in-process bus, which
 *   only carries events of committed transactions (`SeatEventPublisher`). An expiry is never
 *   announced: clients free a seat when its `heldUntil` passes.
 * - **Liveness.** A ping every 30 seconds; a client that did not answer the previous one is
 *   dropped. No seat state depends on this timer.
 *
 * Handlers never throw: a failure is logged and the client gets nothing for that message.
 */
@Public()
@WebSocketGateway({ path: SEAT_MAP_PATH, maxPayload: SEAT_MAP_MAX_PAYLOAD_BYTES })
export class SeatMapGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SeatMapGateway.name);
  private readonly origins: ReadonlySet<string>;
  private unsubscribeBus: (() => void) | undefined;
  private pingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly connections: SeatMapConnections<WebSocket>,
    private readonly availability: SeatAvailabilityService,
    private readonly bus: SeatEventBus,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.origins = new Set(config.corsOrigins);
  }

  onModuleInit(): void {
    this.unsubscribeBus = this.bus.subscribe((event) => this.deliver(event));
    this.pingTimer = setInterval(() => this.sweepConnections(), SEAT_MAP_PING_INTERVAL_MS);
    // Liveness only: the timer never keeps the process (or a test run) alive.
    this.pingTimer.unref();
  }

  onModuleDestroy(): void {
    this.unsubscribeBus?.();
    if (this.pingTimer) clearInterval(this.pingTimer);
  }

  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const origin = request.headers.origin;
    const admission = this.connections.admit(
      client,
      clientAddressOf(request),
      typeof origin === 'string' && this.origins.has(origin),
    );
    if (!admission.admitted) {
      this.send(client, errorMessage(admission.code));
      client.close(admission.closeCode);
      return;
    }
    client.on('pong', () => this.connections.markAlive(client));
  }

  handleDisconnect(client: WebSocket): void {
    this.connections.release(client);
  }

  @SubscribeMessage('subscribe')
  async onSubscribe(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: unknown,
  ): Promise<void> {
    if (!this.connections.isOpen(client)) return;
    const showtimeId = parseShowtimeId(data);
    if (showtimeId === null) {
      this.send(client, errorMessage('VALIDATION_FAILED'));
      return;
    }
    const { outcome, generation } = this.connections.subscribe(
      client,
      this.clock.now(),
      showtimeId,
    );
    if (outcome === 'limit' || outcome === 'rate_limited') {
      this.send(client, errorMessage('RATE_LIMITED'));
      return;
    }
    // That showtime's snapshot is already being read: it answers this subscribe too.
    if (outcome === 'pending') return;
    try {
      const snapshot = await this.availability.snapshot(showtimeId);
      // A newer subscribe (or an unsubscribe, or a close) made this snapshot stale.
      const buffered = this.connections.markLive(client, showtimeId, generation);
      if (buffered === null) return;
      this.send(client, snapshotMessage(snapshot));
      for (const message of buffered) this.send(client, message);
    } catch (error) {
      this.logger.error({ err: error }, 'A seat map snapshot failed');
      this.connections.unsubscribe(client, showtimeId);
    }
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown): void {
    const showtimeId = parseShowtimeId(data);
    if (showtimeId === null) {
      this.send(client, errorMessage('VALIDATION_FAILED'));
      return;
    }
    this.connections.unsubscribe(client, showtimeId);
  }

  /**
   * One liveness round (the ping timer's body; public so tests run it without waiting): a client
   * that did not answer the previous ping is terminated, every other one is pinged.
   */
  sweepConnections(): void {
    const { stale, ping } = this.connections.sweep(this.clock.now());
    for (const client of stale) {
      this.connections.release(client);
      client.terminate();
    }
    for (const client of ping) {
      if (client.readyState === WebSocket.OPEN) client.ping();
    }
  }

  private deliver(event: SeatEvent): void {
    const message = eventMessage(event);
    for (const client of this.connections.recipients(event.showtimeId, message)) {
      this.send(client, message);
    }
  }

  private send(client: WebSocket, message: OutboundSeatMapMessage): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(message));
  }
}
