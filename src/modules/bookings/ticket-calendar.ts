import { CALENDAR_UID_DOMAIN } from './bookings.constants';
import type { TicketDetails } from './types';

/** RFC 5545 content lines end with CRLF and fold past 75 octets. */
const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;

/**
 * The "Add to calendar" file of a ticket (PRD "Tickets and QR codes": the showtime and the
 * theater's address), an RFC 5545 calendar with one event. Times are written in UTC
 * (`YYYYMMDDTHHMMSSZ`), so the file needs no time-zone data and every calendar shows the
 * showtime in its own zone. `now` is the `DTSTAMP`.
 */
export function ticketCalendar(details: TicketDetails, now: Date): string {
  const seats = details.seats.map((seat) => seat.label).join(', ');
  const location = [
    details.theaterName,
    details.theaterAddress,
    details.theaterDistrict,
    details.theaterCity,
  ].join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maqady//Tickets//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${details.reference}@${CALENDAR_UID_DOMAIN}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(details.startsAt)}`,
    `DTEND:${utcStamp(details.endsAt)}`,
    `SUMMARY:${escapeText(`${details.movieTitle} · ${details.theaterName}`)}`,
    `LOCATION:${escapeText(location)}`,
    `DESCRIPTION:${escapeText(
      `Booking ${details.reference}. ${details.hallName}. Seats ${seats}. Admits ${details.admits}. Show the ticket QR code at the entrance.`,
    )}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** An instant as an RFC 5545 UTC date-time: `20261011T163000Z`. */
export function utcStamp(instant: Date): string {
  return instant
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line into lines of at most 75 octets (RFC 5545 §3.1): each continuation
 * starts with one space, which counts. A UTF-8 character is never split across lines.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}
