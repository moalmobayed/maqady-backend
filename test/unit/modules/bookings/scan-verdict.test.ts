import { scanVerdict } from '../../../../src/modules/bookings/scan-verdict';
import type { ScanVerdictInput } from '../../../../src/modules/bookings/types';

const STARTS_AT = new Date('2026-10-16T19:30:00+03:00');
const ENDS_AT = new Date('2026-10-16T21:38:00+03:00');
const OPENS_AT = new Date('2026-10-16T18:30:00+03:00');
const AT_DOOR = new Date('2026-10-16T19:10:00+03:00');

function input(overrides: Partial<ScanVerdictInput> = {}): ScanVerdictInput {
  return {
    theaterId: 3,
    showtime: { theaterId: 3, status: 'scheduled', startsAt: STARTS_AT, endsAt: ENDS_AT },
    booking: { status: 'confirmed', qrVersion: 1, checkedInAt: null },
    presentedVersion: 1,
    via: 'qr',
    confirm: false,
    ...overrides,
  };
}

describe('scanVerdict', () => {
  it('admits a paid, unused ticket of this theater inside the window', () => {
    expect(scanVerdict(input(), AT_DOOR)).toEqual({ admit: true });
  });

  it('opens exactly 60 minutes before the start and closes exactly at the end', () => {
    expect(scanVerdict(input(), new Date(OPENS_AT.getTime() - 1))).toEqual({
      admit: false,
      result: 'WRONG_SHOWTIME',
      reason: 'not_open_yet',
    });
    expect(scanVerdict(input(), OPENS_AT)).toEqual({ admit: true });
    expect(scanVerdict(input(), new Date(ENDS_AT.getTime() - 1))).toEqual({ admit: true });
    expect(scanVerdict(input(), ENDS_AT)).toEqual({
      admit: false,
      result: 'WRONG_SHOWTIME',
      reason: 'ended',
    });
  });

  it('applies the first rule that holds, in order', () => {
    const cases: [Partial<ScanVerdictInput>, string, string | null][] = [
      [
        {
          theaterId: 4,
          showtime: { theaterId: 3, status: 'cancelled', startsAt: STARTS_AT, endsAt: ENDS_AT },
          booking: { status: 'refunded', qrVersion: 1, checkedInAt: AT_DOOR },
        },
        'WRONG_SHOWTIME',
        'other_theater',
      ],
      [
        {
          showtime: { theaterId: 3, status: 'cancelled', startsAt: STARTS_AT, endsAt: ENDS_AT },
          booking: { status: 'refunded', qrVersion: 1, checkedInAt: null },
        },
        'WRONG_SHOWTIME',
        'cancelled',
      ],
      [
        { booking: { status: 'held', qrVersion: null, checkedInAt: null }, via: 'reference' },
        'NOT_VALID',
        'not_paid',
      ],
      [
        { booking: { status: 'refunded', qrVersion: 2, checkedInAt: AT_DOOR } },
        'NOT_VALID',
        'refunded',
      ],
      [
        { booking: { status: 'confirmed', qrVersion: 2, checkedInAt: AT_DOOR } },
        'NOT_VALID',
        'replaced',
      ],
      [
        { booking: { status: 'confirmed', qrVersion: 1, checkedInAt: AT_DOOR } },
        'ALREADY_USED',
        null,
      ],
      [{ via: 'reference', presentedVersion: null, confirm: false }, 'CONFIRM_REQUIRED', null],
      [
        {
          via: 'reference',
          presentedVersion: null,
          confirm: false,
          booking: { status: 'confirmed', qrVersion: 1, checkedInAt: AT_DOOR },
        },
        'ALREADY_USED',
        null,
      ],
    ];
    for (const [overrides, result, reason] of cases) {
      expect({ overrides, verdict: scanVerdict(input(overrides), AT_DOOR) }).toEqual({
        overrides,
        verdict: { admit: false, result, reason },
      });
    }
  });

  it('tells a refunded ticket it is not valid even outside the window', () => {
    const refunded = input({ booking: { status: 'refunded', qrVersion: 1, checkedInAt: null } });
    expect(scanVerdict(refunded, new Date('2026-10-15T12:00:00+03:00'))).toMatchObject({
      result: 'NOT_VALID',
      reason: 'refunded',
    });
  });

  it('admits a typed reference only with confirm, whatever its QR version', () => {
    const typed = input({
      via: 'reference',
      presentedVersion: null,
      confirm: true,
      booking: { status: 'confirmed', qrVersion: 3, checkedInAt: null },
    });
    expect(scanVerdict(typed, AT_DOOR)).toEqual({ admit: true });
    expect(scanVerdict({ ...input(), confirm: true, presentedVersion: 1 }, AT_DOOR)).toEqual({
      admit: true,
    });
  });
});
