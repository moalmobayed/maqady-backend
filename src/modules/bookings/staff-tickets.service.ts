import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { BOOKING_ENTITY, TICKET_DOWNLOADED_ACTION } from './bookings.constants';
import { BookingsRepository } from './bookings.repository';
import { TicketsService } from './tickets.service';
import type { TicketFile } from './types';

/**
 * The staff ticket download (design §7.9; PRD "Tickets and QR codes"): any booking's PDF ticket
 * while it has one, since staff read every booking (design §10.4). The PDF carries a QR code that
 * admits its booking, so each download is recorded in the activity log, in a short transaction of
 * its own (a GET runs without a request transaction, design §14.1), after the ticket was built.
 */
@Injectable()
export class StaffTicketsService {
  constructor(
    private readonly tickets: TicketsService,
    private readonly bookings: BookingsRepository,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
  ) {}

  /** `NOT_FOUND` for an unknown reference, `TICKET_NOT_AVAILABLE { status }` without a ticket. */
  async ticketPdf(staff: StaffPrincipal, reference: string): Promise<TicketFile> {
    const file = await this.tickets.ticketPdf(reference, { kind: 'staff' });
    const row = await this.bookings.findByReference(reference);
    if (row) {
      await this.transactions.run(() =>
        this.audit.record({
          actor: { kind: 'staff', id: staff.id },
          action: TICKET_DOWNLOADED_ACTION,
          entity: { type: BOOKING_ENTITY, id: row.id },
          bookingId: row.id,
          metadata: { format: 'pdf' },
        }),
      );
    }
    return file;
  }
}
