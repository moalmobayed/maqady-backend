import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { Clock } from '../../common/time/clock';
import { MessageLogController } from './message-log.controller';
import { MessageLogRepository } from './message-log.repository';
import { MessageLogService } from './message-log.service';
import { MessageTemplateRegistry } from './message-template.registry';
import { MessagesRepository } from './messages.repository';
import { MessagingService } from './messaging.service';
import { RESEND_MIN_INTERVAL_MS } from './messaging.constants';
import { OutboxDrainInterceptor } from './outbox-drain.interceptor';
import { OutboxDrainService } from './outbox-drain.service';
import { EmailSender } from './senders/email-sender';
import { ResendEmailSender } from './senders/resend-email.sender';
import { SimulatedEmailSender } from './senders/simulated-email.sender';
import { SimulatedSmsSender } from './senders/simulated-sms.sender';
import { SmsSender } from './senders/sms-sender';

/**
 * Email and SMS through the `messages` outbox (design §13.1, ADR 0004). Global, because every
 * module that sends a message queues it here; it depends on no feature module. Templates are
 * registered by the modules that own them. `AppModule` registers `OutboxDrainInterceptor` as a
 * global interceptor. The admin Message log (`GET /admin/messages`) reads the outbox here too.
 */
@Global()
@Module({
  controllers: [MessageLogController],
  providers: [
    MessagesRepository,
    MessageLogRepository,
    MessageLogService,
    MessageTemplateRegistry,
    MessagingService,
    OutboxDrainService,
    OutboxDrainInterceptor,
    {
      provide: EmailSender,
      inject: [APP_CONFIG, Clock],
      useFactory: (config: AppConfig, clock: Clock): EmailSender =>
        config.email.driver === 'resend'
          ? new ResendEmailSender(
              {
                apiKey: config.email.apiKey,
                from: config.email.from,
                minIntervalMs: RESEND_MIN_INTERVAL_MS,
              },
              clock,
            )
          : new SimulatedEmailSender(),
    },
    { provide: SmsSender, useClass: SimulatedSmsSender },
  ],
  exports: [
    MessagingService,
    MessageTemplateRegistry,
    OutboxDrainService,
    OutboxDrainInterceptor,
    EmailSender,
    SmsSender,
  ],
})
export class MessagingModule {}
