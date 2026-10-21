import type { ArgumentMetadata } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, Min, MinLength, ValidateNested } from 'class-validator';
import { AppError } from '../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../src/common/errors/validation';

class SeatInput {
  @IsString()
  label!: string;
}

class HoldInput {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsInt()
  @Min(1)
  count!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeatInput)
  seats!: SeatInput[];
}

const bodyMetadata: ArgumentMetadata = { type: 'body', metatype: HoldInput, data: '' };

async function rejectionOf(value: unknown): Promise<AppError> {
  try {
    await createValidationPipe().transform(value, bodyMetadata);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected the pipe to reject');
}

describe('createValidationPipe', () => {
  it('transforms a valid body into the DTO class', async () => {
    const result: unknown = await createValidationPipe().transform(
      { name: 'Mona', count: 2, seats: [{ label: 'C4' }] },
      bodyMetadata,
    );
    expect(result).toBeInstanceOf(HoldInput);
    expect((result as HoldInput).seats[0]).toBeInstanceOf(SeatInput);
  });

  it('throws VALIDATION_FAILED with one entry per invalid field, nested paths included', async () => {
    const error = await rejectionOf({
      name: 'ab',
      count: 0,
      seats: [{ label: 'A1' }, { label: 7 }],
    });
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.status).toBe(400);
    expect(error.details).toEqual({
      fields: [
        { field: 'name', messages: ['name must be longer than or equal to 3 characters'] },
        { field: 'count', messages: ['count must not be less than 1'] },
        { field: 'seats.1.label', messages: ['label must be a string'] },
      ],
    });
  });

  it('rejects unknown properties instead of silently dropping them', async () => {
    const error = await rejectionOf({ name: 'Mona', count: 1, seats: [], isAdmin: true });
    expect(error.details).toEqual({
      fields: [{ field: 'isAdmin', messages: ['property isAdmin should not exist'] }],
    });
  });

  it('never copies the rejected values into the error', async () => {
    const error = await rejectionOf({ name: 'x@secret.example', count: 'many', seats: [] });
    expect(JSON.stringify(error.details)).not.toContain('secret.example');
    expect(JSON.stringify(error.details)).not.toContain('many');
  });
});
