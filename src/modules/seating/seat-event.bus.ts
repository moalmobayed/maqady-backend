import { Injectable, Logger } from '@nestjs/common';
import type { SeatEvent, SeatEventListener } from './types';

/**
 * The in-process seat event bus (design §12): one instance, so fan-out is a loop over the
 * listeners. Publish only through `SeatEventPublisher`, which waits for the commit. A listener
 * that throws is logged and does not stop the others.
 */
@Injectable()
export class SeatEventBus {
  private readonly logger = new Logger(SeatEventBus.name);
  private readonly listeners = new Set<SeatEventListener>();

  subscribe(listener: SeatEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: SeatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error({ err: error, event: event.type }, 'A seat event listener failed');
      }
    }
  }
}
