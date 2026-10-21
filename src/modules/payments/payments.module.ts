import { Module } from '@nestjs/common';
import { PaymentProvider } from './payment-provider';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';
import { SimulatedPaymentProvider } from './simulated-payment.provider';

/**
 * Payments (design §5, §6.2, §7.5): the `payments` ledger and the payment provider behind it,
 * the simulated one in v1. It depends on nothing beyond the global modules: bookings drives
 * checkout and settlement (U11) and later counter sales, refunds and payouts (U13, U14) through
 * the exported `PaymentsService`, and `PaymentProvider` for a refund's provider call.
 */
@Module({
  providers: [
    PaymentsRepository,
    PaymentsService,
    SimulatedPaymentProvider,
    { provide: PaymentProvider, useExisting: SimulatedPaymentProvider },
  ],
  exports: [PaymentsService, PaymentProvider],
})
export class PaymentsModule {}
