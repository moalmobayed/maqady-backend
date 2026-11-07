import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import {
  AUDIT_ACTION_PATTERN,
  AUDIT_ENTITY_TYPE_PATTERN,
  MAX_ACTION_LENGTH,
  MAX_ENTITY_TYPE_LENGTH,
} from '../../../common/audit/audit.constants';
import { ACTOR_KINDS } from '../../../common/audit/enums';
import type { ActorKind } from '../../../common/audit/types';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import { IsCinemaDate } from '../../showtimes/dto/showtime.validators';

/** The item types the dashboard records today, for the filter's description. */
const KNOWN_ENTITY_TYPES =
  '`booking`, `payment`, `showtime`, `movie`, `movie_photo`, `movie_video`, `person`, `theater`, `theater_photo`, `theater_special_date`, `hall`, `customer`, `staff_user`, `session`, `export`';

/**
 * `GET /admin/activity?staffUserId=&actorKind=&entityType=&entityId=&action=&dateFrom=&dateTo=&cursor=&limit=`
 * (PRD "Activity log": "filterable by staff member, item type and date"). Every filter is
 * optional and they combine (AND).
 */
export class ActivityQuery extends PageQuery {
  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 7,
    description:
      'Only what this staff member did (their id, from `GET /admin/staff`). An unknown id simply has no events.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  staffUserId?: number;

  @ApiPropertyOptional({
    enum: ACTOR_KINDS,
    enumName: 'ActorKind',
    nullable: false,
    example: 'staff',
    description:
      'Only events by `staff` (the dashboard), `customer` (the website) or `system` (settlement, guests).',
  })
  @IsOptional()
  @IsIn(ACTOR_KINDS)
  actorKind?: ActorKind;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    maxLength: MAX_ENTITY_TYPE_LENGTH,
    pattern: AUDIT_ENTITY_TYPE_PATTERN.source,
    example: 'booking',
    description: `Only events about this item type, a lower-case name: ${KNOWN_ENTITY_TYPES}. A type nothing records has no events.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ENTITY_TYPE_LENGTH)
  @Matches(AUDIT_ENTITY_TYPE_PATTERN, {
    message: 'entityType must be a lower-case name such as booking',
  })
  entityType?: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 81,
    description:
      "With `entityType` only: one item's activity (for example `entityType=showtime&entityId=81`). Without `entityType`: `VALIDATION_FAILED`.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  entityId?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    maxLength: MAX_ACTION_LENGTH,
    pattern: AUDIT_ACTION_PATTERN.source,
    example: 'booking.refunded',
    description: 'Only this action, `noun.verb` as events name it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ACTION_LENGTH)
  @Matches(AUDIT_ACTION_PATTERN, { message: 'action must look like noun.verb' })
  action?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Events on or after this cinema date (`YYYY-MM-DD`; a cinema day runs from 06:00 to 06:00 Cairo time).',
  })
  @IsOptional()
  @IsCinemaDate()
  dateFrom?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    nullable: false,
    example: '2026-10-16',
    description:
      'Events on or before this cinema date (inclusive: until 06:00 the next morning). Not before `dateFrom`.',
  })
  @IsOptional()
  @IsCinemaDate()
  dateTo?: string;
}
