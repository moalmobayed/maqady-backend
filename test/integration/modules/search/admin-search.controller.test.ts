import type { Response } from 'supertest';
import { OutboxDrainService } from '../../../../src/modules/messaging/outbox-drain.service';
import { EmailSender } from '../../../../src/modules/messaging/senders/email-sender';
import { anonymiseCustomer, paidBookingOf } from '../../../support/admin-customers';
import { counterSale } from '../../../support/box-office';
import { createDraftMovie, createPerson, expectStatus } from '../../../support/catalog';
import { TestClock } from '../../../support/clock';
import { registerCustomer } from '../../../support/customer-auth';
import { bookableShowtime } from '../../../support/holds';
import { RecordingEmailSender } from '../../../support/messaging/recording-email-sender';
import { groupIds, searchStaff, theaterWithStatus } from '../../../support/search';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type {
  BookableShowtimeFixture,
  CustomerSessionFixture,
  StaffSession,
  TestApp,
} from '../../../support/types';

jest.setTimeout(180_000);

/** Saturday 10 October 2026, 10:00 Cairo time; the show is on the 11th at 19:30. */
const NOW = new Date('2026-10-10T10:00:00+03:00');

function expectError(response: Response, status: number, code: string): void {
  expect({ status: response.status, code: response.body?.error?.code }).toEqual({ status, code });
}

const references = (response: Response): string[] =>
  (response.body.bookings.items as { reference: string }[]).map((item) => item.reference);

/**
 * `GET /admin/search` (design §11, §13.2; PRD "Admin search results"): bookings and customers for
 * both roles, the catalog for admins only, an anonymised customer never findable by what they
 * were. Real app and Postgres; only Resend is replaced.
 */
