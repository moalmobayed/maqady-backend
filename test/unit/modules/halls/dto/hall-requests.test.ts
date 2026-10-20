import type { ArgumentMetadata } from '@nestjs/common';
import { AppError } from '../../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../../src/common/errors/validation';
import { CreateHallRequest } from '../../../../../src/modules/halls/dto/create-hall.request';
import { HallIdParams } from '../../../../../src/modules/halls/dto/hall-id.params';
import { HallListQuery } from '../../../../../src/modules/halls/dto/hall-list.query';
import { ReplaceHallLayoutRequest } from '../../../../../src/modules/halls/dto/replace-hall-layout.request';
import { UpdateHallRequest } from '../../../../../src/modules/halls/dto/update-hall.request';

/** The fields the global ValidationPipe refuses, or [] when the input is valid. */
async function invalidFields(
  metatype: ArgumentMetadata['metatype'],
  value: unknown,
  type: ArgumentMetadata['type'] = 'body',
): Promise<string[]> {
  try {
    await createValidationPipe().transform(value, { type, metatype, data: '' });
    return [];
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (error.details as { fields: { field: string }[] }).fields.map((entry) => entry.field);
  }
}

async function transformed<T>(metatype: new () => T, body: unknown): Promise<T> {
  return (await createValidationPipe().transform(body, { type: 'body', metatype, data: '' })) as T;
}

const LAYOUT = {
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [{ rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' }],
};

describe('hall request DTOs', () => {
  describe('CreateHallRequest', () => {
    it('trims the name', async () => {
      expect(await transformed(CreateHallRequest, { name: '  Hall 3 ' })).toEqual({
        name: 'Hall 3',
      });
    });

    it.each([
      ['no name', {}],
      ['a blank name', { name: '   ' }],
      ['a name of 41 characters', { name: 'x'.repeat(41) }],
      ['a number', { name: 3 }],
      // Postgres text can't hold NUL: the insert would fail with a 500.
      ['a name with a NUL character', { name: 'Hall\u00003' }],
    ])('refuses %s', async (_, body) => {
      expect(await invalidFields(CreateHallRequest, body)).toEqual(['name']);
    });

    it('accepts 40 characters and refuses unknown fields', async () => {
      expect(await invalidFields(CreateHallRequest, { name: 'x'.repeat(40) })).toEqual([]);
      expect(await invalidFields(CreateHallRequest, { name: 'Hall', format: 'IMAX' })).toEqual([
        'format',
      ]);
    });
  });

  describe('UpdateHallRequest', () => {
    it('needs at least one field, and refuses null', async () => {
      expect(await invalidFields(UpdateHallRequest, {})).toEqual(['name']);
      expect(await invalidFields(UpdateHallRequest, { name: null })).toEqual(['name']);
      expect(await invalidFields(UpdateHallRequest, { status: null })).toEqual(['status']);
    });

    it('refuses a name with a NUL character, which Postgres text cannot hold', async () => {
      expect(await invalidFields(UpdateHallRequest, { name: 'Hall\u00004' })).toEqual(['name']);
    });

    it('takes a name, a status or both', async () => {
      expect(await invalidFields(UpdateHallRequest, { name: 'Hall 4' })).toEqual([]);
      expect(await invalidFields(UpdateHallRequest, { status: 'retired' })).toEqual([]);
      expect(await invalidFields(UpdateHallRequest, { name: 'Hall', status: 'active' })).toEqual(
        [],
      );
      expect(await invalidFields(UpdateHallRequest, { status: 'closed' })).toEqual(['status']);
    });
  });

  describe('ReplaceHallLayoutRequest', () => {
    it('accepts a valid layout and an empty mark list', async () => {
      expect(await invalidFields(ReplaceHallLayoutRequest, LAYOUT)).toEqual([]);
      expect(await invalidFields(ReplaceHallLayoutRequest, { ...LAYOUT, seatMarks: [] })).toEqual(
        [],
      );
    });

    it.each<[string, Record<string, unknown>, string[]]>([
      ['3 rows', { rowCount: 3 }, ['rowCount']],
      ['16 rows', { rowCount: 16 }, ['rowCount']],
      ['7 seats per row', { seatsPerRow: 7 }, ['seatsPerRow']],
      ['21 seats per row', { seatsPerRow: 21 }, ['seatsPerRow']],
      ['a text row count', { rowCount: '4' }, ['rowCount']],
      ['an unknown zone', { rowZones: ['front', 'vip', 'middle', 'back'] }, ['rowZones']],
      ['3 zones', { rowZones: ['front', 'middle', 'back'] }, ['rowZones']],
      ['no zones', { rowZones: undefined }, ['rowZones']],
      [
        'row label I',
        { seatMarks: [{ rowLabel: 'I', seatNumber: 1, kind: 'no_seat' }] },
        ['seatMarks.0.rowLabel'],
      ],
      [
        'a lower-case row',
        { seatMarks: [{ rowLabel: 'a', seatNumber: 1, kind: 'no_seat' }] },
        ['seatMarks.0.rowLabel'],
      ],
      [
        'seat 0',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 0, kind: 'no_seat' }] },
        ['seatMarks.0.seatNumber'],
      ],
      [
        'seat 21',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 21, kind: 'no_seat' }] },
        ['seatMarks.0.seatNumber'],
      ],
      [
        'an unknown kind',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 1, kind: 'vip' }] },
        ['seatMarks.0.kind'],
      ],
      [
        'a mark with an extra field',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 1, kind: 'no_seat', price: 1 }] },
        ['seatMarks.0.price'],
      ],
      ['no marks field', { seatMarks: undefined }, ['seatMarks']],
      [
        '301 marks',
        {
          seatMarks: Array.from({ length: 301 }, () => ({
            rowLabel: 'A',
            seatNumber: 1,
            kind: 'no_seat',
          })),
        },
        ['seatMarks'],
      ],
    ])('refuses %s', async (_, overrides, fields) => {
      expect(await invalidFields(ReplaceHallLayoutRequest, { ...LAYOUT, ...overrides })).toEqual(
        fields,
      );
    });
  });

  describe('params and query', () => {
    it('takes a positive integer hall id', async () => {
      expect(await invalidFields(HallIdParams, { id: '3' }, 'param')).toEqual([]);
      expect(await invalidFields(HallIdParams, { id: '0' }, 'param')).toEqual(['id']);
      expect(await invalidFields(HallIdParams, { id: 'abc' }, 'param')).toEqual(['id']);
    });

    it('filters by a known status', async () => {
      expect(await invalidFields(HallListQuery, { status: 'draft', limit: '5' }, 'query')).toEqual(
        [],
      );
      expect(await invalidFields(HallListQuery, { status: 'closed' }, 'query')).toEqual(['status']);
    });
  });
});
