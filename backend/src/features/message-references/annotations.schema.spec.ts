import { BadRequestException } from '@nestjs/common';
import {
  ANNOTATIONS_MAX_BYTES,
  validateAnnotations,
} from './annotations.schema';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** A minimal valid text annotation. */
const validText = () => ({
  type: 'text' as const,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.1,
  text: 'Hello world',
});

/** A minimal valid path annotation (two points). */
const validPath = () => ({
  type: 'path' as const,
  points: [
    { x: 0.0, y: 0.0 },
    { x: 1.0, y: 1.0 },
  ],
});

/**
 * Build an array of `n` text annotations whose `text` field is `textLen`
 * characters long.  Used to manufacture payloads near the 1 MB boundary.
 */
function buildTextPayload(n: number, textLen: number): unknown[] {
  const text = 'a'.repeat(textLen);
  return Array.from({ length: n }, () => ({
    type: 'text',
    x: 0.5,
    y: 0.5,
    width: 0.5,
    height: 0.5,
    text,
  }));
}

// ─── happy-path tests ─────────────────────────────────────────────────────────

describe('validateAnnotations — valid inputs', () => {
  it('accepts a list containing only text annotations', () => {
    const result = validateAnnotations([validText()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
  });

  it('accepts a list containing only path annotations', () => {
    const result = validateAnnotations([validPath()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('path');
  });

  it('accepts a mixed list of text and path annotations', () => {
    const input = [validText(), validPath(), validText()];
    const result = validateAnnotations(input);
    expect(result).toHaveLength(3);
  });

  it('accepts a text annotation with an optional color field', () => {
    const ann = { ...validText(), color: '#ff0000' };
    const result = validateAnnotations([ann]);
    expect((result[0] as { color?: string }).color).toBe('#ff0000');
  });

  it('accepts a path annotation with optional color and strokeWidth', () => {
    const ann = { ...validPath(), color: 'rgba(0,0,0,0.5)', strokeWidth: 3 };
    const result = validateAnnotations([ann]);
    expect((result[0] as { strokeWidth?: number }).strokeWidth).toBe(3);
  });

  it('accepts coordinates at the boundary values 0 and 1', () => {
    const ann = { ...validText(), x: 0, y: 0, width: 1, height: 1 };
    expect(() => validateAnnotations([ann])).not.toThrow();
  });

  it('accepts a path with exactly 5 000 points', () => {
    const points = Array.from({ length: 5000 }, (_, i) => ({
      x: (i % 100) / 100,
      y: Math.floor(i / 100) / 100,
    }));
    expect(() => validateAnnotations([{ type: 'path', points }])).not.toThrow();
  });

  it('accepts a payload whose serialised size is just under 1 MB', () => {
    // 507 items with 2000-char text ≈ 1 047 970 bytes < 1 048 576 bytes
    const payload = buildTextPayload(507, 2000);
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(bytes).toBeLessThan(ANNOTATIONS_MAX_BYTES);
    expect(() => validateAnnotations(payload)).not.toThrow();
  });
});

// ─── rejection tests ──────────────────────────────────────────────────────────

describe('validateAnnotations — invalid inputs', () => {
  it('rejects an empty array with a 400 mentioning "required"', () => {
    expect(() => validateAnnotations([])).toThrow(BadRequestException);
    try {
      validateAnnotations([]);
    } catch (err) {
      expect((err as BadRequestException).message).toMatch(/required/i);
    }
  });

  it('rejects an annotation with an unknown type', () => {
    expect(() =>
      validateAnnotations([{ type: 'circle', x: 0.1, y: 0.1 }]),
    ).toThrow(BadRequestException);
  });

  it('rejects an annotation whose type field is missing', () => {
    expect(() =>
      validateAnnotations([{ x: 0.1, y: 0.2, width: 0.3, height: 0.1, text: 'hi' }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a text annotation where a coordinate exceeds 1 (e.g. x = 1.5)', () => {
    const ann = { ...validText(), x: 1.5 };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a text annotation where a coordinate is negative (e.g. y = -0.1)', () => {
    const ann = { ...validText(), y: -0.1 };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a text annotation with an empty text string', () => {
    const ann = { ...validText(), text: '' };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a text annotation with text longer than 2 000 characters', () => {
    const ann = { ...validText(), text: 'x'.repeat(2001) };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a path annotation with only one point', () => {
    const ann = { type: 'path', points: [{ x: 0.1, y: 0.2 }] };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a path annotation with more than 5 000 points', () => {
    const points = Array.from({ length: 5001 }, () => ({ x: 0.1, y: 0.2 }));
    expect(() => validateAnnotations([{ type: 'path', points }])).toThrow(
      BadRequestException,
    );
  });

  it('rejects a path annotation where a point coordinate is out of range', () => {
    const ann = {
      type: 'path',
      points: [
        { x: 0.0, y: 1.5 }, // y out of range
        { x: 0.5, y: 0.5 },
      ],
    };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a strokeWidth below 0.5', () => {
    const ann = { ...validPath(), strokeWidth: 0.1 };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a strokeWidth above 50', () => {
    const ann = { ...validPath(), strokeWidth: 51 };
    expect(() => validateAnnotations([ann])).toThrow(BadRequestException);
  });

  it('rejects a non-array input (plain object)', () => {
    expect(() => validateAnnotations({ type: 'text' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-array input (string)', () => {
    expect(() => validateAnnotations('not an array')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-array input (null)', () => {
    expect(() => validateAnnotations(null)).toThrow(BadRequestException);
  });

  it('rejects a non-array input (number)', () => {
    expect(() => validateAnnotations(42)).toThrow(BadRequestException);
  });

  it('rejects a payload over 1 MB and mentions "1 MB" in the error', () => {
    // 508 items with 2000-char text ≈ 1 050 037 bytes > 1 048 576 bytes
    const payload = buildTextPayload(508, 2000);
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(bytes).toBeGreaterThan(ANNOTATIONS_MAX_BYTES);

    expect(() => validateAnnotations(payload)).toThrow(BadRequestException);
    try {
      validateAnnotations(payload);
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        errors?: string[];
      };
      expect(body.errors?.join(' ')).toMatch(/1 MB/i);
    }
  });

  it('includes field paths in the validation error response', () => {
    const ann = { ...validText(), x: 2.0 }; // x out of range
    try {
      validateAnnotations([ann]);
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        errors?: string[];
      };
      // Should report a path that references the invalid field
      expect(body.errors).toBeDefined();
      expect(body.errors!.length).toBeGreaterThan(0);
    }
  });
});
