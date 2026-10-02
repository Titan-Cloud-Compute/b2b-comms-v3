import { isBlankMessageHtml, isSafeHref, sanitizeMessageHtml } from './message-sanitizer';

describe('sanitizeMessageHtml', () => {
  it('keeps rich-text formatting', () => {
    const html = '<p><b>bold</b> <i>it</i> <strong>s</strong></p><ul><li>one</li></ul><ol><li>two</li></ol>';
    expect(sanitizeMessageHtml(html)).toBe(html);
  });

  it('keeps safe links and mentions', () => {
    const out = sanitizeMessageHtml('<a href="https://x.test/a" onclick="evil()">x</a> <span data-mention-id="u1" style="color:red">@U</span>');
    expect(out).toContain('href="https://x.test/a"');
    expect(out).toContain('data-mention-id="u1"');
    expect(out).not.toMatch(/onclick|style=/i);
  });

  it('removes script elements and their content', () => {
    const out = sanitizeMessageHtml('hi<script>alert(1)</script><SCRIPT src=x></SCRIPT>there');
    expect(out).toBe('hithere');
    expect(out).not.toMatch(/<script/i);
  });

  it('drops event-handler attributes and disallowed tags', () => {
    const out = sanitizeMessageHtml('<img src=x onerror="alert(1)"><b onmouseover=alert(1)>b</b><svg onload=alert(1)>s</svg>');
    expect(out).toBe('<b>b</b>s');
    expect(out).not.toMatch(/on\w+=/i);
  });

  it('escapes malformed markup so nothing becomes an element', () => {
    const out = sanitizeMessageHtml('<img src=x onerror=alert(1)//');
    expect(out).not.toMatch(/<img/i);
    expect(out.startsWith('&lt;img')).toBe(true);
    expect(sanitizeMessageHtml('<script>alert(1)')).toBe('');
  });

  it('strips javascript: hrefs', () => {
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeMessageHtml('<a href="java&#115;cript:alert(1)">x</a>')).not.toContain('href');
    expect(isSafeHref('mailto:a@b.c')).toBe(true);
    expect(isSafeHref(' JaVaScRiPt:x')).toBe(false);
  });

  it('treats non-string input as empty', () => {
    expect(sanitizeMessageHtml(undefined)).toBe('');
    expect(sanitizeMessageHtml(42)).toBe('');
  });
});

describe('isBlankMessageHtml', () => {
  it('detects blank bodies', () => {
    expect(isBlankMessageHtml('')).toBe(true);
    expect(isBlankMessageHtml('<p>&nbsp; </p><br>')).toBe(true);
    expect(isBlankMessageHtml(sanitizeMessageHtml('<script>x</script>'))).toBe(true);
    expect(isBlankMessageHtml('<b>x</b>')).toBe(false);
  });
});
