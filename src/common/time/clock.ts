import { Injectable } from '@nestjs/common';

/**
 * "Now", for services and queries (design §14.6). Inject `Clock` and call `now()`; never call
 * `new Date()` or SQL `now()` for a value that decides correctness. Tests replace the provider
 * to move time, which is how expiry and summer-time rules are tested without sleeping.
 */
export abstract class Clock {
  abstract now(): Date;
}

/** The real clock. */
@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
