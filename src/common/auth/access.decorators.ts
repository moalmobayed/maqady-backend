import { applyDecorators, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Request } from 'express';
import { ACCESS_METADATA, ACCESS_OPENAPI_EXTENSION } from './auth.constants';
import type { AccessLevel, Principal } from './types';

/**
 * Records one access declaration on a route method or a controller class. Declarations are
 * appended, never overwritten, so the boot check can see a route declared twice.
 */
function declareAccess(level: AccessLevel): ClassDecorator & MethodDecorator {
  const record = (target: object): void => {
    const existing = (Reflect.getOwnMetadata(ACCESS_METADATA, target) ?? []) as AccessLevel[];
    Reflect.defineMetadata(ACCESS_METADATA, [...existing, level], target);
  };
  return applyDecorators(
    (target: object, _key?: string | symbol, descriptor?: PropertyDescriptor) => {
      record(descriptor ? (descriptor.value as object) : target);
    },
    ApiExtension(ACCESS_OPENAPI_EXTENSION, level),
  );
}

/** Anyone may call the route; a token is ignored. */
export const Public = (): ClassDecorator & MethodDecorator => declareAccess('public');

/** Anyone, optionally signed in as a customer; an invalid customer token is `UNAUTHENTICATED`. */
export const Guest = (): ClassDecorator & MethodDecorator => declareAccess('guest');

/** A signed-in customer. Owner routes declare this and check ownership in the service. */
export const Customer = (): ClassDecorator & MethodDecorator => declareAccess('customer');

/** A signed-in staff member of either role. */
export const Staff = (): ClassDecorator & MethodDecorator => declareAccess('staff');

/** A signed-in admin; box office staff get `FORBIDDEN`. */
export const Admin = (): ClassDecorator & MethodDecorator => declareAccess('admin');

/** The principal of the request, or undefined on public routes and for guests. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined =>
    context.switchToHttp().getRequest<Request>().principal,
);
