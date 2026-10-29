import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { StaffRefResponse } from './admin-payment.response';

/** An internal note on a booking (PRD A6 "Internal notes: text + author · time"). Staff only. */
@ApiSchema({ name: 'BookingNote' })
export class BookingNoteResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 12, description: 'Note id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'Customer called: will arrive 10 minutes late, keep the seats.',
    description: 'What the staff member wrote.',
  })
  body!: string;

  @ApiProperty({
    type: () => StaffRefResponse,
    nullable: true,
    description: 'Who wrote it.',
  })
  author!: StaffRefResponse | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-16T19:10:00+03:00',
    description: 'When (Cairo time).',
  })
  createdAt!: string;
}

/** `GET /admin/bookings/{ref}/notes`: newest first. */
export const BookingNotePageResponse = PageResponseOf(BookingNoteResponse);
