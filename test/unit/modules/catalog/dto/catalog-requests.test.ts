import type { ArgumentMetadata } from '@nestjs/common';
import { AppError } from '../../../../../src/common/errors/app-error';
import { createValidationPipe } from '../../../../../src/common/errors/validation';
import { BulkArchiveMoviesRequest } from '../../../../../src/modules/catalog/dto/bulk-archive-movies.request';
import { CreateMovieRequest } from '../../../../../src/modules/catalog/dto/create-movie.request';
import { CreateMovieVideoRequest } from '../../../../../src/modules/catalog/dto/create-movie-video.request';
import { CreatePersonRequest } from '../../../../../src/modules/catalog/dto/create-person.request';
import { ReplaceMovieCreditsRequest } from '../../../../../src/modules/catalog/dto/replace-movie-credits.request';
import { UpdateMovieRequest } from '../../../../../src/modules/catalog/dto/update-movie.request';
import { UpdateMoviePhotoRequest } from '../../../../../src/modules/catalog/dto/update-movie-photo.request';

/** The fields the global ValidationPipe refuses for a body, or [] when it is valid. */
async function invalidFields(
  metatype: ArgumentMetadata['metatype'],
  body: unknown,
): Promise<string[]> {
  try {
    await createValidationPipe().transform(body, { type: 'body', metatype, data: '' });
    return [];
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return (error.details as { fields: { field: string }[] }).fields.map((entry) => entry.field);
  }
}

async function transformed<T>(metatype: new () => T, body: unknown): Promise<T> {
  return (await createValidationPipe().transform(body, { type: 'body', metatype, data: '' })) as T;
}

