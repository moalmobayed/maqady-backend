import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AccessDeclarationCheck } from './access-declaration.check';
import { AccessGuard } from './access.guard';
import { AccessTokenService } from './access-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrincipalResolverRegistry } from './principal-resolver.registry';

/**
 * Access control shared by every module (design §10.3). The guards are registered globally as
 * `APP_GUARD` by `AppModule`, in the order `JwtAuthGuard`, `RateLimitGuard`, `AccessGuard`.
 * Feature modules register their principal resolver with `PrincipalResolverRegistry`.
 */
@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    AccessTokenService,
    PrincipalResolverRegistry,
    JwtAuthGuard,
    AccessGuard,
    AccessDeclarationCheck,
  ],
  exports: [AccessTokenService, PrincipalResolverRegistry, JwtAuthGuard, AccessGuard],
})
export class AuthModule {}
