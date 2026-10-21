import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { BookingResponse } from './booking.response';

/** A hold as `POST /showtimes/{id}/holds` and `POST /holds/{ref}/claims` answer it. */
@ApiSchema({ name: 'Hold' })
export class HoldResponse extends BookingResponse {
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: '^[A-Za-z0-9_-]{43}$',
    example: 'q3Jx1oV0b8m2Yc6Kp9Rz4Tn7Wd5Fh2Lg0Sa8Ue3Bi1',
    description:
      'A guest hold only: the private hold code, shown this once. Keep it for this browser session and send it as `X-Hold-Token` to read, release or claim the hold (after signing in, `POST /holds/{ref}/claims`). Null for a customer hold and after a claim.',
  })
  holdCode!: string | null;
}
