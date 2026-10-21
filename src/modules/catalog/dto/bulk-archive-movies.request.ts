import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
} from 'class-validator';
import { MAX_BULK_ARCHIVE } from '../catalog.constants';

const BULK_STATUSES = ['archived'] as const;

/** `PATCH /admin/movies`: archive the movies selected in the list, all or nothing. */
export class BulkArchiveMoviesRequest {
  @ApiProperty({
    type: 'integer',
    isArray: true,
    minItems: 1,
    maxItems: MAX_BULK_ARCHIVE,
    uniqueItems: true,
    example: [12, 14],
    description: '1 to 100 movie ids, each once.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_ARCHIVE)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(Number.MAX_SAFE_INTEGER, { each: true })
  movieIds!: number[];

  @ApiProperty({
    enum: BULK_STATUSES,
    example: 'archived',
    description: 'The only bulk change: `archived`.',
  })
  @IsIn(BULK_STATUSES)
  status!: 'archived';
}
