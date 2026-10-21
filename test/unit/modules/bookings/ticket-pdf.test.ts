import { money } from '../../../../src/common/money/money';
import { renderTicketPdf, winAnsiText } from '../../../../src/modules/bookings/ticket-pdf';
import type { TicketDetails } from '../../../../src/modules/bookings/types';
import { pdfRectangleCount, pdfTextRuns } from '../../../support/checkout';

const DETAILS: TicketDetails = {
  bookingId: 100,
  reference: 'MQ-7K3P9Q',
  customerId: 12,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  movieTitle: 'Café Société',
  ageRating: '16+',
  theaterName: 'المنارة Zamalek',
  theaterAddress: '26th of July St',
  theaterDistrict: 'Zamalek',
  theaterCity: 'Cairo',
  hallName: '1',
  startsAt: new Date('2026-10-16T19:30:00+03:00'),
  endsAt: new Date('2026-10-16T21:30:00+03:00'),
  cinemaDate: '2026-10-16',
  seats: [{ label: 'A1', zone: 'front' }],
  admits: 1,
  total: money(15000),
  qrCode: 'MQ1.MQ-7K3P9Q.1.Rk2xV9bQm4Tz8LpW3nYc1A',
};

describe('the PDF ticket', () => {
  it('keeps Latin-1 and WinAnsi punctuation and prints anything else as ?', () => {
    expect(winAnsiText('Café · “Société” — €5')).toBe('Café · “Société” — €5');
    expect(winAnsiText('المنارة Zamalek')).toBe('??????? Zamalek');
    expect(winAnsiText('🎬 Film')).toBe('?? Film');
  });

  it('draws the details as text and the QR code as rectangles, with its title and creation date', async () => {
    const now = new Date('2026-10-10T07:00:00Z');
    const pdf = await renderTicketPdf(DETAILS, now);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdfTextRuns(pdf).join('\n');
    for (const expected of [
      'Café Société',
      'Rated 16+',
      '??????? Zamalek',
      'Hall 1',
      'Fri 16 Oct 2026, 19:30',
      'Seats A1 (Front)',
      'Admits 1 · Total EGP 150',
      'Booking MQ-7K3P9Q',
    ]) {
      expect(text).toContain(expected);
    }
    expect(pdfRectangleCount(pdf)).toBeGreaterThan(100);
    const raw = pdf.toString('latin1');
    // pdfkit writes each info value as an object of its own: `(Maqady ticket …)`.
    expect(raw).toContain('(Maqady ticket MQ-7K3P9Q)');
    expect(raw).toContain('(D:20261010070000Z)');
  });
});
