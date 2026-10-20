import { REDACTED_LINK } from '../../../../src/modules/messaging/messaging.constants';
import { escapeHtml, renderSimpleHtml } from '../../../../src/modules/messaging/simple-html';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('renderSimpleHtml', () => {
  it('escapes the heading, every paragraph and the action', () => {
    const html = renderSimpleHtml({
      heading: 'Hi <b>Omar</b>',
      paragraphs: ['Seats A1 & A2', '"Dune" at 21:30'],
      action: { label: 'View <tickets>', url: 'https://maqady.example/b?x=1&y=2' },
    });
    expect(html).toContain('Hi &lt;b&gt;Omar&lt;/b&gt;');
    expect(html).toContain('Seats A1 &amp; A2');
    expect(html).toContain('&quot;Dune&quot; at 21:30');
    expect(html).toContain('href="https://maqady.example/b?x=1&amp;y=2"');
    expect(html).toContain('View &lt;tickets&gt;');
    expect(html).not.toContain('<b>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('writes a redacted action as plain text, with nothing to click', () => {
    const html = renderSimpleHtml({
      heading: 'Set your password',
      paragraphs: [],
      action: { label: 'Set password', url: REDACTED_LINK },
    });
    expect(html).toContain(`Set password: ${REDACTED_LINK}`);
    expect(html).not.toContain('href=');
  });

  it('renders without an action', () => {
    expect(renderSimpleHtml({ heading: 'Refund sent', paragraphs: ['Done.'] })).not.toContain(
      '<a ',
    );
  });
});
