import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `/admin/movies/{id}`. */
export class MovieIdParams {
  @ApiProperty({ type: 'integer', minimum: 1, example: 1, description: 'Movie id.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  id!: number;
}

/** `/admin/movies/{id}/photos/{photoId}`. */
export class MoviePhotoParams extends MovieIdParams {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 21,
    description: 'Photo id; a photo of another movie is `NOT_FOUND`.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  photoId!: number;
}

/** `/admin/movies/{id}/videos/{videoId}`. */
export class MovieVideoParams extends MovieIdParams {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 11,
    description: 'Video id; a video of another movie is `NOT_FOUND`.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  videoId!: number;
}
