/**
 * Story: General Channels — pure logic.
 */
import {
  canCreateChannel,
  canModifyMessage,
  canViewChannel,
  htmlToText,
  isBlankMessage,
  sanitizeHtml,
  type GcActor,
} from './general-channels.logic';

const actor = (role: string, isExternal = false, userId = 'u1'): GcActor => ({
  userId,
  role,
  organizationId: isExternal ? 'org-ext' : null,
  isExternal,
});

describe('sanitizeHtml', () => {
  it('keeps bold, italic, lists and safe links', () => {
    const out = sanitizeHtml('<b>bold</b> <i>it</i><ul><li>one</li></ul><a href="https://x.test">x</a>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>it</i>');
    expect(out).toContain('<ul><li>one</li></ul>');
    expect(out).toContain('href="https://x.test"');
  });

  it('removes script elements and their content', () => {
    const out = sanitizeHtml('hi<script>alert(1)</script><SCRIPT src="x"></SCRIPT>');
    expect(out).toBe('hi');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  it('cannot be tricked into re-forming a script tag', () => {
    const out = sanitizeHtml('<scr<script>x</script>ipt>alert(1)</script>');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  it('strips event handlers, styles and javascript: urls', () => {
    const out = sanitizeHtml('<b onclick="evil()" style="x">a</b><a href="javascript:alert(1)" onmouseover=x>l</a><img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/on\w+=/i);
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<img');
    expect(out).toContain('<b>a</b>');
  });

  it('escapes malformed markup and closes unclosed tags', () => {
    const out = sanitizeHtml('<b>open <img src=x onerror=alert(1)');
    expect(out).not.toContain('<img');
    expect(out.endsWith('</b>')).toBe(true);
  });

  it('keeps mention spans', () => {
    expect(sanitizeHtml('<span data-mention-id="u2" onclick="x">@bob</span>')).toBe(
      '<span data-mention-id="u2" class="mention">@bob</span>',
    );
  });

  it('handles non-string input', () => {
    expect(sanitizeHtml(undefined)).toBe('');
    expect(sanitizeHtml(42)).toBe('');
  });
});

describe('isBlankMessage', () => {
  it('treats whitespace, nbsp and empty tags as blank', () => {
    expect(isBlankMessage('')).toBe(true);
    expect(isBlankMessage('   ')).toBe(true);
    expect(isBlankMessage('<p>&nbsp;</p><br>')).toBe(true);
    expect(isBlankMessage('<script>alert(1)</script>')).toBe(true);
    expect(htmlToText('<b> x </b>')).toBe('x');
  });
  it('accepts text, attachments or a reference', () => {
    expect(isBlankMessage('<b>hi</b>')).toBe(false);
    expect(isBlankMessage('', ['f1'])).toBe(false);
    expect(isBlankMessage('', [], 'r1')).toBe(false);
    expect(isBlankMessage('', ['  '], ' ')).toBe(true);
  });
});

describe('channel access policy', () => {
  it('only internal managers and admins create channels', () => {
    expect(canCreateChannel(actor('ADMIN'))).toBe(true);
    expect(canCreateChannel(actor('MANAGER'))).toBe(true);
    expect(canCreateChannel(actor('USER'))).toBe(false);
    expect(canCreateChannel(actor('MANAGER', true))).toBe(false);
  });
  it('hides internal-only channels from external users', () => {
    expect(canViewChannel(actor('USER', true), { internal_only: true })).toBe(false);
    expect(canViewChannel(actor('USER', true), { internal_only: false })).toBe(true);
    expect(canViewChannel(actor('USER'), { internal_only: true })).toBe(true);
  });
  it('only the author may modify a message', () => {
    expect(canModifyMessage(actor('USER', false, 'u1'), { author_id: 'u1' })).toBe(true);
    expect(canModifyMessage(actor('ADMIN', false, 'u2'), { author_id: 'u1' })).toBe(false);
    expect(canModifyMessage(actor('ADMIN'), { author_id: null })).toBe(false);
  });
});
