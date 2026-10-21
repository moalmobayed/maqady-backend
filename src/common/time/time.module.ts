import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';

/** Provides the `Clock` everywhere. Tests override it with `overrideProvider(Clock)`. */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class TimeModule {}
