import type { Request } from 'express';
import type { ImageUploadPayload, UploadOutcome } from './types';

/**
 * What `ImageUploadInterceptor` hands to `@UploadedImage()` for one request, and how
 * `MediaService.upload()` tells the interceptor which status to answer. Kept in weak maps, so
 * nothing is added to Express's `Request` type and a finished request leaves nothing behind.
 */
const payloads = new WeakMap<Request, ImageUploadPayload>();
const outcomes = new WeakSet<object>();

export function attachUploadPayload(request: Request, payload: ImageUploadPayload): void {
  payloads.set(request, payload);
}

export function uploadPayloadOf(request: Request): ImageUploadPayload | undefined {
  return payloads.get(request);
}

/** An upload's answer, marked so the interceptor can tell it from an ordinary return value. */
export function uploadOutcome<T>(status: number, body: T, replayed: boolean): UploadOutcome<T> {
  const outcome: UploadOutcome<T> = { status, body, replayed };
  outcomes.add(outcome);
  return outcome;
}

export function isUploadOutcome(value: unknown): value is UploadOutcome<unknown> {
  return typeof value === 'object' && value !== null && outcomes.has(value);
}
