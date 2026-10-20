import { Body, Controller, Get, HttpCode, Module, type OnModuleInit, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { Public } from '../../../src/common/auth/access.decorators';
import { AppError } from '../../../src/common/errors/app-error';
import { MessageTemplateRegistry } from '../../../src/modules/messaging/message-template.registry';
import { MessagingService } from '../../../src/modules/messaging/messaging.service';
import { oneTimeLinkTemplate, smsNoticeTemplate } from './test-templates';

/**
 * Test-only routes under `/api/v1/test-messaging`, registered by the messaging suites and never
 * by the app. Each write queues messages through the real `MessagingService` inside the request
 * transaction, the way a feature's write will, and can fail after queueing to prove a rollback
 * stores and sends nothing.
 */

export class QueueEmailsBody {
  @IsString()
  recipient!: string;

  @IsString()
  name!: string;

  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  count?: number;

  @IsOptional()
  @IsInt()
  relatedCustomerId?: number;

  /** Throw after queueing, so the request transaction rolls back. */
  @IsOptional()
  @IsBoolean()
  fail?: boolean;
}

export class QueueSmsBody {
  @IsString()
  recipient!: string;

  @IsString()
  text!: string;
}

@Public()
@Controller('test-messaging')
export class MessagingProbeController implements OnModuleInit {
  constructor(
    private readonly messaging: MessagingService,
    private readonly registry: MessageTemplateRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(oneTimeLinkTemplate);
    this.registry.register(smsNoticeTemplate);
  }

  @Post('emails')
  async queueEmails(@Body() body: QueueEmailsBody): Promise<{ ids: number[] }> {
    const ids: number[] = [];
    for (let index = 0; index < (body.count ?? 1); index += 1) {
      const { id } = await this.messaging.queue({
        template: oneTimeLinkTemplate,
        recipient: body.recipient,
        params: { name: body.name, token: body.token },
        ...(body.relatedCustomerId === undefined
          ? {}
          : { related: { customerId: body.relatedCustomerId } }),
      });
      ids.push(id);
    }
    if (body.fail) throw new AppError('CONFLICT', 'Probe failure after queueing.');
    return { ids };
  }

  @Post('sms')
  async queueSms(@Body() body: QueueSmsBody): Promise<{ id: number }> {
    return this.messaging.queue({
      template: smsNoticeTemplate,
      recipient: body.recipient,
      params: { text: body.text },
    });
  }

  /** A write that queues nothing: it only triggers the after-write drain. */
  @Post('noop')
  @HttpCode(204)
  noop(): void {}

  /** A read: it must not trigger a drain. */
  @Get('ping')
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [MessagingProbeController] })
export class MessagingProbeModule {}
