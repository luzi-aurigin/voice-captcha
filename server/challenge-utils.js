'use strict';

const DEFAULT_DIFFICULTY = 3;
const CHALLENGE_SEPARATOR = ' | ';

function parseDifficulty(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_DIFFICULTY;
  return Math.max(1, Math.min(10, n));
}

function parseTwoPart(value) {
  if (value === undefined || value === null || value === '') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return true;
}

function interpolateDifficulty(d, anchors) {
  const keys = Object.keys(anchors).map(Number).sort((a, b) => a - b);
  if (d <= keys[0]) return anchors[keys[0]];
  if (d >= keys[keys.length - 1]) return anchors[keys[keys.length - 1]];

  for (let i = 0; i < keys.length - 1; i++) {
    const low = keys[i];
    const high = keys[i + 1];
    if (d >= low && d <= high) {
      const t = (d - low) / (high - low);
      const a = anchors[low];
      const b = anchors[high];
      if (typeof a === 'string') {
        return t < 0.5 ? a : b;
      }
      return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
      ];
    }
  }

  return anchors[keys[0]];
}

function getCaptchaConfig() {
  return {
    difficulty: parseDifficulty(process.env.CAPTCHA_DIFFICULTY),
    twoPart: parseTwoPart(process.env.CAPTCHA_TWO_PART),
  };
}

function getPromptText(difficulty, twoPart, { revealed = false } = {}) {
  const d = parseDifficulty(difficulty);
  const split = parseTwoPart(twoPart);

  if (split && revealed) {
    return d >= 8 ? 'Complete the sentence' : 'Finish the sentence';
  }

  if (split) {
    if (d <= 2) return 'Say the short phrase aloud';
    if (d >= 8) return 'Read the sentence carefully';
    return 'Say the sentence aloud';
  }

  if (d <= 2) return 'Say the phrase aloud';
  if (d >= 8) return 'Read the sentence carefully';
  return 'Say the sentence aloud';
}

function getChallengeGenerationSpec(difficulty, twoPart) {
  const d = parseDifficulty(difficulty);
  const split = parseTwoPart(twoPart);

  const vocabAnchors = {
    1: 'extremely common words that are very easy to pronounce clearly',
    3: 'common everyday vocabulary, easy to pronounce clearly',
    7: 'moderately varied vocabulary with some less common but still natural words',
    10: 'sophisticated vocabulary with longer or less common words that are still pronounceable',
  };

  const phrasingAnchors = {
    1: 'simple, direct phrasing',
    3: 'non-typical but natural phrasing',
    10: 'rich, descriptive phrasing',
  };

  const vocab = interpolateDifficulty(d, vocabAnchors);
  const phrasing = interpolateDifficulty(d, phrasingAnchors);

  if (split) {
    const clauseWords = interpolateDifficulty(d, {
      1: [3, 5],
      3: [5, 8],
      10: [9, 14],
    });
    const totalWords = interpolateDifficulty(d, {
      1: [6, 10],
      3: [12, 16],
      10: [20, 28],
    });

    return {
      difficulty: d,
      twoPart: true,
      format:
        'Format: exactly two natural clauses separated by a pipe with spaces ( | ). ' +
        `Example: the quiet harbor waits at dawn | while distant bells echo through misty hills. ` +
        `Rules: ${clauseWords[0]}–${clauseWords[1]} words per clause, ${totalWords[0]}–${totalWords[1]} words total, ` +
        `${vocab}, ${phrasing}, no proper nouns, no offensive content. ` +
        'Respond with ONLY the sentence in that format — no quotes, no trailing punctuation, no explanation.',
    };
  }

  const sentenceWords = interpolateDifficulty(d, {
    1: [4, 6],
    3: [7, 10],
    10: [14, 20],
  });

  return {
    difficulty: d,
    twoPart: false,
    format:
      'Format: one natural sentence with no pipe delimiter. ' +
      `Example: the quiet harbor waits at dawn. ` +
      `Rules: ${sentenceWords[0]}–${sentenceWords[1]} words total, ${vocab}, ${phrasing}, ` +
      'no proper nouns, no offensive content. ' +
      'Respond with ONLY the sentence — no quotes, no trailing punctuation, no explanation.',
  };
}

