import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchQuery } from '../../../../../src/modules/search/dto/search.query';

async function check(query: Record<string, unknown>) {
  const instance = plainToInstance(SearchQuery, query);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: errors.map((error) => error.property) };
}

describe('SearchQuery', () => {
  it('trims q and accepts 2 to 100 characters', async () => {
    const two = await check({ q: '  ab  ' });
    expect(two.fields).toEqual([]);
    expect(two.instance.q).toBe('ab');
    expect((await check({ q: 'x'.repeat(100) })).fields).toEqual([]);
    expect((await check({ q: '50% off_' })).fields).toEqual([]);
  });

  it.each([
    [{}, 'missing'],
    [{ q: '' }, 'empty'],
    [{ q: '   a   ' }, 'one character after trimming'],
    [{ q: 'x'.repeat(101) }, 'too long'],
    [{ q: 'ab\u0000c' }, 'a NUL character'],
    [{ q: ['ab', 'cd'] }, 'repeated'],
  ])('refuses %j (%s) on q', async (query: Record<string, unknown>, _label: string) => {
    expect((await check(query)).fields).toEqual(['q']);
  });

  it('refuses unknown parameters', async () => {
    expect((await check({ q: 'nile', limit: 50 })).fields).toEqual(['limit']);
  });
});