describe('catalog request DTOs', () => {
  describe('CreateMovieRequest and UpdateMovieRequest', () => {
    it('trims text and turns an empty optional text into null', async () => {
      const body = await transformed(CreateMovieRequest, {
        title: '  The Last Lighthouse ',
        synopsis: '   ',
        budgetLabel: ' EGP 48M ',
      });
      expect(body).toEqual(
        expect.objectContaining({
          title: 'The Last Lighthouse',
          synopsis: null,
          budgetLabel: 'EGP 48M',
        }),
      );
    });

    it.each([
      ['an empty title', { title: '   ' }, ['title']],
      ['a runtime of 0', { title: 'x', runtimeMinutes: 0 }, ['runtimeMinutes']],
      ['a runtime of 601', { title: 'x', runtimeMinutes: 601 }, ['runtimeMinutes']],
      ['six genres', { title: 'x', genreIds: [1, 2, 3, 4, 5, 6] }, ['genreIds']],
      ['a repeated genre', { title: 'x', genreIds: [1, 1] }, ['genreIds']],
      ['a genre id as text', { title: 'x', genreIds: ['1'] }, ['genreIds']],
      ['an impossible date', { title: 'x', releaseDate: '2026-02-30' }, ['releaseDate']],
      ['an unknown age rating', { title: 'x', ageRating: 'R' }, ['ageRating']],
      ['a synopsis of 601 characters', { title: 'x', synopsis: 'a'.repeat(601) }, ['synopsis']],
      ['a status on create', { title: 'x', status: 'now_showing' }, ['status']],
    ])('CreateMovieRequest refuses %s', async (_label, body, fields) => {
      expect(await invalidFields(CreateMovieRequest, body)).toEqual(fields);
    });

    it.each([
      ['an empty body', {}, ['title']],
      ['a null title', { title: null }, ['title']],
      ['position 0', { featuredPosition: 0 }, ['featuredPosition']],
      ['position 6', { featuredPosition: 6 }, ['featuredPosition']],
      ['an unknown status', { status: 'published' }, ['status']],
    ])('UpdateMovieRequest refuses %s', async (_label, body, fields) => {
      expect(await invalidFields(UpdateMovieRequest, body)).toEqual(fields);
    });

    it('UpdateMovieRequest accepts a single field and nulls that clear', async () => {
      expect(await invalidFields(UpdateMovieRequest, { featuredPosition: null })).toEqual([]);
      expect(
        await invalidFields(UpdateMovieRequest, { heroVideoId: null, synopsis: null }),
      ).toEqual([]);
    });
  });

  describe('ReplaceMovieCreditsRequest', () => {
    it('accepts a character name for an actor or voice only', async () => {
      expect(
        await invalidFields(ReplaceMovieCreditsRequest, {
          credits: [
            { personId: 1, role: 'actor', characterName: 'Youssef' },
            { personId: 2, role: 'voice', characterName: 'The lamp' },
            { personId: 3, role: 'director', characterName: null },
          ],
        }),
      ).toEqual([]);
      expect(
        await invalidFields(ReplaceMovieCreditsRequest, {
          credits: [{ personId: 1, role: 'director', characterName: 'Youssef' }],
        }),
      ).toEqual(['credits.0.characterName']);
    });

    it('refuses a repeated person and role, an unknown role and more than 200 credits', async () => {
      expect(
        await invalidFields(ReplaceMovieCreditsRequest, {
          credits: [
            { personId: 1, role: 'actor' },
            { personId: 1, role: 'director' },
            { personId: 1, role: 'actor' },
          ],
        }),
      ).toEqual(['credits']);
      expect(
        await invalidFields(ReplaceMovieCreditsRequest, {
          credits: [{ personId: 1, role: 'stunts' }],
        }),
      ).toEqual(['credits.0.role']);
      const many = Array.from({ length: 201 }, (_, index) => ({
        personId: index + 1,
        role: 'actor',
      }));
      expect(await invalidFields(ReplaceMovieCreditsRequest, { credits: many })).toEqual([
        'credits',
      ]);
    });
  });

  describe('CreateMovieVideoRequest', () => {
    it.each([
      'https://vimeo.com/123456',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
      'https://youtu.be/',
      'javascript:alert(1)',
    ])('refuses %s on url with the editor message', async (url) => {
      try {
        await createValidationPipe().transform(
          { url, title: 'Trailer', kind: 'trailer' },
          { type: 'body', metatype: CreateMovieVideoRequest, data: '' },
        );
        throw new Error('expected a rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).details).toEqual({
          fields: [{ field: 'url', messages: ["That doesn't look like a YouTube video link."] }],
        });
      }
    });

    it('refuses a duration over ten hours and an unknown kind', async () => {
      expect(
        await invalidFields(CreateMovieVideoRequest, {
          url: 'https://youtu.be/dQw4w9WgXcQ',
          title: 'Trailer',
          kind: 'movie',
          durationSeconds: 36_001,
        }),
      ).toEqual(['kind', 'durationSeconds']);
    });
  });

  describe('UpdateMoviePhotoRequest', () => {
    it('needs at least one field and a known kind', async () => {
      expect(await invalidFields(UpdateMoviePhotoRequest, {})).toEqual(['kind']);
      expect(await invalidFields(UpdateMoviePhotoRequest, { caption: null })).toEqual([]);
      expect(await invalidFields(UpdateMoviePhotoRequest, { kind: 'poster' })).toEqual(['kind']);
    });
  });

  describe('CreatePersonRequest', () => {
    it.each([
      ['a bio of 401 characters', { bio: 'a'.repeat(401) }, ['bio']],
      [
        'an Instagram link on another host',
        { instagramUrl: 'https://www.imdb.com/name/x' },
        ['instagramUrl'],
      ],
      [
        'an IMDb link on a look-alike host',
        { imdbUrl: 'https://imdb.com.evil.example/x' },
        ['imdbUrl'],
      ],
      ['a plain http website', { websiteUrl: 'http://example.com' }, ['websiteUrl']],
      ['an unknown role', { roles: ['stunts'] }, ['roles']],
      ['a repeated role', { roles: ['actor', 'actor'] }, ['roles']],
    ])('refuses %s', async (_label, body, fields) => {
      expect(
        await invalidFields(CreatePersonRequest, { fullName: 'Karim Fahmy', ...body }),
      ).toEqual(fields);
    });

    it('accepts the three social links on their hosts', async () => {
      expect(
        await invalidFields(CreatePersonRequest, {
          fullName: 'Karim Fahmy',
          instagramUrl: 'https://www.instagram.com/karim',
          imdbUrl: 'https://m.imdb.com/name/nm1/',
          websiteUrl: 'https://karim.example/about',
          roles: ['actor', 'voice'],
        }),
      ).toEqual([]);
    });
  });

  describe('BulkArchiveMoviesRequest', () => {
    it('only archives, 1 to 100 distinct ids', async () => {
      expect(
        await invalidFields(BulkArchiveMoviesRequest, { movieIds: [1], status: 'draft' }),
      ).toEqual(['status']);
      expect(
        await invalidFields(BulkArchiveMoviesRequest, { movieIds: [], status: 'archived' }),
      ).toEqual(['movieIds']);
      const many = Array.from({ length: 101 }, (_, index) => index + 1);
      expect(
        await invalidFields(BulkArchiveMoviesRequest, { movieIds: many, status: 'archived' }),
      ).toEqual(['movieIds']);
      expect(
        await invalidFields(BulkArchiveMoviesRequest, { movieIds: [1, 1], status: 'archived' }),
      ).toEqual(['movieIds']);
    });
  });
});
