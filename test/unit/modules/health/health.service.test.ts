import { AppError } from '../../../../src/common/errors/app-error';
import type { HealthRepository } from '../../../../src/modules/health/health.repository';
import { HealthService } from '../../../../src/modules/health/health.service';
import { socketError } from '../../../support/errors';

function serviceWith(ping: jest.Mock) {
  const repository = { ping } as unknown as HealthRepository;
  return new HealthService(repository);
}

describe('HealthService', () => {
  it('reports liveness without touching the database', () => {
    const ping = jest.fn();
    expect(serviceWith(ping).getLiveness()).toEqual({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports ready when the database answers', async () => {
    const ping = jest.fn().mockResolvedValue(undefined);
    await expect(serviceWith(ping).getReadiness()).resolves.toEqual({ status: 'ok' });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('answers SERVICE_UNAVAILABLE (503) when the datastore is down, keeping the cause for the log', async () => {
    const down = socketError('ECONNREFUSED');
    const ping = jest.fn().mockRejectedValue(down);

    const error: unknown = await serviceWith(ping)
      .getReadiness()
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'The service is temporarily unavailable.',
      details: null,
    });
    expect((error as AppError).cause).toBe(down);
  });
});
