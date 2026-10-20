import { Inject, Injectable } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { APP_CONFIG } from '../config/config.constants';
import type { AppConfig } from '../config/types';
import { decodeSecret } from '../config/validators';
import { AppError } from '../errors/app-error';
import { Clock } from '../time/clock';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_TTL_SECONDS,
  POSITIVE_ID_PATTERN,
} from './auth.constants';
import type { AccessTokenSubject, TokenAudience, VerifiedAccessToken } from './types';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Signs and verifies access tokens (design §10.2): HS256 JWTs valid for 15 minutes, carrying
 * `sub`, `aud` and `sid`, with one secret per audience. Expiry is judged by the `Clock`.
 *
 * Verification refuses, as `UNAUTHENTICATED`, anything but a well-formed token for exactly the
 * expected audience: another algorithm, the other audience's secret, a wrong `aud`, an expired or
 * not-yet-valid token, or claims that are missing or not positive integers.
 */
@Injectable()
export class AccessTokenService {
  private readonly secrets: Readonly<Record<TokenAudience, Buffer>>;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly clock: Clock,
  ) {
    this.secrets = {
      customer: secretBytes(config.auth.customerTokenSecret),
      staff: secretBytes(config.auth.staffTokenSecret),
    };
  }

  /** A new access token for a session; U2 and U9 call it when signing in or refreshing. */
  sign(subject: AccessTokenSubject): string {
    const issuedAt = this.nowSeconds();
    return sign(
      {
        sub: String(subject.subjectId),
        aud: subject.audience,
        sid: String(subject.sessionId),
        iat: issuedAt,
        exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
      },
      this.secrets[subject.audience],
      { algorithm: ACCESS_TOKEN_ALGORITHM },
    );
  }

  verify(token: string, audience: TokenAudience): VerifiedAccessToken {
    let claims: unknown;
    try {
      claims = verify(token, this.secrets[audience], {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        audience,
        clockTimestamp: this.nowSeconds(),
        clockTolerance: 0,
      });
    } catch (error) {
      throw new AppError('UNAUTHENTICATED', undefined, null, { cause: error });
    }
    const { sub, sid, exp } = (claims ?? {}) as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof exp !== 'number' ||
      !POSITIVE_ID_PATTERN.test(sub) ||
      !POSITIVE_ID_PATTERN.test(sid)
    ) {
      throw new AppError('UNAUTHENTICATED');
    }
    return { audience, subjectId: Number(sub), sessionId: Number(sid) };
  }

  private nowSeconds(): number {
    return Math.floor(this.clock.now().getTime() / MILLISECONDS_PER_SECOND);
  }
}

function secretBytes(text: string): Buffer {
  const bytes = decodeSecret(text);
  if (!bytes) throw new Error('An access-token secret is not valid base64');
  return bytes;
}
