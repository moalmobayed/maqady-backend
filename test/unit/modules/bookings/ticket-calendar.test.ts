import { money } from '../../../../src/common/money/money';
import {
  escapeText,
  foldLine,
  ticketCalendar,
  utcStamp,
} from '../../../../src/modules/bookings/ticket-calendar';
import type { TicketDetails } from '../../../../src/modules/bookings/types';

const DETAILS: TicketDetails = {
  bookingId: 100,
  reference: 'MQ-7K3P9Q',
  customerId: 12,
  contactName: 'Mona Adel',
  contactEmail: 'mona@example.com',
  contactPhone: null,
  movieTitle: 'The Nile Light',
  ageRating: '12+',
  theaterName: 'Zamalek; Downtown',
  theaterAddress: '26th of July St, Zamalek',
  theaterDistrict: 'Zamalek',
  theaterCity: 'Cairo',
  hallName: 'Hall 1',
  startsAt: new Date('2026-10-16T19:30:00+03:00'),
  endsAt: new Date('2026-10-16T21:38:00+03:00'),
  cinemaDate: '2026-10-16',
  seats: [
    { label: 'F7', zone: 'middle' },
    { label: 'F8', zone: 'middle' },
  ],
  admits: 2,
  total: money(38000),
  qrCode: 'MQ1.MQ-7K3P9Q.1.AAAAAAAAAAAAAAAAAAAAAA',
};
const NOW = new Date('2026-10-10T10:00:00+03:00');

describe('the calendar file (RFC 5545)', () => {
  const ics = ticketCalendar(DETAILS, NOW);
  const lines = ics.replace(/\r\n /g, '').split('\r\n');

  it('uses CRLF only, folds nothing past 75 octets and ends with a line break', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  it('holds one event with the UID, the times in UTC, the summary, the location and the seats', () => {
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines).toEqual(
      expect.arrayContaining([
        'UID:MQ-7K3P9Q@maqady',
        'DTSTAMP:20261010T070000Z',
        'DTSTART:20261016T163000Z',
        'DTEND:20261016T183800Z',
        'SUMMARY:The Nile Light · Zamalek\\; Downtown',
        'LOCATION:Zamalek\\; Downtown\\, 26th of July St\\, Zamalek\\, Zamalek\\, Cairo',
      ]),
    );
    expect(lines.find((line) => line.startsWith('DESCRIPTION:'))).toBe(
      'DESCRIPTION:Booking MQ-7K3P9Q. Hall Hall 1. Seats F7\\, F8. Admits 2. Show the ticket QR code at the entrance.',
    );
    expect(lines.some((line) => line.includes('VTIMEZONE'))).toBe(false);
  });

  it('escapes backslashes, semicolons, commas and line breaks', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(line).split('\r\n');
    expect(folded.length).toBeGreaterThan(1);
    for (const part of folded) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(folded.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
    expect(foldLine('SHORT:line')).toBe('SHORT:line');
    expect(utcStamp(new Date('2026-03-01T00:00:00.123Z'))).toBe('20260301T000000Z');
  });
});
