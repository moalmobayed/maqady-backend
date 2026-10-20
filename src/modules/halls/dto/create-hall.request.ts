import { ApiProperty } from '@nestjs/swagger';
import { IsString, NotContains } from 'class-validator';
import { HasLength, Trim } from '../../theaters/dto/validators';
import { HALL_NAME_LIMITS } from '../halls.constants';

/** `POST /admin/theaters/{id}/halls`: a new hall, created as a draft with a 12 × 16 layout. */
export class CreateHallRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: HALL_NAME_LIMITS.min,
    maxLength: HALL_NAME_LIMITS.max,
    example: 'Hall 3',
    description:
      'Shown on showtimes and tickets ("Hall 3 · 186 seats"). Unique among the theater\'s halls in any status, ignoring letter case: a taken name is `CONFLICT` (`uq_halls_theater_id_name`). Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(HALL_NAME_LIMITS.min, HALL_NAME_LIMITS.max)
  // Postgres text can't hold NUL: refused here, not a 500 from the write.
  @NotContains('\u0000', { message: 'name must not contain the NUL character' })
  name!: string;
}
