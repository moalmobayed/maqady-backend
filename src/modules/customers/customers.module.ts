import { Module } from '@nestjs/common';
import { CredentialsModule } from '../auth/credentials.module';
import { CustomerAuthController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerPrincipalResolver } from './customer-principal.resolver';
import { CustomerProfileService } from './customer-profile.service';
import { CustomerService } from './customer.service';
import { CustomersRepository } from './customers.repository';
import { MeController } from './me.controller';
import { CustomerTemplatesRegistrar } from './templates/customer-templates.registrar';

/**
 * Customer accounts and customer access (design §10, §11 "Public and customer routes"):
 * registration, sign-in, refresh and sign-out, email verification, password reset, `/me`, the
 * customer principal resolver and the customer email templates. `CustomerService` is what other
 * modules use (bookings, the admin customer screens).
 */
@Module({
  imports: [CredentialsModule],
  controllers: [CustomerAuthController, MeController],
  providers: [
    CustomersRepository,
    CustomerService,
    CustomerAuthService,
    CustomerProfileService,
    CustomerPrincipalResolver,
    CustomerTemplatesRegistrar,
  ],
  exports: [CustomerService],
})
export class CustomersModule {}
