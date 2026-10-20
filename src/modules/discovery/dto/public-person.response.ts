import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { CREDIT_ROLES } from '../../catalog/enums';
import type { CreditRole } from '../../catalog/types';
import { ImageResponse } from '../../media/dto/image.response';

/** A person credited on a public movie: the Movies page cast filter. */
@ApiSchema({ name: 'PublicPerson' })
export class PublicPersonResponse {
  @ApiProperty({
    type: 'integer',
    example: 4,
    description: 'Person id; filter with `/movies?people=<id>`.',
  })
  id!: number;

  @ApiProperty({ type: String, example: 'Karim Fahmy', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({
    type: () => ImageResponse,
    nullable: true,
    description: 'Square photo, or null when none is set.',
  })
  photo!: ImageResponse | null;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    example: ['actor'],
    description: 'Their roles: set on the person and credited, in the credit role order.',
  })
  roles!: CreditRole[];
}

/** `GET /people`: one page of people. */
@ApiSchema({ name: 'PublicPersonPage' })
export class PublicPersonPageResponse {
  @ApiProperty({
    type: () => [PublicPersonResponse],
    description: 'This page, by name. Empty when nothing matches.',
  })
  items!: PublicPersonResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Pass as `cursor` to get the next page; null on the last page.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 18,
    description: 'How many people match.',
  })
  total!: number;
}
