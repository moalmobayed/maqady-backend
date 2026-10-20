import type { Type } from '@nestjs/common';
import type { AppError } from '../../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../../src/common/errors/validation';
import { CreateSpecialDateRequest } from '../../../../../src/modules/theaters/dto/create-special-date.request';
import { CreateTheaterRequest } from '../../../../../src/modules/theaters/dto/create-theater.request';
import { ReplaceFacilitiesRequest } from '../../../../../src/modules/theaters/dto/replace-facilities.request';
import { ReplaceHoursRequest } from '../../../../../src/modules/theaters/dto/replace-hours.request';
import { ReplacePhonesRequest } from '../../../../../src/modules/theaters/dto/replace-phones.request';
import { ReplacePricesRequest } from '../../../../../src/modules/theaters/dto/replace-prices.request';
import { TheaterPhotoFieldsRequest } from '../../../../../src/modules/theaters/dto/theater-photo-fields.request';
import { UpdateSpecialDateRequest } from '../../../../../src/modules/theaters/dto/update-special-date.request';
import { UpdateTheaterPhotoRequest } from '../../../../../src/modules/theaters/dto/update-theater-photo.request';
import { UpdateTheaterRequest } from '../../../../../src/modules/theaters/dto/update-theater.request';

const pipe = createValidationPipe();

/** The body as the global pipe validates it: the DTO, or the fields it refused. */
async function validate(metatype: Type<unknown>, body: unknown): Promise<unknown> {
  return pipe.transform(body, { type: 'body', metatype });
}

async function refusedFields(metatype: Type<unknown>, body: unknown): Promise<string[]> {
  try {
    await validate(metatype, body);
  } catch (error) {
    const appError = error as AppError;
    expect(appError.code).toBe('VALIDATION_FAILED');
    const fields = (appError.details as { fields: { field: string }[] }).fields;
    return [...new Set(fields.map(({ field }) => field))];
  }
  throw new Error('The body was accepted');
}

const openDay = (weekday: number) => ({ weekday, closed: false, opens: '12:00', closes: '01:00' });
const week = () => [1, 2, 3, 4, 5, 6, 7].map(openDay);

