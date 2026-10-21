import { ApiProperty } from '@nestjs/swagger';

/** A staff member as "Last edited by" shows them (PRD A2). */
export class StaffRefResponse {
  @ApiProperty({ type: 'integer', nullable: false, example: 3, description: 'Staff member id.' })
  id!: number;

  @ApiProperty({ type: String, nullable: false, example: 'Mona Adel', description: 'Full name.' })
  fullName!: string;
}
