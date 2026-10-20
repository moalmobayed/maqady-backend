import { decodeCursor } from '../../../../src/common/pagination/cursor';
import type { MessageLogRepository } from '../../../../src/modules/messaging/message-log.repository';
import { MessageLogService } from '../../../../src/modules/messaging/message-log.service';
import type { MessageLogDetailRow, MessageLogRow } from '../../../../src/modules/messaging/types';

const CREATED = new Date('2026-10-20T09:00:00.123Z');

function row(id: number, createdAt: Date = CREATED): MessageLogRow {
  return {
    id,
    channel: 'email',
    template: 'staff.invite',
    recipient: 'mona@maqady.example',
    subject: "You're invited to the Maqady dashboard",
    status: 'sent',
    attempts: 1,
    last_error_code: null,
    next_attempt_at: null,
    sent_at: createdAt,
    related_customer_id: null,
    related_staff_user_id: 7,
    related_booking_id: null,
    created_at: createdAt,
  };
}

describe('MessageLogService', () => {
  let repository: jest.Mocked<MessageLogRepository>;
  let service: MessageLogService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([row(3), row(2), row(1)]),
      count: jest.fn().mockResolvedValue(9),
      findById: jest.fn(),
    } as unknown as jest.Mocked<MessageLogRepository>;
    service = new MessageLogService(repository);
  });

  it('pages newest first with a cursor of the last row’s created_at instant (milliseconds kept) and id', async () => {
    const filter = { channel: 'email' as const, status: 'sent' as const };
    const page = await service.list(filter, { after: null, limit: 2 });

    expect(repository.list).toHaveBeenCalledWith(filter, { after: null, limit: 2 });
    expect(repository.count).toHaveBeenCalledWith(filter);
    expect(page.total).toBe(9);
    expect(page.items.map((item) => item.id)).toEqual([3, 2]);
    expect(decodeCursor(page.nextCursor!, 'instant')).toEqual({
      sortKey: '2026-10-20T09:00:00.123Z',
      id: 2,
    });
  });

  it('maps a row to an entry with its related records, and ends on the last page', async () => {
    repository.list.mockResolvedValueOnce([row(1)]);
    const page = await service.list({}, { after: null, limit: 20 });
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: 1,
      channel: 'email',
      template: 'staff.invite',
      recipient: 'mona@maqady.example',
      subject: "You're invited to the Maqady dashboard",
      status: 'sent',
      attempts: 1,
      lastErrorCode: null,
      nextAttemptAt: null,
      sentAt: CREATED,
      related: { customerId: null, staffUserId: 7, bookingId: null },
      createdAt: CREATED,
    });
  });

  it('refuses a cursor whose sort key is not an instant', async () => {
    for (const sortKey of ['Mona Adel', 5]) {
      await expect(
        service.list({}, { after: { sortKey, id: 1 }, limit: 20 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [expect.objectContaining({ field: 'cursor' })] },
      });
    }
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('refuses a range whose end is not after its start, on `to`', async () => {
    const at = new Date('2026-10-20T00:00:00Z');
    for (const to of [at, new Date('2026-10-19T00:00:00Z')]) {
      await expect(
        service.list({ from: at, to }, { after: null, limit: 20 }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: [{ field: 'to', messages: ['to must be later than from'] }] },
      });
    }
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('opens one message with its stored bodies, or answers NOT_FOUND', async () => {
    const detail: MessageLogDetailRow = {
      ...row(4),
      body_text: 'Hello\n[one-time link hidden]',
      body_html: '<p>[one-time link hidden]</p>',
      provider_message_id: 're_123',
      updated_at: CREATED,
    };
    repository.findById.mockResolvedValueOnce(detail);
    await expect(service.get(4)).resolves.toMatchObject({
      id: 4,
      bodyText: 'Hello\n[one-time link hidden]',
      bodyHtml: '<p>[one-time link hidden]</p>',
      providerMessageId: 're_123',
      updatedAt: CREATED,
      related: { staffUserId: 7 },
    });

    repository.findById.mockResolvedValueOnce(undefined);
    await expect(service.get(5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
