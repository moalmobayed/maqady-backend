import { ApiProperty } from '@nestjs/swagger';
import { ImageResponse } from '../../media/dto/image.response';
import { CREDIT_ROLES } from '../enums';
import type { CreditRole } from '../types';

/** The person of a credit. */
export class CreditedPersonResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 4, description: 'Person id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Karim Fahmy', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Square photo, or null when none is set.',
  })
  photo!: ImageResponse | null;
}

/** One credit of a movie's cast and crew, in display order. */
export class MovieCreditResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 31, description: 'Credit id.' })
  id!: number;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    nullable: false,
    example: 'actor',
    description: 'Actor, Voice, Director, Writer, Producer, Cinematographer or Composer.',
  })
  role!: CreditRole;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Youssef, the keeper',
    description: 'The character played (actor and voice only), or null.',
  })
  characterName!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 0,
    example: 0,
    description: 'Place in the list, 0 first.',
  })
  position!: number;

  @ApiProperty({ type: () => CreditedPersonResponse, nullable: false, description: 'Who.' })
  person!: CreditedPersonResponse;
}
