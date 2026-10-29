import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AdminBookingsQuery } from '../../../../../src/modules/bookings/dto/admin-bookings.query';
import { CreateBookingNoteRequest } from '../../../../../src/modules/bookings/dto/booking-note.request';
import { EditBookingRequest } from '../../../../../src/modules/bookings/dto/edit-booking.request';

/** Every failing path, dotted as the global filter reports it (`contact.phone`). */
function paths(errors: readonly ValidationError[], prefix = ''): string[] {
  return errors.flatMap((error) => {
    const path = `${prefix}${error.property}`;
    return error.children && error.children.length > 0 ? paths(error.children, `${path}.`) : [path];
  });
}

async function check<T extends object>(type: new () => T, body: Record<string, unknown>) {
  const instance = plainToInstance(type, body);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, fields: paths(errors) };
}

describe('EditBookingRequest', () => {
  it('accepts any mix of showtime, seats and contact with a reason', async () => {
    const { instance, fields } = await check(EditBookingRequest, {
      showtimeId: 82,
      seats: ['F7', 'F8'],
      contact: { name: '  Laila Hassan ', email: ' Laila@Example.COM ', phone: '01012345678' },
      reason: 'customer_request',
      notify: true,
      payment: { method: 'card_terminal', receiptReference: ' TRX-9 ' },
    });
    expect(fields).toEqual([]);
    expect(instance.contact).toMatchObject({
      name: 'Laila Hassan',
      email: 'laila@example.com',
      phone: '+201012345678',
    });
    expect(instance.payment?.receiptReference).toBe('TRX-9');
    expect(
      (await check(EditBookingRequest, { reason: 'staff_error', contact: { email: null } })).fields,
    ).toEqual([]);
  });

  it.each([
    [{}, 'reason'],
    [{ reason: 'because' }, 'reason'],
    [{ reason: 'staff_error', showtimeId: 0 }, 'showtimeId'],
    [{ reason: 'staff_error', seats: [] }, 'seats'],
    [{ reason: 'staff_error', seats: ['F7', 'F7'] }, 'seats'],
    [{ reason: 'staff_error', seats: ['I1'] }, 'seats'],
    [
      { reason: 'staff_error', seats: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'] },
      'seats',
    ],
    [{ reason: 'staff_error', contact: { name: '   ' } }, 'contact.name'],
    [{ reason: 'staff_error', contact: { email: 'not-an-email' } }, 'contact.email'],
    [{ reason: 'staff_error', contact: { phone: '12345' } }, 'contact.phone'],
    [{ reason: 'staff_error', contact: { nickname: 'x' } }, 'contact.nickname'],
    [{ reason: 'staff_error', payment: { method: 'card' } }, 'payment.method'],
    [{ reason: 'staff_error', payment: { method: 'card_terminal' } }, 'payment.receiptReference'],
    [
      { reason: 'staff_error', payment: { method: 'cash', receiptReference: 'R1' } },
      'payment.receiptReference',
    ],
    [{ reason: 'staff_error', notify: 'yes' }, 'notify'],
    [{ reason: 'staff_error', total: 1 }, 'total'],
  ])('refuses %j on %s', async (body, field) => {
    expect((await check(EditBookingRequest, body)).fields).toContain(field);
  });
});

describe('AdminBookingsQuery', () => {
  it('converts the numbers and trims the search', async () => {
    const { instance, fields } = await check(AdminBookingsQuery, {
      q: '  nadia ',
      theaterId: '3',
      movieId: '12',
      status: 'completed',
      channel: 'counter',
      method: 'card_terminal',
      dateFrom: '2026-10-10',
      dateTo: '2026-10-16',
      limit: '50',
    });
    expect(fields).toEqual([]);
    expect(instance).toMatchObject({ q: 'nadia', theaterId: 3, movieId: 12, limit: 50 });
  });

  it.each([
    [{ q: ' a ' }, 'q'],
    [{ q: 'x'.repeat(101) }, 'q'],
    [{ status: 'cancelled' }, 'status'],
    [{ channel: 'phone' }, 'channel'],
    [{ method: 'cheque' }, 'method'],
    [{ theaterId: '1.5' }, 'theaterId'],
    [{ dateFrom: '16-10-2026' }, 'dateFrom'],
    [{ dateTo: '2026-02-30' }, 'dateTo'],
    [{ sort: 'total' }, 'sort'],
  ])('refuses %j on %s', async (query, field) => {
    expect((await check(AdminBookingsQuery, query)).fields).toContain(field);
  });
});

describe('CreateBookingNoteRequest', () => {
  it('trims the note and keeps it to 1 to 1,000 characters', async () => {
    const { instance, fields } = await check(CreateBookingNoteRequest, { body: '  Late.  ' });
    expect(fields).toEqual([]);
    expect(instance.body).toBe('Late.');
    expect((await check(CreateBookingNoteRequest, { body: 'x'.repeat(1000) })).fields).toEqual([]);
    for (const body of ['   ', 'x'.repeat(1001), 7, 'a\u0000b']) {
      expect((await check(CreateBookingNoteRequest, { body })).fields).toEqual(['body']);
    }
  });
});
