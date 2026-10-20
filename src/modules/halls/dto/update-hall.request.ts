import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsIn, IsString, ValidateIf } from 'class-validator';
import { HasLength, Trim } from '../../theaters/dto/validators';
import { HALL_STATUSES } from '../enums';
import { HALL_NAME_LIMITS } from '../halls.constants';
import type { HallStatus } from '../types';

const NOTHING_TO_CHANGE = 'send at least one field to change';

/** A field that may be left out but not set to null. */
const sent = (_: object, value: unknown): boolean => value !== undefined;

/**
 * `PATCH /admin/halls/{id}`: a new name, a new status, or both (the name applies first, in one
 * transaction). At least one field.
 */
export class UpdateHallRequest {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: HALL_NAME_LIMITS.min,
    maxLength: HALL_NAME_LIMITS.max,
    example: 'Hall 3',
    description:
      "Unique among the theater's halls, ignoring letter case (`CONFLICT` when taken). A retired hall can still be renamed. Trimmed.",
  })
  // Validated when sent, and when nothing at all is sent, so an empty body names a field.
  @ValidateIf((body: UpdateHallRequest) =>
    body.status === undefined ? true : body.name !== undefined,
  )
  @IsDefined({ message: NOTHING_TO_CHANGE })
  @Trim()
  @IsString()
  @HasLength(HALL_NAME_LIMITS.min, HALL_NAME_LIMITS.max)
  name?: string;

  @ApiPropertyOptional({
    enum: HALL_STATUSES,
    enumName: 'HallStatus',
    nullable: false,
    example: 'active',
    description:
      '`active` makes a draft hall schedulable and counts for publishing its theater. `retired` hides a draft or active hall from scheduling and keeps it for history; it needs no upcoming showtimes (`HALL_NOT_RETIRABLE`) and is final. Any other change is `CONFLICT`.',
  })
  @ValidateIf(sent)
  @IsIn(HALL_STATUSES)
  status?: HallStatus;
}
