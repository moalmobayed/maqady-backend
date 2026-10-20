import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { PasswordService } from '../../../../src/modules/auth/password.service';
import type { SessionService } from '../../../../src/modules/auth/session.service';
import { CustomerProfileService } from '../../../../src/modules/customers/customer-profile.service';
import type { CustomersRepository } from '../../../../src/modules/customers/customers.repository';
import type { CustomerRow } from '../../../../src/modules/customers/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-20T10:00:00Z');
const HASH = 'scrypt$16384$8$5$c2FsdA$a2V5';
const NEW_HASH = 'scrypt$16384$8$5$bmV3$a2V5';
const PRINCIPAL = { kind: 'customer', id: 7, sessionId: 70 } as const;

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 7,
    email: 'layla@example.com',
    full_name: 'Layla Hassan',
    phone: '+201012345678',
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

describe('CustomerProfileService', () => {
  let customers: jest.Mocked<CustomersRepository>;
  let passwords: jest.Mocked<PasswordService>;
  let sessions: jest.Mocked<SessionService>;
  let service: CustomerProfileService;

  beforeEach(() => {
    customers = {
      findById: jest.fn().mockResolvedValue(customer()),
      findByIdForUpdate: jest.fn().mockResolvedValue(customer()),
      updateProfile: jest.fn().mockResolvedValue(customer({ full_name: 'Layla H.' })),
      setPasswordHash: jest.fn().mockResolvedValue(customer({ password_hash: NEW_HASH })),
    } as unknown as jest.Mocked<CustomersRepository>;
    passwords = {
      hash: jest.fn().mockResolvedValue(NEW_HASH),
      verify: jest.fn().mockResolvedValue(true),
    };
    sessions = {
      revokeAllFor: jest.fn().mockResolvedValue(1),
    } as unknown as jest.Mocked<SessionService>;
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new CustomerProfileService(
      customers,
      passwords,
      sessions,
      transactions,
      new TestClock(NOW),
    );
  });

  it('reads the signed-in customer, and refuses one anonymised since the guard ran', async () => {
    await expect(service.get(PRINCIPAL)).resolves.toMatchObject({
      id: 7,
      fullName: 'Layla Hassan',
    });
    customers.findById.mockResolvedValue(
      customer({ deleted_at: NOW, email: null, full_name: null, phone: null, password_hash: null }),
    );
    await expect(service.get(PRINCIPAL)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  describe('update', () => {
    it('writes only the fields that changed, with updated_at', async () => {
      await service.update(PRINCIPAL, { fullName: 'Layla H.', phone: '+201012345678' });
      expect(customers.updateProfile).toHaveBeenCalledWith(7, {
        full_name: 'Layla H.',
        updated_at: NOW,
      });
    });

    it('clears the phone with null', async () => {
      await service.update(PRINCIPAL, { phone: null });
      expect(customers.updateProfile).toHaveBeenCalledWith(7, { phone: null, updated_at: NOW });
    });

    it('writes nothing for a change to nothing and returns the profile as it is', async () => {
      const result = await service.update(PRINCIPAL, { fullName: 'Layla Hassan' });
      expect(customers.updateProfile).not.toHaveBeenCalled();
      expect(result).toMatchObject({ fullName: 'Layla Hassan', phone: '+201012345678' });
    });
  });

  describe('changePassword', () => {
    const input = { currentPassword: 'Cinema2026', newPassword: 'NewCinema2026' };

    it('checks the current password, stores the new hash and signs out the other devices', async () => {
      await service.changePassword(PRINCIPAL, input);
      expect(customers.findByIdForUpdate).toHaveBeenCalledWith(7);
      expect(passwords.verify).toHaveBeenCalledWith('Cinema2026', HASH);
      expect(customers.setPasswordHash).toHaveBeenCalledWith(7, NEW_HASH, NOW);
      expect(sessions.revokeAllFor).toHaveBeenCalledWith(
        { audience: 'customer', id: 7 },
        'password_changed',
        { exceptSessionId: 70 },
      );
    });

    it('answers VALIDATION_FAILED on currentPassword for a wrong one, writing nothing', async () => {
      passwords.verify.mockResolvedValue(false);
      await expect(service.changePassword(PRINCIPAL, input)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: {
          fields: [{ field: 'currentPassword', messages: ['currentPassword is not correct'] }],
        },
      });
      expect(customers.setPasswordHash).not.toHaveBeenCalled();
      expect(sessions.revokeAllFor).not.toHaveBeenCalled();
    });
  });
});
