import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Matches, ValidateNested } from 'class-validator';
import { MAX_PHONES, PHONE_NUMBER_PATTERN, TEXT_LIMITS } from '../theaters.constants';
import { HasLength, Trim } from './validators';

/** One labelled phone number. */
export class PhoneRequest {
  @ApiProperty({
    type: String,
    nullable: false,
    minLength: TEXT_LIMITS.phoneLabel.min,
    maxLength: TEXT_LIMITS.phoneLabel.max,
    example: 'Box office',
    description:
      'What the number is for: Main line, Box office, WhatsApp, Cinema manager. Trimmed.',
  })
  @Trim()
  @IsString()
  @HasLength(TEXT_LIMITS.phoneLabel.min, TEXT_LIMITS.phoneLabel.max)
  label!: string;

  @ApiProperty({
    type: String,
    nullable: false,
    pattern: PHONE_NUMBER_PATTERN.source,
    example: '+20227351100',
    description: 'E.164: `+`, the country code and the number, digits only.',
  })
  @IsString()
  @Matches(PHONE_NUMBER_PATTERN, {
    message: 'number must be in E.164 format, such as +20227351100',
  })
  number!: string;
}

/** `PUT /admin/theaters/{id}/phones`: the whole list. */
export class ReplacePhonesRequest {
  @ApiProperty({
    type: () => [PhoneRequest],
    maxItems: MAX_PHONES,
    description: `Up to ${MAX_PHONES} phones, in display order; the first is the main phone shown on cards. Empty removes every phone.`,
  })
  @IsArray()
  @ArrayMaxSize(MAX_PHONES)
  @ValidateNested({ each: true })
  @Type(() => PhoneRequest)
  phones!: PhoneRequest[];
}
