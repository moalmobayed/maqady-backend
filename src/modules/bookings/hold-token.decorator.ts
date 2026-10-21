import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { HOLD_TOKEN_HEADER_NAME } from './bookings.constants';

/**
 * The `X-Hold-Token` request header (a guest's hold code, design §10.4), or undefined when it is
 * absent, empty or sent twice. Its format is checked where it is compared: a malformed code
 * simply matches no hold.
 */
export const HoldToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const value = context.switchToHttp().getRequest<Request>().headers[HOLD_TOKEN_HEADER_NAME];
    return typeof value === 'string' && value !== '' ? value : undefined;
  },
);