describe('GET /admin/search (integration)', () => {
  let testApp: TestApp;
  let admin: StaffSession;
  let boxOffice: StaffSession;
  let showtime: BookableShowtimeFixture;
  let layla: CustomerSessionFixture;
  let laylaBooking: string;
  let walkInBooking: string;
  const catalog = { draftMovie: 0, person: 0, draftTheater: 0 };
  const clock = new TestClock(NOW);
  const sender = new RecordingEmailSender();

  const staff = async (session: StaffSession, q: string): Promise<Response> =>
    expectStatus(await searchStaff(testApp, session.authorization, q), 200);

  beforeAll(async () => {
    testApp = await createTestApp({
      clock,
      overrides: [{ provide: EmailSender, useValue: sender }],
    });
    admin = await staffSession(testApp, 'admin');
    boxOffice = await staffSession(testApp, 'box_office');
    showtime = await bookableShowtime(testApp, admin);

    layla = await registerCustomer(testApp, {
      fullName: 'Layla Hassan',
      email: 'layla.hassan@example.com',
    });
    expectStatus(
      await testApp
        .http()
        .patch('/api/v1/me')
        .set('Authorization', layla.authorization)
        .send({ phone: '01012345678' }),
      200,
    );
    laylaBooking = (await paidBookingOf(testApp, layla, showtime.showtimeId, ['B2'])).reference;
    const sale = expectStatus(
      await counterSale(testApp, boxOffice.authorization, showtime.showtimeId, ['C3'], {
        method: 'cash',
        customer: { kind: 'contact', fullName: 'Karim Walkin', phone: '01198765432' },
      }),
      201,
    );
    walkInBooking = (sale.body as { booking: { reference: string } }).booking.reference;

    catalog.draftMovie = (await createDraftMovie(testApp, admin, { title: 'Layla and Majnun' })).id;
    catalog.person = (await createPerson(testApp, admin, { fullName: 'Layla Murad' })).id;
    catalog.draftTheater = await theaterWithStatus(testApp, admin, 'draft', {
      name: 'Layla Cinema',
      district: 'Dokki',
    });
  });

  afterAll(async () => {
    await testApp.app.get(OutboxDrainService).whenIdle();
    await testApp.close();
  });

  describe('results by role', () => {
    it('gives admins bookings, customers and the catalog in any status, drafts included', async () => {
      const response = await staff(admin, 'layla');
      expect(references(response)).toEqual([laylaBooking]);
      expect(groupIds(response, 'customers')).toEqual([layla.customerId]);
      expect(groupIds(response, 'movies')).toEqual([catalog.draftMovie]);
      expect(response.body.movies.items[0]).toMatchObject({ status: 'draft', releaseDate: null });
      expect(groupIds(response, 'people')).toEqual([catalog.person]);
      expect(response.body.theaters.items).toEqual([
        expect.objectContaining({ id: catalog.draftTheater, status: 'draft', district: 'Dokki' }),
      ]);
    });

    it('gives box office bookings and customers only: the catalog groups are null', async () => {
      const response = await staff(boxOffice, 'layla');
      expect(references(response)).toEqual([laylaBooking]);
      expect(groupIds(response, 'customers')).toEqual([layla.customerId]);
      expect(response.body).toMatchObject({ movies: null, people: null, theaters: null });
    });

    it('refuses a customer token and a missing one', async () => {
      // A customer token is not a staff token at all (design §10.2: one secret per audience).
      expectError(await searchStaff(testApp, layla.authorization, 'layla'), 401, 'UNAUTHENTICATED');
      const anonymous = await testApp.http().get('/api/v1/admin/search').query({ q: 'layla' });
      expectError(anonymous, 401, 'UNAUTHENTICATED');
    });

    it('is personal data: never cached', async () => {
      const response = await staff(admin, 'layla');
      expect(response.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('bookings', () => {
    it('finds a booking by its whole reference in any case, as the Bookings table shows it', async () => {
      const response = await staff(boxOffice, laylaBooking.toLowerCase());
      expect(response.body.bookings).toEqual({
        hasMore: false,
        items: [
          expect.objectContaining({
            reference: laylaBooking,
            status: 'confirmed',
            paymentStatus: 'paid',
            channel: 'online',
            owner: 'customer',
            seatLabels: ['B2'],
            contact: {
              name: 'Layla Hassan',
              email: 'layla.hassan@example.com',
              phone: '+201012345678',
            },
          }),
        ],
      });
    });

    it('finds bookings by contact name with a typo, part of an email, or a local mobile', async () => {
      expect(references(await staff(boxOffice, 'Layla Hasan'))).toEqual([laylaBooking]);
      expect(references(await staff(boxOffice, 'hassan@exa'))).toEqual([laylaBooking]);
      expect(references(await staff(boxOffice, '01012345678'))).toEqual([laylaBooking]);
      expect(references(await staff(boxOffice, '01198765432'))).toEqual([walkInBooking]);
      expect(references(await staff(boxOffice, 'karim walkin'))).toEqual([walkInBooking]);
    });

    it('treats a partial reference as text, not a reference', async () => {
      expect(references(await staff(admin, laylaBooking.slice(0, 5)))).toEqual([]);
    });
  });

  describe('customers', () => {
    it('finds live customers by name, email or local mobile with their account fields', async () => {
      for (const q of ['layla', 'Laila Hassan', 'LAYLA.HASSAN@', '1234567']) {
        expect({ q, ids: groupIds(await staff(boxOffice, q), 'customers') }).toEqual({
          q,
          ids: [layla.customerId],
        });
      }
      const response = await staff(boxOffice, '01012345678');
      expect(response.body.customers.items).toEqual([
        {
          id: layla.customerId,
          fullName: 'Layla Hassan',
          email: 'layla.hassan@example.com',
          phone: '+201012345678',
          status: 'active',
          emailVerified: false,
          joinedAt: '2026-10-10T10:00:00+03:00',
        },
      ]);
    });

    it('answers at most 10 and says when there are more', async () => {
      for (let n = 1; n <= 11; n += 1) {
        await registerCustomer(testApp, {
          fullName: `Bulk Searcher ${n}`,
          email: `bulk.searcher.${n}@example.com`,
        });
      }
      const response = await staff(admin, 'bulk searcher');
      expect(response.body.customers.items).toHaveLength(10);
      expect(response.body.customers.hasMore).toBe(true);
    });
  });

  it('never finds an anonymised customer, nor their bookings, by their old details', async () => {
    const salma = await registerCustomer(testApp, {
      fullName: 'Salma Nour',
      email: 'salma.nour@example.com',
    });
    expectStatus(
      await testApp
        .http()
        .patch('/api/v1/me')
        .set('Authorization', salma.authorization)
        .send({ phone: '01087654321' }),
      200,
    );
    const booking = await paidBookingOf(testApp, salma, showtime.showtimeId, ['D4']);
    const details = ['Salma Nour', 'salma.nour@', '01087654321', '+201087654321'];

    // Before: every detail finds the customer and the booking.
    for (const q of details) {
      const found = await staff(admin, q);
      expect({ q, customers: groupIds(found, 'customers'), bookings: references(found) }).toEqual({
        q,
        customers: [salma.customerId],
        bookings: [booking.reference],
      });
    }

    expectStatus(await anonymiseCustomer(testApp, admin.authorization, salma.customerId), 200);

    for (const session of [admin, boxOffice]) {
      for (const q of [...details, 'salma', 'nour']) {
        const after = await staff(session, q);
        expect({ q, customers: groupIds(after, 'customers'), bookings: references(after) }).toEqual(
          { q, customers: [], bookings: [] },
        );
      }
    }
    // The booking is kept for accounting and its reference still finds it, without a contact.
    const byReference = await staff(boxOffice, booking.reference);
    expect(byReference.body.bookings.items).toEqual([
      expect.objectContaining({
        reference: booking.reference,
        contact: { name: null, email: null, phone: null },
      }),
    ]);
    expect(byReference.body.customers.items).toEqual([]);
  });

  it('refuses a query under 2 characters', async () => {
    expectError(await searchStaff(testApp, admin.authorization, ' x '), 400, 'VALIDATION_FAILED');
  });
});
