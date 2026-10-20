import { registerCustomer } from '../../../support/customer-auth';
import { listHttpRoutes, samplePath } from '../../../support/routes';
import { staffSession } from '../../../support/staff-auth';
import { createTestApp } from '../../../support/test-app';
import type { HttpRoute, TestApp } from '../../../support/types';

jest.setTimeout(60_000);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Design 10.1: a customer token never opens a staff route, and a staff token never acts as a customer. */
describe('Customer and staff audiences (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const call = (route: HttpRoute, authorization: string) =>
    testApp
      .http()
      [route.method.toLowerCase() as Method](samplePath(route.path))
      .set('Authorization', authorization)
      .send({});

  it('refuses a staff token on every customer route', async () => {
    const admin = await staffSession(testApp, 'admin');
    const routes = listHttpRoutes(testApp).filter((route) => route.access === 'customer');
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining([
        'GET /api/v1/me',
        'PATCH /api/v1/me',
        'PUT /api/v1/me/password',
        'DELETE /api/v1/auth/sessions/current',
        'POST /api/v1/auth/email-verification-requests',
      ]),
    );
    for (const route of routes) {
      const response = await call(route, admin.authorization);
      expect({
        route: route.handler,
        status: response.status,
        code: response.body?.error?.code,
      }).toEqual({ route: route.handler, status: 401, code: 'UNAUTHENTICATED' });
    }
  });

  it('refuses a customer token on every staff and admin route', async () => {
    const customer = await registerCustomer(testApp);
    const routes = listHttpRoutes(testApp).filter(
      (route) => route.access === 'staff' || route.access === 'admin',
    );
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(
      expect.arrayContaining(['GET /api/v1/admin/me', 'GET /api/v1/admin/staff']),
    );
    for (const route of routes) {
      const response = await call(route, customer.authorization);
      expect({
        route: route.handler,
        status: response.status,
        code: response.body?.error?.code,
      }).toEqual({ route: route.handler, status: 401, code: 'UNAUTHENTICATED' });
    }
    // The same customer token still works where it belongs.
    const me = await testApp.http().get('/api/v1/me').set('Authorization', customer.authorization);
    expect(me.status).toBe(200);
  });
});
