import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TEXT_LIMITS } from '../catalog.constants';
import { MOVIE_PHOTO_KINDS } from '../enums';
import type { MoviePhotoKind } from '../types';
import { TrimToNull } from './catalog.validators';

/** The text fields sent with `POST /admin/movies/{id}/photos`, beside the file. */
export class MoviePhotoFieldsRequest {
  @ApiProperty({
    enum: MOVIE_PHOTO_KINDS,
    enumName: 'MoviePhotoKind',
    example: 'still',
    description: '`still` or `behind_the_scenes`.',
  })
  @IsIn(MOVIE_PHOTO_KINDS)
  kind!: MoviePhotoKind;

  @ApiPropertyOptional({
    type: String,
    maxLength: TEXT_LIMITS.photoCaption,
    example: 'Youssef climbs to the lamp room',
    description: 'Optional caption, up to 200 characters; also the alt text.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.photoCaption)
  caption?: string | null;
}
