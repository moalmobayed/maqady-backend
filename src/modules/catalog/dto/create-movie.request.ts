import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { TEXT_LIMITS } from '../catalog.constants';
import { Trim } from './catalog.validators';
import { MovieDetailsFields } from './movie-fields';

/** `POST /admin/movies`: a new draft. Only the title is required ("Add movie"). */
export class CreateMovieRequest extends MovieDetailsFields {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.title,
    example: 'The Last Lighthouse',
    description: 'The title, 1 to 200 characters after trimming.',
  })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.title)
  title!: string;
}
