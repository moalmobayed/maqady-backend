import { ApiProperty } from '@nestjs/swagger';
import { PageResponseOf } from '../../../common/pagination/dto/page-response.dto';
import { ImageResponse } from '../../media/dto/image.response';
import { CREDIT_ROLES } from '../enums';
import type { CreditRole } from '../types';

/** A movie a person is known for. */
export class KnownForResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 1, description: 'Movie id.' })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: false,
    example: 'The Last Lighthouse',
    description: 'Title.',
  })
  title!: string;
}

/** A row of the admin people list (PRD A3). */
export class AdminPersonListItemResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 4, description: 'Person id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Karim Fahmy', description: 'Full name.' })
  fullName!: string;

  @ApiProperty({ type: () => ImageResponse, nullable: true, description: 'Photo, or null.' })
  photo!: ImageResponse | null;

  @ApiProperty({
    enum: CREDIT_ROLES,
    enumName: 'CreditRole',
    isArray: true,
    nullable: false,
    example: ['actor', 'director'],
    description: 'Roles set on the person and roles they are credited in, in role-list order.',
  })
  roles!: CreditRole[];

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 1984,
    description: 'Birth year, or null.',
  })
  birthYear!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Alexandria, Egypt',
    description: 'Birth place.',
  })
  birthPlace!: string | null;

  @ApiProperty({ type: 'integer', nullable: false, example: 7, description: 'How many credits.' })
  creditCount!: number;

  @ApiProperty({
    type: () => [KnownForResponse],
    nullable: false,
    maxItems: 2,
    description: 'Up to two movies, newest release first.',
  })
  knownFor!: KnownForResponse[];
}

/** `GET /admin/people`: `{ items, nextCursor, total }`. */
export const AdminPersonPage = PageResponseOf(AdminPersonListItemResponse);
