import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { ActivityController } from './activity.controller';
import { ActivityRepository } from './activity.repository';
import { ActivityResponseMapper } from './activity-response.mapper';
import { ActivityService } from './activity.service';

/**
 * The admin Activity log (U19, `docs/gh-20-exports-activity/spec.md`; design §13.5): the audit
 * events, newest first, with filters and cursor pages.
 *
 * Read-only, like `analytics` and `search` (design §5): its repository reads `audit_events` (the
 * global audit module's table, written only through `AuditService`) and the reference of each
 * event's booking in one query per page; staff names come from staff's `StaffService`. It writes
 * nothing. Exported: `ActivityService`.
 */
@Module({
  imports: [StaffModule],
  controllers: [ActivityController],
  providers: [ActivityRepository, ActivityService, ActivityResponseMapper],
  exports: [ActivityService],
})
export class ActivityModule {}
