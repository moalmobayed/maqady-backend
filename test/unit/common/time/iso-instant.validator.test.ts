import { validateSync } from 'class-validator';
import { IsIsoInstant } from '../../../../src/common/time/iso-instant.validator';

class Probe {
  @IsIsoInstant()
  at!: unknown;
}

function errorsFor(value: unknown): string[] {
  const probe = Object.assign(new Probe(), { at: value });
  return validateSync(probe).flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('IsIsoInstant', () => {
  it('accepts instants with an offset or Z, with or without milliseconds', () => {
    for (const value of [
      '2026-10-16T00:00:00+03:00',
      '2026-10-15T21:00:00Z',
      '2026-10-15T21:00:00.123Z',
      '2026-01-01T00:00:00-05:00',
    ]) {
      expect(errorsFor(value)).toEqual([]);
    }
  });

  it('refuses a bare date, a time without an offset, an impossible date and non-strings', () => {
    for (const value of [
      '2026-10-16',
      '2026-10-16T00:00:00',
      '2026-02-30T00:00:00Z',
      '2026-10-16 00:00:00Z',
      '',
      1_760_000_000_000,
      null,
    ]) {
      expect(errorsFor(value)).toEqual([
        'at must be an ISO 8601 time with its offset, such as 2026-10-16T00:00:00+03:00',
      ]);
    }
  });
});
