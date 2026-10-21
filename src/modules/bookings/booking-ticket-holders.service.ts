import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RegisteredTicketHolders } from '../showtimes/showtime-ticket-holder.service';
import { ShowtimeTicketHolderService } from '../showtimes/showtime-ticket-holder.service';
import type { ShowtimeTicketHolder } from '../showtimes/types';
import { BookingsRepository } from './bookings.repository';

/**
 * Who holds tickets to a showtime (U7's seam, PRD "Showtimes" 5): the contact of every confirmed
 * booking, in one query. Registered with U7's `RegisteredTicketHolders` at boot, since showtimes
 * cannot import bookings. A move holds the showtime `FOR UPDATE`, and confirmation holds it
 * `FOR SHARE`, so a move never misses a booking confirmed meanwhile.
 */
@Injectable()
export class BookingTicketHolders extends ShowtimeTicketHolderService implements OnModuleInit {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly registry: RegisteredTicketHolders,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(this);
  }

  async listTicketHolders(showtimeId: number): Promise<readonly ShowtimeTicketHolder[]> {
    const rows = await this.bookings.ticketHoldersOf(showtimeId);
    return rows.map((row) => ({
      bookingId: row.id,
      bookingReference: row.reference,
      customerId: row.customer_id,
      email: row.contact_email,
      phone: row.contact_phone,
    }));
  }
}