describe('theater request DTOs (the global ValidationPipe)', () => {
  describe('CreateTheaterRequest', () => {
    const valid = {
      name: '  Maqady Zamalek ',
      address: '26 July Street',
      district: 'Zamalek',
      city: 'Cairo',
      latitude: 30.0609,
      longitude: 31.2197,
    };

    it('trims text and accepts a minimal theater', async () => {
      const body = (await validate(CreateTheaterRequest, valid)) as CreateTheaterRequest;
      expect(body.name).toBe('Maqady Zamalek');
      expect(body).toBeInstanceOf(CreateTheaterRequest);
    });

    it('refuses a missing name, a blank district, out-of-range or too precise coordinates', async () => {
      expect(
        await refusedFields(CreateTheaterRequest, {
          ...valid,
          name: undefined,
          district: '   ',
          latitude: 91,
          longitude: 31.1234567,
        }),
      ).toEqual(['name', 'district', 'latitude', 'longitude']);
    });

    it('refuses a malformed email and an unknown field', async () => {
      expect(
        await refusedFields(CreateTheaterRequest, { ...valid, email: 'nope', manager: 'x' }),
      ).toEqual(['manager', 'email']);
    });

    it('refuses a quoted email and coordinates written with an exponent, as fields', async () => {
      expect(
        await refusedFields(CreateTheaterRequest, {
          ...valid,
          email: '"front desk"@maqady.example',
          latitude: 1e-7,
          longitude: 2.5e-8,
        }),
      ).toEqual(['latitude', 'longitude', 'email']);
      expect(
        await refusedFields(UpdateTheaterRequest, {
          email: '"a@b"@maqady.example',
          latitude: 1e-9,
        }),
      ).toEqual(['latitude', 'email']);
      const body = (await validate(CreateTheaterRequest, {
        ...valid,
        email: 'zamalek@maqady.example',
        latitude: 0.000001,
        longitude: -0.5,
      })) as CreateTheaterRequest;
      expect([body.email, body.latitude, body.longitude]).toEqual([
        'zamalek@maqady.example',
        0.000001,
        -0.5,
      ]);
    });
  });

  describe('UpdateTheaterRequest', () => {
    it('needs at least one field', async () => {
      expect(await refusedFields(UpdateTheaterRequest, {})).toEqual(['name']);
    });

    it('accepts a status alone, and null for the clearable fields only', async () => {
      await expect(validate(UpdateTheaterRequest, { status: 'active' })).resolves.toBeDefined();
      await expect(
        validate(UpdateTheaterRequest, { email: null, transitInfo: null }),
      ).resolves.toBeDefined();
      expect(await refusedFields(UpdateTheaterRequest, { name: null, city: null })).toEqual([
        'name',
        'city',
      ]);
      expect(await refusedFields(UpdateTheaterRequest, { status: 'closed' })).toEqual(['status']);
    });
  });

  describe('ReplaceHoursRequest', () => {
    it('accepts all seven weekdays, in any order', async () => {
      await expect(
        validate(ReplaceHoursRequest, { days: week().reverse() }),
      ).resolves.toBeDefined();
    });

    it('refuses 6 or 8 days and a weekday twice', async () => {
      expect(await refusedFields(ReplaceHoursRequest, { days: week().slice(1) })).toEqual(['days']);
      expect(await refusedFields(ReplaceHoursRequest, { days: [...week(), openDay(1)] })).toEqual([
        'days',
      ]);
      const twice = week();
      twice[6] = openDay(1);
      expect(await refusedFields(ReplaceHoursRequest, { days: twice })).toEqual(['days']);
    });

    it('refuses times on a closed day, an open day without times, and bad times', async () => {
      const days = week();
      days[0] = { weekday: 1, closed: true, opens: '12:00', closes: '01:00' };
      days[1] = { weekday: 2, closed: false } as never;
      days[2] = { weekday: 3, closed: false, opens: '05:00', closes: '12:00' };
      days[3] = { weekday: 4, closed: false, opens: '12:00', closes: '11:59' };
      days[4] = { weekday: 5, closed: false, opens: '12:00', closes: '25:00' };
      expect(await refusedFields(ReplaceHoursRequest, { days })).toEqual([
        'days.0.opens',
        'days.0.closes',
        'days.1.opens',
        'days.1.closes',
        'days.2.opens',
        'days.3.closes',
        'days.4.closes',
      ]);
    });
  });

  describe('ReplacePhonesRequest', () => {
    const phone = { label: 'Box office', number: '+20227351100' };

    it('accepts up to 10 E.164 numbers', async () => {
      await expect(
        validate(ReplacePhonesRequest, { phones: Array.from({ length: 10 }, () => phone) }),
      ).resolves.toBeDefined();
      await expect(validate(ReplacePhonesRequest, { phones: [] })).resolves.toBeDefined();
    });

    it('refuses an 11th phone, a local number and an empty label', async () => {
      expect(
        await refusedFields(ReplacePhonesRequest, {
          phones: Array.from({ length: 11 }, () => phone),
        }),
      ).toEqual(['phones']);
      expect(
        await refusedFields(ReplacePhonesRequest, {
          phones: [
            { label: 'Main', number: '0227351100' },
            { label: ' ', number: '+20227351100' },
          ],
        }),
      ).toEqual(['phones.0.number', 'phones.1.label']);
    });
  });

  describe('ReplaceFacilitiesRequest', () => {
    it('accepts known facilities once each', async () => {
      await expect(
        validate(ReplaceFacilitiesRequest, { facilities: ['cafe_bar', 'kids_room'] }),
      ).resolves.toBeDefined();
    });

    it('refuses duplicates and unknown facilities', async () => {
      expect(
        await refusedFields(ReplaceFacilitiesRequest, { facilities: ['cafe_bar', 'cafe_bar'] }),
      ).toEqual(['facilities']);
      expect(await refusedFields(ReplaceFacilitiesRequest, { facilities: ['imax'] })).toEqual([
        'facilities',
      ]);
    });
  });

  describe('ReplacePricesRequest', () => {
    const egp = (amount: number) => ({ amount, currency: 'EGP' });

    it('accepts three whole piastre amounts from 1 to 1,000,000', async () => {
      await expect(
        validate(ReplacePricesRequest, { front: egp(1), middle: egp(19050), back: egp(1_000_000) }),
      ).resolves.toBeDefined();
    });

    it('refuses 0, 1,000,001, a fraction, another currency and a missing zone', async () => {
      expect(
        await refusedFields(ReplacePricesRequest, {
          front: egp(0),
          middle: egp(1_000_001),
          back: egp(150.5),
        }),
      ).toEqual(['front.amount', 'middle.amount', 'back.amount']);
      expect(
        await refusedFields(ReplacePricesRequest, {
          front: egp(15000),
          middle: { amount: 19000, currency: 'USD' },
        }),
      ).toEqual(['middle', 'middle.currency', 'back']);
    });
  });

  describe('special dates', () => {
    it('accepts a closed date without times and an open one with them', async () => {
      await expect(
        validate(CreateSpecialDateRequest, {
          cinemaDate: '2026-10-06',
          label: 'Armed Forces Day',
          closed: false,
          opens: '10:00',
          closes: '03:00',
        }),
      ).resolves.toBeDefined();
      await expect(
        validate(CreateSpecialDateRequest, {
          cinemaDate: '2026-12-31',
          label: 'NYE',
          closed: true,
        }),
      ).resolves.toBeDefined();
    });

    it('refuses an impossible date and times on a closed date', async () => {
      expect(
        await refusedFields(CreateSpecialDateRequest, {
          cinemaDate: '2026-02-30',
          label: 'Holiday',
          closed: true,
          closes: '02:00',
        }),
      ).toEqual(['cinemaDate', 'closes']);
    });

    it('lets a PATCH send one time alone, and needs at least one field', async () => {
      await expect(validate(UpdateSpecialDateRequest, { closes: '02:00' })).resolves.toBeDefined();
      await expect(validate(UpdateSpecialDateRequest, { closed: false })).resolves.toBeDefined();
      expect(await refusedFields(UpdateSpecialDateRequest, {})).toEqual(['cinemaDate']);
      expect(
        await refusedFields(UpdateSpecialDateRequest, { closed: true, opens: '10:00' }),
      ).toEqual(['opens']);
    });
  });

  describe('photos', () => {
    it('takes a caption with a gallery photo only', async () => {
      await expect(
        validate(TheaterPhotoFieldsRequest, { usage: 'gallery', caption: 'The lobby' }),
      ).resolves.toBeDefined();
      await expect(validate(TheaterPhotoFieldsRequest, { usage: 'cover' })).resolves.toBeDefined();
      expect(
        await refusedFields(TheaterPhotoFieldsRequest, { usage: 'cover', caption: 'Front' }),
      ).toEqual(['caption']);
      expect(await refusedFields(TheaterPhotoFieldsRequest, { usage: 'poster' })).toEqual([
        'usage',
      ]);
    });

    it('counts caption and label lengths as Postgres does, emoji selectors included', async () => {
      // 119 letters and "☺️" are 121 characters for Postgres; class-validator's Length counts 120.
      const caption = `${'a'.repeat(119)}☺️`;
      expect(await refusedFields(TheaterPhotoFieldsRequest, { usage: 'gallery', caption })).toEqual(
        ['caption'],
      );
      expect(await refusedFields(UpdateTheaterPhotoRequest, { caption })).toEqual(['caption']);
      expect(
        await refusedFields(UpdateSpecialDateRequest, { label: `${'a'.repeat(79)}☺️` }),
      ).toEqual(['label']);
      await expect(
        validate(UpdateTheaterPhotoRequest, { caption: `${'a'.repeat(118)}☺️` }),
      ).resolves.toBeDefined();
    });

    it('changes a caption (null removes it) or a position, at least one', async () => {
      await expect(validate(UpdateTheaterPhotoRequest, { caption: null })).resolves.toBeDefined();
      await expect(validate(UpdateTheaterPhotoRequest, { position: 0 })).resolves.toBeDefined();
      expect(await refusedFields(UpdateTheaterPhotoRequest, {})).toEqual(['caption']);
      expect(await refusedFields(UpdateTheaterPhotoRequest, { position: -1 })).toEqual([
        'position',
      ]);
    });
  });
});
