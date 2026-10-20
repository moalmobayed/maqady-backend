import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { YOUTUBE_ID_PATTERN } from '../catalog.constants';
import { VIDEO_KINDS } from '../enums';
import type { MovieVideo, VideoKind } from '../types';
import { youtubeEmbedUrl, youtubeThumbnailUrl } from '../youtube';

/** A movie's YouTube video (home-page contract `Video`). U8 reuses it in the public responses. */
@ApiSchema({ name: 'Video' })
export class VideoResponse {
  @ApiProperty({ type: 'integer', description: 'Video id.', example: 11 })
  id!: number;

  @ApiProperty({
    type: String,
    pattern: YOUTUBE_ID_PATTERN.source,
    description: 'The YouTube video id.',
    example: 'aBcDeFgHiJk',
  })
  youtubeId!: string;

  @ApiProperty({
    type: String,
    description: 'Title shown to customers.',
    example: 'Official trailer',
  })
  title!: string;

  @ApiProperty({
    enum: VIDEO_KINDS,
    enumName: 'VideoKind',
    description: 'Trailer, Teaser, Clip or Featurette.',
    example: 'trailer',
  })
  kind!: VideoKind;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: 'Typed by an admin; null when unknown',
    example: 134,
  })
  durationSeconds!: number | null;

  @ApiProperty({
    type: String,
    format: 'uri',
    description:
      'Privacy-enhanced embed URL. For the muted, looping carousel, add `?autoplay=1&mute=1&loop=1&playlist=<youtubeId>&controls=0` or use the YouTube IFrame API.',
    example: 'https://www.youtube-nocookie.com/embed/aBcDeFgHiJk',
  })
  embedUrl!: string;

  @ApiProperty({
    type: String,
    format: 'uri',
    description: "The video's thumbnail on YouTube's image host.",
    example: 'https://i.ytimg.com/vi/aBcDeFgHiJk/hqdefault.jpg',
  })
  thumbnailUrl!: string;
}

/** The `Video` of a stored video: the embed and thumbnail URLs derived from its id. */
export function toVideoResponse(video: MovieVideo): VideoResponse {
  return Object.assign(new VideoResponse(), videoFields(video));
}

export function videoFields(video: MovieVideo) {
  return {
    id: video.id,
    youtubeId: video.youtubeId,
    title: video.title,
    kind: video.kind,
    durationSeconds: video.durationSeconds,
    embedUrl: youtubeEmbedUrl(video.youtubeId),
    thumbnailUrl: youtubeThumbnailUrl(video.youtubeId),
  };
}
