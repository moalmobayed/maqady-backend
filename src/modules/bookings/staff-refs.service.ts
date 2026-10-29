import { Injectable } from '@nestjs/common';
import { StaffService } from '../staff/staff.service';
import type { LedgerEntry } from '../payments/types';
import type { AdminLedgerEntry, StaffRef } from './types';

/**
 * Names the staff members the admin booking screens mention (U14): a counter booking's seller,
 * who scanned it, who took or paid out its money, who acted in its activity log. One query for
 * any number of them (`StaffService.findByIds()`).
 */
@Injectable()
export class StaffRefsService {
  constructor(private readonly staff: StaffService) {}

  async refsOf(ids: readonly (number | null)[]): Promise<ReadonlyMap<number, StaffRef>> {
    const wanted = ids.filter((id): id is number => id !== null);
    if (wanted.length === 0) return new Map();
    const members = await this.staff.findByIds(wanted);
    return new Map(
      [...members.values()].map((member) => [
        member.id,
        { id: member.id, fullName: member.fullName },
      ]),
    );
  }

  /** These ledger entries with the members who collected or paid them out. */
  async ledgerWithStaff(entries: readonly LedgerEntry[]): Promise<AdminLedgerEntry[]> {
    const refs = await this.refsOf(
      entries.flatMap((entry) => [entry.collectedByStaffId, entry.paidOutByStaffId]),
    );
    return entries.map((entry) => withStaff(entry, refs));
  }
}

/** A ledger entry with the members it names, from refs already read. */
export function withStaff(
  entry: LedgerEntry,
  refs: ReadonlyMap<number, StaffRef>,
): AdminLedgerEntry {
  return {
    entry,
    collectedBy:
      entry.collectedByStaffId === null ? null : (refs.get(entry.collectedByStaffId) ?? null),
    paidOutBy: entry.paidOutByStaffId === null ? null : (refs.get(entry.paidOutByStaffId) ?? null),
  };
}
