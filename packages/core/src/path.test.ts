import { describe, expect, it } from 'vitest';
import { isElementPath, normalizeElementPath } from './path.js';

describe('normalizeElementPath', () => {
  it('keeps a canonical path unchanged', () => {
    expect(normalizeElementPath('/html[1]/body[1]/main[1]/p[2]')).toBe(
      '/html[1]/body[1]/main[1]/p[2]',
    );
  });

  it('drops a trailing text node so text and element findings line up', () => {
    // Alfa reports the text inside the paragraph; axe reports the paragraph.
    expect(normalizeElementPath('/html[1]/body[1]/p[1]/text()[1]')).toBe('/html[1]/body[1]/p[1]');
  });

  it('adds the implicit index engines omit for an only child', () => {
    expect(normalizeElementPath('/html/body/main')).toBe('/html[1]/body[1]/main[1]');
  });

  it('lowercases tag names', () => {
    expect(normalizeElementPath('/HTML[1]/BODY[1]/DIV[3]')).toBe('/html[1]/body[1]/div[3]');
  });

  it('treats the document root as its own path', () => {
    expect(normalizeElementPath('/')).toBe('/');
  });

  it('rejects a text step that is not at the end', () => {
    expect(normalizeElementPath('/html[1]/text()[1]/p[1]')).toBeUndefined();
  });

  it('rejects anything that is not a path', () => {
    expect(normalizeElementPath('div > p:nth-child(2)')).toBeUndefined();
    expect(normalizeElementPath('')).toBeUndefined();
    expect(normalizeElementPath('/html[1]//p[1]')).toBeUndefined();
  });

  it('recognises paths that are already canonical', () => {
    expect(isElementPath('/html[1]/body[1]')).toBe(true);
    expect(isElementPath('/html/body')).toBe(false);
  });
});
