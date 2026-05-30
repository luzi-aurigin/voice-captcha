'use strict';

const { wordsMatch, normalizeWord } = require('../challenge-utils');

/** Mirror verifyWordsAlignment text gate: all expected words found in transcription. */
function allExpectedWordsFound(transcription, expectedWords) {
  if (!transcription || !expectedWords || expectedWords.length === 0) return false;

  const cleaned = transcription.toLowerCase()
    .replace(/[.,!?;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const spokenText = cleaned.split(/\s+/).filter(w => w.length > 0);
  const expected = expectedWords.map(normalizeWord);

  return expected.every(exp => spokenText.some(sp => wordsMatch(sp, exp)));
}

describe('wordsMatch', () => {
  test('exact match', () => {
    expect(wordsMatch('apple', 'apple')).toBe(true);
  });

  test('plural suffix passes', () => {
    expect(wordsMatch('elephants', 'elephant')).toBe(true);
  });

  test('partial spoken word passes when expected is longer', () => {
    expect(wordsMatch('eleph', 'elephant')).toBe(true);
  });

  test('unrelated words fail', () => {
    expect(wordsMatch('banana', 'apple')).toBe(false);
  });
});

describe('allExpectedWordsFound (transcription gate)', () => {
  test('exact match passes', () => {
    expect(allExpectedWordsFound('apple banana cherry', ['apple', 'banana', 'cherry'])).toBe(true);
  });

  test('partial match — plural suffix passes', () => {
    expect(allExpectedWordsFound('I see elephants and tigers', ['elephant', 'tiger'])).toBe(true);
  });

  test('case insensitive', () => {
    expect(allExpectedWordsFound('Apple BANANA Cherry', ['apple', 'banana', 'cherry'])).toBe(true);
  });

  test('missing word fails', () => {
    expect(allExpectedWordsFound('apple banana', ['apple', 'banana', 'cherry'])).toBe(false);
  });

  test('empty transcription fails', () => {
    expect(allExpectedWordsFound('', ['apple'])).toBe(false);
    expect(allExpectedWordsFound(null, ['apple'])).toBe(false);
  });

  test('empty expected words returns false', () => {
    expect(allExpectedWordsFound('apple banana', [])).toBe(false);
  });

  test('punctuation in transcription is ignored', () => {
    expect(allExpectedWordsFound('apple, banana. cherry!', ['apple', 'banana', 'cherry'])).toBe(true);
  });

  test('extra words in transcription do not matter', () => {
    expect(allExpectedWordsFound(
      'um okay so apple and then banana also cherry right',
      ['apple', 'banana', 'cherry']
    )).toBe(true);
  });

  test('word order does not matter', () => {
    expect(allExpectedWordsFound('cherry apple banana', ['apple', 'banana', 'cherry'])).toBe(true);
  });

  test('partial word containment — transcribed "eleph" matches expected "elephant"', () => {
    expect(allExpectedWordsFound('eleph', ['elephant'])).toBe(true);
  });
});
