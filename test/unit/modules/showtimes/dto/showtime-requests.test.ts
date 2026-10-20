import type { ArgumentMetadata } from '@nestjs/common';
import { AppError } from '../../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../../src/common/errors/validation';
import { CheckShowtimesRequest } from '../../../../../src/modules/showtimes/dto/check-showtimes.request';
import { CreateShowtimesRequest } from '../../../../../src/modules/showtimes/dto/create-showtimes.request';
import { ShowtimeIdParams } from '../../../../../src/modules/showtimes/dto/showtime-id.params';
import { TimelineQuery } from '../../../../../src/modules/showtimes/dto/timeline.query';
import { UpdateShowtimeRequest } from '../../../../../src/modules/showtimes/dto/update-showtime.request';

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

const PRICES = {
  front: { amount: 15000, currency: 'EGP' },
  middle: { amount: 19000, currency: 'EGP' },
  back: { amount: 23000, currency: 'EGP' },
};
const CHECK = { movieId: 1, hallId: 2, dates: ['2026-10-16'], startTime: '19:30' };

/** `count` consecutive dates from 1 Nov 2026. */
function datesFrom(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 1 + index));
    return date.toISOString().slice(0, 10);
  });
}

describe('showtime request DTOs', () => {
  describe('CheckShowtimesRequest and CreateShowtimesRequest', () => {
    it('accept 1 to 31 unique dates within 31 days', async () => {
      expect(await invalidFields(CheckShowtimesRequest, CHECK)).toEqual([]);
      expect(
        await invalidFields(CheckShowtimesRequest, { ...CHECK, dates: datesFrom(31) }),
      ).toEqual([]);
      expect(
        await invalidFields(CreateShowtimesRequest, {
          ...CHECK,
          skipUnavailable: true,
          prices: PRICES,
        }),
      ).toEqual([]);
    });

    it.each([
      ['no dates', { dates: [] }, 'dates'],
      ['32 dates', { dates: datesFrom(32) }, 'dates'],
      ['a duplicate date', { dates: ['2026-10-16', '2026-10-16'] }, 'dates'],
      [
        'dates 32 days apart, first and last included',
        { dates: ['2026-11-01', '2026-12-02'] },
        'dates',
      ],
      ['an impossible date', { dates: ['2026-02-30'] }, 'dates'],
      ['a date that is not a string', { dates: [20261016] }, 'dates'],
      ['24:00', { startTime: '24:00' }, 'startTime'],
      ['7:30 without its leading zero', { startTime: '7:30' }, 'startTime'],
      ['seconds', { startTime: '19:30:00' }, 'startTime'],
      ['a movie id of 0', { movieId: 0 }, 'movieId'],
      ['a hall id as text', { hallId: '2' }, 'hallId'],
    ])('refuse %s', async (_name, change, field) => {
      expect(await invalidFields(CheckShowtimesRequest, { ...CHECK, ...change })).toEqual([field]);
    });

    it('require skipUnavailable to create, and valid prices in one currency when given', async () => {
      expect(await invalidFields(CreateShowtimesRequest, CHECK)).toEqual(['skipUnavailable']);
      const free = { ...PRICES, middle: { amount: 0, currency: 'EGP' } };
      expect(
        await invalidFields(CreateShowtimesRequest, {
          ...CHECK,
          skipUnavailable: true,
          prices: free,
        }),
      ).toEqual(['prices.middle.amount']);
      expect(
        await invalidFields(CreateShowtimesRequest, {
          ...CHECK,
          skipUnavailable: true,
          prices: { front: PRICES.front },
        }),
      ).toEqual(['prices.middle', 'prices.back']);
    });
  });

  describe('UpdateShowtimeRequest', () => {
    it.each([
      ['a move', { startTime: '21:00' }],
      ['a move to another date', { cinemaDate: '2026-10-17', startTime: '13:00' }],
      ['new prices', { prices: PRICES }],
      ['a move with new prices', { startTime: '21:00', prices: PRICES }],
      ['a cancellation', { status: 'cancelled', cancelReason: 'low_sales' }],
    ])('accepts %s', async (_name, body) => {
      expect(await invalidFields(UpdateShowtimeRequest, body)).toEqual([]);
    });

    it.each([
      ['an empty body', {}, ['startTime']],
      ['a date without a time', { cinemaDate: '2026-10-17' }, ['startTime']],
      ['an impossible date', { cinemaDate: '2026-02-30', startTime: '13:00' }, ['cinemaDate']],
      ['a cancellation without a reason', { status: 'cancelled' }, ['cancelReason']],
      ['a reason without the status', { cancelReason: 'low_sales' }, ['status']],
      ['an unknown reason', { status: 'cancelled', cancelReason: 'weather' }, ['cancelReason']],
      ['another status', { status: 'scheduled', cancelReason: 'low_sales' }, ['status']],
      [
        'a cancellation with a move',
        { status: 'cancelled', cancelReason: 'low_sales', startTime: '21:00' },
        ['status'],
      ],
      [
        'a cancellation with prices',
        { status: 'cancelled', cancelReason: 'low_sales', prices: PRICES },
        ['status'],
      ],
      ['an unknown field', { startTime: '21:00', hallId: 3 }, ['hallId']],
    ])('refuses %s', async (_name, body, fields) => {
      expect(await invalidFields(UpdateShowtimeRequest, body)).toEqual(fields);
    });
  });

  describe('TimelineQuery and ShowtimeIdParams', () => {
    it('take a theater, a cinema date and optional filters from the query string', async () => {
      expect(
        await invalidFields(
          TimelineQuery,
          { theaterId: '1', date: '2026-10-16', hallId: '3', status: 'cancelled' },
          'query',
        ),
      ).toEqual([]);
      expect(await invalidFields(TimelineQuery, { date: '2026-10-16' }, 'query')).toEqual([
        'theaterId',
      ]);
      expect(
        await invalidFields(TimelineQuery, { theaterId: '1', date: '16-10-2026' }, 'query'),
      ).toEqual(['date']);
      expect(
        await invalidFields(
          TimelineQuery,
          { theaterId: '1', date: '2026-10-16', status: 'started' },
          'query',
        ),
      ).toEqual(['status']);
      expect(await invalidFields(ShowtimeIdParams, { id: '0' }, 'param')).toEqual(['id']);
    });
  });
});
