import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { Clock } from '../../common/time/clock';
import { CatalogAssembler } from './catalog-assembler.service';
import { fieldErrors } from './catalog-errors';
import { MAX_CREDITS } from './catalog.constants';
import { CreditsRepository } from './credits.repository';
import { MoviesRepository } from './movies.repository';
import { PeopleRepository } from './people.repository';
import type {
  AdminMovie,
  AdminPerson,
  CharacterNameChange,
  CreditInput,
  NewMovieCreditRow,
  PersonCreditInput,
} from './types';

/**
 * Cast and crew, edited from either side (PRD A3 "Filmography can be edited from the person or
 * from the movie"). Both follow the catalog lock order: the movies first, in ascending id, then
 * the people, so a movie-side and a person-side edit never deadlock.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly movies: MoviesRepository,
    private readonly people: PeopleRepository,
    private readonly credits: CreditsRepository,
    private readonly assembler: CatalogAssembler,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /**
   * `PUT /admin/movies/{id}/credits`: the movie's whole cast and crew, in request order. Every
   * person must exist (`VALIDATION_FAILED` on `credits.<i>.personId`); they are locked
   * `FOR KEY SHARE` so none is deleted before the credits commit.
   */
  async replaceForMovie(
    actor: StaffPrincipal,
    movieId: number,
    credits: readonly CreditInput[],
  ): Promise<AdminMovie> {
    return this.transactions.run(async () => {
      const movie = await this.movies.findByIdForUpdate(movieId);
      if (!movie) throw new AppError('NOT_FOUND');
      const existing = new Set(
        await this.people.lockExisting([...new Set(credits.map((credit) => credit.personId))]),
      );
      const unknown = credits.flatMap((credit, index) =>
        existing.has(credit.personId)
          ? []
          : [[`credits.${index}.personId`, 'personId must name an existing person'] as const],
      );
      if (unknown.length > 0) throw fieldErrors(unknown);

      const now = this.clock.now();
      await this.credits.replaceForMovie(
        movieId,
        credits.map((credit, index): NewMovieCreditRow => ({
          movie_id: movieId,
          person_id: credit.personId,
          role: credit.role,
          character_name: credit.characterName,
          sort_order: index,
          created_at: now,
        })),
      );
      await this.movies.touch([movieId], now, actor.id);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'movie.credits_replaced',
        entity: { type: 'movie', id: movieId },
        metadata: { count: credits.length },
      });
      const result = await this.assembler.adminMovie(movieId);
      if (!result) throw new AppError('NOT_FOUND');
      return result;
    });
  }

  /**
   * `PUT /admin/people/{id}/credits`: the person's whole filmography. A credit that stays (same
   * movie and role) keeps its place in the movie's list and takes the new character name; a new
   * one goes last in its movie's list; a dropped one is removed. Each affected movie's list is
   * renumbered `0…n-1` and its "Last edited by" touched. Every movie must exist
   * (`VALIDATION_FAILED` on `credits.<i>.movieId`); a movie that would exceed 200 credits is
   * `CONFLICT { limit }`.
   */
  async replaceForPerson(
    actor: StaffPrincipal,
    personId: number,
    credits: readonly PersonCreditInput[],
  ): Promise<AdminPerson> {
    return this.transactions.run(async () => {
      if (!(await this.people.findById(personId))) throw new AppError('NOT_FOUND');
      const requestedIds = [...new Set(credits.map((credit) => credit.movieId))];
      const currentIds = await this.credits.movieIdsOfPerson(personId);
      const locked = await this.movies.findByIdsForUpdate([
        ...new Set([...requestedIds, ...currentIds]),
      ]);
      const found = new Set(locked.map((movie) => movie.id));
      const unknown = credits.flatMap((credit, index) =>
        found.has(credit.movieId)
          ? []
          : [[`credits.${index}.movieId`, 'movieId must name an existing movie'] as const],
      );
      if (unknown.length > 0) throw fieldErrors(unknown);
      if (!(await this.people.findByIdForUpdate(personId))) throw new AppError('NOT_FOUND');

      const current = await this.credits.ofPerson(personId);
      // A credit added on another movie while this waited for its locks: lock that movie too,
      // so removing the credit renumbers and touches it.
      const lateIds = [...new Set(current.map((row) => row.movie_id))]
        .filter((movieId) => !found.has(movieId))
        .sort((a, b) => a - b);
      await this.movies.findByIdsForUpdate(lateIds);
      const keyOf = (movieId: number, role: string): string => `${movieId}:${role}`;
      const requested = new Map(
        credits.map((credit) => [keyOf(credit.movieId, credit.role), credit]),
      );
      const kept = current.filter((row) => requested.has(keyOf(row.movie_id, row.role)));
      const keptKeys = new Set(kept.map((row) => keyOf(row.movie_id, row.role)));
      const removed = current.filter((row) => !keptKeys.has(keyOf(row.movie_id, row.role)));
      const added = credits.filter((credit) => !keptKeys.has(keyOf(credit.movieId, credit.role)));

      const renamed = kept.flatMap((row) => {
        const characterName = requested.get(keyOf(row.movie_id, row.role))?.characterName ?? null;
        return characterName === row.character_name
          ? []
          : [{ movieId: row.movie_id, change: { id: row.id, characterName } }];
      });
      // Only the movies whose credits change are renumbered and get the new "Last edited by".
      const affected = [
        ...new Set([
          ...removed.map((row) => row.movie_id),
          ...added.map((credit) => credit.movieId),
          ...renamed.map((rename) => rename.movieId),
        ]),
      ].sort((a, b) => a - b);
      await this.credits.deleteByIds(removed.map((row) => row.id));
      await this.credits.setCharacterNames(
        renamed.map((rename): CharacterNameChange => rename.change),
      );
      await this.credits.renumber(affected);
      const counts = await this.credits.countsByMovie(affected);
      const now = this.clock.now();
      const next = new Map(counts);
      const rows: NewMovieCreditRow[] = added.map((credit) => {
        const sortOrder = next.get(credit.movieId) ?? 0;
        next.set(credit.movieId, sortOrder + 1);
        return {
          movie_id: credit.movieId,
          person_id: personId,
          role: credit.role,
          character_name: credit.characterName,
          sort_order: sortOrder,
          created_at: now,
        };
      });
      const full = [...next.entries()].filter(([, count]) => count > MAX_CREDITS);
      if (full.length > 0) {
        throw new AppError('CONFLICT', `A movie has at most ${MAX_CREDITS} credits.`, {
          limit: MAX_CREDITS,
          movieIds: full.map(([movieId]) => movieId),
        });
      }
      await this.credits.insertMany(rows);
      await this.movies.touch(affected, now, actor.id);
      await this.people.update(personId, { updated_at: now });
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'person.credits_replaced',
        entity: { type: 'person', id: personId },
        metadata: { count: credits.length, movieCount: requestedIds.length },
      });
      const result = await this.assembler.adminPerson(personId);
      if (!result) throw new AppError('NOT_FOUND');
      return result;
    });
  }
}
