import { TEST_FRONTEND_BASE_URL } from '../test-config';

/**
 * The token of the first one-time link to `path` in an email the recording sender captured (the
 * delivery copy: the stored copy never has one). Fails the test when there is none, so a test
 * that expects a link can't pass on a missing one.
 *
 * @example oneTimeTokenFrom(email.text, '/admin/set-password')
 */
export function oneTimeTokenFrom(
  text: string,
  path: string,
  baseUrl: string = TEST_FRONTEND_BASE_URL,
): string {
  const prefix = `${baseUrl}${path}?token=`;
  const start = text.indexOf(prefix);
  if (start === -1) throw new Error(`No one-time link to ${path} in the text`);
  const token = /^[A-Za-z0-9_-]+/.exec(text.slice(start + prefix.length))?.[0];
  if (!token) throw new Error(`The one-time link to ${path} has no token`);
  return token;
}
