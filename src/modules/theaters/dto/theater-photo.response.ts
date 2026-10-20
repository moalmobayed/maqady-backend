import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';

/** One gallery photo. */
export class TheaterPhotoResponse {
  @ApiProperty({ type: 'integer', example: 12, description: 'Photo id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'The lobby',
    description: 'Caption, or null.',
  })
  caption!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 0,
    description: 'Place in the gallery, from 0; positions run without gaps.',
  })
  position!: number;

  @ApiProperty({
    type: () => ImageResponse,
    description:
      'The photo in web sizes; its alternative text is the caption, else the theater name.',
  })
  image!: ImageResponse;
}
