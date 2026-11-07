import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength, NotContains } from 'class-validator';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '../search.constants';

/** `GET /search?q=` and `GET /admin/search?q=`: what was typed in the search box. */
export class SearchQuery {
  @ApiProperty({
    type: String,
    nullable: false,
    required: true,
    minLength: SEARCH_MIN_LENGTH,
    maxLength: SEARCH_MAX_LENGTH,
    example: 'Incepton',
    description: `What to look for, ${SEARCH_MIN_LENGTH} to ${SEARCH_MAX_LENGTH} characters after the surrounding spaces are dropped. Case-insensitive: part of a word matches anywhere (\`%\` and \`_\` are plain characters), and from 3 characters a name or title with a typo matches too.`,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(SEARCH_MIN_LENGTH)
  @MaxLength(SEARCH_MAX_LENGTH)
  @NotContains('\u0000', { message: 'q must not contain a NUL character' })
  q!: string;
}