function normalizeWord(w) {
  return w.toLowerCase().replace(/[.,!?;:'''"""]/g, '').trim();
}

function wordsMatch(spoken, expected) {
  return spoken === expected ||
    (spoken.includes(expected) && spoken.length <= expected.length + 3) ||
    (expected.includes(spoken) && expected.length <= spoken.length + 3);
}

function extractContentWords(sentence) {
  return sentence
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, '')
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

/**
 * Split at the natural delimiter ( | ) from generation, with fallbacks.
 */
const CLAUSE_DELIMITER = /\s*\|\s*|\s+—\s+|\s+–\s+/;

function splitSentence(sentence) {
  const trimmed = (sentence || '').trim();
  if (!trimmed) {
    return { part1: '', part2: '' };
  }

  if (CLAUSE_DELIMITER.test(trimmed)) {
    const parts = trimmed.split(CLAUSE_DELIMITER).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { part1: parts[0], part2: parts.slice(1).join(' ') };
    }
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return { part1: trimmed, part2: '' };
  }

  const mid = Math.ceil(words.length / 2);
  return {
    part1: words.slice(0, mid).join(' '),
    part2: words.slice(mid).join(' '),
  };
}

/**
 * Map expected words to Whisper alignment timestamps in spoken order.
 */
function mapWordTimings(alignedWords, expectedWords) {
  const expected = expectedWords.map(normalizeWord);
  const timings = [];
  let searchFrom = 0;

  for (const exp of expected) {
    let found = null;
    for (let i = searchFrom; i < alignedWords.length; i++) {
      if (wordsMatch(alignedWords[i].word, exp)) {
        found = alignedWords[i];
        searchFrom = i + 1;
        break;
      }
    }
    if (!found) return null;
    timings.push({ word: exp, start: found.start, end: found.end });
  }

  return timings;
}

/**
 * Reject if any consecutive pair in the mapped sequence has a pause longer than maxGapMs.
 */
function verifyConsecutiveWordGaps(timings, maxGapMs) {
  if (!timings || timings.length < 2) {
    return { match: true };
  }

  const maxGapSec = maxGapMs / 1000;
  for (let i = 1; i < timings.length; i++) {
    const gapSec = timings[i].start - timings[i - 1].end;
    if (gapSec > maxGapSec) {
      return {
        match: false,
        reason: 'word_gap_exceeded',
        gapMs: Math.round(gapSec * 1000),
        maxGapMs,
        between: [timings[i - 1].word, timings[i].word],
      };
    }
  }

  return { match: true };
}

const REVEAL_TRIGGER_WORD_COUNT = 2;

/**
 * Verify the first N part-1 words were spoken before revealOffsetMs, part 2
 * starts after, and no pause within each half exceeds maxWordGapMs.
 */
function verifySplitSentenceTiming(
  result,
  wordsPart1,
  wordsPart2,
  revealOffsetMs,
  toleranceMs = 800,
  maxWordGapMs = 1000
) {
  if (!result || !result.words || result.words.length === 0) {
    return { match: false, reason: 'no_alignment' };
  }

  if (revealOffsetMs == null || !Number.isFinite(revealOffsetMs) || revealOffsetMs < 0) {
    return { match: false, reason: 'invalid_reveal_offset' };
  }

  const aligned = result.words
    .filter(w => typeof w.start === 'number' && typeof w.end === 'number')
    .map(w => ({
      word: normalizeWord(w.word),
      start: w.start,
      end: w.end,
    }));

  if (aligned.length === 0) {
    return { match: false, reason: 'no_alignment' };
  }

  const part1AnchorWords = wordsPart1.slice(0, REVEAL_TRIGGER_WORD_COUNT);
  const part1AnchorTimings = part1AnchorWords.length > 0
    ? mapWordTimings(aligned, part1AnchorWords)
    : [];
  const part1Timings = mapWordTimings(aligned, wordsPart1);
  const part2Timings = mapWordTimings(aligned, wordsPart2);

  if (
    !part1AnchorTimings ||
    part1AnchorTimings.length < part1AnchorWords.length ||
    !part1Timings ||
    !part2Timings
  ) {
    return { match: false, reason: 'words_mismatch' };
  }

  const revealSec = revealOffsetMs / 1000;
  const toleranceSec = toleranceMs / 1000;
  const lastAnchorEnd = Math.max(...part1AnchorTimings.map(t => t.end));
  const firstPart2Start = Math.min(...part2Timings.map(t => t.start));

  if (lastAnchorEnd > revealSec + toleranceSec) {
    return {
      match: false,
      reason: 'part1_after_reveal',
      lastAnchorEnd,
      revealSec,
      checkedWords: part1AnchorWords,
    };
  }

  if (firstPart2Start < revealSec - toleranceSec) {
    return {
      match: false,
      reason: 'part2_before_reveal',
      firstPart2Start,
      revealSec,
    };
  }

  for (const [label, timings] of [['part1', part1Timings], ['part2', part2Timings]]) {
    const gaps = verifyConsecutiveWordGaps(timings, maxWordGapMs);
    if (!gaps.match) {
      return { ...gaps, segment: label };
    }
  }

  return {
    match: true,
    lastAnchorEnd,
    firstPart2Start,
    revealSec,
    checkedWords: part1AnchorWords,
  };
}

module.exports = {
  DEFAULT_DIFFICULTY,
  CHALLENGE_SEPARATOR,
  parseDifficulty,
  parseTwoPart,
  getCaptchaConfig,
  getPromptText,
  getChallengeGenerationSpec,
  normalizeWord,
  wordsMatch,
  extractContentWords,
  splitSentence,
  verifySplitSentenceTiming,
};
