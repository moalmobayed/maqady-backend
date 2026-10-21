import { formatCairoIso } from '../../common/time/time';
import type { OutboundSeatMapMessage, SeatEvent, SeatMapErrorCode, SeatSnapshot } from './types';

/**
 * The seat map's messages (design §12), in Nest's `{ event, data }` shape, times in Cairo ISO
 * with their offset like the REST API.
 */

/** The `showtimeId` of a `subscribe` or `unsubscribe`: a positive safe integer, else null. */
export function parseShowtimeId(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const { showtimeId } = data as { showtimeId?: unknown };
  return typeof showtimeId === 'number' && Number.isSafeInteger(showtimeId) && showtimeId > 0
    ? showtimeId
    : null;
}

/** Every taken seat of a showtime and the server's time, so the client can correct its clock. */
export function snapshotMessage(snapshot: SeatSnapshot): OutboundSeatMapMessage {
  return {
    event: 'snapshot',
    data: {
      showtimeId: snapshot.showtimeId,
      serverTime: formatCairoIso(snapshot.serverTime),
      seats: snapshot.seats.map((seat) =>
        seat.heldUntil === null
          ? { label: seat.label, state: seat.state }
          : { label: seat.label, state: seat.state, heldUntil: formatCairoIso(seat.heldUntil) },
      ),
    },
  };
}

/** A seat event as clients receive it. */
export function eventMessage(event: SeatEvent): OutboundSeatMapMessage {
  if (event.type === 'seat.held') {
    return {
      event: event.type,
      data: {
        showtimeId: event.showtimeId,
        labels: [...event.labels],
        heldUntil: formatCairoIso(event.heldUntil),
      },
    };
  }
  return { event: event.type, data: { showtimeId: event.showtimeId, labels: [...event.labels] } };
}

export function errorMessage(code: SeatMapErrorCode): OutboundSeatMapMessage {
  return { event: 'error', data: { code } };
}
