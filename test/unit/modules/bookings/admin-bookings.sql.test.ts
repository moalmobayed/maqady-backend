import {
  adminBookingConditions,
  adminSearchOf,
  containsPattern,
} from '../../../../src/modules/bookings/admin-bookings.sql';

const NOW = new Date('2026-10-10T10:00:00+03:00');

describe('adminSearchOf', () => {
  it('matches a reference exactly, in any case and with spaces around it', () => {
    expect(adminSearchOf(' mq-7k3p9q ')).toEqual({ kind: 'reference', reference: 'MQ-7K3P9Q' });
  });

  it('searches anything else as a substring of the contact fields', () => {
    expect(adminSearchOf('Nadia')).toEqual({
      kind: 'contact',
      pattern: '%Nadia%',
      phonePattern: null,
    });
    // Not a valid reference (an O), so a substring search.
    expect(adminSearchOf('MQ-7K3POQ').kind).toBe('contact');
  });

  it('also searches the stored form of an Egyptian mobile typed locally', () => {
    expect(adminSearchOf('01012345678')).toEqual({
      kind: 'contact',
      pattern: '%01012345678%',
      phonePattern: '%+201012345678%',
    });
    expect(adminSearchOf('0101234567')).toMatchObject({ phonePattern: null });
  });
});

describe('containsPattern', () => {
  it('escapes the LIKE wildcards and the escape character', () => {
    expect(containsPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('adminBookingConditions', () => {
  it('adds nothing without filters', () => {
    expect(adminBookingConditions({}, NOW)).toEqual([]);
  });

  it('binds every filter value, never inlining it', () => {
    const conditions = adminBookingConditions(
      {
        q: "o'brien",
        theaterId: 3,
        movieId: 12,
        status: 'confirmed',
        channel: 'counter',
        method: 'cash',
        dateFrom: '2026-10-10',
        dateTo: '2026-10-11',
      },
      NOW,
    );
    expect(conditions.map((condition) => condition.sql)).toEqual([
      '(b.contact_name ILIKE ? OR b.contact_email::text ILIKE ? OR b.contact_phone ILIKE ?)',
      's.theater_id = ?',
      's.movie_id = ?',
      "(b.status = 'confirmed' AND s.ends_at > ?)",
      'b.channel = ?',
      "EXISTS (SELECT 1 FROM payments AS p WHERE p.booking_id = b.id AND p.kind = 'charge' AND p.purpose = 'sale' AND p.method = ?)",
      'b.created_at >= ?',
      'b.created_at < ?',
    ]);
    expect(conditions.flatMap((condition) => condition.bindings)).toEqual([
      "%o'brien%",
      "%o'brien%",
      "%o'brien%",
      3,
      12,
      NOW,
      'counter',
      'cash',
      // 06:00 Cairo time on the 10th, and 06:00 after the 11th.
      new Date('2026-10-10T06:00:00+03:00'),
      new Date('2026-10-12T06:00:00+03:00'),
    ]);
  });

  it("keeps one customer's bookings with customerId (the Customers drawer, U15)", () => {
    expect(adminBookingConditions({ customerId: 42 }, NOW)).toEqual([
      { sql: 'b.customer_id = ?', bindings: [42] },
    ]);
  });

  it('matches a reference on its own column', () => {
    expect(adminBookingConditions({ q: 'MQ-7K3P9Q' }, NOW)).toEqual([
      { sql: 'b.reference = ?', bindings: ['MQ-7K3P9Q'] },
    ]);
  });

  it('adds the E.164 phone alternative for a local mobile', () => {
    const [search] = adminBookingConditions({ q: '01012345678' }, NOW);
    expect(search?.sql).toContain('OR b.contact_phone ILIKE ?)');
    expect(search?.bindings).toHaveLength(4);
    expect(search?.bindings[3]).toBe('%+201012345678%');
  });

  it('uses the shared status predicate for the clock-derived statuses', () => {
    const [failed] = adminBookingConditions({ status: 'failed' }, NOW);
    expect(failed).toEqual({
      sql: "(b.status = 'held' AND b.hold_expires_at <= ? AND b.has_declined_payment)",
      bindings: [NOW],
    });
  });
});
