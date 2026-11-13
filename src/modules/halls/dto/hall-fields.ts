import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateBy, ValidateIf, type ValidationArguments } from 'class-validator';
import { decimalsOf } from '../../theaters/dto/validators';
import { HALL_FORMATS } from '../enums';
import { SCREEN_METERS_DECIMALS, SCREEN_METERS_LIMITS } from '../halls.constants';
import type { HallChanges, HallFormat } from '../types';

type ScreenSide = 'screenWidthMeters' | 'screenHeightMeters';

const PARTNER: Readonly<Record<ScreenSide, ScreenSide>> = {
  screenWidthMeters: 'screenHeightMeters',
  screenHeightMeters: 'screenWidthMeters',
};

/** A field that may be left out but not set to null. */
const sent = (_: object, value: unknown): boolean => value !== undefined;

/** Either side of the screen was sent, so both are judged. */
const screenSent = (body: HallSpecFields): boolean =>
  body.screenWidthMeters !== undefined || body.screenHeightMeters !== undefined;

/** Why one screen side is refused, judged with its partner; null when it is fine. */
function screenSideProblem(side: ScreenSide, body: object): string | null {
  const record = body as Record<ScreenSide, unknown>;
  const value = record[side];
  const partner = PARTNER[side];
  const other = record[partner];
  if (value === undefined) return `${side} is required with ${partner}`;
  if (value === null) {
    return other === null ? null : `${side} can be null only when ${partner} is null too`;
  }
  const { min, max } = SCREEN_METERS_LIMITS;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    decimalsOf(value) > SCREEN_METERS_DECIMALS
  ) {
    return `${side} must be a number of metres from ${min} to ${max} with at most ${SCREEN_METERS_DECIMALS} decimals`;
  }
  return null;
}

/**
 * One side of the screen, in metres: a number from 1 to 50 with at most 2 decimals, sent with
 * the other side, or null with the other side null (both or neither, `chk_halls_screen_size`).
 * The error lands on the side that is missing, null beside a number, or out of range.
 */
function IsScreenSide(side: ScreenSide): PropertyDecorator {
  return ValidateBy({
    name: 'isScreenSide',
    validator: {
      validate: (_: unknown, args?: ValidationArguments) =>
        args !== undefined && screenSideProblem(side, args.object) === null,
      defaultMessage: (args?: ValidationArguments) =>
        (args && screenSideProblem(side, args.object)) ?? `${side} is invalid`,
    },
  });
}

/**
 * The hall's projection format and screen size (#29 P4), shared by `POST
 * /admin/theaters/{id}/halls` and `PATCH /admin/halls/{id}`. The screen is typed in metres and
 * stored in whole centimetres.
 */
export class HallSpecFields {
  @ApiPropertyOptional({
    enum: HALL_FORMATS,
    enumName: 'HallFormat',
    nullable: false,
    example: 'dolby_atmos',
    description:
      'The projection format customers see on the hall and on each of its showtime chips: `standard` (Standard), `vip` (VIP), `imax` (IMAX), `dolby_atmos` (Dolby Atmos, "Atmos" on a chip), `4dx` (4DX), `screenx` (ScreenX), `max` (MAX). A label only: prices stay by seat zone. A new hall without one is `standard`; null is refused.',
  })
  @ValidateIf(sent)
  @IsIn(HALL_FORMATS)
  format?: HallFormat;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: SCREEN_METERS_LIMITS.min,
    maximum: SCREEN_METERS_LIMITS.max,
    example: 22.1,
    description:
      'Screen width in metres, 1 to 50 with at most 2 decimals; customers see "22.1m x 12.3m". Sent with `screenHeightMeters`, or both null to clear the size (the hall then shows none). One side alone, or a number beside a null, is `VALIDATION_FAILED`.',
  })
  @ValidateIf(screenSent)
  @IsScreenSide('screenWidthMeters')
  screenWidthMeters?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: SCREEN_METERS_LIMITS.min,
    maximum: SCREEN_METERS_LIMITS.max,
    example: 12.3,
    description:
      'Screen height in metres, 1 to 50 with at most 2 decimals. Sent with `screenWidthMeters`, or both null to clear the size.',
  })
  @ValidateIf(screenSent)
  @IsScreenSide('screenHeightMeters')
  screenHeightMeters?: number | null;
}

/**
 * The screen a validated request sets: nothing when neither side was sent, null when both were
 * null (the validation has made sure they go together).
 */
export function screenInput(body: HallSpecFields): Pick<HallChanges, 'screen'> {
  const { screenWidthMeters: width, screenHeightMeters: height } = body;
  if (width === undefined || height === undefined) return {};
  if (width === null || height === null) return { screen: null };
  return { screen: { widthMeters: width, heightMeters: height } };
}
