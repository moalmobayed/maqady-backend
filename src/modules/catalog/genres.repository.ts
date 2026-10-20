import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import type { GenreRow, MovieGenreRow } from './types';

const GENRE_COLUMNS = ['id', 'name', 'slug'] as const;

/** `genres` (seeded, read-only) and `movie_genres` (design §6.2). */
@Injectable()
export class GenresRepository {
  constructor(private readonly db: TransactionContext) {}

  /** Every genre, alphabetical. */
  async listAll(): Promise<GenreRow[]> {
    return this.db
      .executor()('genres')
      .select<GenreRow[]>(GENRE_COLUMNS)
      .orderBy([
        { column: 'name', order: 'asc' },
        { column: 'id', order: 'asc' },
      ]);
  }

  async findByIds(ids: readonly number[]): Promise<GenreRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('genres')
      .select<GenreRow[]>(GENRE_COLUMNS)
      .whereIn('id', [...ids]);
  }

  /** The genres of these movies, by movie then display order, in one query. */
  async genresOf(movieIds: readonly number[]): Promise<MovieGenreRow[]> {
    if (movieIds.length === 0) return [];
    return this.db
      .executor()('movie_genres as mg')
      .join('genres as g', 'g.id', 'mg.genre_id')
      .select<MovieGenreRow[]>('mg.movie_id', 'mg.sort_order', 'g.id', 'g.name', 'g.slug')
      .whereIn('mg.movie_id', [...movieIds])
      .orderBy([
        { column: 'mg.movie_id', order: 'asc' },
        { column: 'mg.sort_order', order: 'asc' },
      ]);
  }

  /** Replaces a movie's genres with these, in this display order. */
  async replaceMovieGenres(movieId: number, genreIds: readonly number[]): Promise<void> {
    await this.movieGenres().where({ movie_id: movieId }).delete();
    if (genreIds.length === 0) return;
    await this.movieGenres().insert(
      genreIds.map((genreId, index) => ({
        movie_id: movieId,
        genre_id: genreId,
        sort_order: index,
      })),
    );
  }

  private movieGenres(): Knex.QueryBuilder {
    return this.db.executor()('movie_genres');
  }
}
