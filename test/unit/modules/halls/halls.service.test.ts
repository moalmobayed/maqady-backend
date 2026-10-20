import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import { AppError } from '../../../../src/common/errors/app-error';
import type { HallLayoutRepository } from '../../../../src/modules/halls/hall-layout.repository';
import { HallLifecycleRegistry } from '../../../../src/modules/halls/hall-lifecycle.registry';
import type { HallReadService } from '../../../../src/modules/halls/hall-read.service';
import type { HallsRepository } from '../../../../src/modules/halls/halls.repository';
import { HallsService } from '../../../../src/modules/halls/halls.service';
import type { HallRow, HallStatus, HallSummary } from '../../../../src/modules/halls/types';
import { TheaterLifecycleRegistry } from '../../../../src/modules/theaters/theater-lifecycle.registry';
import type { TheaterReadService } from '../../../../src/modules/theaters/theater-read.service';
import { TestClock } from '../../../support/clock';

const NOW = new Date('2026-10-16T12:00:00Z');
const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 30, role: 'admin' };

function hallRow(overrides: Partial<HallRow> = {}): HallRow {
  return {
    id: 7,
    theater_id: 2,
    name: 'Hall 1',
    status: 'draft',
    row_count: 12,
    seats_per_row: 16,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function summaryOf(row: HallRow): HallSummary {
  return {
    id: row.id,
    theaterId: row.theater_id,
    name: row.name,
    status: row.status,
    rowCount: row.row_count,
    seatsPerRow: row.seats_per_row,
    seatCount: 192,
    wheelchairCount: 0,
    zoneSeatCounts: { front: 48, middle: 80, back: 64 },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

describe('HallsService', () => {
  let halls: jest.Mocked<HallsRepository>;
  let layouts: jest.Mocked<HallLayoutRepository>;
  let reads: jest.Mocked<HallReadService>;
  let theaters: jest.Mocked<TheaterReadService>;
  let audit: jest.Mocked<AuditService>;
  let lifecycle: HallLifecycleRegistry;
  let theaterLifecycle: TheaterLifecycleRegistry;
  let service: HallsService;
  let calls: string[];

  const withHall = (row: HallRow): void => {
    halls.findById.mockResolvedValue(row);
    halls.findByIdForUpdate.mockImplementation(() => {
      calls.push('hall FOR UPDATE');
      return Promise.resolve(row);
    });
  };

  beforeEach(() => {
    calls = [];
    halls = {
      findById: jest.fn(),
      findByIdForUpdate: jest.fn(),
      insert: jest.fn().mockImplementation((row: HallRow) => Promise.resolve({ ...row, id: 7 })),
      update: jest.fn().mockImplementation(() => Promise.resolve(hallRow())),
      deleteById: jest.fn().mockResolvedValue(undefined),
      hasActiveHall: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<HallsRepository>;
    layouts = {
      replace: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<HallLayoutRepository>;
    reads = {
      summariesOf: jest
        .fn()
        .mockImplementation((rows: HallRow[]) => Promise.resolve(rows.map(summaryOf))),
    } as unknown as jest.Mocked<HallReadService>;
    theaters = {
      findById: jest.fn().mockResolvedValue({ id: 2 }),
      lockForShare: jest.fn().mockImplementation(() => {
        calls.push('theater FOR SHARE');
        return Promise.resolve({ id: 2, name: 'Maqady', status: 'draft', defaultPrices: null });
      }),
    } as unknown as jest.Mocked<TheaterReadService>;
    audit = { record: jest.fn().mockResolvedValue(1) } as unknown as jest.Mocked<AuditService>;
    lifecycle = new HallLifecycleRegistry();
    theaterLifecycle = new TheaterLifecycleRegistry();
    const transactions = {
      run: jest.fn((fn: () => Promise<unknown>) => fn()),
    } as unknown as TransactionRepository;
    service = new HallsService(
      halls,
      layouts,
      reads,
      lifecycle,
      theaters,
      theaterLifecycle,
      transactions,
      audit,
      new TestClock(NOW),
    );
  });

  it('registers active_hall with the theater lifecycle, answered by the repository', async () => {
    service.onModuleInit();
    const [requirement] = theaterLifecycle.publishRequirements();
    expect(requirement?.key).toBe('active_hall');
    halls.hasActiveHall.mockResolvedValueOnce(false);
    await expect(requirement!.isMet(2)).resolves.toBe(false);
    expect(halls.hasActiveHall).toHaveBeenCalledWith(2);
  });

  describe('create', () => {
    it('locks the theater, inserts a 12 × 16 draft with its rows, and audits it', async () => {
      withHall(hallRow());
      const view = await service.create(ACTOR, 2, 'Hall 1');
      expect(calls[0]).toBe('theater FOR SHARE');
      expect(halls.insert).toHaveBeenCalledWith({
        theater_id: 2,
        name: 'Hall 1',
        status: 'draft',
        row_count: 12,
        seats_per_row: 16,
        created_at: NOW,
        updated_at: NOW,
      });
      const [hallId, rows, marks] = layouts.replace.mock.calls[0]!;
      expect(hallId).toBe(7);
      expect(rows).toHaveLength(12);
      expect(rows[8]).toEqual({ hall_id: 7, row_index: 8, row_label: 'J', zone: 'back' });
      expect(marks).toEqual([]);
      expect(audit.record).toHaveBeenCalledWith({
        actor: { kind: 'staff', id: 3 },
        action: 'hall.created',
        entity: { type: 'hall', id: 7 },
        metadata: { theaterId: 2 },
      });
      expect(view).toEqual(expect.objectContaining({ id: 7, deletable: true }));
    });

    it('refuses an unknown theater with NOT_FOUND and writes nothing', async () => {
      theaters.lockForShare.mockResolvedValueOnce(null);
      expect((await rejection(service.create(ACTOR, 99, 'Hall 1'))).code).toBe('NOT_FOUND');
      expect(halls.insert).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it.each<[HallStatus, HallStatus, string]>([
      ['draft', 'active', 'hall.activated'],
      ['draft', 'retired', 'hall.retired'],
      ['active', 'retired', 'hall.retired'],
    ])('allows %s → %s and audits it as %s', async (from, to, action) => {
      withHall(hallRow({ status: from }));
      await service.update(ACTOR, 7, { status: to });
      expect(calls).toEqual(['theater FOR SHARE', 'hall FOR UPDATE']);
      expect(halls.update).toHaveBeenCalledWith(7, { status: to, updated_at: NOW });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action, metadata: { from, to } }),
      );
    });

    it.each<[HallStatus, HallStatus]>([
      ['active', 'draft'],
      ['retired', 'active'],
      ['retired', 'draft'],
    ])('refuses %s → %s with CONFLICT naming both', async (from, to) => {
      withHall(hallRow({ status: from }));
      const error = await rejection(service.update(ACTOR, 7, { status: to }));
      expect({ code: error.code, details: error.details }).toEqual({
        code: 'CONFLICT',
        details: { from, to },
      });
      expect(halls.update).not.toHaveBeenCalled();
    });

    it('refuses retiring with the objecting retirement blockers, in registration order', async () => {
      withHall(hallRow({ status: 'active' }));
      lifecycle.addRetirementBlocker({
        key: 'has_future_showtimes',
        blockedIds: () => Promise.resolve(new Set([7])),
      });
      lifecycle.addRetirementBlocker({
        key: 'quiet',
        blockedIds: () => Promise.resolve(new Set()),
      });
      lifecycle.addRetirementBlocker({
        key: 'also',
        blockedIds: () => Promise.resolve(new Set([7])),
      });
      const error = await rejection(service.update(ACTOR, 7, { status: 'retired' }));
      expect({ code: error.code, details: error.details }).toEqual({
        code: 'HALL_NOT_RETIRABLE',
        details: { reasons: ['has_future_showtimes', 'also'] },
      });
      expect(halls.update).not.toHaveBeenCalled();
    });

    it('asks no retirement blocker when activating', async () => {
      withHall(hallRow());
      const blockedIds = jest.fn().mockResolvedValue(new Set([7]));
      lifecycle.addRetirementBlocker({ key: 'has_future_showtimes', blockedIds });
      await service.update(ACTOR, 7, { status: 'active' });
      expect(blockedIds).not.toHaveBeenCalled();
    });

    it('writes nothing for a PATCH that changes nothing', async () => {
      withHall(hallRow({ status: 'active' }));
      await service.update(ACTOR, 7, { name: 'Hall 1', status: 'active' });
      expect(halls.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('renames and retires in one update with two audit rows; a case change is a rename', async () => {
      withHall(hallRow({ status: 'active' }));
      await service.update(ACTOR, 7, { name: 'HALL 1', status: 'retired' });
      expect(halls.update).toHaveBeenCalledWith(7, {
        name: 'HALL 1',
        status: 'retired',
        updated_at: NOW,
      });
      expect(audit.record.mock.calls.map(([event]) => event.action)).toEqual([
        'hall.updated',
        'hall.retired',
      ]);
      expect(audit.record.mock.calls[0]![0].changedFields).toEqual(['name']);
    });

    it('answers NOT_FOUND for an unknown hall, and for one deleted while it waited', async () => {
      halls.findById.mockResolvedValue(undefined);
      expect((await rejection(service.update(ACTOR, 7, { name: 'x' }))).code).toBe('NOT_FOUND');
      halls.findById.mockResolvedValue(hallRow());
      halls.findByIdForUpdate.mockResolvedValue(undefined);
      expect((await rejection(service.update(ACTOR, 7, { name: 'x' }))).code).toBe('NOT_FOUND');
      expect(halls.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a hall no blocker keeps, under both locks, and audits it', async () => {
      withHall(hallRow({ status: 'active' }));
      await service.delete(ACTOR, 7);
      expect(calls).toEqual(['theater FOR SHARE', 'hall FOR UPDATE']);
      expect(halls.deleteById).toHaveBeenCalledWith(7);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'hall.deleted', metadata: { theaterId: 2 } }),
      );
    });

    it('refuses with HALL_NOT_DELETABLE and the objecting keys', async () => {
      withHall(hallRow());
      lifecycle.addDeletionBlocker({
        key: 'has_showtimes',
        blockedIds: () => Promise.resolve(new Set([7])),
      });
      const error = await rejection(service.delete(ACTOR, 7));
      expect({ code: error.code, details: error.details }).toEqual({
        code: 'HALL_NOT_DELETABLE',
        details: { reasons: ['has_showtimes'] },
      });
      expect(halls.deleteById).not.toHaveBeenCalled();
    });
  });

  describe('views', () => {
    it('marks a hall a deletion blocker keeps as not deletable, asking once for the page', async () => {
      const rows = [hallRow({ id: 1, name: 'A' }), hallRow({ id: 2, name: 'B' })];
      halls.listByTheater = jest.fn().mockResolvedValue(rows);
      halls.countByTheater = jest.fn().mockResolvedValue(2);
      const blockedIds = jest.fn().mockResolvedValue(new Set([2]));
      lifecycle.addDeletionBlocker({ key: 'has_showtimes', blockedIds });
      const page = await service.list(2, {}, { after: null, limit: 20 });
      expect(page.items.map((item) => [item.id, item.deletable])).toEqual([
        [1, true],
        [2, false],
      ]);
      expect(blockedIds).toHaveBeenCalledTimes(1);
      expect(blockedIds).toHaveBeenCalledWith([1, 2]);
    });

    it('answers NOT_FOUND for the halls of an unknown theater', async () => {
      theaters.findById.mockResolvedValueOnce(null);
      expect((await rejection(service.list(9, {}, { after: null, limit: 20 }))).code).toBe(
        'NOT_FOUND',
      );
    });
  });
});
