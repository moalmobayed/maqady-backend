import { sha256Hex } from '../../../../src/common/crypto/hashing';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { OneTimeTokenService } from '../../../../src/modules/auth/one-time-token.service';
import type { OneTimeTokensRepository } from '../../../../src/modules/auth/one-time-tokens.repository';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');

describe('OneTimeTokenService', () => {
  let tokens: jest.Mocked<OneTimeTokensRepository>;
  let service: OneTimeTokenService;

  beforeEach(() => {
    tokens = {
      insert: jest.fn().mockResolvedValue(5),
      deleteUnused: jest.fn().mockResolvedValue(1),
      consume: jest.fn().mockResolvedValue({ id: 5, staff_user_id: 3, customer_id: null }),
    } as unknown as jest.Mocked<OneTimeTokensRepository>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new OneTimeTokenService(tokens, transactions, new TestClock(NOW));
  });

  it('issues a hashed token after deleting the owner’s earlier unused ones of that purpose', async () => {
    const issued = await service.issue({
      purpose: 'staff_invite',
      owner: { kind: 'staff', id: 3 },
      lifetimeSeconds: 259_200,
    });

    expect(issued).toEqual({
      id: 5,
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiresAt: new Date('2026-10-23T10:00:00Z'),
    });
    expect(tokens.deleteUnused).toHaveBeenCalledWith({ kind: 'staff', id: 3 }, 'staff_invite');
    expect(tokens.deleteUnused.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.insert.mock.invocationCallOrder[0]!,
    );
    expect(tokens.insert).toHaveBeenCalledWith({
      purpose: 'staff_invite',
      staff_user_id: 3,
      customer_id: null,
      token_hash: sha256Hex(issued.token),
      created_at: NOW,
      expires_at: issued.expiresAt,
    });
  });

  it('refuses a purpose issued to the wrong kind of owner', async () => {
    await expect(
      service.issue({
        purpose: 'verify_email',
        owner: { kind: 'staff', id: 3 },
        lifetimeSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(tokens.insert).not.toHaveBeenCalled();
  });

  it('consumes a token by its hash and purpose, and says whose it was', async () => {
    const token = 'b'.repeat(43);
    await expect(service.consume({ purpose: 'staff_invite', token })).resolves.toEqual({
      id: 5,
      owner: { kind: 'staff', id: 3 },
    });
    expect(tokens.consume).toHaveBeenCalledWith(sha256Hex(token), 'staff_invite', NOW);

    tokens.consume.mockResolvedValueOnce({ id: 6, staff_user_id: null, customer_id: 9 });
    await expect(service.consume({ purpose: 'verify_email', token })).resolves.toEqual({
      id: 6,
      owner: { kind: 'customer', id: 9 },
    });
  });

  it('answers INVALID_TOKEN when nothing matched (unknown, used, expired, other purpose) or the token is malformed', async () => {
    tokens.consume.mockResolvedValueOnce(undefined);
    await expect(
      service.consume({ purpose: 'staff_invite', token: 'b'.repeat(43) }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });

    await expect(
      service.consume({ purpose: 'staff_invite', token: 'not a token' }),
    ).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(tokens.consume).toHaveBeenCalledTimes(1);
  });

  it('invalidates every unused token of an account', async () => {
    await expect(service.invalidateAllFor({ kind: 'staff', id: 3 })).resolves.toBe(1);
    expect(tokens.deleteUnused).toHaveBeenCalledWith({ kind: 'staff', id: 3 });
  });
});
