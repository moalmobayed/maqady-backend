import type { AuditService } from '../../../../src/common/audit/audit.service';
import { sha256Hex } from '../../../../src/common/crypto/hashing';
import type { TransactionContext } from '../../../../src/common/database/transaction-context';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { SessionService } from '../../../../src/modules/auth/session.service';
import type { SessionsRepository } from '../../../../src/modules/auth/sessions.repository';
import type { SessionRow } from '../../../../src/modules/auth/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const EXPIRES = new Date('2026-10-20T18:00:00Z');
const TOKEN = 'A'.repeat(43);
const FAMILY = '0f8c5a7e-1d2b-4c3a-9e8f-7a6b5c4d3e2f';

function row(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 10,
    family_id: FAMILY,
    staff_user_id: 3,
    customer_id: null,
    expires_at: EXPIRES,
    rotated_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('SessionService', () => {
  let sessions: jest.Mocked<SessionsRepository>;
  let transactions: jest.Mocked<TransactionRepository>;
  let context: jest.Mocked<TransactionContext>;
  let audit: jest.Mocked<AuditService>;
  let clock: TestClock;
  let service: SessionService;
  let assertOwnerLive: jest.Mock<Promise<void>, [number]>;

  beforeEach(() => {
    sessions = {
      insert: jest.fn().mockResolvedValue(11),
      findByTokenHashForUpdate: jest.fn().mockResolvedValue(row()),
      familyOf: jest.fn().mockResolvedValue(FAMILY),
      markRotated: jest.fn().mockResolvedValue(undefined),
      lockLiveHeads: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<SessionsRepository>;
    transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as jest.Mocked<TransactionRepository>;
    context = {
      isActive: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<TransactionContext>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    clock = new TestClock(NOW);
    service = new SessionService(sessions, transactions, context, audit, clock);
    assertOwnerLive = jest.fn().mockResolvedValue(undefined);
  });

  const refresh = () =>
    service.refresh({ audience: 'staff', refreshToken: TOKEN, assertOwnerLive });

  describe('open', () => {
    it('starts a family with a hashed 32-byte token that expires after the lifetime', async () => {
      const issued = await service.open({
        owner: { audience: 'staff', id: 3 },
        lifetimeSeconds: 43_200,
      });

      expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.expiresAt).toEqual(new Date('2026-10-20T22:00:00Z'));
      expect(issued.sessionId).toBe(11);
      expect(sessions.insert).toHaveBeenCalledWith({
        family_id: issued.familyId,
        staff_user_id: 3,
        customer_id: null,
        token_hash: sha256Hex(issued.refreshToken),
        created_at: NOW,
        expires_at: issued.expiresAt,
      });
      expect(issued.familyId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('puts a customer session in the customer column', async () => {
      await service.open({ owner: { audience: 'customer', id: 9 }, lifetimeSeconds: 60 });
      expect(sessions.insert).toHaveBeenCalledWith(
        expect.objectContaining({ staff_user_id: null, customer_id: 9 }),
      );
    });
  });

  describe('refresh', () => {
    it('rotates: a new row in the same family keeping its expiry, the old one marked rotated', async () => {
      const refreshed = await refresh();

      expect(sessions.findByTokenHashForUpdate).toHaveBeenCalledWith(sha256Hex(TOKEN));
      expect(assertOwnerLive).toHaveBeenCalledWith(3);
      expect(sessions.insert).toHaveBeenCalledWith({
        family_id: FAMILY,
        staff_user_id: 3,
        customer_id: null,
        token_hash: sha256Hex(refreshed.refreshToken),
        created_at: NOW,
        expires_at: EXPIRES,
      });
      expect(sessions.markRotated).toHaveBeenCalledWith(10, NOW, 11);
      expect(refreshed).toEqual({
        sessionId: 11,
        ownerId: 3,
        refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: EXPIRES,
      });
      expect(refreshed.refreshToken).not.toBe(TOKEN);
    });

    it('refuses to run inside an open transaction, where a revocation could roll back', async () => {
      context.isActive.mockReturnValue(true);
      await expect(refresh()).rejects.toMatchObject({ code: 'INTERNAL' });
      expect(sessions.findByTokenHashForUpdate).not.toHaveBeenCalled();
    });

    it('answers UNAUTHENTICATED for an unknown token, a malformed one, or a session of the other audience', async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValueOnce(undefined);
      await expect(refresh()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      await expect(
        service.refresh({ audience: 'staff', refreshToken: 'short', assertOwnerLive }),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      sessions.findByTokenHashForUpdate.mockResolvedValueOnce(
        row({ staff_user_id: null, customer_id: 9 }),
      );
      await expect(refresh()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(sessions.insert).not.toHaveBeenCalled();
    });

    it("asks the owner's check first, so a deactivated or blocked account is the answer even for its revoked session", async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValue(
        row({ revoked_at: NOW, rotated_at: new Date('2026-10-20T09:00:00Z') }),
      );
      assertOwnerLive.mockRejectedValue(new Error('ACCOUNT_DEACTIVATED stand-in'));
      await expect(refresh()).rejects.toThrow('ACCOUNT_DEACTIVATED stand-in');
      expect(assertOwnerLive).toHaveBeenCalledWith(3);
      expect(sessions.revoke).not.toHaveBeenCalled();
      expect(sessions.insert).not.toHaveBeenCalled();
    });

    it('answers SESSION_REVOKED for a revoked session of a live account, before the expiry', async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValue(
        row({ revoked_at: NOW, expires_at: new Date('2026-10-19T00:00:00Z') }),
      );
      await expect(refresh()).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('answers SESSION_EXPIRED at and after the family expiry', async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValue(row({ expires_at: NOW }));
      await expect(refresh()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(sessions.insert).not.toHaveBeenCalled();
    });

    it('answers REFRESH_CONFLICT within 30 seconds of the rotation, writing and revoking nothing', async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValue(
        row({ rotated_at: new Date('2026-10-20T09:59:31Z') }),
      );
      await expect(refresh()).rejects.toMatchObject({ code: 'REFRESH_CONFLICT' });
      expect(sessions.revoke).not.toHaveBeenCalled();
      expect(sessions.insert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('revokes the family for reuse from 30 seconds on, in a second transaction, records it, and throws only after the commit', async () => {
      sessions.findByTokenHashForUpdate.mockResolvedValue(
        row({ rotated_at: new Date('2026-10-20T09:59:30Z') }),
      );
      // Each transaction resolves (commits) in turn; only then is the error thrown.
      const committed: unknown[] = [];
      let revokedInTransaction: number | undefined;
      sessions.revoke.mockImplementation(() => {
        revokedInTransaction = committed.length + 1;
        return Promise.resolve(2);
      });
      transactions.run.mockImplementation(async (fn: () => Promise<unknown>) => {
        const result = await fn();
        committed.push(result);
        return result;
      });

      await expect(refresh()).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
      expect(committed).toEqual([{ kind: 'reused', familyId: FAMILY, sessionId: 10 }, undefined]);
      // Not in the transaction that read (and locked) the presented row.
      expect(revokedInTransaction).toBe(2);
      expect(sessions.lockLiveHeads).toHaveBeenCalledWith({ kind: 'family', familyId: FAMILY });
      expect(sessions.revoke).toHaveBeenCalledWith(
        { kind: 'family', familyId: FAMILY },
        NOW,
        'refresh_reuse',
      );
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'system' },
        action: 'session.reuse_detected',
        entity: { type: 'session', id: 10 },
        metadata: { audience: 'staff' },
      });
      expect(sessions.insert).not.toHaveBeenCalled();
      expect(assertOwnerLive).toHaveBeenCalledWith(3);
    });

    it("lets the owner's check refuse before anything is written", async () => {
      assertOwnerLive.mockRejectedValue(new Error('ACCOUNT_DEACTIVATED stand-in'));
      await expect(refresh()).rejects.toThrow('ACCOUNT_DEACTIVATED stand-in');
      expect(sessions.insert).not.toHaveBeenCalled();
      expect(sessions.markRotated).not.toHaveBeenCalled();
    });
  });

  describe('revocation', () => {
    it('signs out a family: locks its live heads first, then revokes every row', async () => {
      await expect(service.revokeFamilyOf(11, 'sign_out')).resolves.toBe(2);
      expect(sessions.familyOf).toHaveBeenCalledWith(11);
      expect(sessions.lockLiveHeads.mock.invocationCallOrder[0]).toBeLessThan(
        sessions.revoke.mock.invocationCallOrder[0]!,
      );
      expect(sessions.revoke).toHaveBeenCalledWith(
        { kind: 'family', familyId: FAMILY },
        NOW,
        'sign_out',
      );
    });

    it('does nothing for an unknown session', async () => {
      sessions.familyOf.mockResolvedValue(undefined);
      await expect(service.revokeFamilyOf(99, 'sign_out')).resolves.toBe(0);
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('revokes every session of an owner', async () => {
      const owner = { audience: 'staff', id: 3 } as const;
      await service.revokeAllFor(owner, 'account_deactivated');
      expect(sessions.lockLiveHeads).toHaveBeenCalledWith({ kind: 'owner', owner });
      expect(sessions.revoke).toHaveBeenCalledWith(
        { kind: 'owner', owner },
        NOW,
        'account_deactivated',
      );
    });
  });
});
