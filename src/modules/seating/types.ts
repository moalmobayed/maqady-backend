import type { SEAT_EVENT_TYPES, SEAT_MAP_ERROR_CODES, SEAT_STATES } from './enums';

export type SeatState = (typeof SEAT_STATES)[number];

export type SeatEventType = (typeof SEAT_EVENT_TYPES)[number];

export type SeatMapErrorCode = (typeof SEAT_MAP_ERROR_CODES)[number];

// --- Rows -----------------------------------------------------------------------------------

/** A `seat_claims` row as the snapshot reads it. `claimed_until` NULL is a sold seat. */
export interface SeatClaimRow {
  readonly seat_label: string;
  readonly booking_id: number;
  readonly claimed_until: Date | null;
}

/** One row the claim statement proposes: a new claim, or the release of an earlier one. */
export interface ClaimWriteRow {
  readonly label: string;
  readonly bookingId: number;
  /** A new claim's end (null: sold); a release writes `now`, which frees the seat. */
  readonly claimedUntil: Date | null;
}

/** A row the claim statement wrote. */
export interface WrittenClaimRow {
  readonly seat_label: string;
  readonly booking_id: number;
}

/** A `hold_refusals` row as the repository inserts it. */
export interface HoldRefusalRow {
  readonly showtime_id: number;
  readonly refused_at: Date;
  readonly seat_count: number;
}

/** How many seats of a showtime are taken right now, as the repository counts them. */
export interface TakenCountRow {
  readonly showtime_id: number;
  readonly taken: number;
}

// --- Claim writes ---------------------------------------------------------------------------

/** Seats one booking claims on one showtime. */
export interface ClaimRequest {
  readonly showtimeId: number;
  readonly bookingId: number;
  readonly labels: readonly string[];
  /** The hold's expiry, or null for seats sold at once. */
  readonly claimedUntil: Date | null;
}

/** The seats of a booking being released: its claims end `now`. */
export interface ReleasedClaims {
  readonly showtimeId: number;
  readonly bookingId: number;
  readonly labels: readonly string[];
}

/**
 * Everything one transaction writes to `seat_claims`: at most one claim, and the releases of the
 * bookings it replaces. The bookings released must already be locked `FOR UPDATE` (§7.1 step 5).
 */
export interface ClaimPlan {
  readonly now: Date;
  readonly claim?: ClaimRequest;
  readonly release: readonly ReleasedClaims[];
}

/** One statement of a plan: the rows of one showtime, sorted by label, each label once. */
export interface ClaimStatement {
  readonly showtimeId: number;
  readonly rows: readonly ClaimWriteRow[];
  /** Bookings whose live claims these rows may take over: the ones being released. */
  readonly takeOverFrom: readonly number[];
}

/** What a claim got: the labels it holds now, and those someone else holds. Both sorted. */
export interface ClaimOutcome {
  readonly claimed: readonly string[];
  readonly missing: readonly string[];
}

// --- Availability ---------------------------------------------------------------------------

/** A taken seat of a showtime. */
export interface TakenSeat {
  readonly label: string;
  readonly state: SeatState;
  /** When the hold ends; null for a sold seat. */
  readonly heldUntil: Date | null;
}

/** Every taken seat of a showtime at `serverTime`, by label. */
export interface SeatSnapshot {
  readonly showtimeId: number;
  readonly serverTime: Date;
  readonly seats: readonly TakenSeat[];
}

// --- Events ---------------------------------------------------------------------------------

/** Seats just held, by a new hold or an extended one. */
export interface SeatHeldEvent {
  readonly type: 'seat.held';
  readonly showtimeId: number;
  readonly labels: readonly string[];
  readonly heldUntil: Date;
}

/** Seats freed by a released hold (an expiry is never announced: clients use `heldUntil`). */
export interface SeatReleasedEvent {
  readonly type: 'seat.released';
  readonly showtimeId: number;
  readonly labels: readonly string[];
}

/** Seats sold (U11, U13). */
export interface SeatBookedEvent {
  readonly type: 'seat.booked';
  readonly showtimeId: number;
  readonly labels: readonly string[];
}

/** What the seat map pushes, published after the transaction that caused it commits. */
export type SeatEvent = SeatHeldEvent | SeatReleasedEvent | SeatBookedEvent;

/** A subscriber of the in-process seat event bus. */
export type SeatEventListener = (event: SeatEvent) => void;

// --- Seat map messages ----------------------------------------------------------------------

/** One taken seat in a `snapshot` message; `heldUntil` only when held. */
export interface SnapshotSeatData {
  readonly label: string;
  readonly state: SeatState;
  readonly heldUntil?: string;
}

/** A message the server sends, in Nest's `{ event, data }` shape. */
export type OutboundSeatMapMessage =
  | {
      readonly event: 'snapshot';
      readonly data: {
        readonly showtimeId: number;
        readonly serverTime: string;
        readonly seats: readonly SnapshotSeatData[];
      };
    }
  | {
      readonly event: 'seat.held';
      readonly data: {
        readonly showtimeId: number;
        readonly labels: readonly string[];
        readonly heldUntil: string;
      };
    }
  | {
      readonly event: 'seat.released' | 'seat.booked';
      readonly data: { readonly showtimeId: number; readonly labels: readonly string[] };
    }
  | { readonly event: 'error'; readonly data: { readonly code: SeatMapErrorCode } };

/**
 * One subscription of a connection: buffering events until its snapshot went out, then live.
 * `generation` names the `subscribe()` whose snapshot this is, so an older one is dropped.
 */
export interface SeatMapSubscription {
  readonly generation: number;
  live: boolean;
  readonly pending: OutboundSeatMapMessage[];
}

/** What the gateway keeps per connection. */
export interface SeatMapClientState {
  readonly address: string;
  /** False once a ping went out unanswered; the next sweep then terminates the client. */
  alive: boolean;
  readonly subscriptions: Map<number, SeatMapSubscription>;
  /** The generation of this connection's latest `subscribe()`: it only ever grows. */
  lastGeneration: number;
}

/** One client address's snapshot reads in the current rate limit window. */
export interface SnapshotReadWindow {
  /** When the window started, in epoch milliseconds from the `Clock`. */
  readonly startedAt: number;
  count: number;
}

/** What admitting a new connection decided. */
export type SeatMapAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly code: SeatMapErrorCode; readonly closeCode: number };

/**
 * What a `subscribe` decided: a new subscription or a refreshed one (read a snapshot), one whose
 * snapshot is already being read (read nothing more), or a refusal: too many subscriptions on
 * the connection (`limit`) or too many snapshot reads from its address (`rate_limited`).
 */
export type SubscribeOutcome = 'subscribed' | 'refreshed' | 'pending' | 'limit' | 'rate_limited';

/** A `subscribe` as registered: its outcome, and the generation its snapshot belongs to. */
export interface SubscribeResult {
  readonly outcome: SubscribeOutcome;
  readonly generation: number;
}

/** One liveness round: clients to terminate, and clients to ping. */
export interface SweepResult<Client> {
  readonly stale: Client[];
  readonly ping: Client[];
}
