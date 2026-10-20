import type { AuditService } from '../../../../src/common/audit/audit.service';
import type { StaffPrincipal } from '../../../../src/common/auth/types';
import type { TransactionRepository } from '../../../../src/common/database/transaction.repository';
import type { TheaterHoursRepository } from '../../../../src/modules/theaters/theater-hours.repository';
import { TheaterSpecialDatesService } from '../../../../src/modules/theaters/theater-special-dates.service';
import type { TheatersService } from '../../../../src/modules/theaters/theaters.service';
import type { SpecialDateRow } from '../../../../src/modules/theaters/types';
import { TestClock } from '../../../support/clock';

const ACTOR: StaffPrincipal = { kind: 'staff', id: 3, sessionId: 9, role: 'admin' };
// 05:00 on 16 October is still the cinema date 15 October.
const NOW = new Date('2026-10-16T05:00:00+03:00');

describe('TheaterSpecialDatesService (collaborators mocked)', () => {
  let stored: SpecialDateRow;
  let hours: jest.Mocked<
    Pick<TheaterHoursRepository, 'insertSpecialDate' | 'findSpecialDate' | 'updateSpecialDate'>
  >;
  let audit: jest.Mocked<Pick<AuditService, 'record'>>;
  let service: TheaterSpecialDatesService;

  beforeEach(() => {
    stored = {
      id: 4,
      theater_id: 1,
      cinema_date: '2026-10-20',
      label: 'Holiday',
      is_closed: false,
      opens_minute: 600,
      closes_minute: 1620,
      created_at: NOW,
      updated_at: NOW,
    };
    hours = {
      insertSpecialDate: jest.fn().mockImplementation((row) => Promise.resolve({ id: 5, ...row })),
      findSpecialDate: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      updateSpecialDate: jest
        .fn()
        .mockImplementation((id, changes) => Promise.resolve({ ...stored, ...changes, id })),
    };
    audit = { record: jest.fn().mockImplementation(() => Promise.resolve(1)) };
    service = new TheaterSpecialDatesService(
      hours as unknown as TheaterHoursRepository,
      {
        lockForWrite: jest.fn().mockImplementation(() => Promise.resolve({ id: 1 })),
        touch: jest.fn().mockImplementation(() => Promise.resolve()),
      } as unknown as TheatersService,
      { run: <T>(fn: () => Promise<T>) => fn() } as unknown as TransactionRepository,
      audit as unknown as AuditService,
      new TestClock(NOW),
    );
  });

  it("accepts today's cinema date by the wall clock, and refuses the one before", async () => {
    await expect(
      service.create(ACTOR, 1, { cinemaDate: '2026-10-15', label: 'Today', closed: true }),
    ).resolves.toEqual(expect.objectContaining({ cinemaDate: '2026-10-15', closed: true }));
    await expect(
      service.create(ACTOR, 1, { cinemaDate: '2026-10-14', label: 'Past', closed: true }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field: 'cinemaDate', messages: [expect.any(String)] }] },
    });
  });

  it('records only the changed fields, by their API names', async () => {
    await service.update(ACTOR, 1, 4, { closes: '02:00', label: 'Holiday' });
    expect(hours.updateSpecialDate).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ opens_minute: 600, closes_minute: 1560 }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'theater_special_date.updated',
        changedFields: ['closes'],
        metadata: { theaterId: 1, cinemaDate: '2026-10-20' },
      }),
    );
  });

  it('writes nothing when nothing changes', async () => {
    await service.update(ACTOR, 1, 4, { opens: '10:00', closed: false });
    expect(hours.updateSpecialDate).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to change a past special date, which can only be deleted', async () => {
    stored = { ...stored, cinema_date: '2026-10-01' };
    await expect(service.update(ACTOR, 1, 4, { label: 'Renamed' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('refuses to move a past special date to a later date too', async () => {
    stored = { ...stored, cinema_date: '2026-10-01' };
    await expect(
      service.update(ACTOR, 1, 4, { cinemaDate: '2026-10-25', label: 'Renamed' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: [{ field: 'cinemaDate', messages: [expect.any(String)] }] },
    });
    expect(hours.updateSpecialDate).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
