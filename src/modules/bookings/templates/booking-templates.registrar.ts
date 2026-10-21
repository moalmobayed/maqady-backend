import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MessageTemplateRegistry } from '../../messaging/message-template.registry';
import { bookingTicketsSmsTemplate } from './booking-tickets-sms.template';
import { bookingTicketsTemplate } from './booking-tickets.template';

/** Registers the booking templates with U3's registry at boot (design §13.1, deviation U3). */
@Injectable()
export class BookingTemplatesRegistrar implements OnModuleInit {
  constructor(private readonly registry: MessageTemplateRegistry) {}

  onModuleInit(): void {
    this.registry.register(bookingTicketsTemplate);
    this.registry.register(bookingTicketsSmsTemplate);
  }
}
