import { SetMetadata } from '@nestjs/common';
import { DRAIN_AFTER_RESPONSE_METADATA } from './messaging.constants';

/**
 * After the handler answers successfully, start a `flush` drain in the background: claim and
 * send queued messages until none are due (design §16). Used by `GET /health/ready`, so the
 * daily keep-alive ping also flushes the outbox. The response never waits for the drain.
 */
export const DrainOutboxAfterResponse = (): MethodDecorator =>
  SetMetadata(DRAIN_AFTER_RESPONSE_METADATA, true);
