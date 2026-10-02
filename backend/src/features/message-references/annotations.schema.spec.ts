import { BadRequestException } from '@nestjs/common';
import {
  ANNOTATIONS_MAX_BYTES,
  Annotation,
  validateAnnotations,
} from './annotations.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validText = (): Annotation => ({
  type: 'text',
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.05,
  text: 'Hello world',
});

const validPath = (): Annotation => ({
  type: 'path',
  points: [
    { x: 0.0, y: 0.0 },
    { x: 0.5, y: 0.5 },
  ],
  strokeWidth: 2,
});

// ---------------------------------------------------------------------------
// Happy-path tests
// ---------------------------------------------------------------------------

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
    const result = validateAnnotations([validText(), validPath()]);
    expect(result).toHaveLength(2);
  });

  it('accepts optional fields being absent (no color, no strokeWidth)', () => {
    const annotation: Annotation = {
      type: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    };
    expect(() => validateAnnotations([annotation])).not.toThrow();
  });

  it('accepts coordinates at boundary values 0 and 1', () => {
    const annotation: Annotation = {
      type: 'text',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      text: 'Boundary',
    };
    expect(() => validateAnnotations([annotation])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Payload just under 1 MB should pass
// ---------------------------------------------------------------------------

describe('validateAnnotations — size boundary', () => {
  it('accepts a payload just under 1 MB', () => {
    // Build a list of small paths whose total serialised size is < 1 MB
    const smallPath = {
      type: 'path',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
    };
    const singleSize = Buffer.byteLength(JSON.stringify([smallPath]));
    const count = Math.floor((ANNOTATIONS_MAX_BYTES - 100) / singleSize);
    const payload = Array.from({ length: count }, () => ({ ...smallPath }));

    // Sanity-check: should be under the cap
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(
      ANNOTATIONS_MAX_BYTES,
    );

    expect(() => validateAnnotations(payload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rejection tests
// ---------------------------------------------------------------------------

describe('validateAnnotations — invalid inputs', () => {
  it('rejects an empty array with a BadRequestException', () => {
    expect(() => validateAnnotations([])).toThrow(BadRequestException);
    try {
      validateAnnotations([]);
    } catch (e) {
      expect((e as BadRequestException).message).toMatch(/required/i);
    }
  });

  it('rejects a non-array input', () => {
    expect(() => validateAnnotations({ type: 'text' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects null', () => {
    expect(() => validateAnnotations(null)).toThrow(BadRequestException);
  });

  it('rejects an item with an unknown type', () => {
    const bad = [{ type: 'circle', x: 0.1, y: 0.1, radius: 0.05 }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects an item with no type field', () => {
    const bad = [{ x: 0.1, y: 0.1, width: 0.1, height: 0.1, text: 'hi' }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a text annotation with an x coordinate > 1', () => {
    const bad = [{ ...validText(), x: 1.5 }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a text annotation with a negative y coordinate', () => {
    const bad = [{ ...validText(), y: -0.1 }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a text annotation with empty text', () => {
    const bad = [{ ...validText(), text: '' }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a text annotation with text exceeding 2000 chars', () => {
    const bad = [{ ...validText(), text: 'a'.repeat(2001) }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a path annotation with fewer than 2 points', () => {
    const bad = [{ type: 'path', points: [{ x: 0.1, y: 0.1 }] }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a path annotation with a point coordinate out of [0,1]', () => {
    const bad = [
      {
        type: 'path',
        points: [
          { x: 1.5, y: 0.5 },
          { x: 0.5, y: 0.5 },
        ],
      },
    ];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a path annotation with strokeWidth below 0.5', () => {
    const bad = [{ ...validPath(), strokeWidth: 0.1 }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('rejects a path annotation with strokeWidth above 50', () => {
    const bad = [{ ...validPath(), strokeWidth: 51 }];
    expect(() => validateAnnotations(bad)).toThrow(BadRequestException);
  });

  it('includes issue paths in the error for schema failures', () => {
    const bad = [{ ...validText(), x: 1.5 }];
    try {
      validateAnnotations(bad);
      fail('should have thrown');
    } catch (e) {
      const response = (e as BadRequestException).getResponse() as {
        errors: string[];
      };
      expect(response.errors).toBeDefined();
      expect(response.errors.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 1 MB size cap
// ---------------------------------------------------------------------------

describe('validateAnnotations — 1 MB size cap', () => {
  it('rejects a ~1.1 MB array of valid paths with a 400 mentioning 1 MB', () => {
    // Construct a path large enough to push the payload above 1 MB
    const bigPath = {
      type: 'path',
      points: Array.from({ length: 5000 }, (_, i) => ({
        x: (i % 100) / 100,
        y: Math.floor(i / 100) / 50,
      })),
    };

    // Determine how many copies to exceed the cap
    const singleSize = Buffer.byteLength(JSON.stringify([bigPath]));
    const count = Math.ceil(ANNOTATIONS_MAX_BYTES / singleSize) + 1;
    const payload = Array.from({ length: count }, () => bigPath);

    // Confirm the payload is actually over the cap
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(
      ANNOTATIONS_MAX_BYTES,
    );

    let caught: BadRequestException | undefined;
    try {
      validateAnnotations(payload);
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).toBeDefined();
    expect(caught).toBeInstanceOf(BadRequestException);

    const response = caught!.getResponse() as {
      message: string;
      errors: string[];
    };
    expect(response.errors).toContain('annotations exceeds 1 MB');
  });
});
