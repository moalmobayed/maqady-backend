import { Module } from '@nestjs/common';
import { CredentialsModule } from '../auth/credentials.module';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffBootstrapService } from './staff-bootstrap.service';
import { StaffMeController } from './staff-me.controller';
import { StaffOnboardingService } from './staff-onboarding.service';
import { StaffPrincipalResolver } from './staff-principal.resolver';
import { StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';
import { StaffService } from './staff.service';

/**
 * Staff accounts and staff access (design §10, §11 "Admin routes"): sign-in, refresh and
 * sign-out, `GET /admin/me`, the Staff screen's list, invites and changes, staff "Forgot
 * password" and the set-password page, the staff email templates, the staff principal resolver
 * and the first-admin bootstrap.
 */
@Module({
  imports: [CredentialsModule],
  controllers: [StaffAuthController, StaffMeController, StaffController],
  providers: [
    StaffRepository,
    StaffService,
    StaffAuthService,
    StaffOnboardingService,
    StaffPrincipalResolver,
    StaffBootstrapService,
  ],
  exports: [StaffService, StaffBootstrapService],
})
export class StaffModule {}
