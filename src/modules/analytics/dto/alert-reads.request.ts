import { ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ALERT_KEY_PATTERN, MAX_ALERT_READ_KEYS } from '../analytics.constants';

/** `POST /admin/alert-reads`: mark some alerts read (one clicked), or every current one. */
@ApiSchema({ name: 'AlertReadsRequest' })
export class AlertReadsRequest {
  @ApiPropertyOptional({
    type: String,
    isArray: true,
    nullable: false,
    minItems: 1,
    maxItems: MAX_ALERT_READ_KEYS,
    example: ['failed-payments:2026-10-16:6', 'low-sales:81'],
    description: `The \`key\`s to mark read, 1 to ${MAX_ALERT_READ_KEYS}, as \`GET /admin/alerts\` gave them. Omit to mark every current alert read ("Mark all as read"). A key that is not a current alert any more is ignored.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ALERT_READ_KEYS)
  @IsString({ each: true })
  @Matches(ALERT_KEY_PATTERN, {
    each: true,
    message: 'each key must be an alert key such as low-sales:81',
  })
  keys?: string[];
}
