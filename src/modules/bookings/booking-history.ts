import {
  HISTORY_BOOKING_ACTIONS,
  HISTORY_LABELS,
  HISTORY_SHOWTIME_ACTIONS,
} from './bookings.constants';
import type { BookingHistoryEvent, HistoryAuditEvent } from './types';

/**
 * One audit event as a booking's History shows it (PRD C11, design §13.5): its kind and English
 * label, or null for an action the customer does not see. The showtime's actions only reach here
 * for the window the booking held a ticket (`BookingHistoryService`).
 */
export function toHistoryEvent(event: HistoryAuditEvent): BookingHistoryEvent | null {
  const kind =
    (Object.hasOwn(HISTORY_BOOKING_ACTIONS, event.action)
      ? HISTORY_BOOKING_ACTIONS[event.action]
      : undefined) ??
    (Object.hasOwn(HISTORY_SHOWTIME_ACTIONS, event.action)
      ? HISTORY_SHOWTIME_ACTIONS[event.action]
      : undefined);
  return kind === undefined
    ? null
    : { kind, label: HISTORY_LABELS[kind], occurredAt: event.occurredAt };
}
