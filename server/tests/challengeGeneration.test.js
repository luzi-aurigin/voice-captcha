'use strict';

const {
  parseDifficulty,
  parseTwoPart,
  getCaptchaConfig,
  getPromptText,
  getChallengeGenerationSpec,
  DEFAULT_DIFFICULTY,
} = require('../challenge-utils');

describe('getCaptchaConfig', () => {
  const originalDifficulty = process.env.CAPTCHA_DIFFICULTY;
  const originalTwoPart = process.env.CAPTCHA_TWO_PART;

  afterEach(() => {
    if (originalDifficulty === undefined) delete process.env.CAPTCHA_DIFFICULTY;
    else process.env.CAPTCHA_DIFFICULTY = originalDifficulty;
    if (originalTwoPart === undefined) delete process.env.CAPTCHA_TWO_PART;
    else process.env.CAPTCHA_TWO_PART = originalTwoPart;
  });

  it('defaults to difficulty 3 and two-part mode', () => {
    delete process.env.CAPTCHA_DIFFICULTY;
    delete process.env.CAPTCHA_TWO_PART;
    expect(getCaptchaConfig()).toEqual({ difficulty: 3, twoPart: true });
  });

  it('reads server env configuration', () => {
    process.env.CAPTCHA_DIFFICULTY = '7';
    process.env.CAPTCHA_TWO_PART = 'false';
    expect(getCaptchaConfig()).toEqual({ difficulty: 7, twoPart: false });
  });
});

describe('getPromptText', () => {
  it('returns finish text after reveal for split challenges', () => {
    expect(getPromptText(3, true, { revealed: true })).toBe('Finish the sentence');
  });
});

describe('parseDifficulty', () => {
  it('defaults to 3', () => {
    expect(parseDifficulty(undefined)).toBe(DEFAULT_DIFFICULTY);
    expect(parseDifficulty('')).toBe(DEFAULT_DIFFICULTY);
  });

  it('clamps to 1–10', () => {
    expect(parseDifficulty(0)).toBe(1);
    expect(parseDifficulty(99)).toBe(10);
    expect(parseDifficulty('5')).toBe(5);
  });
});

describe('parseTwoPart', () => {
  it('defaults to true', () => {
    expect(parseTwoPart(undefined)).toBe(true);
    expect(parseTwoPart('')).toBe(true);
  });

  it('accepts falsey values', () => {
    expect(parseTwoPart(false)).toBe(false);
    expect(parseTwoPart('false')).toBe(false);
    expect(parseTwoPart('0')).toBe(false);
  });
});

describe('getChallengeGenerationSpec', () => {
  it('uses current default sizing at difficulty 3 for two-part', () => {
    const spec = getChallengeGenerationSpec(3, true);
    expect(spec.twoPart).toBe(true);
    expect(spec.format).toContain('5–8 words per clause');
    expect(spec.format).toContain('12–16 words total');
    expect(spec.format).toContain('common everyday vocabulary');
  });

  it('uses a single sentence at difficulty 3 for one-part', () => {
    const spec = getChallengeGenerationSpec(3, false);
    expect(spec.twoPart).toBe(false);
    expect(spec.format).toContain('one natural sentence');
    expect(spec.format).toContain('7–10 words total');
    expect(spec.format).not.toContain(' | ');
  });

  it('increases word counts at higher difficulty', () => {
    const easy = getChallengeGenerationSpec(1, true);
    const hard = getChallengeGenerationSpec(10, true);
    expect(easy.format).toContain('3–5 words per clause');
    expect(hard.format).toContain('9–14 words per clause');
  });
});
