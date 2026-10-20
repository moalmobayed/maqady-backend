import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  MovieListQuery,
  PublicTheaterListQuery,
} from '../../../../../src/modules/discovery/dto/discovery.queries';

async function parse<T extends object>(
  type: new () => T,
  query: Record<string, unknown>,
): Promise<{ value: T; fields: string[] }> {
  const value = plainToInstance(type, query);
  const errors = await validate(value, { whitelist: true, forbidNonWhitelisted: true });
  return { value, fields: errors.map((error) => error.property) };
}

describe('MovieListQuery', () => {
  it('splits comma-separated genre slugs and person ids', async () => {
    const { value, fields } = await parse(MovieListQuery, {
      genres: ' drama, sci-fi ,,',
      people: '4,9',
      q: '  light ',
    });
    expect(fields).toEqual([]);
    expect(value.genres).toEqual(['drama', 'sci-fi']);
    expect(value.people).toEqual([4, 9]);
    expect(value.q).toBe('light');
  });

  it('joins a repeated parameter before splitting it', async () => {
    const { value } = await parse(MovieListQuery, { genres: ['drama', 'action,comedy'] });
    expect(value.genres).toEqual(['drama', 'action', 'comedy']);
  });

  it('reads an empty filter as an empty list, which filters nothing', async () => {
    const { value, fields } = await parse(MovieListQuery, { genres: '', people: '' });
    expect(fields).toEqual([]);
    expect(value.genres).toEqual([]);
    expect(value.people).toEqual([]);
  });

  it.each([
    ['genres', 'Drama'],
    ['genres', 'sci fi'],
    ['people', '4,x'],
    ['people', '0'],
    ['people', '1.5'],
    ['q', 'a'],
    ['status', 'draft'],
    ['status', 'archived'],
  ])('refuses %s=%s', async (field, raw) => {
    const { fields } = await parse(MovieListQuery, { [field]: raw });
    expect(fields).toEqual([field]);
  });

  it('refuses a person that is not an id with one message', async () => {
    for (const people of ['4,x', '0', '-3']) {
      const value = plainToInstance(MovieListQuery, { people });
      const errors = await validate(value);
      expect({ people, constraints: errors.map((error) => error.constraints) }).toEqual({
        people,
        constraints: [{ isInt: 'each person must be a person id' }],
      });
    }
  });

  it('refuses more than 20 people and 10 genres', async () => {
    const people = Array.from({ length: 21 }, (_, index) => index + 1).join(',');
    const genres = Array.from({ length: 11 }, (_, index) => `g${index}`).join(',');
    expect((await parse(MovieListQuery, { people })).fields).toEqual(['people']);
    expect((await parse(MovieListQuery, { genres })).fields).toEqual(['genres']);
  });
});

describe('PublicTheaterListQuery', () => {
  it('reads true and false', async () => {
    const { value, fields } = await parse(PublicTheaterListQuery, {
      openNow: 'true',
      parking: 'false',
    });
    expect(fields).toEqual([]);
    expect(value.openNow).toBe(true);
    expect(value.parking).toBe(false);
  });

  it.each(['1', 'yes', 'TRUE', ''])('refuses openNow=%s', async (raw) => {
    expect((await parse(PublicTheaterListQuery, { openNow: raw })).fields).toEqual(['openNow']);
  });
});
