import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/**
 * Whether a theater is open now (home-page contract `OpenState`). Judged by the cinema day, so
 * 01:30 on Thursday uses Wednesday's hours.
 */
@ApiSchema({
  name: 'OpenState',
  description: "Judged by the cinema day, so 01:30 on Thursday uses Wednesday's hours.",
})
export class OpenStateResponse {
  @ApiProperty({ type: Boolean, example: true, description: 'True while the theater is open.' })
  isOpen!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-17T01:00:00+03:00',
    description: 'When it closes, if open now ("Open now · until 01:00")',
  })
  closesAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description:
      'When it next opens, if closed now ("Opens 12:00"); null if no opening is scheduled in the next 7 days',
  })
  nextOpensAt!: string | null;
}
