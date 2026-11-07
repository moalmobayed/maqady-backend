import { tabPredicate } from '../../../../src/modules/bookings/my-bookings.sql';

const NOW = new Date('2026-10-16T19:00:00+03:00');
const ALIASES = { booking: 'b', showtime: 's' };

describe('My Bookings tab predicates (PRD C10, design 7.4)', () => {
  it('Upcoming is a confirmed booking whose showtime has not ended', () => {
    expect(tabPredicate('upcoming', ALIASES, NOW)).toEqual({
      sql: "(b.status = 'confirmed' AND s.ends_at > ?)",
      bindings: [NOW],
    });
  });

  it('Past is Completed, Refunded or Failed, binding now once per timed condition', () => {
    expect(tabPredicate('past', ALIASES, NOW)).toEqual({
      sql:
        "((b.status = 'confirmed' AND s.ends_at <= ?) OR (b.status = 'refunded') OR " +
        "(b.status = 'held' AND b.hold_expires_at <= ? AND b.has_declined_payment))",
      bindings: [NOW, NOW],
    });
  });

  it('never matches a live hold or an abandoned one', () => {
    for (const tab of ['upcoming', 'past'] as const) {
      const { sql } = tabPredicate(tab, ALIASES, NOW);
      expect(sql).not.toContain('hold_expires_at > ?');
      expect(sql).not.toContain('NOT b.has_declined_payment');
    }
  });
});
