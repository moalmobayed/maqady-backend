import { Transform } from 'class-transformer';
import { EGYPT_COUNTRY_CODE, EGYPT_LOCAL_MOBILE_PATTERN } from '../customers.constants';

/** Trims a string before validation; anything else is left for the validators to refuse. */
export function TrimString(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/**
 * The phone as stored: trimmed, and an Egyptian local mobile number (`01012345678`) rewritten as
 * E.164 (`+201012345678`). Other values pass through to the E.164 check unchanged.
 */
export function normalisePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return EGYPT_LOCAL_MOBILE_PATTERN.test(trimmed)
    ? `${EGYPT_COUNTRY_CODE}${trimmed.slice(1)}`
    : trimmed;
}

export function NormalisePhone(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => normalisePhone(value));
}
