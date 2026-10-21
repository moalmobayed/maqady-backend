import PDFDocument from 'pdfkit';
import { create as createQrCode } from 'qrcode';
import { formatMoneyDisplay } from '../../common/money/money';
import { formatCairoDisplay } from '../../common/time/time';
import type { TicketDetails } from './types';

/** A5 portrait, in PDF points. */
const PAGE_WIDTH = 419.53;
const MARGIN = 36;
const QR_SIZE = 150;
const QR_QUIET_ZONE_MODULES = 4;
const ZONE_NAMES = { front: 'Front', middle: 'Middle', back: 'Back' } as const;
const POLICY_LINE =
  "This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the showtime.";

/**
 * Characters the PDF's built-in Helvetica (WinAnsi) can draw: printable ASCII, Latin-1 and the
 * few extra WinAnsi punctuation marks. v1 data is English (PRD "Out of scope": Arabic names and
 * titles), so anything else is printed as `?` rather than as garbage.
 */
const WIN_ANSI =
  /[^\x20-\x7e\u00a0-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201a\u201c-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]/g;

/** Text as Helvetica can draw it: every other character becomes `?`. */
export function winAnsiText(value: string): string {
  return value.replace(WIN_ANSI, '?');
}

/**
 * The PDF ticket (PRD "Tickets and QR codes": movie, theater, hall, date, time, seats, reference
 * and QR code), built on demand with pdfkit (design §7.9). The QR code is drawn as one filled
 * square per dark module, from `qrcode`'s matrix, so it scans at any zoom; the document's
 * content is left uncompressed (a ticket is a few tens of KB). `now` is its creation date.
 */
export function renderTicketPdf(details: TicketDetails, now: Date): Promise<Buffer> {
  const document = new PDFDocument({
    size: 'A5',
    layout: 'portrait',
    margin: MARGIN,
    compress: false,
    info: {
      Title: `Maqady ticket ${details.reference}`,
      Author: 'Maqady',
      Subject: winAnsiText(details.movieTitle),
      CreationDate: now,
      ModDate: now,
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const width = PAGE_WIDTH - 2 * MARGIN;
  const text = (value: string, size: number, font = 'Helvetica', gap = 4): void => {
    document.font(font).fontSize(size).text(winAnsiText(value), { width });
    document.moveDown(gap / size);
  };

  text('MAQADY E-TICKET', 10, 'Helvetica-Bold', 10);
  text(details.movieTitle, 20, 'Helvetica-Bold');
  text(`Rated ${details.ageRating}`, 10, 'Helvetica', 10);
  text(details.theaterName, 13, 'Helvetica-Bold');
  text(`${details.theaterAddress}, ${details.theaterDistrict}, ${details.theaterCity}`, 10);
  text(`Hall ${details.hallName}`, 11, 'Helvetica', 10);
  text(formatCairoDisplay(details.startsAt), 13, 'Helvetica-Bold');
  text(`Cinema day ${details.cinemaDate}`, 9, 'Helvetica', 10);
  const seats = details.seats.map((seat) => `${seat.label} (${ZONE_NAMES[seat.zone]})`);
  text(`Seats ${seats.join(', ')}`, 11);
  text(
    `Admits ${details.admits} · Total ${formatMoneyDisplay(details.total)}`,
    11,
    'Helvetica',
    10,
  );
  text(`Booking ${details.reference}`, 14, 'Helvetica-Bold', 10);

  drawQrCode(document, details.qrCode, MARGIN + (width - QR_SIZE) / 2, document.y);
  document.y += QR_SIZE + 12;
  text(`Show this QR code at the entrance. It admits ${details.admits}.`, 10, 'Helvetica', 6);
  text(POLICY_LINE, 8);

  document.end();
  return done;
}

/**
 * Draws the QR code of `payload` in a `QR_SIZE` square at (`x`, `y`), quiet zone included: one
 * rectangle per dark module, filled at once. Nothing else on the page is a rectangle.
 */
function drawQrCode(document: PDFKit.PDFDocument, payload: string, x: number, y: number): void {
  const { modules } = createQrCode(payload, { errorCorrectionLevel: 'M' });
  const count = modules.size + 2 * QR_QUIET_ZONE_MODULES;
  const cell = QR_SIZE / count;
  for (let row = 0; row < modules.size; row += 1) {
    for (let column = 0; column < modules.size; column += 1) {
      if (!modules.get(row, column)) continue;
      document.rect(
        x + (column + QR_QUIET_ZONE_MODULES) * cell,
        y + (row + QR_QUIET_ZONE_MODULES) * cell,
        cell,
        cell,
      );
    }
  }
  document.fillColor('black').fill();
}
