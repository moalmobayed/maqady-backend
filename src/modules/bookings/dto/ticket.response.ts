import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** A confirmed booking's ticket (PRD C9 "the ticket card with QR code", "Admits 2"). */
@ApiSchema({ name: 'Ticket' })
export class TicketResponse {
  @ApiProperty({
    type: String,
    nullable: false,
    pattern: '^MQ1\\.MQ-[2-9A-HJKMNP-Z]{6}\\.[1-9][0-9]{0,4}\\.[A-Za-z0-9_-]{22}$',
    example: 'MQ1.MQ-7K3P9Q.1.Rk2xV9bQm4Tz8LpW3nYc1A',
    description:
      'The signed QR payload: draw it as a QR code (error correction M). It admits the whole booking once at the entrance and cannot be guessed or forged; the reference alone admits nobody. Keep it private.',
  })
  qrCode!: string;

  @ApiProperty({
    type: 'integer',
    nullable: false,
    minimum: 1,
    maximum: 8,
    example: 2,
    description: 'How many people it admits: the seat count ("Admits 2").',
  })
  admits!: number;
}
