import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { StaffPrincipal } from '../../common/auth/types';
import { TransactionRepository } from '../../common/database/transaction.repository';
import { AppError } from '../../common/errors/app-error';
import { toPage } from '../../common/pagination/cursor';
import type { Page, PageRequest } from '../../common/pagination/types';
import { Clock } from '../../common/time/clock';
import { formatCairoIso } from '../../common/time/time';
import { MediaService } from '../media/media.service';
import type { ImageUploadPayload, UploadOutcome } from '../media/types';
import { CatalogAssembler, inRoleOrder } from './catalog-assembler.service';
import { fieldError } from './catalog-errors';
import { CreditsRepository } from './credits.repository';
import { diffPerson, sameSet } from './movie-changes';
import { MoviesRepository } from './movies.repository';
import { PeopleRepository } from './people.repository';
import type {
  AdminPerson,
  AdminPersonListFilter,
  AdminPersonListItem,
  NewPersonInput,
  PersonChanges,
  Presenter,
} from './types';
import { inSequence } from './sequential';

/**
 * People in the admin dashboard (PRD A3): the list, the editor's reads, create, edit, delete
 * and the photo. Deleting a person removes their credits (design §9); the movies they were
 * credited on are locked first (the catalog lock order), renumbered and touched.
 */
@Injectable()
export class PeopleService {
  constructor(
    private readonly people: PeopleRepository,
    private readonly movies: MoviesRepository,
    private readonly credits: CreditsRepository,
    private readonly media: MediaService,
    private readonly assembler: CatalogAssembler,
    private readonly transactions: TransactionRepository,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  /** `GET /admin/people`: by name then id. */
  async list(filter: AdminPersonListFilter, page: PageRequest): Promise<Page<AdminPersonListItem>> {
    const [rows, total] = await inSequence([
      () => this.people.adminList(filter, page),
      () => this.people.adminCount(filter),
    ]);
    const rowPage = toPage(
      rows,
      page,
      total,
      (row) => ({ sortKey: row.full_name, id: row.id }),
      (row) => row,
    );
    return { ...rowPage, items: await this.assembler.adminPersonListItems(rowPage.items) };
  }

  async get(id: number): Promise<AdminPerson> {
    const person = await this.assembler.adminPerson(id);
    if (!person) throw new AppError('NOT_FOUND');
    return person;
  }

  async assertExists(id: number): Promise<void> {
    if (!(await this.people.findById(id))) throw new AppError('NOT_FOUND');
  }

  /** `POST /admin/people`. */
  async create(actor: StaffPrincipal, input: NewPersonInput): Promise<AdminPerson> {
    this.assertBirthDate(input.birthDate);
    return this.transactions.run(async () => {
      const now = this.clock.now();
      const row = await this.people.insert({
        full_name: input.fullName,
        birth_date: input.birthDate ?? null,
        birth_place: input.birthPlace ?? null,
        nationality: input.nationality ?? null,
        bio: input.bio ?? null,
        photo_image_id: null,
        instagram_url: input.instagramUrl ?? null,
        imdb_url: input.imdbUrl ?? null,
        website_url: input.websiteUrl ?? null,
        created_at: now,
        updated_at: now,
      });
      await this.people.replaceRoles(row.id, inRoleOrder(input.roles ?? []));
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'person.created',
        entity: { type: 'person', id: row.id },
      });
      return this.get(row.id);
    });
  }

  /** `PATCH /admin/people/{id}`: details, links and set roles. A change to nothing writes nothing. */
  async update(actor: StaffPrincipal, id: number, changes: PersonChanges): Promise<AdminPerson> {
    this.assertBirthDate(changes.birthDate);
    return this.transactions.run(async () => {
      const row = await this.people.findByIdForUpdate(id);
      if (!row) throw new AppError('NOT_FOUND');
      const diff = diffPerson(row, changes);
      const currentRoles = (await this.people.rolesOf([id])).map((role) => role.role);
      const rolesChanged = changes.roles !== undefined && !sameSet(changes.roles, currentRoles);
      if (diff.changedFields.length === 0 && !rolesChanged) return this.get(id);

      await this.people.update(id, { ...diff.columns, updated_at: this.clock.now() });
      if (rolesChanged) await this.people.replaceRoles(id, inRoleOrder(changes.roles ?? []));
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'person.updated',
        entity: { type: 'person', id },
        changedFields: [...diff.changedFields, ...(rolesChanged ? ['roles'] : [])],
      });
      return this.get(id);
    });
  }

  /**
   * `DELETE /admin/people/{id}`: the person, their roles and their credits; each movie they were
   * credited on is renumbered and touched; their photo's files go after commit.
   */
  async delete(actor: StaffPrincipal, id: number): Promise<void> {
    await this.transactions.run(async () => {
      const lockedIds = await this.credits.movieIdsOfPerson(id);
      await this.movies.findByIdsForUpdate(lockedIds);
      const row = await this.people.findByIdForDelete(id);
      if (!row) throw new AppError('NOT_FOUND');
      // A movie credited on the person while the delete waited for its locks: lock it too, so
      // its list is renumbered and touched. Nothing new can credit the person from here on.
      const credits = await this.credits.ofPerson(id);
      const movieIds = [...new Set(credits.map((credit) => credit.movie_id))].sort((a, b) => a - b);
      const locked = new Set(lockedIds);
      await this.movies.findByIdsForUpdate(movieIds.filter((movieId) => !locked.has(movieId)));
      const creditCount = credits.length;
      await this.people.deleteById(id);
      await this.credits.renumber(movieIds);
      await this.movies.touch(movieIds, this.clock.now(), actor.id);
      if (row.photo_image_id !== null) await this.media.delete(row.photo_image_id);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'person.deleted',
        entity: { type: 'person', id },
        metadata: { creditCount },
      });
    });
  }

  /** `PUT /admin/people/{id}/photo`: square, at least 600 × 600; a replaced photo goes. */
  async uploadPhoto<T>(
    actor: StaffPrincipal,
    id: number,
    upload: ImageUploadPayload,
    present: Presenter<AdminPerson, T>,
  ): Promise<UploadOutcome<T>> {
    await this.assertExists(id);
    return this.media.upload({
      kind: 'person',
      upload,
      actor,
      link: async (image) => {
        const row = await this.people.findByIdForUpdate(id);
        if (!row) throw new AppError('NOT_FOUND');
        await this.people.update(id, { photo_image_id: image.id, updated_at: this.clock.now() });
        if (row.photo_image_id !== null) await this.media.delete(row.photo_image_id);
        await this.audit.record({
          actor: { kind: 'staff', id: actor.id },
          action: 'person.photo_replaced',
          entity: { type: 'person', id },
        });
        return present(await this.get(id));
      },
    });
  }

  /** `DELETE /admin/people/{id}/photo`: removes the photo, if any, and its files. */
  async removePhoto(actor: StaffPrincipal, id: number): Promise<void> {
    await this.transactions.run(async () => {
      const row = await this.people.findByIdForUpdate(id);
      if (!row) throw new AppError('NOT_FOUND');
      if (row.photo_image_id === null) return;
      await this.people.update(id, { photo_image_id: null, updated_at: this.clock.now() });
      await this.media.delete(row.photo_image_id);
      await this.audit.record({
        actor: { kind: 'staff', id: actor.id },
        action: 'person.photo_removed',
        entity: { type: 'person', id },
      });
    });
  }

  /**
   * A birth date can't be after today's calendar date in Cairo: the wall-clock date, not the
   * cinema day (which only turns over at 06:00).
   */
  private assertBirthDate(birthDate: string | null | undefined): void {
    if (birthDate && birthDate > formatCairoIso(this.clock.now()).slice(0, 10)) {
      throw fieldError('birthDate', 'birthDate must not be in the future');
    }
  }
}
