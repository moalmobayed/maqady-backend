import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionContext } from '../../common/database/transaction-context';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage, toPageRequest } from '../../common/pagination/cursor';
import { INVALID_CURSOR_MESSAGE } from '../../common/pagination/pagination.constants';
import type { Page, PageQueryInput } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { StaffService } from '../staff/staff.service';
import { BOOKING_ENTITY, NOTE_ADDED_ACTION } from './bookings.constants';
import { BookingNotesRepository } from './booking-notes.repository';
import { BookingsRepository } from './bookings.repository';
import type { BookingNote, BookingNoteRow, StaffRef } from './types';

/**
 * Internal notes on a booking (PRD A6 "internal notes"; design §6.2 `booking_notes`), for staff
 * only: both roles read and add them. No customer route ever reads them, and their text never
 * enters the audit log (`booking.note_added` carries no body), so the activity log and every
 * export stay free of what staff wrote.
 */
@Injectable()
export class BookingNotesService {
  constructor(
    private readonly notes: BookingNotesRepository,
    private readonly bookings: BookingsRepository,
    private readonly staff: StaffService,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRepository,
    private readonly context: TransactionContext,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/bookings/{ref}/notes`: newest first, with their authors; unknown is `NOT_FOUND`. */
  async list(reference: string, query: PageQueryInput): Promise<Page<BookingNote>> {
    const request = toPageRequest(query, 'instant');
    if (request.after !== null && request.after.sortKey === null) {
      throw new AppError('VALIDATION_FAILED', undefined, {
        fields: [{ field: 'cursor', messages: [INVALID_CURSOR_MESSAGE] }],
      });
    }
    const booking = await this.bookings.findByReference(reference);
    if (!booking) throw new AppError('NOT_FOUND');
    // One after the other: inside a transaction they would share one connection.
    const rows = await this.notes.pageOf(booking.id, request);
    const total = await this.notes.countOf(booking.id);
    const authors = await this.authorsOf(rows);
    return toPage(
      rows,
      request,
      total,
      (row) => ({ sortKey: row.created_at.toISOString(), id: row.id }),
      (row) => toNote(row, authors),
    );
  }

  /** `POST /admin/bookings/{ref}/notes`: the note (already trimmed and checked), by this member. */
  async add(staff: StaffPrincipal, reference: string, body: string): Promise<BookingNote> {
    return this.transactions.run(async () => {
      const booking = await this.bookings.findByReference(reference);
      if (!booking) throw new AppError('NOT_FOUND');
      const row = await this.notes.insert({
        booking_id: booking.id,
        staff_user_id: staff.id,
        body,
        created_at: this.clock.now(),
      });
      await this.audit.record({
        actor: { kind: 'staff', id: staff.id },
        action: NOTE_ADDED_ACTION,
        entity: { type: BOOKING_ENTITY, id: booking.id },
        bookingId: booking.id,
        metadata: { noteId: row.id },
      });
      return toNote(row, await this.authorsOf([row]));
    });
  }

  /**
   * Deletes the notes on a customer's bookings in the open transaction (anonymisation, U15,
   * design §21: "the internal notes on their bookings"); returns how many went.
   */
  async deleteForCustomer(customerId: number): Promise<number> {
    if (!this.context.isActive()) {
      throw new AppError('INTERNAL', 'Notes are deleted inside a transaction.');
    }
    return this.notes.deleteForCustomer(customerId);
  }

  private async authorsOf(rows: readonly BookingNoteRow[]): Promise<ReadonlyMap<number, StaffRef>> {
    const members = await this.staff.findByIds(rows.map((row) => row.staff_user_id));
    return new Map(
      [...members.values()].map((member) => [
        member.id,
        { id: member.id, fullName: member.fullName },
      ]),
    );
  }
}

function toNote(row: BookingNoteRow, authors: ReadonlyMap<number, StaffRef>): BookingNote {
  return {
    id: row.id,
    body: row.body,
    author: authors.get(row.staff_user_id) ?? null,
    createdAt: row.created_at,
  };
}
