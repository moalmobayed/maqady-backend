import { Injectable } from '@nestjs/common';
import type { PrincipalResolver, TokenAudience } from './types';

/**
 * Holds the principal resolver of each token audience. The staff module (U2) and the customer
 * module (U9) register theirs in `onModuleInit`. Until an audience has one, its routes answer
 * `UNAUTHENTICATED`: a token alone never makes a principal.
 */
@Injectable()
export class PrincipalResolverRegistry {
  private readonly resolvers = new Map<TokenAudience, PrincipalResolver>();

  register(audience: TokenAudience, resolver: PrincipalResolver): void {
    if (this.resolvers.has(audience)) {
      throw new Error(`A principal resolver for the ${audience} audience is already registered`);
    }
    this.resolvers.set(audience, resolver);
  }

  resolverFor(audience: TokenAudience): PrincipalResolver | undefined {
    return this.resolvers.get(audience);
  }
}
