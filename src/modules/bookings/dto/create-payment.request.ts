import { ApiProperty } from '@nestjs/swagger';
import { IsIn, ValidateBy, type ValidationArguments } from 'class-validator';
import { ONLINE_PAYMENT_METHODS, SIMULATED_PAYMENT_TOKENS } from '../../payments/enums';
import { outcomeOf } from '../../payments/simulated-tokens';
import type { OnlinePaymentMethod, SimulatedPaymentToken } from '../../payments/types';

/** A test token of the other method (a card token with `method: wallet`) is refused. */
function TokenOfMethod(): PropertyDecorator {
  return ValidateBy({
    name: 'tokenOfMethod',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const outcome = typeof value === 'string' ? outcomeOf(value) : undefined;
        const { method } = (args?.object ?? {}) as { method?: unknown };
        return outcome === undefined || outcome.method === method;
      },
      defaultMessage: () => 'token must be a test token of the chosen method',
    },
  });
}

/**
 * `POST /bookings/{ref}/payments`: how the customer pays. The simulated card form sends the
 * chosen test card's token, never a card number (PRD C8, "Payment and messaging providers").
 */
export class CreatePaymentRequest {
  @ApiProperty({
    enum: ONLINE_PAYMENT_METHODS,
    enumName: 'OnlinePaymentMethod',
    nullable: false,
    example: 'card',
    description: '`card` (Visa, Mastercard, Meeza) or `wallet` (Apple Pay, Google Pay).',
  })
  @IsIn(ONLINE_PAYMENT_METHODS, { message: 'method must be card or wallet' })
  method!: OnlinePaymentMethod;

  @ApiProperty({
    enum: SIMULATED_PAYMENT_TOKENS,
    enumName: 'SimulatedPaymentToken',
    nullable: false,
    example: 'sim_card_visa',
    description:
      'The simulated test token, which decides the result (no real money moves):\n\n- `sim_card_visa`, `sim_card_mastercard`, `sim_card_meeza`: approved (Visa •••• 4242, Mastercard •••• 4444, Meeza •••• 0011).\n- `sim_card_declined`: declined (Visa •••• 0002).\n- `sim_card_slow`: `processing`, approved 10 seconds later (Visa •••• 3184).\n- `sim_card_slow_declined`: `processing`, declined 10 seconds later (Visa •••• 0341).\n- `sim_wallet_apple_pay`, `sim_wallet_google_pay`: approved.\n- `sim_wallet_cancelled`: the customer closed the wallet sheet (`cancelled`, not a decline; Apple Pay).\n\nA `sim_card_*` token needs `method: card` and a `sim_wallet_*` token `method: wallet`, else `VALIDATION_FAILED` on `token`.',
  })
  @IsIn(SIMULATED_PAYMENT_TOKENS, { message: 'token must be one of the simulated test tokens' })
  @TokenOfMethod()
  token!: SimulatedPaymentToken;
}
