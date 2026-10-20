import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/theaters/{id}`. */
export class TheaterIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 1,
    description: 'Theater id.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}

/** `/admin/theaters/{id}/special-dates/{specialDateId}`. */
export class SpecialDateParams extends TheaterIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 4,
    description: "Special date id. Another theater's special date is `NOT_FOUND`.",
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  specialDateId!: number;
}

/** `/admin/theaters/{id}/photos/{photoId}`. */
export class TheaterPhotoParams extends TheaterIdParams {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 12,
    description: "Gallery photo id. Another theater's photo is `NOT_FOUND`.",
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  photoId!: number;
}
