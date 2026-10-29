import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { REFERENCE_PATTERN, SCAN_CODE_MAX_LENGTH } from '../bookings.constants';
import { OnlyWhen } from './counter.validators';

/** Why a scan names no ticket, or two: one reason, so the scanner shows one line. */
function presentedProblem(body: ScanRequest): string | null {
  const code = body.code !== undefined;
  const reference = body.reference !== undefined;
  if (code && reference) return 'send code or reference, not both';
  if (!code && !reference) return 'send code (the scanned QR code) or reference (typed by hand)';
  return null;
}

/** Why a `code` is refused, or null when it is fine (absent is fine when `reference` is sent). */
function codeProblem(value: unknown, body: ScanRequest): string | null {
  const presented = presentedProblem(body);
  if (presented !== null) return presented;
  if (value === undefined) return null;
  if (typeof value !== 'string') return 'code must be the scanned text';
  if (value.length === 0) return 'code must not be empty';
  if (value.length > SCAN_CODE_MAX_LENGTH) {
    return `code must be at most ${SCAN_CODE_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * Exactly one of `code` and `reference` (reported on `code`), and a `code` that is scanned text:
 * one check with one message, so the scanner shows one line.
 */
function IsPresentedCode(): PropertyDecorator {
  return ValidateBy({
    name: 'isPresentedCode',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) =>
        codeProblem(value, args?.object as ScanRequest) === null,
      defaultMessage: (args?: ValidationArguments) =>
        codeProblem(args?.value, args?.object as ScanRequest) ?? 'send code or reference',
    },
  });
}

/**
 * `POST /admin/scans` (design §7.9; PRD "Scan tickets"): the theater the scanner stands in, and
 * the ticket presented: the QR code as the camera read it, or the reference typed by hand.
 */
@ApiSchema({ name: 'Scan' })
export class ScanRequest {
  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    example: 3,
    description:
      'The theater the entrance belongs to, chosen on the scanner screen. An unknown theater is `NOT_FOUND`.',
  })
  @IsInt({ message: 'theaterId must be a positive integer' })
  @Min(1, { message: 'theaterId must be a positive integer' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'theaterId must be a positive integer' })
  theaterId!: number;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    minLength: 1,
    maxLength: SCAN_CODE_MAX_LENGTH,
    example: 'MQ1.MQ-7K3P9Q.1.sV0d3l7cQ2b3n1Kx9aYp4w',
    description:
      'The text of the scanned QR code, exactly as the camera read it. Send this or `reference`, not both. Anything that is not a genuine Maqady ticket code (another QR code, a tampered or forged one) answers `200` with `result: NOT_FOUND`, never an error.',
  })
  @IsPresentedCode()
  code?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: false,
    pattern: '^\\s*[Mm][Qq]-[2-9A-HJKMNP-Za-hjkmnp-z]{6}\\s*$',
    example: 'MQ-7K3P9Q',
    description:
      'The booking reference typed by hand when the camera fails; letter case and surrounding spaces do not matter. The first request answers `CONFIRM_REQUIRED` with the booking to compare with the customer; only a second request with `confirm: true` admits it.',
  })
  @ValidateIf((body: ScanRequest) => body.reference !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString({ message: 'reference must be a booking reference such as MQ-7K3P9Q' })
  @Matches(REFERENCE_PATTERN, {
    message: 'reference must be a booking reference such as MQ-7K3P9Q',
  })
  reference?: string;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: false,
    example: true,
    description:
      'Only with `reference`: `true` on the second request, once staff compared the booking shown by `CONFIRM_REQUIRED` with the customer, admits it. Absent or `false` only shows the booking.',
  })
  @OnlyWhen<ScanRequest>(
    (body) => body.reference !== undefined,
    'confirm is sent only with reference',
  )
  @ValidateIf((body: ScanRequest) => body.confirm !== undefined)
  @IsBoolean({ message: 'confirm must be true or false' })
  confirm?: boolean;
}
