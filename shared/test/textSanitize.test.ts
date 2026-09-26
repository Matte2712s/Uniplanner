import { describe, expect, it } from 'vitest';
import { hasControlOrInvisibleChars } from '../src/textSanitize.ts';

describe('hasControlOrInvisibleChars', () => {
  it.each<[string, string]>([
    ['plain ascii', 'Corso di Informatica'],
    ['accented letters', 'Anno all’Universita'],
    ['digits and punctuation', 'Anno 2 - Canale B (2024/25)'],
  ])('accepts %s', (_label, value) => {
    expect(hasControlOrInvisibleChars(value)).toBe(false);
  });

  it.each<[string, string]>([
    ['newline', 'Primo\nanno'],
    ['tab', 'Primo\tanno'],
    ['null byte', 'Primo\x00anno'],
    ['backslash', 'Primo\\anno'],
    ['DEL', 'Primo\x7fanno'],
    ['C1 control', 'Primo\x9fanno'],
    ['zero-width space', 'Primo​anno'],
    ['zero-width joiner', 'Primo‍anno'],
    ['left-to-right mark', 'Primo‎anno'],
    ['bidi override', 'Primo‮anno'],
    ['isolate', 'Primo⁦anno'],
  ])('rejects %s', (_label, value) => {
    expect(hasControlOrInvisibleChars(value)).toBe(true);
  });
});
