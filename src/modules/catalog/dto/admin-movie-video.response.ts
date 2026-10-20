import { ApiProperty } from '@nestjs/swagger';
import { VideoResponse } from './video.response';

/** A movie video in the admin editor: the public `Video` plus its place and role. */
export class AdminMovieVideoResponse extends VideoResponse {
  @ApiProperty({
    type: String,
    format: 'uri',
    nullable: false,
    example: 'https://www.youtube.com/watch?v=aBcDeFgHiJk',
    description: 'The video on YouTube, to open it from the editor.',
  })
  watchUrl!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 0,
    description: 'Place in the list, 0 first.',
  })
  position!: number;

  @ApiProperty({
    type: Boolean,
    nullable: false,
    example: true,
    description: "True when this video is the movie's home hero video.",
  })
  isHero!: boolean;
}
