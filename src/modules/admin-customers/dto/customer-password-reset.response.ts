import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** The answer of `POST /admin/customers/{id}/password-reset-requests`: the email is queued. */
@ApiSchema({ name: 'CustomerPasswordReset' })
export class CustomerPasswordResetResponse {
  @ApiProperty({
    type: String,
    enum: ['email'],
    nullable: false,
    example: 'email',
    description: 'The reset link always goes by email, to the account email.',
  })
  channel!: 'email';

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: false,
    example: '2026-10-29T14:05:00+03:00',
    description:
      'When the email was queued; it leaves within moments (see the Message log, where the link is hidden).',
  })
  queuedAt!: string;
}
