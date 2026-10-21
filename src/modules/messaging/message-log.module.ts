import { Module } from '@nestjs/common';
import { MessageLogController } from './message-log.controller';
import { MessageLogRepository } from './message-log.repository';
import { MessageLogService } from './message-log.service';

/**
 * The admin Message log (`GET /admin/messages`, design §13.1, U2b): read-only access to the
 * `messages` outbox. Kept apart from the global `MessagingModule`, which every feature needs
 * early, so `AppModule` imports it with the admin feature modules (design §21: the Message log
 * API ships with staff access).
 */
@Module({
  controllers: [MessageLogController],
  providers: [MessageLogRepository, MessageLogService],
})
export class MessageLogModule {}
