/**
 * Story: General Channels — pure logic (no Nest, no Prisma).
 * HTML sanitizer, message emptiness check and channel-access policy.
 */

export interface GcActor {
  userId: string;
  role: string;
  organizationId: string | null;
  isExternal: boolean;
}

export interface ChannelLike {
  internal_only?: boolean | null;
}

// ─── Sanitizer ────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'p', 'br', 'div', 'span',
  'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote',
]);
const VOID_TAGS = new Set(['br']);
/** Elements dropped together with their content. */
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math'];
const SAFE_URL = /^(https?:|mailto:|\/(?!\/)|#)/i;

function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

function buildAttrs(tag: string, attrs: Record<string, string>): string {
  const keep: string[] = [];
  if (tag === 'a') {
    const href = (attrs['href'] ?? '').replace(/[\u0000- ]/g, '');
    if (href && SAFE_URL.test(href)) {
      keep.push(`href="${escapeAttr(href)}"`, 'target="_blank"', 'rel="noopener noreferrer"');
    }
  }
  if (tag === 'span') {
    const mention = attrs['data-mention-id'];
    if (mention && /^[A-Za-z0-9_-]{1,64}$/.test(mention)) {
      keep.push(`data-mention-id="${escapeAttr(mention)}"`, 'class="mention"');
    }
  }
  return keep.length ? ' ' + keep.join(' ') : '';
}

/**
 * Allowlist sanitizer: keeps simple formatting tags, links with safe protocols
 * and mention spans. Script-like elements are removed with their content, all
 * other tags are dropped (their text is kept and escaped), and every attribute
 * not explicitly allowed — including on* event handlers and style — is removed.
 */
export function sanitizeHtml(input: unknown): string {
  let html = typeof input === 'string' ? input : '';
  // Remove HTML comments and dangerous elements (repeat until stable so nested
  // tricks like <scr<script></script>ipt> cannot re-form a tag).
  let prev: string;
  do {
    prev = html;
    html = html.replace(/<!--[\s\S]*?(-->|$)/g, '');
    for (const tag of DROP_WITH_CONTENT) {
      html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(<\\/${tag}\\s*>|$)`, 'gi'), '');
      html = html.replace(new RegExp(`<\\/?${tag}\\b[^>]*>?`, 'gi'), '');
    }
  } while (html !== prev);

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  const out: string[] = [];
  const open: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    out.push(escapeText(html.slice(last, m.index)));
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (VOID_TAGS.has(tag)) {
      if (!closing) out.push(`<${tag}>`);
      continue;
    }
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue;
      while (open.length > idx) out.push(`</${open.pop()}>`);
    } else {
      out.push(`<${tag}${buildAttrs(tag, parseAttrs(m[3] ?? ''))}>`);
      open.push(tag);
    }
  }
  out.push(escapeText(html.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** Visible text of a (sanitized) HTML body. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/ |​/g, ' ')
    .trim();
}

/** True when the message has no visible text, no attachments and no reference. */
export function isBlankMessage(bodyHtml: unknown, fileIds: unknown[] = [], referenceId?: unknown): boolean {
  const text = htmlToText(sanitizeHtml(bodyHtml));
  const hasFiles = Array.isArray(fileIds) && fileIds.some((f) => typeof f === 'string' && f.trim() !== '');
  const hasRef = typeof referenceId === 'string' && referenceId.trim() !== '';
  return !text && !hasFiles && !hasRef;
}

// ─── Access policy ────────────────────────────────────────────────────────────

/** Only internal Managers and Admins create channels; Employees and externals get 403. */
export function canCreateChannel(actor: GcActor): boolean {
  return !actor.isExternal && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

/** Internal-only channels are hidden from (and forbidden to) external users. */
export function canViewChannel(actor: GcActor, channel: ChannelLike): boolean {
  return !(channel.internal_only === true && actor.isExternal);
}

/** Only the author may edit or delete a message. */
export function canModifyMessage(actor: GcActor, message: { author_id?: string | null }): boolean {
  return !!message.author_id && message.author_id === actor.userId;
}
