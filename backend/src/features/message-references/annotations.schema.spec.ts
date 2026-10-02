import { MAX_ANNOTATIONS_BYTES, parseAnnotations } from './annotations.schema';

describe('parseAnnotations', () => {
  it('accepts text boxes and freehand strokes', () => {
    const r = parseAnnotations([
      { type: 'text', x: 0.1, y: 0.2, text: 'Check this' },
      { type: 'stroke', points: [[0.1, 0.1], [0.2, 0.3]], color: '#e11d48', width: 3 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it('rejects an empty annotation list', () => {
    expect(parseAnnotations([]).ok).toBe(false);
  });

  it('rejects malformed payloads', () => {
    expect(parseAnnotations(null).ok).toBe(false);
    expect(parseAnnotations('nope').ok).toBe(false);
    expect(parseAnnotations([{ type: 'circle', x: 0, y: 0 }]).ok).toBe(false);
    expect(parseAnnotations([{ type: 'text', x: 2, y: 0, text: 'out of page' }]).ok).toBe(false);
    expect(parseAnnotations([{ type: 'text', x: 0, y: 0, text: '' }]).ok).toBe(false);
    expect(parseAnnotations([{ type: 'stroke', points: [] }]).ok).toBe(false);
    expect(parseAnnotations([{ type: 'text', x: 0, y: 0, text: 'a', extra: true }]).ok).toBe(false);
  });

  it('rejects payloads over 1 MB', () => {
    const text = 'x'.repeat(1999);
    const many = Array.from({ length: Math.ceil(MAX_ANNOTATIONS_BYTES / 2000) + 10 }, () => ({
      type: 'text', x: 0.5, y: 0.5, text,
    }));
    const r = parseAnnotations(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 MB/);
  });
});
