import { Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { TransactionContext } from '../../common/database/transaction-context';
import { AppError } from '../../common/errors/app-error';
import type { PageRequest } from '../../common/pagination/types';
import { ROLE_GROUP_ROLES } from './catalog.constants';
import { PUBLIC_MOVIE_STATUSES } from './enums';
import { containsPattern } from './movie-rules';
import type {
  AdminPersonListFilter,
  CreditRole,
  NewPersonRow,
  PersonRoleRow,
  PersonRow,
  PersonRowUpdate,
  PublicPersonFilter,
} from './types';

const PERSON_COLUMNS = [
  'id',
  'full_name',
  'birth_date',
  'birth_place',
  'nationality',
  'bio',
  'photo_image_id',
  'instagram_url',
  'imdb_url',
  'website_url',
  'created_at',
  'updated_at',
] as const;

const P_COLUMNS = PERSON_COLUMNS.map((column) => `p.${column}`);

/** `people` and `person_roles` (design §6.2). */
@Injectable()
export class PeopleRepository {
  constructor(private readonly db: TransactionContext) {}

  async insert(row: NewPersonRow): Promise<PersonRow> {
    const [inserted] = await this.people().insert(row).returning<PersonRow[]>(PERSON_COLUMNS);
    if (!inserted) throw new AppError('INTERNAL', 'The new person was not returned.');
    return inserted;
  }

  async findById(id: number): Promise<PersonRow | undefined> {
    return this.people().select<PersonRow[]>(PERSON_COLUMNS).where({ id }).first();
  }

  /** The person, locked `FOR NO KEY UPDATE` (credits pointing at them stay insertable). */
  async findByIdForUpdate(id: number): Promise<PersonRow | undefined> {
    return this.people().select<PersonRow[]>(PERSON_COLUMNS).where({ id }).forNoKeyUpdate().first();
  }

  /** The person, locked `FOR UPDATE` for their deletion. */
  async findByIdForDelete(id: number): Promise<PersonRow | undefined> {
    return this.people().select<PersonRow[]>(PERSON_COLUMNS).where({ id }).forUpdate().first();
  }

  /**
   * The ids of these people that exist, locked `FOR KEY SHARE` in ascending id: a person being
   * credited can't be deleted until the credits commit.
   */
  async lockExisting(ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await this.people()
      .select<{ id: number }[]>('id')
      .whereIn('id', [...ids])
      .orderBy('id')
      .forKeyShare();
    return rows.map((row) => row.id);
  }

  async findByIds(ids: readonly number[]): Promise<PersonRow[]> {
    if (ids.length === 0) return [];
    return this.people()
      .select<PersonRow[]>(PERSON_COLUMNS)
      .whereIn('id', [...ids]);
  }

  async update(id: number, changes: PersonRowUpdate): Promise<PersonRow> {
    const [updated] = await this.people()
      .update(changes)
      .where({ id })
      .returning<PersonRow[]>(PERSON_COLUMNS);
    if (!updated) throw new AppError('INTERNAL', 'The person to update is gone.');
    return updated;
  }

  async deleteById(id: number): Promise<void> {
    await this.people().where({ id }).delete();
  }

  /** Replaces the roles set on a person. */
  async replaceRoles(personId: number, roles: readonly CreditRole[]): Promise<void> {
    await this.db.executor()('person_roles').where({ person_id: personId }).delete();
    if (roles.length === 0) return;
    await this.db
      .executor()('person_roles')
      .insert(roles.map((role) => ({ person_id: personId, role })));
  }

  /** The roles set on these people, in one query. */
  async rolesOf(ids: readonly number[]): Promise<PersonRoleRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .executor()('person_roles')
      .select<PersonRoleRow[]>('person_id', 'role')
      .whereIn('person_id', [...ids]);
  }

  // --- Lists --------------------------------------------------------------------------------

  /** Up to `limit + 1` people after the cursor, by name then id. */
  async adminList(filter: AdminPersonListFilter, page: PageRequest): Promise<PersonRow[]> {
    return this.paged(this.filtered(filter), page);
  }

  async adminCount(filter: AdminPersonListFilter): Promise<number> {
    return this.counted(this.filtered(filter));
  }

  /** People credited on at least one public movie, by name then id. */
  async publicList(filter: PublicPersonFilter, page: PageRequest): Promise<PersonRow[]> {
    return this.paged(this.onPublicMovies(this.filtered(filter)), page);
  }

  async publicCount(filter: PublicPersonFilter): Promise<number> {
    return this.counted(this.onPublicMovies(this.filtered(filter)));
  }

  private people(): Knex.QueryBuilder {
    return this.db.executor()('people');
  }

  private async paged(query: Knex.QueryBuilder, page: PageRequest): Promise<PersonRow[]> {
    query
      .select<PersonRow[]>(P_COLUMNS)
      .orderBy([
        { column: 'p.full_name', order: 'asc' },
        { column: 'p.id', order: 'asc' },
      ])
      .limit(page.limit + 1);
    if (page.after) {
      query.whereRaw('(p.full_name, p.id) > (?, ?)', [page.after.sortKey, page.after.id]);
    }
    return query as Promise<PersonRow[]>;
  }

  private async counted(query: Knex.QueryBuilder): Promise<number> {
    const row = (await query.count({ count: 'p.id' }).first()) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** `q` on the name; `roleGroup` by a role set on the person or a credit in one of its roles. */
  private filtered(filter: AdminPersonListFilter): Knex.QueryBuilder {
    const query = this.db.executor()('people as p');
    if (filter.q !== undefined) query.whereRaw('p.full_name ILIKE ?', [containsPattern(filter.q)]);
    if (filter.roleGroup !== undefined) {
      const roles = [...ROLE_GROUP_ROLES[filter.roleGroup]];
      query.whereRaw(
        `(EXISTS (SELECT 1 FROM person_roles r WHERE r.person_id = p.id AND r.role = ANY(?::text[]))
          OR EXISTS (SELECT 1 FROM movie_credits c WHERE c.person_id = p.id AND c.role = ANY(?::text[])))`,
        [roles, roles],
      );
    }
    return query;
  }

  private onPublicMovies(query: Knex.QueryBuilder): Knex.QueryBuilder {
    return query.whereRaw(
      `EXISTS (SELECT 1 FROM movie_credits pc JOIN movies pm ON pm.id = pc.movie_id
        WHERE pc.person_id = p.id AND pm.status = ANY(?::text[]))`,
      [[...PUBLIC_MOVIE_STATUSES]],
    );
  }
}
