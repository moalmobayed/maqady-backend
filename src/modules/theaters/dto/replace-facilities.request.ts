import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { FACILITIES } from '../enums';
import type { Facility } from '../types';

/** `PUT /admin/theaters/{id}/facilities`: the whole set. */
export class ReplaceFacilitiesRequest {
  @ApiProperty({
    enum: FACILITIES,
    enumName: 'Facility',
    isArray: true,
    maxItems: FACILITIES.length,
    uniqueItems: true,
    example: ['wheelchair_access', 'valet_parking', 'cafe_bar'],
    description: 'Every facility the theater has, each once. Empty removes them all.',
  })
  @IsArray()
  @ArrayMaxSize(FACILITIES.length)
  @ArrayUnique()
  @IsIn(FACILITIES, { each: true })
  facilities!: Facility[];
}
