import type { AppConfig } from '../../../../src/common/config/types';
import { DataEncryptionService } from '../../../../src/common/crypto/data-encryption.service';
import { AppError } from '../../../../src/common/errors/app-error';
import type { IdempotencyRepository } from '../../../../src/common/idempotency/idempotency.repository';
import { IdempotencyService } from '../../../../src/common/idempotency/idempotency.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00Z');
const INPUT = { scope: 'customer:4', key: 'k-1', requestHash: 'a'.repeat(64) };

describe('IdempotencyService', () => {
  const encryption = new DataEncryptionService({
    encryption: { key: Buffer.alloc(32, 1).toString('base64') },
  } as AppConfig);
  let repository: jest.Mocked<IdempotencyRepository>;
  let service: IdempotencyService;

  beforeEach(() => {
    repository = {
      claim: jest.fn(),
      find: jest.fn(),
      saveResponse: jest.fn(),
      purgeExpired: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<IdempotencyRepository>;
    service = new IdempotencyService(repository, encryption, new TestClock(NOW));
  });

  it('claims with the Clock: created now, taking over keys created over 24 hours ago', async () => {
    repository.claim.mockResolvedValue(17);
    await expect(service.claim(INPUT)).resolves.toEqual({ kind: 'claimed', id: 17 });
    expect(repository.claim).toHaveBeenCalledWith(
      'customer:4',
      'k-1',
      INPUT.requestHash,
      NOW,
      new Date('2026-10-15T12:00:00Z'),
    );
    expect(repository.purgeExpired).toHaveBeenCalledWith(new Date('2026-10-15T12:00:00Z'), 50);
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('replays the stored status and decrypted body of the identical request', async () => {
    repository.claim.mockResolvedValue(undefined);
    let stored = '';
    repository.saveResponse.mockImplementation((_id, _status, ciphertext) => {
      stored = ciphertext ?? '';
      return Promise.resolve();
    });
    await service.complete(17, INPUT, 201, { reference: 'MQ-7Q2K', holdCode: 'secret' });
    repository.find.mockResolvedValue({
      id: 17,
      request_hash: INPUT.requestHash,
      response_status: 201,
      response_ciphertext: stored,
    });

    await expect(service.claim(INPUT)).resolves.toEqual({
      kind: 'replay',
      status: 201,
      body: { reference: 'MQ-7Q2K', holdCode: 'secret' },
    });
    expect(stored).not.toContain('secret');
    expect(repository.find).toHaveBeenCalledWith('customer:4', 'k-1');
  });

  it('replays an empty body as no body', async () => {
    repository.claim.mockResolvedValue(undefined);
    repository.find.mockResolvedValue({
      id: 17,
      request_hash: INPUT.requestHash,
      response_status: 204,
      response_ciphertext: null,
    });
    await expect(service.claim(INPUT)).resolves.toEqual({
      kind: 'replay',
      status: 204,
      body: undefined,
    });
  });

  it('refuses a live key sent with a different request: IDEMPOTENCY_KEY_REUSED', async () => {
    repository.claim.mockResolvedValue(undefined);
    repository.find.mockResolvedValue({
      id: 17,
      request_hash: 'b'.repeat(64),
      response_status: 201,
      response_ciphertext: null,
    });
    await expect(service.claim(INPUT)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('binds a stored body to its scope and key: another row cannot decrypt it', async () => {
    let stored = '';
    repository.saveResponse.mockImplementation((_id, _status, ciphertext) => {
      stored = ciphertext ?? '';
      return Promise.resolve();
    });
    await service.complete(17, INPUT, 201, { ok: true });
    repository.claim.mockResolvedValue(undefined);
    repository.find.mockResolvedValue({
      id: 18,
      request_hash: INPUT.requestHash,
      response_status: 201,
      response_ciphertext: stored,
    });
    await expect(service.claim({ ...INPUT, scope: 'customer:5' })).rejects.toBeInstanceOf(AppError);
  });

  it('stores no ciphertext when the handler returned nothing', async () => {
    await service.complete(17, INPUT, 204, undefined);
    expect(repository.saveResponse).toHaveBeenCalledWith(17, 204, null);
  });
});
