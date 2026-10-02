import { MAX_ANNOTATIONS_BYTES, isReferenceableMime, parseAnnotations, parsePageNumber } from './annotations.schema';

describe('annotations schema', () => {
  const box = { x: 0.1, y: 0.2, text: 'Check this' };
  const line = { points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], color: '#e00', width: 2 };

  it('accepts text boxes and drawings', () => {
    const r = parseAnnotations({ text_boxes: [box], drawings: [line] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ text_boxes: [box], drawings: [line] });
  });

  it('accepts only drawings or only text boxes', () => {
    expect(parseAnnotations({ drawings: [line] }).ok).toBe(true);
    expect(parseAnnotations({ text_boxes: [box] }).ok).toBe(true);
  });

  it('rejects an empty reference', () => {
    expect(parseAnnotations({ text_boxes: [], drawings: [] }).ok).toBe(false);
    expect(parseAnnotations({}).ok).toBe(false);
  });

  it('rejects malformed payloads', () => {
    expect(parseAnnotations(null).ok).toBe(false);
    expect(parseAnnotations('x').ok).toBe(false);
    expect(parseAnnotations([box]).ok).toBe(false);
    expect(parseAnnotations({ text_boxes: [{ x: 'a', y: 0, text: 'x' }] }).ok).toBe(false);
    expect(parseAnnotations({ text_boxes: [{ x: 2, y: 0, text: 'x' }] }).ok).toBe(false);
    expect(parseAnnotations({ drawings: [{ points: [{ x: 0, y: 0 }] }] }).ok).toBe(false);
    expect(parseAnnotations({ text_boxes: [box], extra: 1 }).ok).toBe(false);
  });

  it('rejects payloads over 1 MB', () => {
    const big = { text_boxes: [{ ...box, text: 'x'.repeat(9_000) }] };
    const many = { text_boxes: Array.from({ length: Math.ceil(MAX_ANNOTATIONS_BYTES / 9_000) + 1 }, () => big.text_boxes[0]) };
    const r = parseAnnotations(many);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 MB/);
  });

  it('only PDF and images are referenceable', () => {
    expect(isReferenceableMime('application/pdf')).toBe(true);
    expect(isReferenceableMime('image/png')).toBe(true);
    expect(isReferenceableMime('IMAGE/JPEG')).toBe(true);
    expect(isReferenceableMime('application/zip')).toBe(false);
    expect(isReferenceableMime('text/plain')).toBe(false);
    expect(isReferenceableMime(null)).toBe(false);
  });

  it('parses page numbers', () => {
    expect(parsePageNumber(3)).toBe(3);
    expect(parsePageNumber('12')).toBe(12);
    expect(parsePageNumber(0)).toBeNull();
    expect(parsePageNumber(1.5)).toBeNull();
    expect(parsePageNumber('abc')).toBeNull();
    expect(parsePageNumber(undefined)).toBeNull();
  });
});
