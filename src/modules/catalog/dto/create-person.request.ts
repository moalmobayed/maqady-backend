import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { TEXT_LIMITS } from '../catalog.constants';
import { Trim } from './catalog.validators';
import { PersonDetailsFields } from './person-fields';

/** `POST /admin/people`. Only the name is required. */
export class CreatePersonRequest extends PersonDetailsFields {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.fullName,
    example: 'Karim Fahmy',
    description: 'Full name, 1 to 120 characters after trimming.',
  })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.fullName)
  fullName!: string;
}
