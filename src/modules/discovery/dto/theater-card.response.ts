import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { OpenStateResponse } from '../../theaters/dto/open-state.response';
import { TheaterPhoneResponse } from '../../theaters/dto/theater-phone.response';
import { FACILITIES } from '../../theaters/enums';
import type { Facility } from '../../theaters/types';

/** The enum options of a facility (contract `Facility`, published by U4b). */
export const FACILITY_ENUM = { enum: FACILITIES, enumName: 'Facility' } as const;

/** A theater card (contract `TheaterCard`): "Our cinemas" on the home page. */
@ApiSchema({ name: 'TheaterCard' })
export class TheaterCardResponse {
  @ApiProperty({ type: 'integer', example: 1, description: 'Theater id.' })
  id!: number;

  @ApiProperty({ type: String, example: 'Maqady Zamalek', description: 'Name.' })
  name!: string;

  @ApiProperty({ type: String, example: 'Zamalek', description: 'District or area.' })
  district!: string;

  @ApiProperty({ type: String, example: 'Cairo', description: 'City.' })
  city!: string;

  @ApiProperty({
    type: String,
    example: '26 July Street, Zamalek',
    description: 'Street address.',
  })
  address!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Cover photo, or null when none is set',
  })
  cover!: ImageResponse | null;

  @ApiProperty({
    type: () => OpenStateResponse,
    description: 'Open now, and until when; or when it opens next.',
  })
  openState!: OpenStateResponse;

  @ApiProperty({
    type: () => TheaterPhoneResponse,
    nullable: true,
    description: 'Null when the theater hides its contacts from the website',
  })
  mainPhone!: TheaterPhoneResponse | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 6,
    description: 'How many halls the theater has open to customers (active halls).',
  })
  hallCount!: number;

  @ApiProperty({
    ...FACILITY_ENUM,
    isArray: true,
    example: ['wheelchair_access', 'valet_parking', 'cafe_bar'],
    description: "All of the theater's facilities; the design shows up to 3 on this page",
  })
  facilities!: Facility[];
}
