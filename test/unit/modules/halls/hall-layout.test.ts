import { AppError } from '../../../../src/common/errors/app-error';
import {
  aisleAfter,
  layoutErrors,
  layoutRows,
  layoutSeats,
  parseSeatLabel,
  rowIndexOf,
  rowLabelAt,
  seatCounts,
  seatLabel,
  validateLayout,
} from '../../../../src/modules/halls/hall-layout';
import { DEFAULT_LAYOUT, ROW_LABELS } from '../../../../src/modules/halls/halls.constants';
import type { HallLayoutInput, Zone } from '../../../../src/modules/halls/types';

const zones = (front: number, middle: number, back: number): Zone[] => [
  ...Array<Zone>(front).fill('front'),
  ...Array<Zone>(middle).fill('middle'),
  ...Array<Zone>(back).fill('back'),
];

const layout = (overrides: Partial<HallLayoutInput> = {}): HallLayoutInput => ({
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [],
  ...overrides,
});

const fieldsOf = (input: HallLayoutInput): string[] =>
  layoutErrors(input).map((error) => error.field);

describe('hall layout rules', () => {
  describe('aisleAfter', () => {
    it.each([
      [8, [4]],
      [9, [4, 5]],
      [12, [4, 8]],
      [16, [4, 12]],
      [20, [4, 16]],
    ])('puts the aisles of a %i-seat row after %j', (seats, expected) => {
      expect(aisleAfter(seats)).toEqual(expected);
    });
  });

  describe('row labels', () => {
    it('letters rows from the screen back, A to P without I', () => {
      expect(ROW_LABELS).toHaveLength(15);
      expect(ROW_LABELS).not.toContain('I');
      expect([0, 7, 8, 14].map(rowLabelAt)).toEqual(['A', 'H', 'J', 'P']);
      expect(rowIndexOf('J')).toBe(8);
      expect(rowIndexOf('I')).toBeNull();
      expect(rowIndexOf('AB')).toBeNull();
      expect(() => rowLabelAt(15)).toThrow(AppError);
    });

    it('builds and parses seat labels', () => {
      expect(seatLabel('F', 7)).toBe('F7');
      expect(parseSeatLabel('F7')).toEqual({ rowLabel: 'F', seatNumber: 7 });
      expect(parseSeatLabel('P20')).toEqual({ rowLabel: 'P', seatNumber: 20 });
      for (const label of ['I3', 'F0', 'F21', 'F07', 'f7', 'F', '7', 'F7 ']) {
        expect(parseSeatLabel(label)).toBeNull();
      }
    });
  });

  describe('the default layout', () => {
    it('is 12 × 16 with rows A–C front, D–H middle, J–M back and 192 seats', () => {
      expect(DEFAULT_LAYOUT.rowCount).toBe(12);
      expect(DEFAULT_LAYOUT.seatsPerRow).toBe(16);
      const rows = layoutRows(DEFAULT_LAYOUT.rowZones);
      expect(rows.map((row) => `${row.label}:${row.zone}`)).toEqual([
        'A:front',
        'B:front',
        'C:front',
        'D:middle',
        'E:middle',
        'F:middle',
        'G:middle',
        'H:middle',
        'J:back',
        'K:back',
        'L:back',
        'M:back',
      ]);
      expect(seatCounts({ seatsPerRow: 16, rows, seatMarks: [] })).toEqual({
        seatCount: 192,
        wheelchairCount: 0,
        zoneSeatCounts: { front: 48, middle: 80, back: 64 },
      });
      expect(layoutErrors(DEFAULT_LAYOUT)).toEqual([]);
    });
  });

  describe('seats and counts', () => {
    const grid = {
      seatsPerRow: 8,
      rows: layoutRows(['front', 'middle', 'middle', 'back']),
      seatMarks: [
        { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' as const },
        { rowLabel: 'A', seatNumber: 2, kind: 'wheelchair' as const },
        { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' as const },
        { rowLabel: 'B', seatNumber: 4, kind: 'no_seat' as const },
      ],
    };

    it('counts wheelchair spaces as seats of their zone and leaves gaps out', () => {
      expect(seatCounts(grid)).toEqual({
        seatCount: 30,
        wheelchairCount: 2,
        zoneSeatCounts: { front: 8, middle: 15, back: 7 },
      });
    });

    it('lists every seat front to back and left to right, keeping numbers across gaps', () => {
      const seats = layoutSeats(grid);
      expect(seats).toHaveLength(30);
      expect(seats[0]).toEqual({
        label: 'A1',
        rowLabel: 'A',
        seatNumber: 1,
        zone: 'front',
        isWheelchair: true,
      });
      const rowB = seats.filter((seat) => seat.rowLabel === 'B').map((seat) => seat.label);
      expect(rowB).toEqual(['B1', 'B2', 'B3', 'B5', 'B6', 'B7', 'B8']);
      expect(seats[seats.length - 1]).toEqual({
        label: 'D7',
        rowLabel: 'D',
        seatNumber: 7,
        zone: 'back',
        isWheelchair: false,
      });
    });
  });

  describe('validateLayout', () => {
    it('accepts an all-back hall, an empty middle band and the largest grid', () => {
      expect(layoutErrors(layout({ rowZones: zones(0, 0, 4) }))).toEqual([]);
      expect(layoutErrors(layout({ rowZones: zones(2, 0, 2) }))).toEqual([]);
      expect(
        layoutErrors({ rowCount: 15, seatsPerRow: 20, rowZones: zones(5, 5, 5), seatMarks: [] }),
      ).toEqual([]);
      expect(() => validateLayout(layout())).not.toThrow();
    });

    it.each<[string, Partial<HallLayoutInput>, string[]]>([
      ['3 rows', { rowCount: 3, rowZones: zones(1, 1, 1) }, ['rowCount']],
      ['16 rows', { rowCount: 16, rowZones: zones(6, 5, 5) }, ['rowCount']],
      ['7 seats per row', { seatsPerRow: 7 }, ['seatsPerRow']],
      ['21 seats per row', { seatsPerRow: 21 }, ['seatsPerRow']],
      ['a fractional row count', { rowCount: 4.5 }, ['rowCount']],
      ['fewer zones than rows', { rowZones: zones(1, 1, 1) }, ['rowZones']],
      ['more zones than rows', { rowZones: zones(2, 2, 1) }, ['rowZones']],
      [
        'a front row behind a middle row',
        { rowZones: ['middle', 'front', 'back', 'back'] },
        ['rowZones.1'],
      ],
      [
        'a middle row behind a back row',
        { rowZones: ['front', 'back', 'middle', 'back'] },
        ['rowZones.2'],
      ],
      ['an unknown zone', { rowZones: ['front', 'vip' as Zone, 'back', 'back'] }, ['rowZones.1']],
      [
        'a mark in a row the hall does not have',
        { seatMarks: [{ rowLabel: 'E', seatNumber: 1, kind: 'wheelchair' }] },
        ['seatMarks.0.rowLabel'],
      ],
      [
        'a mark in row I',
        { seatMarks: [{ rowLabel: 'I', seatNumber: 1, kind: 'wheelchair' }] },
        ['seatMarks.0.rowLabel'],
      ],
      [
        'a mark past the end of the row',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 9, kind: 'no_seat' }] },
        ['seatMarks.0.seatNumber'],
      ],
      [
        'a mark at seat 0',
        { seatMarks: [{ rowLabel: 'A', seatNumber: 0, kind: 'no_seat' }] },
        ['seatMarks.0.seatNumber'],
      ],
      [
        'the same seat marked twice',
        {
          seatMarks: [
            { rowLabel: 'B', seatNumber: 3, kind: 'no_seat' },
            { rowLabel: 'B', seatNumber: 3, kind: 'wheelchair' },
          ],
        },
        ['seatMarks.1'],
      ],
    ])('refuses %s', (_, overrides, fields) => {
      expect(fieldsOf(layout(overrides))).toEqual(fields);
    });

    it('refuses a layout with no seat left, and accepts one seat', () => {
      const cells = ['A', 'B', 'C', 'D'].flatMap((rowLabel) =>
        [1, 2, 3, 4, 5, 6, 7, 8].map((seatNumber) => ({
          rowLabel,
          seatNumber,
          kind: 'no_seat' as const,
        })),
      );
      expect(fieldsOf(layout({ seatMarks: cells }))).toEqual(['seatMarks']);
      expect(fieldsOf(layout({ seatMarks: cells.slice(1) }))).toEqual([]);
      const oneWheelchair = [{ ...cells[0]!, kind: 'wheelchair' as const }, ...cells.slice(1)];
      expect(fieldsOf(layout({ seatMarks: oneWheelchair }))).toEqual([]);
    });

    it('reports every problem at once and throws VALIDATION_FAILED with them', () => {
      const input = layout({
        rowZones: ['back', 'front', 'back'],
        seatMarks: [
          { rowLabel: 'M', seatNumber: 1, kind: 'wheelchair' },
          { rowLabel: 'A', seatNumber: 12, kind: 'no_seat' },
        ],
      });
      expect(fieldsOf(input)).toEqual([
        'rowZones',
        'rowZones.1',
        'seatMarks.0.rowLabel',
        'seatMarks.1.seatNumber',
      ]);
      try {
        validateLayout(input);
        throw new Error('expected a refusal');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('VALIDATION_FAILED');
        expect((error as AppError).details).toEqual({ fields: layoutErrors(input) });
      }
    });
  });
});
