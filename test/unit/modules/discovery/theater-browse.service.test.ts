import { AppError } from '../../../../src/common/errors/app-error';
import { TheaterBrowseService } from '../../../../src/modules/discovery/theater-browse.service';
import type { TheaterHallCountSource } from '../../../../src/modules/discovery/theater-hall-count.source';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallSummary } from '../../../../src/modules/halls/types';
import type { TheaterHoursService } from '../../../../src/modules/theaters/theater-hours.service';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import type {
  CinemaDateHours,
  Facility,
  OpenState,
  TheaterDetails,
} from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00Z');

function theater(
  id: number,
  name: string,
  facilities: Facility[] = [],
  showContactsPublic = true,
): TheaterDetails {
  return {
    id,
    name,
    status: 'active',
    defaultPrices: null,
    address: `${id} Street`,
    district: 'Zamalek',
    city: 'Cairo',
    latitude: 30,
    longitude: 31,
    transitInfo: 'Metro',
    parkingInfo: null,
    email: `t${id}@maqady.example`,
    showContactsPublic,
    phones: [
      { label: 'Main line', number: '+20227351100' },
      { label: 'Box office', number: '+20227351101' },
    ],
    facilities,
    cover: null,
    photos: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function today(): CinemaDateHours {
  return {
    cinemaDate: '2026-10-16',
    weekday: 5,
    source: 'weekly',
    specialDateLabel: null,
    hours: { closed: false, opensMinute: 720, closesMinute: 1500 },
    window: null,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('TheaterBrowseService', () => {
  const open: OpenState = {
    isOpen: true,
    closesAt: new Date('2026-10-16T22:00:00Z'),
    nextOpensAt: null,
  };
  const closed: OpenState = { isOpen: false, closesAt: null, nextOpensAt: NOW };
  let reads: jest.Mocked<Pick<TheaterReadService, 'listActive' | 'findActive'>>;
  let hours: jest.Mocked<
    Pick<TheaterHoursService, 'openStates' | 'hoursFor' | 'weeklyHours' | 'specialDates'>
  >;
  let halls: jest.Mocked<TheaterHallCountSource>;
  let hallReads: jest.Mocked<Pick<HallReadService, 'listByTheaters'>>;
  let clock: TestClock;
  let service: TheaterBrowseService;

  beforeEach(() => {
    const theaters = [
      theater(1, 'Zamalek', ['valet_parking']),
      theater(2, 'downtown', ['street_parking']),
      theater(3, 'Heliopolis', ['free_parking'], false),
    ];
    reads = {
      listActive: jest.fn().mockResolvedValue(theaters),
      findActive: jest.fn().mockResolvedValue(null),
    };
    hours = {
      openStates: jest
        .fn()
        .mockImplementation((ids: number[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, id === 2 ? closed : open]))),
        ),
      hoursFor: jest
        .fn()
        .mockImplementation((ids: number[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, [today()]]))),
        ),
      weeklyHours: jest.fn().mockResolvedValue(new Map()),
      specialDates: jest.fn().mockResolvedValue(new Map()),
    };
    halls = {
      countsOf: jest
        .fn()
        .mockImplementation((ids: number[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, id * 2]))),
        ),
    };
    hallReads = { listByTheaters: jest.fn().mockResolvedValue(new Map([[1, []]])) };
    clock = new TestClock(NOW);
    service = new TheaterBrowseService(
      reads as unknown as TheaterReadService,
      hours as unknown as TheaterHoursService,
      halls,
      hallReads as unknown as HallReadService,
      clock,
    );
  });

  it('builds the cards alphabetically ignoring case, with open states and hall counts at the instant', async () => {
    const at = new Date('2026-10-16T22:30:00Z');
    const cards = await service.cardsAt(at);
    expect(cards.map((card) => card.name)).toEqual(['downtown', 'Heliopolis', 'Zamalek']);
    expect(hours.openStates).toHaveBeenCalledWith([2, 3, 1], at);
    // 01:30 Cairo time is still the 16th's cinema day.
    expect(hours.hoursFor).toHaveBeenCalledWith([2, 3, 1], '2026-10-16', '2026-10-16');
    expect(cards.map((card) => card.hallCount)).toEqual([4, 6, 2]);
    expect(cards[0]!.openState).toBe(closed);
    expect(cards[0]!.today).toEqual(today());
  });

  it('shows the main phone only when the theater shows its contacts', async () => {
    const cards = await service.cardsAt(NOW);
    const byId = new Map(cards.map((card) => [card.id, card]));
    expect(byId.get(1)!.mainPhone).toEqual({ label: 'Main line', number: '+20227351100' });
    expect(byId.get(3)!.mainPhone).toBeNull();
  });

  it('asks nothing more when there is no active theater', async () => {
    reads.listActive.mockResolvedValue([]);
    expect(await service.cardsAt(NOW)).toEqual([]);
    expect(hours.openStates).not.toHaveBeenCalled();
  });

  it('keeps the theaters open at the Clock with openNow, and free or valet parking with parking', async () => {
    const page = { after: null, limit: 20 };
    const openNow = await service.list({ openNow: true }, page);
    expect(openNow.items.map((card) => card.id)).toEqual([3, 1]);
    expect(openNow.total).toBe(2);
    expect(hours.openStates).toHaveBeenCalledWith(expect.any(Array), NOW);
    const parking = await service.list({ parking: true }, page);
    expect(parking.items.map((card) => card.id)).toEqual([3, 1]);
    const both = await service.list({ openNow: true, parking: true }, { after: null, limit: 1 });
    expect(both.items.map((card) => card.id)).toEqual([3]);
    expect(both.nextCursor).not.toBeNull();
    expect((await service.list({}, page)).total).toBe(3);
  });

  describe('find', () => {
    it('is NOT_FOUND unless the theater is active', async () => {
      expect((await rejection(service.find(9))).code).toBe('NOT_FOUND');
      expect(reads.findActive).toHaveBeenCalledWith(9);
    });

    it('lists the special dates of today and the 6 cinema days after', async () => {
      reads.findActive.mockResolvedValue(theater(1, 'Zamalek'));
      await service.find(1);
      expect(hours.specialDates).toHaveBeenCalledWith([1], '2026-10-16', '2026-10-22');
    });

    it('lists the active halls and counts them, without asking the hall-count seam', async () => {
      const hall = (id: number, name: string): HallSummary =>
        ({
          id,
          theaterId: 1,
          name,
          status: 'active',
          seatCount: 186,
          wheelchairCount: 4,
        }) as HallSummary;
      reads.findActive.mockResolvedValue(theater(1, 'Zamalek'));
      hallReads.listByTheaters.mockResolvedValue(
        new Map([[1, [hall(4, 'Hall 1'), hall(2, 'Hall 2')]]]),
      );
      const view = await service.find(1);
      expect(hallReads.listByTheaters).toHaveBeenCalledWith([1], ['active']);
      expect(view.halls.map((row) => row.id)).toEqual([4, 2]);
      expect(view.hallCount).toBe(2);
      expect(halls.countsOf).not.toHaveBeenCalled();
    });

    it('has no halls and a zero count for a theater without active halls', async () => {
      reads.findActive.mockResolvedValue(theater(1, 'Zamalek'));
      hallReads.listByTheaters.mockResolvedValue(new Map());
      const view = await service.find(1);
      expect(view.halls).toEqual([]);
      expect(view.hallCount).toBe(0);
    });

    it('hides phones and email when the theater hides its contacts', async () => {
      reads.findActive.mockResolvedValue(theater(3, 'Heliopolis', [], false));
      const view = await service.find(3);
      expect(view.phones).toEqual([]);
      expect(view.email).toBeNull();
      expect(view.mainPhone).toBeNull();
      reads.findActive.mockResolvedValue(theater(1, 'Zamalek'));
      const shown = await service.find(1);
      expect(shown.phones).toHaveLength(2);
      expect(shown.email).toBe('t1@maqady.example');
    });
  });
});
