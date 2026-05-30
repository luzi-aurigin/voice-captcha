'use strict';

const { splitSentence } = require('../challenge-utils');

describe('splitSentence', () => {
  test('splits on pipe delimiter', () => {
    const result = splitSentence('apple mountain tiger | ocean castle river');
    expect(result.part1).toBe('apple mountain tiger');
    expect(result.part2).toBe('ocean castle river');
  });

  test('splits on em dash delimiter', () => {
    const result = splitSentence('apple mountain tiger — ocean castle river');
    expect(result.part1).toBe('apple mountain tiger');
    expect(result.part2).toBe('ocean castle river');
  });

  test('falls back to midpoint when no delimiter', () => {
    const result = splitSentence('apple mountain tiger ocean castle river');
    expect(result.part1.split(/\s+/).length).toBe(3);
    expect(result.part2.split(/\s+/).length).toBe(3);
  });
});
