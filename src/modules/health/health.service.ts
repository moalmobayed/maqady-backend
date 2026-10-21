import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { HealthResponse } from './dto/health-response.dto';
import { HealthRepository } from './health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  /** The process is up. Touches nothing else, so it is a cheap way to wake the free host. */
  getLiveness(): HealthResponse {
    return { status: 'ok' };
  }

  /** The process can serve requests: the database answers. */
  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.healthRepository.ping();
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', undefined, null, { cause: error });
    }
    return { status: 'ok' };
  }
}
