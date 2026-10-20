import { REDACTED_LINK } from './messaging.constants';
import type { SimpleHtmlContent } from './types';

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/**
 * The simple HTML body every template uses (design §13.1): a heading, paragraphs and an
 * optional button-like link, with inline styles because mail clients drop style sheets. Every
 * value is escaped. A redacted action (a stored copy of a one-time link) is written as text, so
 * the stored HTML has nothing to click.
 */
export function renderSimpleHtml(content: SimpleHtmlContent): string {
  const paragraphs = content.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`)
    .join('');
  const action = content.action ? renderAction(content.action.label, content.action.url) : '';
  return [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#ffffff">',
    `<h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(content.heading)}</h1>`,
    paragraphs,
    action,
    '</body></html>',
  ].join('');
}

function renderAction(label: string, url: string): string {
  if (url === REDACTED_LINK) {
    return `<p style="margin:0 0 16px">${escapeHtml(label)}: ${escapeHtml(REDACTED_LINK)}</p>`;
  }
  return (
    `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" ` +
    'style="display:inline-block;padding:12px 20px;background:#b3001b;color:#ffffff;text-decoration:none;border-radius:6px">' +
    `${escapeHtml(label)}</a></p>` +
    `<p style="margin:0 0 16px;font-size:13px;color:#555555">${escapeHtml(url)}</p>`
  );
}
