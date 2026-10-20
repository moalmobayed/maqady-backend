import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { accessOf } from './access-metadata';

/**
 * Last global guard (design §10.3): enforces the route's declared access against the principal
 * `JwtAuthGuard` resolved. Deny by default: a route without exactly one declaration is refused
 * (the boot check stops such an app from starting at all). Non-HTTP contexts pass through.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const { principal } = context.switchToHttp().getRequest<Request>();
    switch (accessOf(this.reflector, context)) {
      case 'public':
        return true;
      case 'guest':
        if (principal !== undefined && principal.kind !== 'customer') {
          throw new AppError('UNAUTHENTICATED');
        }
        return true;
      case 'customer':
        if (principal?.kind !== 'customer') throw new AppError('UNAUTHENTICATED');
        return true;
      case 'staff':
        if (principal?.kind !== 'staff') throw new AppError('UNAUTHENTICATED');
        return true;
      case 'admin':
        if (principal?.kind !== 'staff') throw new AppError('UNAUTHENTICATED');
        if (principal.role !== 'admin') throw new AppError('FORBIDDEN');
        return true;
      default:
        throw new AppError('FORBIDDEN');
    }
  }
}
