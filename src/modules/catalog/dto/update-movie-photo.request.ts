import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_MOVIE_PHOTOS, TEXT_LIMITS } from '../catalog.constants';
import { MOVIE_PHOTO_KINDS } from '../enums';
import type { MoviePhotoKind } from '../types';
import { noneSent, OptionalNotNull, TrimToNull } from './catalog.validators';

const UPDATE_PHOTO_FIELDS = ['kind', 'caption', 'position'] as const;

/** `PATCH /admin/movies/{id}/photos/{photoId}`: type, caption or place; at least one. */
export class UpdateMoviePhotoRequest {
  @ApiPropertyOptional({
    enum: MOVIE_PHOTO_KINDS,
    enumName: 'MoviePhotoKind',
    example: 'behind_the_scenes',
    description: '`still` or `behind_the_scenes`.',
  })
  @ValidateIf(
    (body: UpdateMoviePhotoRequest) =>
      body.kind !== undefined || noneSent(body, UPDATE_PHOTO_FIELDS),
  )
  @IsDefined({ message: 'send kind, caption or position' })
  @IsIn(MOVIE_PHOTO_KINDS)
  kind?: MoviePhotoKind;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: TEXT_LIMITS.photoCaption,
    example: 'On set in Hurghada',
    description: 'The caption, or null to remove it.',
  })
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMITS.photoCaption)
  caption?: string | null;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: MAX_MOVIE_PHOTOS - 1,
    example: 0,
    description:
      'Moves the photo to this place in the list (0 is first); past the end means last. The others keep their order.',
  })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(MAX_MOVIE_PHOTOS - 1)
  position?: number;
}
