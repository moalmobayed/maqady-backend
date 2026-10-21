import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_CURSOR_LENGTH, MAX_PAGE_SIZE } from '../pagination.constants';

/**
 * `?cursor=&limit=` on every list endpoint (design §11). A list's query DTO extends this class
 * and adds its own filters.
 */
export class PageQuery {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    maxLength: MAX_CURSOR_LENGTH,
    example: 'WyIyMDI2LTEwLTE2VDE5OjMwOjAwKzAzOjAwIiw0Ml0',
    description:
      'Opaque. Omit for the first page; then pass `nextCursor` from the previous page unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'cursor is not valid; pass nextCursor from the previous page',
  })
  cursor?: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    example: DEFAULT_PAGE_SIZE,
    description: `Items per page, 1 to ${MAX_PAGE_SIZE}. Default ${DEFAULT_PAGE_SIZE}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
