import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/access.decorators';
import {
  ApiErrorResponses,
  REQUEST_ID_RESPONSE_HEADER,
} from '../../common/swagger/error-responses';
import { HealthResponse } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Liveness, a cheap way to wake the server',
    description:
      'Public; anyone may call it. Answers as soon as the process is up, without touching the database. Render uses it as the health check. After the free host has slept, the first call can take noticeably longer.',
  })
  @ApiOkResponse({
    type: HealthResponse,
    description: 'The process is up',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  getHealth(): HealthResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Readiness, including the database',
    description:
      'Public; anyone may call it. Runs one trivial query. Answers `200` when the database responds, and `503 SERVICE_UNAVAILABLE` when it is unreachable or times out (within about 10 seconds).',
  })
  @ApiOkResponse({
    type: HealthResponse,
    description: 'The process and its database are ready',
    headers: REQUEST_ID_RESPONSE_HEADER,
  })
  @ApiErrorResponses('SERVICE_UNAVAILABLE')
  getReadiness(): Promise<HealthResponse> {
    return this.healthService.getReadiness();
  }
}
