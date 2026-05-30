'use strict';

const { verifySplitSentenceTiming } = require('../challenge-utils');

describe('verifySplitSentenceTiming', () => {
  const wordsPart1 = ['apple', 'mountain', 'tiger'];
  const wordsPart2 = ['ocean', 'castle', 'river'];

  test('passes when first two part-1 words end before reveal and part2 starts after', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 1.1, end: 1.6 },
        { word: 'tiger', start: 1.8, end: 2.2 },
        { word: 'ocean', start: 3.0, end: 3.5 },
        { word: 'castle', start: 3.7, end: 4.1 },
        { word: 'river', start: 4.3, end: 4.7 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 800, 1000);
    expect(timing.match).toBe(true);
    expect(timing.checkedWords).toEqual(['apple', 'mountain']);
  });

  test('passes even when later part-1 words are after reveal', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 1.1, end: 1.6 },
        { word: 'tiger', start: 2.55, end: 2.95 },
        { word: 'ocean', start: 3.1, end: 3.5 },
        { word: 'castle', start: 3.65, end: 4.05 },
        { word: 'river', start: 4.2, end: 4.6 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 300, 1000);
    expect(timing.match).toBe(true);
  });

  test('fails when a first-two part-1 word extends past reveal offset', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 2.5, end: 3.2 },
        { word: 'tiger', start: 3.3, end: 3.8 },
        { word: 'ocean', start: 4.0, end: 4.5 },
        { word: 'castle', start: 4.6, end: 5.0 },
        { word: 'river', start: 5.1, end: 5.5 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 300);
    expect(timing.match).toBe(false);
    expect(timing.reason).toBe('part1_after_reveal');
  });

  test('fails when part2 starts before reveal offset', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 1.1, end: 1.6 },
        { word: 'tiger', start: 1.7, end: 2.0 },
        { word: 'ocean', start: 2.1, end: 2.5 },
        { word: 'castle', start: 2.6, end: 3.0 },
        { word: 'river', start: 3.1, end: 3.5 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 300);
    expect(timing.match).toBe(false);
    expect(timing.reason).toBe('part2_before_reveal');
  });

  test('fails when pause between consecutive words exceeds max gap', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 1.1, end: 1.6 },
        { word: 'tiger', start: 3.0, end: 3.4 },
        { word: 'ocean', start: 3.6, end: 4.0 },
        { word: 'castle', start: 4.2, end: 4.6 },
        { word: 'river', start: 4.8, end: 5.2 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 800, 1000);
    expect(timing.match).toBe(false);
    expect(timing.reason).toBe('word_gap_exceeded');
    expect(timing.between).toEqual(['mountain', 'tiger']);
  });

  test('passes when consecutive word gaps stay within limit', () => {
    const result = {
      words: [
        { word: 'apple', start: 0.5, end: 1.0 },
        { word: 'mountain', start: 1.2, end: 1.7 },
        { word: 'tiger', start: 1.9, end: 2.3 },
        { word: 'ocean', start: 3.0, end: 3.5 },
        { word: 'castle', start: 3.7, end: 4.1 },
        { word: 'river', start: 4.3, end: 4.7 },
      ],
    };

    const timing = verifySplitSentenceTiming(result, wordsPart1, wordsPart2, 2500, 300, 1000);
    expect(timing.match).toBe(true);
  });
});
