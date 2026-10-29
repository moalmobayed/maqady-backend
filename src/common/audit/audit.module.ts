import { Global, Module } from '@nestjs/common';
import { AuditReadRepository } from './audit-read.repository';
import { AuditReadService } from './audit-read.service';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * The activity log, available to every module (design §5, §13.5): the write side, and the read
 * side a booking's History uses (U12).
 */
@Global()
@Module({
  providers: [AuditRepository, AuditService, AuditReadRepository, AuditReadService],
  exports: [AuditService, AuditReadService],
})
export class AuditModule {}
