import type { AccessTokenService } from '../../../../src/common/auth/access-token.service';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { PasswordService } from '../../../../src/modules/auth/password.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import type { RefreshSessionInput } from '../../../../src/modules/auth/types';
import { CustomerAuthService } from '../../../../src/modules/customers/customer-auth.service';
import type { CustomerService } from '../../../../src/modules/customers/customer.service';
import type { CustomersRepository } from '../../../../src/modules/customers/customers.repository';
import { customerVerifyEmailTemplate } from '../../../../src/modules/customers/templates/customer-verify-email.template';
import type { CustomerRow } from '../../../../src/modules/customers/types';
import type { MessagingService } from '../../../../src/modules/messaging/messaging.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const HASH = 'scrypt$16384$8$5$c2FsdA$a2V5';
const NEW_HASH = 'scrypt$16384$8$5$bmV3$a2V5';
const SESSION_ENDS = new Date('2026-11-19T10:00:00Z');
const LINK_TOKEN = 't'.repeat(43);

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 7,
    email: 'layla@example.com',
    full_name: 'Layla Hassan',
    phone: null,
    password_hash: HASH,
    status: 'active',
    email_verified_at: null,
    last_sign_in_at: null,
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-01T10:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

describe('CustomerAuthService', () => {
  let customers: jest.Mocked<CustomersRepository>;
  let customerService: jest.Mocked<CustomerService>;
  let passwords: jest.Mocked<PasswordService>;
  let sessions: jest.Mocked<SessionService>;
  let oneTimeTokens: jest.Mocked<OneTimeTokenService>;
  let accessTokens: jest.Mocked<AccessTokenService>;
  let messaging: jest.Mocked<MessagingService>;
  let service: CustomerAuthService;

  beforeEach(() => {
    customers = {
      insertIfEmailFree: jest.fn().mockResolvedValue(customer({ last_sign_in_at: NOW })),
      findById: jest.fn().mockResolvedValue(customer()),
      findByIdForUpdate: jest.fn().mockResolvedValue(customer()),
      findLiveByEmail: jest.fn().mockResolvedValue(customer()),
      recordSignIn: jest.fn().mockResolvedValue(customer({ last_sign_in_at: NOW })),
      setPasswordHash: jest.fn().mockResolvedValue(customer({ password_hash: NEW_HASH })),
      markEmailVerified: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<CustomersRepository>;
    customerService = {
      issuePasswordReset: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CustomerService>;
    passwords = {
      hash: jest.fn().mockResolvedValue(NEW_HASH),
      verify: jest.fn().mockResolvedValue(true),
    };
    sessions = {
      open: jest.fn().mockResolvedValue({
        sessionId: 70,
        familyId: 'f',
        refreshToken: 'r'.repeat(43),
        expiresAt: SESSION_ENDS,
      }),
      refresh: jest.fn().mockResolvedValue({
        sessionId: 71,
        ownerId: 7,
        refreshToken: 's'.repeat(43),
        expiresAt: SESSION_ENDS,
      }),
      revokeFamilyOf: jest.fn().mockResolvedValue(1),
      revokeAllFor: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionService>;
    oneTimeTokens = {
      issue: jest.fn().mockResolvedValue({ id: 5, token: LINK_TOKEN, expiresAt: NOW }),
      consume: jest.fn().mockResolvedValue({ id: 5, owner: { kind: 'customer', id: 7 } }),
    } as unknown as jest.Mocked<OneTimeTokenService>;
    accessTokens = {
      sign: jest.fn().mockReturnValue('a.b.c'),
    } as unknown as jest.Mocked<AccessTokenService>;
    messaging = {
      queue: jest.fn().mockResolvedValue({ id: 1 }),
    } as unknown as jest.Mocked<MessagingService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new CustomerAuthService(
      customers,
      customerService,
      passwords,
      sessions,
      oneTimeTokens,
      accessTokens,
      messaging,
      transactions,
      new TestClock(NOW),
    );
  });

  describe('register', () => {
    const input = { fullName: 'Layla Hassan', email: 'layla@example.com', password: 'Cinema2026' };

    it('creates the customer, queues the 24-hour verification link and opens a 30-day session', async () => {
      const result = await service.register(input);

      expect(passwords.hash).toHaveBeenCalledWith('Cinema2026');
      expect(customers.insertIfEmailFree).toHaveBeenCalledWith({
        email: 'layla@example.com',
        full_name: 'Layla Hassan',
        phone: null,
        password_hash: NEW_HASH,
        status: 'active',
        last_sign_in_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      });
      expect(oneTimeTokens.issue).toHaveBeenCalledWith({
        purpose: 'verify_email',
        owner: { kind: 'customer', id: 7 },
        lifetimeSeconds: 86_400,
      });
      expect(messaging.queue).toHaveBeenCalledWith({
        template: customerVerifyEmailTemplate,
        recipient: 'layla@example.com',
        params: { fullName: 'Layla Hassan', token: LINK_TOKEN },
        related: { customerId: 7 },
      });
      expect(sessions.open).toHaveBeenCalledWith({
        owner: { audience: 'customer', id: 7 },
        lifetimeSeconds: 2_592_000,
      });
      expect(accessTokens.sign).toHaveBeenCalledWith({
        audience: 'customer',
        subjectId: 7,
        sessionId: 70,
      });
      expect(result.tokens).toEqual({
        customerId: 7,
        sessionId: 70,
        accessToken: 'a.b.c',
        accessTokenExpiresAt: new Date('2026-10-20T10:15:00Z'),
        refreshToken: 'r'.repeat(43),
        refreshTokenExpiresAt: SESSION_ENDS,
      });
      expect(result.customer).toMatchObject({ id: 7, email: 'layla@example.com' });
      expect(result.customer).not.toHaveProperty('passwordHash');
    });

    it('answers EMAIL_TAKEN when a live customer has the email, issuing, queueing and opening nothing', async () => {
      customers.insertIfEmailFree.mockResolvedValue(undefined);
      await expect(service.register(input)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
      expect(messaging.queue).not.toHaveBeenCalled();
      expect(sessions.open).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    const input = { email: 'layla@example.com', password: 'Cinema2026' };

    it('checks the password against the stored hash and opens a session', async () => {
      const result = await service.signIn(input);
      expect(customers.findLiveByEmail).toHaveBeenCalledWith('layla@example.com');
      expect(passwords.verify).toHaveBeenCalledWith('Cinema2026', HASH);
      expect(customers.recordSignIn).toHaveBeenCalledWith(7, HASH, NOW);
      expect(sessions.open).toHaveBeenCalledWith({
        owner: { audience: 'customer', id: 7 },
        lifetimeSeconds: 2_592_000,
      });
      expect(result.customer.lastSignInAt).toEqual(NOW);
    });

    it('does the same scrypt work for an unknown email, then answers INVALID_CREDENTIALS', async () => {
      customers.findLiveByEmail.mockResolvedValue(undefined);
      passwords.verify.mockResolvedValue(false);
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(passwords.verify).toHaveBeenCalledWith('Cinema2026', null);
      expect(sessions.open).not.toHaveBeenCalled();
    });

    it('answers INVALID_CREDENTIALS to a blocked customer with a wrong password, ACCOUNT_BLOCKED with the right one', async () => {
      customers.findLiveByEmail.mockResolvedValue(customer({ status: 'blocked' }));
      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
      expect(customers.recordSignIn).not.toHaveBeenCalled();
      expect(sessions.open).not.toHaveBeenCalled();
    });

    it('answers ACCOUNT_BLOCKED and opens nothing when a block lands before the sign-in is recorded', async () => {
      customers.recordSignIn.mockResolvedValue(undefined);
      customers.findById.mockResolvedValue(customer({ status: 'blocked' }));
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
      expect(sessions.open).not.toHaveBeenCalled();
    });

    it('answers INVALID_CREDENTIALS and opens nothing when a password change or reset lands before the sign-in is recorded', async () => {
      customers.recordSignIn.mockResolvedValue(undefined);
      customers.findById.mockResolvedValue(
        customer({ password_hash: NEW_HASH, status: 'blocked' }),
      );
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      customers.findById.mockResolvedValue(undefined);
      await expect(service.signIn(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(sessions.open).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const ownerCheck = async (): Promise<(id: number) => Promise<void>> => {
      await service.refresh('r'.repeat(43));
      const [input] = sessions.refresh.mock.calls[0] as [RefreshSessionInput];
      expect(input.audience).toBe('customer');
      return input.assertOwnerLive;
    };

    it('rotates through the customer audience and signs a new access token', async () => {
      await expect(service.refresh('r'.repeat(43))).resolves.toMatchObject({
        customerId: 7,
        sessionId: 71,
        refreshToken: 's'.repeat(43),
        refreshTokenExpiresAt: SESSION_ENDS,
      });
      expect(accessTokens.sign).toHaveBeenCalledWith({
        audience: 'customer',
        subjectId: 7,
        sessionId: 71,
      });
    });

    it('lets an active customer refresh, refuses a blocked one and treats a gone one as unknown', async () => {
      const assertOwnerLive = await ownerCheck();
      await expect(assertOwnerLive(7)).resolves.toBeUndefined();
      customers.findById.mockResolvedValueOnce(customer({ status: 'blocked' }));
      await expect(assertOwnerLive(7)).rejects.toMatchObject({ code: 'ACCOUNT_BLOCKED' });
      customers.findById.mockResolvedValueOnce(
        customer({ deleted_at: NOW, email: null, full_name: null, password_hash: null }),
      );
      await expect(assertOwnerLive(7)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      customers.findById.mockResolvedValueOnce(undefined);
      await expect(assertOwnerLive(7)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  it('signs out by revoking the family of the session in use', async () => {
    await service.signOut({ kind: 'customer', id: 7, sessionId: 70 });
    expect(sessions.revokeFamilyOf).toHaveBeenCalledWith(70, 'sign_out');
  });

  it('verifies the email of the link’s owner', async () => {
    await service.verifyEmail(LINK_TOKEN);
    expect(oneTimeTokens.consume).toHaveBeenCalledWith({
      purpose: 'verify_email',
      token: LINK_TOKEN,
    });
    expect(customers.markEmailVerified).toHaveBeenCalledWith(7, NOW);
  });

  describe('resendVerification', () => {
    const principal = { kind: 'customer', id: 7, sessionId: 70 } as const;

    it('issues and queues a new link for an unverified customer, under the row lock', async () => {
      await service.resendVerification(principal);
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(oneTimeTokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'verify_email' }),
      );
      expect(messaging.queue).toHaveBeenCalledTimes(1);
    });

    it('sends nothing to a customer already verified', async () => {
      customers.findByIdForUpdate.mockResolvedValue(customer({ email_verified_at: NOW }));
      await service.resendVerification(principal);
      expect(oneTimeTokens.issue).not.toHaveBeenCalled();
      expect(messaging.queue).not.toHaveBeenCalled();
    });
  });

  describe('requestPasswordReset', () => {
    it('sends a reset link to an active customer, after locking their row', async () => {
      await service.requestPasswordReset('LAYLA@example.com');
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(customerService.issuePasswordReset).toHaveBeenCalledWith(7);
    });

    it('sends nothing for an unknown email or a blocked customer', async () => {
      customers.findLiveByEmail.mockResolvedValueOnce(undefined);
      await service.requestPasswordReset('nobody@example.com');
      customers.findByIdForUpdate.mockResolvedValueOnce(customer({ status: 'blocked' }));
      await service.requestPasswordReset('layla@example.com');
      expect(customerService.issuePasswordReset).not.toHaveBeenCalled();
    });

    it('sends nothing when the locked row lost the email or was anonymised meanwhile (U15 review)', async () => {
      customers.findByIdForUpdate.mockResolvedValueOnce(customer({ email: 'new@example.com' }));
      await service.requestPasswordReset('layla@example.com');
      customers.findByIdForUpdate.mockResolvedValueOnce(
        customer({ email: null, full_name: null, password_hash: null, deleted_at: NOW }),
      );
      await service.requestPasswordReset('layla@example.com');
      expect(customerService.issuePasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const input = { token: LINK_TOKEN, password: 'NewCinema2026' };

    it('sets the new hash, verifies the email and revokes every session', async () => {
      await service.resetPassword(input);
      expect(oneTimeTokens.consume).toHaveBeenCalledWith({
        purpose: 'customer_password_reset',
        token: LINK_TOKEN,
      });
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(customers.setPasswordHash).toHaveBeenCalledWith(7, NEW_HASH, NOW);
      expect(customers.markEmailVerified).toHaveBeenCalledWith(7, NOW);
      expect(sessions.revokeAllFor).toHaveBeenCalledWith(
        { audience: 'customer', id: 7 },
        'password_changed',
      );
      expect(sessions.open).not.toHaveBeenCalled();
    });

    it('answers ACCOUNT_BLOCKED for a blocked customer and writes nothing', async () => {
      customers.findByIdForUpdate.mockResolvedValue(customer({ status: 'blocked' }));
      await expect(service.resetPassword(input)).rejects.toMatchObject({
        code: 'ACCOUNT_BLOCKED',
      });
      expect(customers.setPasswordHash).not.toHaveBeenCalled();
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
    });

    it('answers INVALID_TOKEN when the link names an anonymised customer', async () => {
      customers.findByIdForUpdate.mockResolvedValue(
        customer({ deleted_at: NOW, email: null, full_name: null, password_hash: null }),
      );
      await expect(service.resetPassword(input)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(customers.setPasswordHash).not.toHaveBeenCalled();
    });
  });
});
