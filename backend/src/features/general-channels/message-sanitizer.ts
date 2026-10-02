/**
 * Allowlist HTML sanitizer for chat message bodies (General Channels).
 *
 * Pure function, no dependencies. Keeps the rich-text formatting the composer
 * produces (bold, italic, lists, links, mentions, line breaks) and drops
 * everything else:
 *  - script/style/iframe/object/embed/template/noscript blocks are removed with their content;
 *  - tags outside the allowlist are dropped (their text content is kept);
 *  - every attribute is dropped except a[href] (http/https/mailto only) and
 *    span[data-mention-id]; so no on* event handlers or style/src attributes survive;
 *  - stray '<' / '>' that don't form a well-formed tag (malformed HTML) are escaped.
 */

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'pre', 'blockquote',
  'p', 'div', 'br', 'ul', 'ol', 'li', 'a', 'span',
]);

const VOID_TAGS = new Set(['br']);

const DANGEROUS_BLOCKS = ['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'xmp'];

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

/** True when the href is safe to keep (http, https, mailto, or relative). */
export function isSafeHref(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  const normalized = decodeBasicEntities(raw).replace(/[\u0000- \u007f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (!scheme) return true;
  return scheme[1] === 'http' || scheme[1] === 'https' || scheme[1] === 'mailto';
}

function rebuildAttrs(tag: string, rawAttrs: string): string {
  const out: string[] = [];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (tag === 'a' && name === 'href') {
      if (isSafeHref(value)) out.push(`href="${escapeAttr(value)}"`);
    } else if (tag === 'span' && name === 'data-mention-id') {
      out.push(`data-mention-id="${escapeAttr(value)}"`);
    }
  }
  if (tag === 'a') out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  return out.length ? ' ' + out.join(' ') : '';
}

export function sanitizeMessageHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let html = input.replace(/<!--[\s\S]*?(-->|$)/g, '');
  for (const tag of DANGEROUS_BLOCKS) {
    const block = new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi');
    html = html.replace(block, '');
  }

  let out = '';
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    out += escapeText(html.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
    } else {
      out += `<${tag}${rebuildAttrs(tag, m[3] ?? '')}>`;
    }
  }
  out += escapeText(html.slice(last));
  return out;
}

/** Visible text of a (sanitized) body, used for the "blank message" check. */
export function messagePlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;| /g, ' ')
    .trim();
}

export function isBlankMessageHtml(html: string): boolean {
  return messagePlainText(html).length === 0;
}
