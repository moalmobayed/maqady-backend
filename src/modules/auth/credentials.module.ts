import { Module } from '@nestjs/common';
import { OneTimeTokenService } from './one-time-token.service';
import { OneTimeTokensRepository } from './one-time-tokens.repository';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { SessionsRepository } from './sessions.repository';

/**
 * Credentials shared by staff and customers (design §10): passwords, refresh-token sessions and
 * single-use links. It owns `sessions` and `one_time_tokens`, and depends only on `common/*`; the
 * staff and customers modules import it and pass in their own account checks, so nothing points
 * back from here to them.
 */
@Module({
  providers: [
    PasswordService,
    SessionService,
    SessionsRepository,
    OneTimeTokenService,
    OneTimeTokensRepository,
  ],
  exports: [PasswordService, SessionService, OneTimeTokenService],
})
export class CredentialsModule {}
