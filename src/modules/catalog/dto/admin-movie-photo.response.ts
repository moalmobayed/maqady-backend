import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { MOVIE_PHOTO_KINDS } from '../enums';
import type { MoviePhotoKind } from '../types';

/** A movie photo in the admin editor. */
export class AdminMoviePhotoResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 21, description: 'Photo id.' })
  id!: number;

  @ApiProperty({
    enum: MOVIE_PHOTO_KINDS,
    enumName: 'MoviePhotoKind',
    nullable: false,
    example: 'still',
    description: '`still` or `behind_the_scenes`.',
  })
  kind!: MoviePhotoKind;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Youssef climbs to the lamp room',
    description: 'Caption, or null.',
  })
  caption!: string | null;

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
    description: "True when this photo is the movie's backdrop.",
  })
  isBackdrop!: boolean;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: false,
    description: 'The photo in web sizes.',
  })
  image!: ImageResponse;
}
