import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsString, Length, ValidateIf } from 'class-validator';
import { TEXT_LIMITS } from '../catalog.constants';
import { noneSent, Trim } from './catalog.validators';
import { PersonDetailsFields } from './person-fields';

const UPDATE_PERSON_FIELDS = [
  'fullName',
  'birthDate',
  'birthPlace',
  'nationality',
  'bio',
  'instagramUrl',
  'imdbUrl',
  'websiteUrl',
  'roles',
] as const;

/** `PATCH /admin/people/{id}`: any of the fields; absent fields stay, null clears one. */
export class UpdatePersonRequest extends PersonDetailsFields {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: TEXT_LIMITS.fullName,
    example: 'Karim Fahmy',
    description: 'Full name, 1 to 120 characters after trimming. Not nullable.',
  })
  @ValidateIf(
    (body: UpdatePersonRequest) =>
      body.fullName !== undefined || noneSent(body, UPDATE_PERSON_FIELDS),
  )
  @IsDefined({ message: 'send at least one field to change' })
  @Trim()
  @IsString()
  @Length(1, TEXT_LIMITS.fullName)
  fullName?: string;
}
