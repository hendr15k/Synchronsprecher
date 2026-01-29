import { describe, it, expect } from 'vitest';
import { chunkText } from '../utils/textProcessors';

describe('chunkText', () => {
  it('should return empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('should return single chunk if text is smaller than max size', () => {
    const text = 'Short text';
    expect(chunkText(text, 100)).toEqual(['Short text']);
  });

  it('should split long text by paragraphs', () => {
    const p1 = 'a'.repeat(60);
    const p2 = 'b'.repeat(60);
    const text = `${p1}\n\n${p2}`;
    // Max size 70, so p1 (60) fits. Adding p2 (60) would be 120 > 70.
    // So it should split.
    const chunks = chunkText(text, 70);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it('should split huge paragraphs by sentences', () => {
    // Sentence 1 (60 chars) + Sentence 2 (60 chars) > 70 chars max
    const s1 = 'a'.repeat(59) + '.';
    const s2 = 'b'.repeat(59) + '.';
    const text = `${s1} ${s2}`;

    const chunks = chunkText(text, 70);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(s1);
    expect(chunks[1]).toBe(s2);
  });

  it('should respect maxChunkSize default', () => {
    const text = 'a'.repeat(2000);
    const chunks = chunkText(text); // default 1500
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(1500);
  });
});
