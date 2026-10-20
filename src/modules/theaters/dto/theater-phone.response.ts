import { ApiProperty, ApiSchema } from '@nestjs/swagger';

/** A labelled phone number (home-page contract `Phone`). */
@ApiSchema({ name: 'Phone' })
export class TheaterPhoneResponse {
  @ApiProperty({ type: String, example: 'Main line', description: 'What the number is for.' })
  label!: string;

  @ApiProperty({
    type: String,
    example: '+20227351100',
    description: 'E.164 format; format it for display on the frontend.',
  })
  number!: string;
}
