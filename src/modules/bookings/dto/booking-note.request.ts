import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, NotContains } from 'class-validator';
import { TrimString } from '../../customers/dto/transforms';
import { NOTE_MAX_LENGTH } from '../bookings.constants';

/** `POST /admin/bookings/{ref}/notes` (PRD A6 "Add a note for staff"). */
@ApiSchema({ name: 'CreateBookingNote' })
export class CreateBookingNoteRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: NOTE_MAX_LENGTH,
    example: 'Customer called: will arrive 10 minutes late, keep the seats.',
    description: `The note, 1 to ${NOTE_MAX_LENGTH} characters; surrounding spaces are dropped. Staff only: customers never see notes.`,
  })
  @TrimString()
  @IsString()
  @MinLength(1, { message: 'body must not be empty' })
  @MaxLength(NOTE_MAX_LENGTH)
  @NotContains('\u0000', { message: 'body must not contain a NUL character' })
  body!: string;
}
