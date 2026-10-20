import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_MOVIE_VIDEOS, MAX_VIDEO_DURATION_SECONDS, TEXT_LIMITS } from '../catalog.constants';
import { VIDEO_KINDS } from '../enums';
import type { VideoKind } from '../types';
import { noneSent, OptionalNotNull, Trim } from './catalog.validators';

const UPDATE_VIDEO_FIELDS = ['title', 'kind', 'durationSeconds', 'position'] as const;

/**
 * `PATCH /admin/movies/{id}/videos/{videoId}`: title, type, length or place; at least one. The
 * link itself can't change: delete the video and add the new one.
 */
export class UpdateMovieVideoRequest {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.videoTitle,
    example: 'Official trailer 2',
    description: 'Title shown to customers, 1 to 120 characters.',
  })
  @ValidateIf(
    (body: UpdateMovieVideoRequest) =>
      body.title !== undefined || noneSent(body, UPDATE_VIDEO_FIELDS),
  )
  @IsDefined({ message: 'send title, kind, durationSeconds or position' })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.videoTitle)
  title?: string;

  @ApiPropertyOptional({
    enum: VIDEO_KINDS,
    enumName: 'VideoKind',
    example: 'teaser',
    description: 'Trailer, Teaser, Clip or Featurette.',
  })
  @OptionalNotNull()
  @IsIn(VIDEO_KINDS)
  kind?: VideoKind;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: MAX_VIDEO_DURATION_SECONDS,
    example: 140,
    description: 'Length in seconds, or null when unknown.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_DURATION_SECONDS)
  durationSeconds?: number | null;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    maximum: MAX_MOVIE_VIDEOS - 1,
    example: 0,
    description:
      'Moves the video to this place in the list (0 is first); past the end means last. The others keep their order.',
  })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(MAX_MOVIE_VIDEOS - 1)
  position?: number;
}
