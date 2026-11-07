import { Injectable } from '@nestjs/common';
import { DataEncryptionService } from '../crypto/data-encryption.service';
import { AppError } from '../errors/app-error';
import { Clock } from '../time/clock';
import { subtractFromInstant } from '../time/time';
import { IDEMPOTENCY_KEY_TTL_HOURS, IDEMPOTENCY_PURGE_BATCH } from './idempotency.constants';
import { IdempotencyRepository } from './idempotency.repository';
import type { IdempotencyClaim, IdempotencyKeyInput } from './types';

/**
 * Claims, replays and completes idempotency keys inside the request transaction (design §14.1).
 * Stored bodies are encrypted: a guest's response can carry their hold code.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly encryption: DataEncryptionService,
    private readonly clock: Clock,
  ) {}

  /**
   * Claims the key, or returns the stored response of the identical earlier request. A live key
   * sent with a different request is `IDEMPOTENCY_KEY_REUSED`. Purges a few expired keys too.
   */
  async claim(input: IdempotencyKeyInput): Promise<IdempotencyClaim> {
    const now = this.clock.now();
    const expiredBefore = subtractFromInstant(now, { hours: IDEMPOTENCY_KEY_TTL_HOURS });
    const id = await this.repository.claim(
      input.scope,
      input.key,
      input.requestHash,
      now,
      expiredBefore,
    );
    await this.repository.purgeExpired(expiredBefore, IDEMPOTENCY_PURGE_BATCH);
    if (id !== undefined) return { kind: 'claimed', id };

    const stored = await this.repository.find(input.scope, input.key);
    if (!stored || stored.response_status === null) {
      // The claim waited for the first request, so its row is committed and complete.
      throw new AppError('INTERNAL', 'An idempotency key has no stored response.');
    }
    if (stored.request_hash !== input.requestHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED');
    }
    const body =
      stored.response_ciphertext === null
        ? undefined
        : (JSON.parse(
            this.encryption.decrypt(stored.response_ciphertext, associatedDataOf(input)),
          ) as unknown);
    return { kind: 'replay', status: stored.response_status, body };
  }

  /**
   * Deletes every key of a scope, live or expired, in the open transaction (anonymisation of a
   * customer, `customer:<id>`, U15, design §21); returns how many went.
   */
  async deleteForScope(scope: string): Promise<number> {
    return this.repository.deleteScope(scope);
  }

  /** Stores the handler's status and JSON body, encrypted, before the transaction commits. */
  async complete(
    id: number,
    input: IdempotencyKeyInput,
    status: number,
    body: unknown,
  ): Promise<void> {
    const json = body === undefined ? undefined : JSON.stringify(body);
    const ciphertext =
      json === undefined ? null : this.encryption.encrypt(json, associatedDataOf(input));
    await this.repository.saveResponse(id, status, ciphertext);
  }
}

/** Binds a stored ciphertext to its key, so it can't be decrypted as another key's response. */
function associatedDataOf(input: IdempotencyKeyInput): string {
  return `idempotency:${input.scope}:${input.key}`;
}
