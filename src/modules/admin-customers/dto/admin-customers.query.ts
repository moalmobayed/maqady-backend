import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, NotContains } from 'class-validator';
import { PageQuery } from '../../../common/pagination/dto/page-query.dto';
import {
  CUSTOMER_SEARCH_MAX_LENGTH,
  CUSTOMER_SEARCH_MIN_LENGTH,
  NUL_CHARACTER,
} from '../../customers/customers.constants';
import { CUSTOMER_STATUSES } from '../../customers/enums';
import type { CustomerStatus } from '../../customers/types';

/**
 * `GET /admin/customers?q=&status=&cursor=&limit=` (PRD A7 search and status filter). Both
 * filters are optional and combine (AND).
 */
export class AdminCustomersQuery extends PageQuery {
  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: CUSTOMER_SEARCH_MIN_LENGTH,
    maxLength: CUSTOMER_SEARCH_MAX_LENGTH,
    example: 'layla',
    description: `Search, ${CUSTOMER_SEARCH_MIN_LENGTH} to ${CUSTOMER_SEARCH_MAX_LENGTH} characters (surrounding spaces dropped), matched case-insensitively anywhere in the customer's name, email or phone ("Name, email or phone"). An Egyptian mobile typed locally (\`01012345678\`) also finds its stored \`+201012345678\`. \`%\` and \`_\` match only themselves.`,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(CUSTOMER_SEARCH_MIN_LENGTH)
  @MaxLength(CUSTOMER_SEARCH_MAX_LENGTH)
  @NotContains(NUL_CHARACTER, { message: 'q must not contain a NUL character' })
  q?: string;

  @ApiPropertyOptional({
    enum: CUSTOMER_STATUSES,
    enumName: 'CustomerStatus',
    nullable: false,
    example: 'blocked',
    description: 'The status radio: only `active` or only `blocked` customers. Omit for All.',
  })
  @IsOptional()
  @IsIn(CUSTOMER_STATUSES)
  status?: CustomerStatus;
}
