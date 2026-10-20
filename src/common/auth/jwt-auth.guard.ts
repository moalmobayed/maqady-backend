import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { accessOf } from './access-metadata';
import { AccessTokenService } from './access-token.service';
import { AUDIENCE_OF_ACCESS, BEARER_PATTERN } from './auth.constants';
import { PrincipalResolverRegistry } from './principal-resolver.registry';

/**
 * First global guard (design §10.3): verifies the bearer token for the audience the route's
 * access implies, then loads the principal through that audience's resolver and puts it on
 * `request.principal`. Public routes ignore any token; guest routes accept none. Other contexts
 * (the WebSocket gateway) pass through: the gateway enforces its own rules.
 *
 * A route with no access declaration gets no principal here, and `AccessGuard` refuses it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly resolvers: PrincipalResolverRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const access = accessOf(this.reflector, context);
    const audience = access === undefined ? null : AUDIENCE_OF_ACCESS[access];
    if (audience === null) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (header === undefined && access === 'guest') return true;

    const match = BEARER_PATTERN.exec(header ?? '');
    if (!match?.[1]) throw new AppError('UNAUTHENTICATED');

    const token = this.tokens.verify(match[1], audience);
    const resolver = this.resolvers.resolverFor(audience);
    if (!resolver) throw new AppError('UNAUTHENTICATED');

    const principal = await resolver.resolve(token);
    if (
      !principal ||
      principal.kind !== audience ||
      principal.id !== token.subjectId ||
      principal.sessionId !== token.sessionId
    ) {
      throw new AppError('UNAUTHENTICATED');
    }
    request.principal = principal;
    return true;
  }
}
