import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { BOOKING_DISPLAY_STATUSES, SCAN_REASONS, SCAN_RESULTS } from '../enums';
import type { BookingDisplayStatus, ScanReason, ScanResult } from '../types';
import { BookingShowtimeResponse } from './booking-showtime.response';

/** The booking a scan found, as the scanner screen shows it (design §7.9). */
@ApiSchema({ name: 'ScannedBooking' })
export class ScannedBookingResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ-[2-9A-HJKMNP-Z]{6}$',
    example: 'MQ-7K3P9Q',
    description: 'Booking reference.',
  })
  reference!: string;

  @ApiProperty({
    enum: BOOKING_DISPLAY_STATUSES,
    enumName: 'BookingStatus',
    nullable: false,
    example: 'confirmed',
    description: 'The booking status now (see `Booking.status`).',
  })
  status!: BookingDisplayStatus;

  @ApiProperty({
    type: String,
    isArray: true,
    nullable: false,
    example: ['F7', 'F8', 'F9'],
    description: 'The seat labels, in seat order.',
  })
  seats!: string[];

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 8,
    example: 3,
    description: 'Number of seats on the booking.',
  })
  seatCount!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Karim Mostafa',
    description:
      'The name on the booking, to compare with the customer before confirming a typed reference; null for a walk-in.',
  })
  contactName!: string | null;

  @ApiProperty({
    type: () => BookingShowtimeResponse,
    nullable: false,
    description: "The booking's showtime: movie, theater, hall, date and time.",
  })
  showtime!: BookingShowtimeResponse;
}

/**
 * What a scan answers (design §7.9; PRD "Scan tickets"). Every ticket outcome is a `200` with a
 * `result`, never an error: the scanner screen shows each one.
 */
@ApiSchema({ name: 'ScanResult' })
export class ScanResultResponse {
  @ApiProperty({
    enum: SCAN_RESULTS,
    enumName: 'ScanResultCode',
    nullable: false,
    example: 'VALID',
    description:
      '`VALID`: admitted now, "Valid · Admits n". `ALREADY_USED`: admitted before, "Already used at 19:12" (`checkedInAt`). `WRONG_SHOWTIME`: another theater, a cancelled showtime, or outside the window (opens 60 minutes before the start, closes when the showtime ends); see `reason`. `NOT_VALID`: unpaid, refunded, or an old QR code replaced by an edit; see `reason`. `NOT_FOUND`: not a Maqady ticket, or no such reference. `CONFIRM_REQUIRED`: a typed reference; compare the booking with the customer, then send the same reference with `confirm: true`.',
  })
  result!: ScanResult;

  @ApiProperty({
    enum: SCAN_REASONS,
    enumName: 'ScanReason',
    nullable: true,
    example: null,
    description:
      'Set for `WRONG_SHOWTIME` (`other_theater`, `cancelled`, `not_open_yet`, `ended`) and `NOT_VALID` (`not_paid`, `refunded`, `replaced`); null otherwise.',
  })
  reason!: ScanReason | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 8,
    example: 3,
    description:
      'How many people the booking admits at once (one QR code admits every seat), for `VALID`, `ALREADY_USED` and `CONFIRM_REQUIRED`; null otherwise.',
  })
  admits!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:12:40+03:00',
    description:
      'When the booking was admitted (Cairo time): now for `VALID`, the first scan for `ALREADY_USED`; null otherwise.',
  })
  checkedInAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:12:40+03:00',
    description: "The server's time of this scan (Cairo time).",
  })
  scannedAt!: string;

  @ApiProperty({
    type: () => ScannedBookingResponse,
    nullable: true,
    description: 'The booking presented; null for `NOT_FOUND`.',
  })
  booking!: ScannedBookingResponse | null;
}
