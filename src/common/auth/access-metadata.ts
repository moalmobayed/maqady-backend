import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { ACCESS_METADATA } from './auth.constants';
import type { AccessLevel } from './types';

/** The declarations on a method or a class, in the order they were applied. */
export function accessDeclarationsOf(target: object): readonly AccessLevel[] {
  return (Reflect.getOwnMetadata(ACCESS_METADATA, target) ?? []) as AccessLevel[];
}

/**
 * The access a request's route declares: the method's, else the controller's. Undefined when
 * the route declares none, which the boot check prevents and the guards treat as "deny".
 */
export function accessOf(reflector: Reflector, context: ExecutionContext): AccessLevel | undefined {
  const levels = reflector.getAllAndOverride<AccessLevel[] | undefined>(ACCESS_METADATA, [
    context.getHandler(),
    context.getClass(),
  ]);
  return levels?.length === 1 ? levels[0] : undefined;
}
