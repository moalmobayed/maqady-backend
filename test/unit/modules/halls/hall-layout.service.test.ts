import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { HallLayoutRepository } from '../../../../src/modules/halls/hall-layout.repository';
import { HallLayoutService } from '../../../../src/modules/halls/hall-layout.service';
import { HallLifecycleRegistry } from '../../../../src/modules/halls/hall-lifecycle.registry';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallsRepository } from '../../../../src/modules/halls/halls.repository';
import type {
  HallLayout,
  HallLayoutInput,
  HallRow,
  HallRowUpdate,
} from '../../../../src/modules/halls/types';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00Z');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' };

const INPUT: HallLayoutInput = {
  rowCount: 4,
  seatsPerRow: 8,
  rowZones: ['front', 'middle', 'middle', 'back'],
  seatMarks: [
    { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
    { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
  ],
};

function hallRow(overrides: Partial<HallRow> = {}): HallRow {
  return {
    id: 7,
    theater_id: 2,
    name: 'Hall 1',
    status: 'active',
    row_count: 12,
    seats_per_row: 16,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
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

describe('HallLayoutService', () => {
  let halls: jest.Mocked<HallsRepository>;
  let layouts: jest.Mocked<HallLayoutRepository>;
  let theaters: jest.Mocked<TheaterReadService>;
  let audit: jest.Mocked<AuditService>;
  let lifecycle: HallLifecycleRegistry;
  let service: HallLayoutService;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    halls = {
      findById: jest.fn().mockResolvedValue(hallRow()),
      findByIdForUpdate: jest.fn().mockImplementation(() => {
        calls.push('hall FOR UPDATE');
        return Promise.resolve(hallRow());
      }),
      update: jest.fn().mockImplementation((id: number, changes: HallRowUpdate) => {
        calls.push('update hall');
        return Promise.resolve(
          hallRow({
            id,
            row_count: changes.row_count!,
            seats_per_row: changes.seats_per_row!,
            updated_at: changes.updated_at,
          }),
        );
      }),
    } as unknown as jest.Mocked<HallsRepository>;
    layouts = {
      replace: jest.fn().mockImplementation(() => {
        calls.push('replace layout');
        return Promise.resolve();
      }),
    } as unknown as jest.Mocked<HallLayoutRepository>;
    theaters = {
      lockForShare: jest.fn().mockImplementation(() => {
        calls.push('theater FOR SHARE');
        return Promise.resolve({ id: 2 });
      }),
    } as unknown as jest.Mocked<TheaterReadService>;
    audit = {
      record: jest.fn().mockImplementation(() => {
        calls.push('audit');
        return Promise.resolve(1);
      }),
    } as unknown as jest.Mocked<AuditService>;
    lifecycle = new HallLifecycleRegistry();
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new HallLayoutService(
      halls,
      layouts,
      { findLayout: jest.fn() } as unknown as HallReadService,
      lifecycle,
      theaters,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  it('locks theater, participants, then hall; checks, writes, then lets participants react', async () => {
    const saved: HallLayout[] = [];
    lifecycle.addLayoutParticipant({
      key: 'capacity',
      beforeLock: () => {
        calls.push('capacity beforeLock');
        return Promise.resolve();
      },
      afterSave: (_, layout) => {
        calls.push('capacity afterSave');
        saved.push(layout);
        return Promise.resolve();
      },
    });
    lifecycle.addLayoutParticipant({
      key: 'claims',
      blockingShowtimes: () => {
        calls.push('claims blockingShowtimes');
        return Promise.resolve([]);
      },
    });

    const layout = await service.replace(ACTOR, 7, INPUT);
    expect(calls).toEqual([
      'theater FOR SHARE',
      'capacity beforeLock',
      'hall FOR UPDATE',
      'claims blockingShowtimes',
      'update hall',
      'replace layout',
      'capacity afterSave',
      'audit',
    ]);
    expect(halls.update).toHaveBeenCalledWith(7, {
      row_count: 4,
      seats_per_row: 8,
      updated_at: NOW,
    });
    const [, rows, marks] = layouts.replace.mock.calls[0]!;
    expect(rows.map((row) => `${row.row_label}:${row.zone}`)).toEqual([
      'A:front',
      'B:middle',
      'C:middle',
      'D:back',
    ]);
    expect(marks).toEqual([
      { hall_id: 7, row_label: 'D', seat_number: 8, kind: 'no_seat' },
      { hall_id: 7, row_label: 'A', seat_number: 1, kind: 'wheelchair' },
    ]);
    expect(layout).toEqual(
      expect.objectContaining({
        hallId: 7,
        rowCount: 4,
        seatsPerRow: 8,
        aisleAfter: [4],
        seatCount: 31,
        wheelchairCount: 1,
        zoneSeatCounts: { front: 8, middle: 16, back: 7 },
        seatMarks: [
          { rowLabel: 'A', seatNumber: 1, kind: 'wheelchair' },
          { rowLabel: 'D', seatNumber: 8, kind: 'no_seat' },
        ],
      }),
    );
    expect(saved).toEqual([layout]);
    expect(audit.record).toHaveBeenCalledWith({
      actor: { kind: 'staff', id: 3 },
      action: 'hall.layout_replaced',
      entity: { type: 'hall', id: 7 },
      metadata: { rowCount: 4, seatsPerRow: 8, seatCount: 31, wheelchairCount: 1 },
    });
  });

  it('refuses with HALL_IN_USE, soonest showtimes first in Cairo time, and writes nothing', async () => {
    lifecycle.addLayoutParticipant({
      key: 'claims',
      blockingShowtimes: () =>
        Promise.resolve([
          { showtimeId: 9, startsAt: new Date('2026-10-17T17:00:00Z'), movieTitle: 'Later' },
          { showtimeId: 4, startsAt: new Date('2026-10-16T16:30:00Z'), movieTitle: 'Sooner' },
        ]),
    });
    const error = await rejection(service.replace(ACTOR, 7, INPUT));
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'HALL_IN_USE',
      details: {
        showtimes: [
          { id: 4, startsAt: '2026-10-16T19:30:00+03:00', movieTitle: 'Sooner' },
          { id: 9, startsAt: '2026-10-17T20:00:00+03:00', movieTitle: 'Later' },
        ],
      },
    });
    expect(halls.update).not.toHaveBeenCalled();
    expect(layouts.replace).not.toHaveBeenCalled();
  });

  it('lists at most 20 blocking showtimes', async () => {
    lifecycle.addLayoutParticipant({
      key: 'claims',
      blockingShowtimes: () =>
        Promise.resolve(
          Array.from({ length: 25 }, (_, index) => ({
            showtimeId: index + 1,
            startsAt: new Date(Date.UTC(2026, 9, 17, 0, index)),
            movieTitle: 'Movie',
          })),
        ),
    });
    const error = await rejection(service.replace(ACTOR, 7, INPUT));
    expect((error.details as { showtimes: unknown[] }).showtimes).toHaveLength(20);
  });

  it('refuses a retired hall with CONFLICT before taking any lock', async () => {
    halls.findById.mockResolvedValue(hallRow({ status: 'retired' }));
    const error = await rejection(service.replace(ACTOR, 7, INPUT));
    expect({ code: error.code, details: error.details }).toEqual({
      code: 'CONFLICT',
      details: { status: 'retired' },
    });
    expect(calls).toEqual([]);
  });

  it('refuses a hall retired while the save waited for its lock', async () => {
    halls.findByIdForUpdate.mockResolvedValue(hallRow({ status: 'retired' }));
    expect((await rejection(service.replace(ACTOR, 7, INPUT))).code).toBe('CONFLICT');
    expect(halls.update).not.toHaveBeenCalled();
  });

  it('refuses an invalid layout with VALIDATION_FAILED before taking any lock', async () => {
    const error = await rejection(
      service.replace(ACTOR, 7, { ...INPUT, rowZones: ['back', 'front', 'back', 'back'] }),
    );
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(calls).toEqual([]);
  });

  it('answers NOT_FOUND for an unknown hall', async () => {
    halls.findById.mockResolvedValue(undefined);
    expect((await rejection(service.replace(ACTOR, 7, INPUT))).code).toBe('NOT_FOUND');
    await expect(service.get(7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
