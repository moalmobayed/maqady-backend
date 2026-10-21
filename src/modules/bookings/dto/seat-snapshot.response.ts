import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { SEAT_STATES } from '../../seating/enums';
import type { SeatState } from '../../seating/types';

/** A seat someone holds or bought. Seats not listed are free. */
@ApiSchema({ name: 'TakenSeat' })
export class TakenSeatResponse {
  @ApiProperty({ type: String, nullable: false, example: 'F7', description: 'Seat label.' })
  label!: string;

  @ApiProperty({
    enum: SEAT_STATES,
    enumName: 'TakenSeatState',
    nullable: false,
    example: 'held',
    description: '`held`: on a live hold ("Temporarily unavailable"); `booked`: sold.',
  })
  state!: SeatState;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T19:05:00+03:00',
    description:
      'When the hold ends (Cairo time); the seat is free from then on, without any message. Null for a booked seat.',
  })
  heldUntil!: string | null;
}

/**
 * The taken seats of a showtime now (design §7.2, §12). The same snapshot opens a `/ws`
 * subscription, which then pushes `seat.held`, `seat.released` and `seat.booked`.
 */
@ApiSchema({ name: 'SeatSnapshot' })
export class SeatSnapshotResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 81, description: 'Showtime id.' })
  showtimeId!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:00:12+03:00',
    description:
      "The server's time when the snapshot was read, to correct the client's clock against `heldUntil`.",
  })
  serverTime!: string;

  @ApiProperty({
    type: () => TakenSeatResponse,
    isArray: true,
    nullable: false,
    description: 'Every seat held or sold right now, by label. Holds that ended are not listed.',
  })
  seats!: TakenSeatResponse[];

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 184,
    description: 'Seats that can be picked right now: the seat capacity minus the taken seats.',
  })
  availableCount!: number;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: false,
    description:
      'True when every seat is held or sold right now ("Sold out"); it can flip back when a hold ends.',
  })
  soldOut!: boolean;
}
