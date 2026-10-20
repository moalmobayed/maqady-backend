import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MessageTemplateRegistry } from '../../messaging/message-template.registry';
import { customerPasswordResetTemplate } from './customer-password-reset.template';
import { customerVerifyEmailTemplate } from './customer-verify-email.template';

/** Registers the customer templates with U3's registry at boot (design §13.1, deviation U3). */
@Injectable()
export class CustomerTemplatesRegistrar implements OnModuleInit {
  constructor(private readonly registry: MessageTemplateRegistry) {}

  onModuleInit(): void {
    this.registry.register(customerVerifyEmailTemplate);
    this.registry.register(customerPasswordResetTemplate);
  }
}
