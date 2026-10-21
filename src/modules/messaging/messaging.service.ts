import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.constants';
import type { AppConfig } from '../../common/config/types';
import { DataEncryptionService } from '../../common/crypto/data-encryption.service';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { storageLinks } from './links';
import { MessageTemplateRegistry } from './message-template.registry';
import { MessagesRepository } from './messages.repository';
import {
  EMAIL_RECIPIENT_PATTERN,
  MAX_EMAIL_RECIPIENT_LENGTH,
  SMS_RECIPIENT_PATTERN,
} from './messaging.constants';
import { OutboxDrainService } from './outbox-drain.service';
import { payloadAad } from './payload';
import { escapeHtml } from './simple-html';
import type {
  MessageChannel,
  MessageTemplate,
  NewMessageRow,
  PreparedMessage,
  QueuedMessage,
  QueueMessageInput,
  RenderedMessage,
  TemplateParams,
} from './types';

/**
 * The outbox's write side (design §13.1). `queue()` writes the message in the current
 * transaction, so a rolled-back change never sends anything, and asks for a drain once the
 * transaction commits. It never waits on a provider.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly transactions: TransactionRepository,
    private readonly messages: MessagesRepository,
    private readonly registry: MessageTemplateRegistry,
    private readonly encryption: DataEncryptionService,
    private readonly clock: Clock,
    private readonly drain: OutboxDrainService,
  ) {}

  /**
   * Queues one message in the open transaction (or a new one). Every problem here is a
   * programming error, `INTERNAL`: an unregistered template, a recipient the caller did not
   * validate, or a stored render that would leak a secret parameter.
   */
  async queue<P extends TemplateParams<P>>(input: QueueMessageInput<P>): Promise<QueuedMessage> {
    const prepared = this.prepare(input);
    return this.transactions.run(async () => {
      const id = await this.messages.nextId();
      await this.messages.insert(this.rowOf(prepared, id, this.clock.now()));
      await this.transactions.afterCommit(() => this.drain.requestDrain('batch'));
      return { id };
    });
  }

  /**
   * Queues several messages at once, with the same checks as `queue()`: one query reserves their
   * ids, one multi-row insert writes them, and one drain is asked for after the commit (design
   * §7.7 "never one query per booking"). Every input is checked before anything is written, so a
   * bad one queues none. Returns the ids in input order; nothing is written for an empty list.
   */
  async queueMany<P extends TemplateParams<P>>(
    inputs: readonly QueueMessageInput<P>[],
  ): Promise<readonly QueuedMessage[]> {
    const prepared = inputs.map((input) => this.prepare(input));
    if (prepared.length === 0) return [];
    return this.transactions.run(async () => {
      const ids = await this.messages.nextIds(prepared.length);
      const now = this.clock.now();
      await this.messages.insertMany(
        prepared.map((message, index) => this.rowOf(message, ids[index]!, now)),
      );
      await this.transactions.afterCommit(() => this.drain.requestDrain('batch'));
      return ids.map((id) => ({ id }));
    });
  }

  /**
   * Checks one input and renders its stored copy. Every problem here is a programming error,
   * `INTERNAL`.
   */
  private prepare<P extends TemplateParams<P>>(input: QueueMessageInput<P>): PreparedMessage {
    const { template, recipient, params, related } = input;
    if (!this.registry.isRegistered(template)) {
      throw new AppError('INTERNAL', `Message template "${template.name}" is not registered.`);
    }
    checkRecipient(template.channel, recipient);
    const stored = template.render(params, storageLinks(this.config.frontendBaseUrl));
    checkRendered(template, stored);
    checkNoSecretLeaks(template, params, stored);
    return {
      channel: template.channel,
      template: template.name,
      recipient,
      stored,
      payload: JSON.stringify(params),
      related: related ?? {},
    };
  }

  private rowOf(message: PreparedMessage, id: number, now: Date): NewMessageRow {
    return {
      id,
      channel: message.channel,
      template: message.template,
      recipient: message.recipient,
      subject: message.stored.subject ?? null,
      body_text: message.stored.text,
      body_html: message.stored.html ?? null,
      status: 'queued',
      attempts: 0,
      last_error_code: null,
      next_attempt_at: now,
      payload_ciphertext: this.encryption.encrypt(message.payload, payloadAad(id)),
      provider_message_id: null,
      sent_at: null,
      related_customer_id: message.related.customerId ?? null,
      related_staff_user_id: message.related.staffUserId ?? null,
      related_booking_id: message.related.bookingId ?? null,
      created_at: now,
      updated_at: now,
    };
  }
}

function checkRecipient(channel: MessageChannel, recipient: string): void {
  const valid =
    channel === 'email'
      ? recipient.length <= MAX_EMAIL_RECIPIENT_LENGTH && EMAIL_RECIPIENT_PATTERN.test(recipient)
      : SMS_RECIPIENT_PATTERN.test(recipient);
  if (!valid) {
    // The recipient itself is personal data, so the message only names the channel.
    throw new AppError('INTERNAL', `A message recipient is not a valid ${channel} address.`);
  }
}

function checkRendered<P extends TemplateParams<P>>(
  template: MessageTemplate<P>,
  rendered: RenderedMessage,
): void {
  const isEmail = template.channel === 'email';
  const hasEmailParts = Boolean(rendered.subject) && Boolean(rendered.html);
  const hasNoEmailParts = rendered.subject === undefined && rendered.html === undefined;
  if (rendered.text === '' || (isEmail ? !hasEmailParts : !hasNoEmailParts)) {
    throw new AppError(
      'INTERNAL',
      `Message template "${template.name}" must render ${isEmail ? 'a subject, text and HTML' : 'text only'}.`,
    );
  }
}

/**
 * A stored copy must never hold a secret parameter (design §13.1): raw, URL-encoded (as
 * `encodeURIComponent` or a query string writes it) or HTML-escaped (as `renderSimpleHtml` does).
 */
function checkNoSecretLeaks<P extends TemplateParams<P>>(
  template: MessageTemplate<P>,
  params: P,
  rendered: RenderedMessage,
): void {
  const stored = [rendered.subject ?? '', rendered.text, rendered.html ?? ''].join('\n');
  for (const name of template.secretParams) {
    const value: unknown = params[name];
    if (typeof value !== 'string' || value === '') {
      throw new AppError(
        'INTERNAL',
        `Secret parameter "${name}" of "${template.name}" must be a non-empty string.`,
      );
    }
    const forms = [
      value,
      encodeURIComponent(value),
      new URLSearchParams({ v: value }).toString().slice(2),
      escapeHtml(value),
    ];
    if (forms.some((form) => stored.includes(form))) {
      throw new AppError(
        'INTERNAL',
        `Message template "${template.name}" would store secret parameter "${name}".`,
      );
    }
  }
}
