import { Clock } from '../../src/common/time/clock';
import { addToInstant } from '../../src/common/time/time';
import type { InstantDuration } from '../../src/common/time/types';

/**
 * A clock the test moves by hand (design §14.6): expiry and summer-time rules are tested by
 * setting or advancing it, never by sleeping. It starts at the real time unless told otherwise.
 */
export class TestClock extends Clock {
  private current: Date;

  constructor(start: Date = new Date()) {
    super();
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(instant: Date): void {
    this.current = new Date(instant.getTime());
  }

  advance(duration: InstantDuration): void {
    this.current = addToInstant(this.current, duration);
  }
}
