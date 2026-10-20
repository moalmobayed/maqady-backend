import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { MediaService } from '../../../../src/modules/media/media.service';
import type { TheaterHoursRepository } from '../../../../src/modules/theaters/theater-hours.repository';
import type { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import { TheaterLifecycleRegistry } from '../../../../src/modules/theaters/theater-lifecycle.registry';
import type { TheaterPhotosRepository } from '../../../../src/modules/theaters/theater-photos.repository';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import type { TheatersRepository } from '../../../../src/modules/theaters/theaters.repository';
import { TheatersService } from '../../../../src/modules/theaters/theaters.service';
import type { DayHours, TheaterRow, TheaterStatus } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 9, role: 'admin' };
const NOW = new Date('2026-10-16T12:00:00+03:00');

function theaterRow(overrides: Partial<TheaterRow> = {}): TheaterRow {
  return {
    id: 1,
    name: 'Maqady Zamalek',
    status: 'draft',
    address: '26 July Street',
    district: 'Zamalek',
    city: 'Cairo',
    latitude: 30.0609,
    longitude: 31.2197,
    transit_info: null,
    parking_info: null,
    email: null,
    show_contacts_public: false,
    cover_image_id: null,
    default_price_front: 15000,
    default_price_middle: 19000,
    default_price_back: 23000,
    currency: 'EGP',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

const openWeek: DayHours[] = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({
  weekday,
  closed: false,
  opensMinute: 720,
  closesMinute: 1500,
}));

describe('TheatersService (collaborators mocked)', () => {
  let row: TheaterRow;
  let weekly: DayHours[];
  let theaters: jest.Mocked<
    Pick<
      TheatersRepository,
      'findByIdForWrite' | 'findByIdForDelete' | 'update' | 'deleteById' | 'findById'
    >
  >;
  let photos: jest.Mocked<Pick<TheaterPhotosRepository, 'photosOf'>>;
  let media: jest.Mocked<Pick<MediaService, 'deleteMany'>>;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let lifecycle: TheaterLifecycleRegistry;
  let service: TheatersService;

  beforeEach(() => {
    row = theaterRow();
    weekly = openWeek;
    theaters = {
      findByIdForWrite: jest.fn().mockImplementation(() => Promise.resolve(row)),
      findByIdForDelete: jest.fn().mockImplementation(() => Promise.resolve(row)),
      findById: jest.fn().mockImplementation(() => Promise.resolve(row)),
      update: jest.fn().mockImplementation(() => Promise.resolve(row)),
      deleteById: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    photos = { photosOf: jest.fn().mockImplementation(() => Promise.resolve([])) };
    media = { deleteMany: jest.fn().mockImplementation(() => Promise.resolve()) };
    audit = { record: jest.fn().mockImplementation(() => Promise.resolve(1)) };
    lifecycle = new TheaterLifecycleRegistry();
    const hours = {
      weeklyHours: jest.fn().mockImplementation(() => Promise.resolve(new Map([[row.id, weekly]]))),
    } as unknown as TheaterHoursService;
    const transactions = {
      run: <T>(fn: () => Promise<T>) => fn(),
    } as unknown as TransactionRepository;
    service = new TheatersService(
      theaters as unknown as TheatersRepository,
      {} as TheaterHoursRepository,
      photos as unknown as TheaterPhotosRepository,
      {} as TheaterReadService,
      hours,
      lifecycle,
      media as unknown as MediaService,
      transactions,
      audit as unknown as AuditService,
      new TestClock(NOW),
    );
    jest.spyOn(service, 'view').mockResolvedValue({} as never);
  });

  const failure = async (promise: Promise<unknown>): Promise<AppError> => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      return error as AppError;
    }
    throw new Error('expected a refusal');
  };

  describe('status changes', () => {
    it.each<[TheaterStatus, TheaterStatus, string]>([
      ['draft', 'active', 'theater.published'],
      ['active', 'sales_paused', 'theater.sales_paused'],
      ['sales_paused', 'active', 'theater.sales_resumed'],
    ])('allows %s → %s, recorded as %s', async (from, to, action) => {
      row = theaterRow({ status: from });
      await service.update(ACTOR, 1, { status: to });
      expect(theaters.update).toHaveBeenCalledWith(1, { status: to, updated_at: NOW });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action, metadata: { from, to } }),
      );
    });

    it.each<[TheaterStatus, TheaterStatus]>([
      ['draft', 'sales_paused'],
      ['active', 'draft'],
      ['sales_paused', 'draft'],
    ])('refuses %s → %s with CONFLICT and writes nothing', async (from, to) => {
      row = theaterRow({ status: from });
      const error = await failure(service.update(ACTOR, 1, { status: to }));
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual({ from, to });
      expect(theaters.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('treats the current status as no change', async () => {
      row = theaterRow({ status: 'active' });
      await service.update(ACTOR, 1, { status: 'active' });
      expect(theaters.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('publishing', () => {
    it('lists the built-in requirements first, then the registered ones in order', async () => {
      row = theaterRow({
        currency: null,
        default_price_front: null,
        default_price_middle: null,
        default_price_back: null,
      });
      weekly = openWeek.map((day) => ({
        ...day,
        closed: true,
        opensMinute: null,
        closesMinute: null,
      }));
      lifecycle.addPublishRequirement({ key: 'active_hall', isMet: () => Promise.resolve(false) });
      lifecycle.addPublishRequirement({ key: 'met_rule', isMet: () => Promise.resolve(true) });
      lifecycle.addPublishRequirement({ key: 'seat_map', isMet: () => Promise.resolve(false) });

      const error = await failure(service.update(ACTOR, 1, { status: 'active' }));
      expect(error.code).toBe('THEATER_NOT_PUBLISHABLE');
      expect(error.details).toEqual({ missing: ['prices', 'hours', 'active_hall', 'seat_map'] });
      expect(theaters.update).not.toHaveBeenCalled();
    });

    it('counts hours as missing until all seven weekdays are set', async () => {
      weekly = openWeek.slice(0, 6);
      const error = await failure(service.update(ACTOR, 1, { status: 'active' }));
      expect(error.details).toEqual({ missing: ['hours'] });
    });

    it('applies field changes and the publish in one write, with two audit rows', async () => {
      await service.update(ACTOR, 1, {
        name: 'Maqady Zamalek Plaza',
        city: 'Cairo',
        status: 'active',
      });

      expect(theaters.update).toHaveBeenCalledTimes(1);
      expect(theaters.update).toHaveBeenCalledWith(1, {
        name: 'Maqady Zamalek Plaza',
        status: 'active',
        updated_at: NOW,
      });
      expect(audit.record.mock.calls.map(([event]) => [event.action, event.changedFields])).toEqual(
        [
          ['theater.updated', ['name']],
          ['theater.published', undefined],
        ],
      );
    });
  });

  it('writes nothing and records nothing for a PATCH that changes nothing', async () => {
    await service.update(ACTOR, 1, { name: 'Maqady Zamalek', latitude: 30.0609, email: null });
    expect(theaters.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  describe('deleting', () => {
    it('refuses a theater that is not a draft, with every reason', async () => {
      row = theaterRow({ status: 'sales_paused' });
      lifecycle.addDeletionBlocker({ key: 'has_showtimes', blocks: () => Promise.resolve(true) });
      const error = await failure(service.delete(ACTOR, 1));
      expect(error.code).toBe('THEATER_NOT_DELETABLE');
      expect(error.details).toEqual({ reasons: ['not_draft', 'has_showtimes'] });
      expect(theaters.deleteById).not.toHaveBeenCalled();
    });

    it('refuses a draft a registered blocker keeps', async () => {
      lifecycle.addDeletionBlocker({ key: 'has_showtimes', blocks: () => Promise.resolve(true) });
      const error = await failure(service.delete(ACTOR, 1));
      expect(error.details).toEqual({ reasons: ['has_showtimes'] });
    });

    it('deletes a free draft with its cover and gallery images', async () => {
      row = theaterRow({ cover_image_id: 40 });
      photos.photosOf.mockResolvedValue([
        {
          id: 1,
          theater_id: 1,
          image_id: 41,
          caption: null,
          sort_order: 0,
          created_at: NOW,
          updated_at: NOW,
        },
        {
          id: 2,
          theater_id: 1,
          image_id: 42,
          caption: null,
          sort_order: 1,
          created_at: NOW,
          updated_at: NOW,
        },
      ]);
      await service.delete(ACTOR, 1);
      expect(theaters.deleteById).toHaveBeenCalledWith(1);
      expect(media.deleteMany).toHaveBeenCalledWith([40, 41, 42]);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'theater.deleted',
          metadata: { photoCount: 2, hadCover: true },
        }),
      );
    });

    it('is NOT_FOUND for a missing theater', async () => {
      theaters.findByIdForDelete.mockResolvedValue(undefined);
      expect((await failure(service.delete(ACTOR, 1))).code).toBe('NOT_FOUND');
    });
  });
});
