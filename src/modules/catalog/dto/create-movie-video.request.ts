import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import {
  MAX_VIDEO_DURATION_SECONDS,
  MAX_YOUTUBE_URL_LENGTH,
  TEXT_LIMITS,
} from '../catalog.constants';
import { VIDEO_KINDS } from '../enums';
import type { VideoKind } from '../types';
import { IsYoutubeUrl, Trim } from './catalog.validators';

/** `POST /admin/movies/{id}/videos`: a YouTube link with its title, type and length. */
export class CreateMovieVideoRequest {
  @ApiProperty({
    type: String,
    maxLength: MAX_YOUTUBE_URL_LENGTH,
    example: 'https://youtu.be/aBcDeFgHiJk',
    description:
      'A YouTube link: `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/shorts/…` or an embed link (`youtube.com/embed/…`, `youtube-nocookie.com/embed/…`). Only the 11-character video id is kept; the video stays on YouTube and plays in its privacy-enhanced player. Anything else is `VALIDATION_FAILED` on `url` ("That doesn\'t look like a YouTube video link.").',
  })
  @Trim()
  @IsString()
  @IsYoutubeUrl()
  url!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.videoTitle,
    example: 'Official trailer',
    description: 'Title shown to customers, 1 to 120 characters.',
  })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.videoTitle)
  title!: string;

  @ApiProperty({
    enum: VIDEO_KINDS,
    enumName: 'VideoKind',
    example: 'trailer',
    description: 'Trailer, Teaser, Clip or Featurette.',
  })
  @IsIn(VIDEO_KINDS)
  kind!: VideoKind;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: MAX_VIDEO_DURATION_SECONDS,
    example: 134,
    description: 'Length in seconds, typed by the admin; optional.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_DURATION_SECONDS)
  durationSeconds?: number | null;
}
