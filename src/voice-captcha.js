/**
 * VoiceCaptcha — drop-in voice CAPTCHA widget with deepfake detection.
 *
 * ## Lifecycle (high level)
 *
 * 1. init() — render UI, create session, fetch challenge sentence
 * 2. User records audio (optional two-part reveal mid-recording)
 * 3. POST audio to apiEndpoint → receive verificationToken on success
 * 4. Host app sends token to its backend; server redeems via /api/siteverify
 *
 * ## File layout
 *
 * - Constants & small helpers (no `this`)
 * - VoiceCaptcha class, grouped by concern:
 *   Public API → Configuration → Backend → Recording → Verification
 *   → Two-part challenge → UI templates → UI updates → Speech / VAD
 */

// ---------------------------------------------------------------------------
// Defaults & shared helpers
// ---------------------------------------------------------------------------

const DEFAULT_MIN_DURATION_SEC = 2;
const DEFAULT_SILENCE_THRESHOLD = 0.01;
const DEFAULT_SILENCE_DELAY_MS = 1200;
const WAVE_BAR_COUNT = 14;

/** @param {string} apiEndpoint */
function deriveApiUrls(apiEndpoint, overrides = {}) {
  const baseUrl = apiEndpoint.replace(/\/api\/verify$/, '');
  return {
    verify: apiEndpoint,
    challenge: overrides.challengeEndpoint || `${baseUrl}/api/challenge`,
    reveal: overrides.revealEndpoint || `${baseUrl}/api/challenge/reveal`,
    session: overrides.sessionEndpoint || `${baseUrl}/api/session`,
  };
}

/**
 * Only http(s) URLs are accepted for footer legal links.
 * @returns {string|null}
 */
function normalizeExternalUrl(url, optionName) {
  if (url == null || url === '') return null;
  if (typeof url !== 'string') {
    console.warn(`VoiceCaptcha: ${optionName} must be a string`);
    return null;
  }
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch (_) {
    /* invalid URL */
  }
  console.warn(`VoiceCaptcha: ignoring invalid ${optionName} (must be http or https)`);
  return null;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function noop() {}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

class VoiceCaptcha {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * @param {object} [options]
   * @param {string} [options.apiEndpoint]
   * @param {string} [options.challengeEndpoint]
   * @param {string} [options.revealEndpoint]
   * @param {string} [options.sessionEndpoint]
   * @param {string} [options.lang] — BCP 47 language tag for challenges & speech recognition
   * @param {number} [options.minDuration] — minimum recording length in seconds
   * @param {string} [options.privacyUrl] — https URL for Privacy link in footer
   * @param {string} [options.termsUrl] — https URL for Terms link in footer
   * @param {number} [options.silenceThreshold] — RMS below this counts as silence (VAD)
   * @param {number} [options.silenceDelay] — ms of silence before auto-stop
   * @param {function} [options.onSuccess]
   * @param {function} [options.onError]
   * @param {function} [options.onRecordingStart]
   * @param {function} [options.onRecordingStop]
   * @param {function} [options.onVerificationStart]
   */
  constructor(options = {}) {
    this._configure(options);
    this._initRuntimeState();
  }

  init(containerId = 'voice-captcha-container') {
    if (!this._browserSupportsRecording()) {
      const el = document.getElementById(containerId);
      if (el) {
        el.textContent = 'Your browser does not support voice recording. Please use Chrome, Edge, or Safari.';
      }
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`VoiceCaptcha: container "#${containerId}" not found`);
      return;
    }

    this.container = container;
    this._mountWidget();
    this._bootstrap()
      .catch((error) => {
        this._setStatus('', 'error');
        this.onError(error);
      });
  }

  async reset() {
    this._releaseMicrophone();
    this._clearRecordingBuffers();
    this._clearVerificationToken();
    this._part2Revealed = false;
    this._part2RevealPending = false;
    this._setStatus('');
    this._hideLoading();
    this._setVerified(false);
    this._hideTryAgain();
    this._setRecordButtonDisabled(true);
    this._updatePromptText();
    await this._bootstrap();
  }

  getVerificationToken() {
    return this.verificationToken;
  }

  // -------------------------------------------------------------------------
  // Configuration (constructor + derived state)
  // -------------------------------------------------------------------------

  _configure(options) {
    const apiEndpoint = options.apiEndpoint || '/api/verify';
    const urls = deriveApiUrls(apiEndpoint, options);

    this.apiEndpoint = urls.verify;
    this.challengeEndpoint = urls.challenge;
    this.revealEndpoint = urls.reveal;
    this.sessionEndpoint = urls.session;

    this.lang = options.lang
      || (typeof navigator !== 'undefined' ? navigator.language : 'en')
      || 'en';
    this.minDuration = options.minDuration != null ? options.minDuration : DEFAULT_MIN_DURATION_SEC;

    this.privacyUrl = normalizeExternalUrl(options.privacyUrl, 'privacyUrl');
    this.termsUrl = normalizeExternalUrl(options.termsUrl, 'termsUrl');

    this.onSuccess = options.onSuccess || noop;
    this.onError = options.onError || noop;
    this.onRecordingStart = options.onRecordingStart || noop;
    this.onRecordingStop = options.onRecordingStop || noop;
    this.onVerificationStart = options.onVerificationStart || noop;

    this.silenceThreshold = options.silenceThreshold != null
      ? options.silenceThreshold
      : DEFAULT_SILENCE_THRESHOLD;
    this.silenceDelay = options.silenceDelay != null
      ? options.silenceDelay
      : DEFAULT_SILENCE_DELAY_MS;
  }

  /** Per-challenge and per-recording state (reset on new challenge / recording). */
  _initRuntimeState() {
    this.container = null;

    this.sentence = '';
    this.sentencePart1 = '';
    this.sentencePart2 = '';
    this.challengeId = null;
    this.sessionId = null;
    this.sessionKey = null;
    this.verificationToken = null;
    this.twoPart = true;
    this._promptText = 'Say the sentence aloud';

    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isVerifying = false;
    this._mediaStream = null;
    this.recordingDuration = 0;
    this.durationInterval = null;

    this._part2Revealed = false;
    this._part2RevealPending = false;
    this._recordingStartPerf = 0;
    this._wordsPart1 = [];
    this._wordsPart2 = [];
    this._heardPart1 = new Set();
    this._heardPart2 = new Set();

    this._audioCtx = null;
    this._audioSource = null;
    this._analyser = null;
    this._vadInterval = null;
    this._speechDetected = false;
    this._silenceStartTime = null;
    this._visualLevel = 0;
    this._allWordsHeard = null;
    this._recognition = null;
  }

  // -------------------------------------------------------------------------
  // Bootstrap — session + first challenge
  // -------------------------------------------------------------------------

  async _bootstrap() {
    await this._ensureSession();
    await this._loadChallenge();
  }

  async _ensureSession() {
    if (this.sessionId && this.sessionKey) return;

    const response = await fetch(this.sessionEndpoint, { method: 'POST' });
    if (!response.ok) throw new Error(`Failed to create session (HTTP ${response.status})`);

    const data = await response.json();
    this.sessionId = data.sessionId;
    this.sessionKey = data.sessionKey;
  }

  async _computeProof(challengeId, action, timestamp) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.sessionKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const message = new TextEncoder().encode(`${challengeId}:${action}:${timestamp}`);
    const signature = await crypto.subtle.sign('HMAC', key, message);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async _loadChallenge() {
    try {
      this._setStatus('Loading…');
      this._setRecordButtonDisabled(true);
      await this._ensureSession();

      const url = `${this.challengeEndpoint}?sessionId=${encodeURIComponent(this.sessionId)}&lang=${encodeURIComponent(this.lang)}`;
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      this.challengeId = data.challengeId;
      this.twoPart = Boolean(data.separator);
      this._promptText = data.promptText || 'Say the sentence aloud';
      this.sentence = data.sentence || '';
      this.sentencePart1 = data.sentence || '';
      this.sentencePart2 = '';
      this._wordsPart1 = data.words || [];
      this._wordsPart2 = [];
      this._part2Revealed = !this.twoPart;
      if (data.lang) this.lang = data.lang;

      this._updateSentenceDisplay({ animatePart1: true });
      this._updatePromptText();
      this._setStatus('');
      this._setRecordButtonDisabled(false);
    } catch (error) {
      this._setStatus('', 'error');
      this.onError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  async _toggleRecording() {
    if (this.isVerifying) return;
    if (this.isRecording) {
      await this._stopRecording();
    } else {
      await this._startRecording();
    }
  }

  async _startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._mediaStream = stream;

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        '';

      this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      this.audioChunks = [];
      this.isRecording = true;
      this.recordingDuration = 0;
      this._part2Revealed = !this.twoPart;
      this._part2RevealPending = false;
      this._wordsPart2 = [];
      this._heardPart1 = new Set();
      this._heardPart2 = new Set();
      this._recordingStartPerf = performance.now();

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = () => {
        this._releaseMicrophone();
        this._submitRecording();
      };

      this.mediaRecorder.onerror = (e) => {
        this._releaseMicrophone();
        this._setStatus('', 'error');
        this.onError(e.error || new Error('MediaRecorder error'));
      };

      this.mediaRecorder.start(100);
      this._startVoiceActivityDetection(stream);
      this._startLiveWordTracking();
      this._updateRecordingControls();
      this._updatePromptText();
      this._startDurationTimer();
      this._setStatus('Listening…');
      this._setRecordButtonDisabled(false);
      this.onRecordingStart();
    } catch (error) {
      this._releaseMicrophone();
      this._setStatus('', 'error');
      this.onError(error);
    }
  }

  async _stopRecording() {
    if (!this.mediaRecorder || !this.isRecording) return;

    this.isRecording = false;
    this._stopDurationTimer();
    this._stopVoiceActivityDetection();
    this._stopLiveWordTracking();

    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this._updateRecordingControls();
    this.onRecordingStop({ duration: this.recordingDuration });
  }

  _releaseMicrophone() {
    if (this._mediaStream) {
      this._mediaStream.getTracks().forEach((t) => t.stop());
      this._mediaStream = null;
    }
  }

  _startDurationTimer() {
    this.durationInterval = setInterval(() => {
      this.recordingDuration++;
      this._updateDurationDisplay();
    }, 1000);
  }

  _stopDurationTimer() {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  _clearRecordingBuffers() {
    this._stopVoiceActivityDetection();
    this._stopLiveWordTracking();
    this._heardPart1 = new Set();
    this._heardPart2 = new Set();
    this.audioChunks = [];
    this.recordingDuration = 0;
    const dur = this.container && this.container.querySelector('.vc-duration');
    if (dur) dur.textContent = '';
    if (this.container) {
      this.container.querySelectorAll('.vc-wave-bar').forEach((bar) => { bar.style.height = ''; });
    }
    this._updateRecordingControls();
  }

  // -------------------------------------------------------------------------
  // Two-part challenge — reveal second half while recording
  // -------------------------------------------------------------------------

  _revealWordThreshold() {
    return Math.min(2, this._wordsPart1.length);
  }

  _openingWordsSpoken() {
    const required = this._wordsPart1.slice(0, this._revealWordThreshold());
    return required.length > 0 && required.every((w) => this._heardPart1.has(w));
  }

  async _requestPart2Reveal() {
    if (!this.twoPart || this._part2Revealed || this._part2RevealPending || !this.isRecording) return;
    this._part2RevealPending = true;

    const recordingOffsetMs = Math.round(performance.now() - this._recordingStartPerf);

    try {
      const timestamp = Date.now();
      const proof = await this._computeProof(this.challengeId, 'reveal', timestamp);
      const response = await fetch(this.revealEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: this.challengeId,
          sessionId: this.sessionId,
          recordingOffsetMs,
          timestamp,
          proof,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Could not load the rest of the sentence.');
      }

      this._part2Revealed = true;
      this.sentencePart2 = data.sentencePart2 || '';
      this._wordsPart2 = data.wordsPart2 || [];
      if (data.promptText) this._promptText = data.promptText;
      this._updateSentenceDisplay({ animatePart2: true });
      this._updatePromptText();
    } catch (error) {
      console.warn('VoiceCaptcha: reveal failed', error);
    } finally {
      this._part2RevealPending = false;
    }
  }

  _spokenWordMatches(spoken, expected) {
    return spoken === expected
      || (spoken.includes(expected) && spoken.length <= expected.length + 3)
      || (expected.includes(spoken) && expected.length <= spoken.length + 3);
  }

  _onWordsRecognized(spoken) {
    for (const exp of this._wordsPart1) {
      if (spoken.some((sp) => this._spokenWordMatches(sp, exp))) {
        this._heardPart1.add(exp);
      }
    }
    for (const exp of this._wordsPart2) {
      if (spoken.some((sp) => this._spokenWordMatches(sp, exp))) {
        this._heardPart2.add(exp);
      }
    }

    if (!this._part2Revealed && this._openingWordsSpoken()) {
      this._requestPart2Reveal();
    }

    if (this._part2Revealed) {
      const allPart1 = this._wordsPart1.every((w) => this._heardPart1.has(w));
      const allPart2 = this.twoPart
        ? this._wordsPart2.every((w) => this._heardPart2.has(w))
        : true;
      this._allWordsHeard = allPart1 && allPart2;
    }
  }

  // -------------------------------------------------------------------------
  // Verification — upload recording after stop
  // -------------------------------------------------------------------------

  async _submitRecording() {
    if (this.recordingDuration < this.minDuration) {
      this._setStatus('', 'error');
      this._clearRecordingBuffers();
      return;
    }

    if (this.twoPart && !this._part2Revealed) {
      this._setStatus('', 'error');
      this._clearRecordingBuffers();
      setTimeout(() => this._setStatus(''), 2500);
      return;
    }

    try {
      if (!this.challengeId) throw new Error('No active challenge. Please refresh.');
      if (!this.sessionId || !this.sessionKey) throw new Error('No active session. Please refresh.');

      this.isVerifying = true;
      this._setRecordButtonDisabled(true);
      this._showLoading();
      this.onVerificationStart();

      const timestamp = Date.now();
      const proof = await this._computeProof(this.challengeId, 'verify', timestamp);

      const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('challengeId', this.challengeId);
      formData.append('sessionId', this.sessionId);
      formData.append('timestamp', String(timestamp));
      formData.append('proof', proof);

      const response = await fetch(this.apiEndpoint, { method: 'POST', body: formData });
      const result = await response.json();

      this._hideLoading();
      this.isVerifying = false;

      if (!response.ok) {
        throw new Error(result.message || `Server error: ${response.status}`);
      }

      const passed = result.prediction === 'bonafide'
        || result.prediction === 'real'
        || result.success === true;

      if (passed) {
        if (!result.verificationToken) {
          throw new Error('Verification succeeded but no token was returned. Check server configuration.');
        }
        this.verificationToken = result.verificationToken;
        this._syncHiddenTokenField(result.verificationToken);
        this._setVerified(true);
        this.onSuccess(result);
      } else {
        throw new Error(result.message || 'Verification failed. Please try again.');
      }
    } catch (error) {
      this._hideLoading();
      this.isVerifying = false;
      this._setStatus('', 'error');
      this._clearRecordingBuffers();
      setTimeout(async () => {
        this.sessionId = null;
        this.sessionKey = null;
        this._part2Revealed = false;
        this._setStatus('');
        this._updatePromptText();
        try {
          await this._bootstrap();
        } catch (e) {
          this._setStatus('', 'error');
        }
      }, 2000);
      this.onError(error);
    }
  }

  // -------------------------------------------------------------------------
  // UI — mount widget & templates
  // -------------------------------------------------------------------------

  _browserSupportsRecording() {
    return typeof MediaRecorder !== 'undefined'
      && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  _mountWidget() {
    this.container.innerHTML = this._buildWidgetHtml();
    this._bindWidgetEvents();
  }

  _bindWidgetEvents() {
    this.container.querySelector('.vc-record-btn')
      .addEventListener('click', () => this._toggleRecording());
    this.container.querySelector('.vc-refresh-btn')
      .addEventListener('click', () => this.reset());
  }

  _buildWidgetHtml() {
    return `
      <div class="vc-widget" role="dialog" aria-label="Voice CAPTCHA challenge">
        <input type="hidden" name="verificationToken" class="vc-verification-token" value="">
        <div class="vc-header">
          <span class="vc-header-text">Say the sentence aloud</span>
        </div>
        <div class="vc-body">
          <div class="vc-sentence-box">
            <div class="vc-sentence" role="text" aria-label="Sentence to speak"></div>
          </div>
          <div class="vc-feedback">
            <div class="vc-waveform" aria-hidden="true">${this._buildWaveBarsHtml()}</div>
            <div class="vc-status" role="status" aria-live="polite"></div>
          </div>
          <div class="vc-loading" style="display:none" aria-hidden="true">
            <div class="vc-spinner"></div>
          </div>
          <div class="vc-verified" style="display:none" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
            <span>Verified</span>
          </div>
          <div class="vc-failed" style="display:none" aria-hidden="true" role="alert">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
            <span>Try again.</span>
          </div>
        </div>
        <div class="vc-controls-bar">
          <div class="vc-controls-left">
            <button class="vc-icon-btn vc-refresh-btn" type="button" title="Get a new sentence" aria-label="Get a new sentence">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
            </button>
            <span class="vc-duration" aria-live="polite"></span>
          </div>
          <button class="vc-record-btn" type="button" disabled>
            <span class="vc-btn-icon" aria-hidden="true">
              <svg class="vc-icon-mic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
              </svg>
              <svg class="vc-icon-stop" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="display:none">
                <path d="M6 6h12v12H6z"/>
              </svg>
            </span>
            <span class="vc-record-text">RECORD</span>
          </button>
        </div>
        ${this._buildFooterHtml()}
      </div>
    `;
  }

  /**
   * Footer legal links are only rendered when privacyUrl and/or termsUrl are set.
   */
  _buildFooterHtml() {
    const legalLinks = this._buildLegalLinksHtml();
    return `
      <div class="vc-footer">
        <div class="vc-branding">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
          </svg>
          <span>Voice Captcha</span>
        </div>
        ${legalLinks}
      </div>
    `;
  }

  _buildLegalLinkHtml(label, url) {
    const safeUrl = escapeHtml(url);
    const safeLabel = escapeHtml(label);
    return `<a class="vc-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
  }

  _buildLegalLinksHtml() {
    const parts = [];
    if (this.privacyUrl) parts.push(this._buildLegalLinkHtml('Privacy', this.privacyUrl));
    if (this.termsUrl) parts.push(this._buildLegalLinkHtml('Terms', this.termsUrl));
    if (!parts.length) return '';
    return `<div class="vc-footer-links">${parts.join('<span class="vc-link-sep">·</span>')}</div>`;
  }

  _buildWaveBarsHtml() {
    return Array.from({ length: WAVE_BAR_COUNT }, (_, i) => {
      const delay = ((i % 7) * 0.085 + (i >= 7 ? 0.04 : 0)).toFixed(3);
      return `<span class="vc-wave-bar" style="animation-delay:${delay}s"></span>`;
    }).join('');
  }

  _buildWordSpanHtml(word, index, part, animate) {
    const classes = ['vc-word'];
    if (animate) classes.push('vc-word--enter');
    if (part === 2) classes.push('vc-word--continue');
    return `<span class="${classes.join(' ')}" style="--vc-word-delay: ${index * 55}ms">${escapeHtml(word)}</span>`;
  }

  // -------------------------------------------------------------------------
  // UI — live updates
  // -------------------------------------------------------------------------

  _updatePromptText() {
    const el = this.container && this.container.querySelector('.vc-header-text');
    if (el) el.textContent = this._promptText;
  }

  _animateNewWords() {
    const el = this.container && this.container.querySelector('.vc-sentence');
    if (!el) return;
    requestAnimationFrame(() => {
      el.querySelectorAll('.vc-word--enter').forEach((wordEl) => {
        wordEl.classList.add('vc-word--visible');
      });
    });
  }

  _updateSentenceDisplay({ animatePart1 = false, animatePart2 = false } = {}) {
    const el = this.container && this.container.querySelector('.vc-sentence');
    if (!el) return;

    const part1Words = (this.sentencePart1 || this.sentence || '').trim().split(/\s+/).filter(Boolean);
    const part2Words = this._part2Revealed
      ? (this.sentencePart2 || '').trim().split(/\s+/).filter(Boolean)
      : [];

    let html = '<span class="vc-sentence-part vc-sentence-part--1">';
    html += part1Words.map((w, i) => this._buildWordSpanHtml(w, i, 1, animatePart1)).join(' ');
    html += '</span>';

    if (part2Words.length) {
      html += ' <span class="vc-sentence-part vc-sentence-part--2">';
      const offset = part1Words.length;
      html += part2Words.map((w, i) => this._buildWordSpanHtml(w, offset + i, 2, animatePart2)).join(' ');
      html += '</span>';
    }

    el.innerHTML = html;

    if (animatePart1 || animatePart2) {
      this._animateNewWords();
    }
  }

  _updateRecordingControls() {
    const widget = this.container.querySelector('.vc-widget');
    const btn = this.container.querySelector('.vc-record-btn');
    const text = this.container.querySelector('.vc-record-text');
    const micIcon = this.container.querySelector('.vc-icon-mic');
    const stopIcon = this.container.querySelector('.vc-icon-stop');

    if (this.isRecording) {
      widget.classList.add('vc-is-recording');
      btn.classList.add('vc-recording');
      btn.setAttribute('aria-label', 'Stop recording');
      text.textContent = 'STOP';
      micIcon.style.display = 'none';
      stopIcon.style.display = '';
    } else {
      widget.classList.remove('vc-is-recording');
      btn.classList.remove('vc-recording');
      btn.setAttribute('aria-label', 'Start recording');
      text.textContent = 'RECORD';
      micIcon.style.display = '';
      stopIcon.style.display = 'none';
    }
  }

  _updateDurationDisplay() {
    const el = this.container.querySelector('.vc-duration');
    if (el) {
      const m = Math.floor(this.recordingDuration / 60);
      const s = this.recordingDuration % 60;
      el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  _setStatus(message, type = '') {
    if (type === 'error') {
      this._showTryAgain();
      return;
    }
    this._hideTryAgain();
    const el = this.container.querySelector('.vc-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'vc-status' + (type ? ` vc-status--${type}` : '');
  }

  _showTryAgain() {
    const failedEl = this.container && this.container.querySelector('.vc-failed');
    const bodyEl = this.container && this.container.querySelector('.vc-body');
    const statusEl = this.container && this.container.querySelector('.vc-status');
    if (failedEl) {
      failedEl.style.display = 'flex';
      failedEl.setAttribute('aria-hidden', 'false');
    }
    if (bodyEl) bodyEl.classList.add('vc-body--failed');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'vc-status';
    }
  }

  _hideTryAgain() {
    const failedEl = this.container && this.container.querySelector('.vc-failed');
    const bodyEl = this.container && this.container.querySelector('.vc-body');
    if (failedEl) {
      failedEl.style.display = 'none';
      failedEl.setAttribute('aria-hidden', 'true');
    }
    if (bodyEl) bodyEl.classList.remove('vc-body--failed');
  }

  _showLoading() {
    const el = this.container.querySelector('.vc-loading');
    if (el) {
      el.style.display = 'flex';
      el.removeAttribute('aria-hidden');
    }
  }

  _hideLoading() {
    const el = this.container.querySelector('.vc-loading');
    if (el) {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
    }
  }

  _setVerified(verified) {
    const verifiedEl = this.container.querySelector('.vc-verified');
    const bodyEl = this.container.querySelector('.vc-body');
    const widgetEl = this.container.querySelector('.vc-widget');
    if (verified) this._hideTryAgain();
    if (verifiedEl) {
      verifiedEl.style.display = verified ? 'flex' : 'none';
      verifiedEl.setAttribute('aria-hidden', verified ? 'false' : 'true');
    }
    if (bodyEl) bodyEl.classList.toggle('vc-body--verified', verified);
    if (widgetEl) widgetEl.classList.toggle('vc-widget--verified', verified);
    const recordBtn = this.container.querySelector('.vc-record-btn');
    const refreshBtn = this.container.querySelector('.vc-refresh-btn');
    if (verified) {
      if (recordBtn) recordBtn.disabled = true;
      if (refreshBtn) refreshBtn.disabled = true;
    } else {
      this._clearVerificationToken();
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  _setRecordButtonDisabled(disabled) {
    const btn = this.container.querySelector('.vc-record-btn');
    if (btn) btn.disabled = disabled;
  }

  _syncHiddenTokenField(token) {
    const el = this.container && this.container.querySelector('.vc-verification-token');
    if (el) el.value = token || '';
  }

  _clearVerificationToken() {
    this.verificationToken = null;
    this._syncHiddenTokenField(null);
  }

  // -------------------------------------------------------------------------
  // Speech recognition (live word tracking for two-part reveal)
  // -------------------------------------------------------------------------

  _startLiveWordTracking() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !this._wordsPart1.length) {
      this._allWordsHeard = null;
      return;
    }

    this._allWordsHeard = false;
    this._recognition = new SR();
    this._recognition.continuous = true;
    this._recognition.interimResults = true;
    this._recognition.lang = this.lang;

    this._recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const spoken = transcript.toLowerCase()
        .replace(/[.,!?;:'''"""]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 0);
      this._onWordsRecognized(spoken);
    };

    this._recognition.onerror = () => {
      this._allWordsHeard = null;
    };

    try {
      this._recognition.start();
    } catch (e) {
      this._allWordsHeard = null;
    }
  }

  _stopLiveWordTracking() {
    if (this._recognition) {
      try { this._recognition.abort(); } catch (_) { /* already stopped */ }
      this._recognition = null;
    }
    this._allWordsHeard = null;
  }

  // -------------------------------------------------------------------------
  // Voice activity detection — waveform + auto-stop on silence
  // -------------------------------------------------------------------------

  _startVoiceActivityDetection(stream) {
    try {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      this._analyser.smoothingTimeConstant = 0.4;
      this._audioSource = this._audioCtx.createMediaStreamSource(stream);
      this._audioSource.connect(this._analyser);

      const buffer = new Float32Array(this._analyser.fftSize);
      this._speechDetected = false;
      this._silenceStartTime = null;
      this._visualLevel = 0;

      const widget = this.container.querySelector('.vc-widget');
      if (widget) widget.classList.add('vc-vad-active');

      this._vadInterval = setInterval(() => {
        if (!this.isRecording) return;

        this._analyser.getFloatTimeDomainData(buffer);
        const rms = Math.sqrt(buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length);
        this._updateWaveformFromAmplitude(rms);

        if (rms >= this.silenceThreshold) {
          this._speechDetected = true;
          this._silenceStartTime = null;
        } else if (this._speechDetected) {
          if (this._silenceStartTime === null) {
            this._silenceStartTime = Date.now();
          } else {
            const silenceMs = Date.now() - this._silenceStartTime;
            const wordsOk = this._part2Revealed && this._allWordsHeard !== false;
            const extendedSilence = silenceMs >= this.silenceDelay * 3;
            if (
              this._part2Revealed
              && (wordsOk || extendedSilence)
              && silenceMs >= this.silenceDelay
              && this.recordingDuration >= this.minDuration
            ) {
              this._stopVoiceActivityDetection();
              this._stopRecording();
            }
          }
        }
      }, 80);
    } catch (e) {
      console.warn('VoiceCaptcha: AudioContext unavailable, auto-stop disabled', e);
    }
  }

  _stopVoiceActivityDetection() {
    if (this._vadInterval) {
      clearInterval(this._vadInterval);
      this._vadInterval = null;
    }
    if (this._audioSource) {
      this._audioSource.disconnect();
      this._audioSource = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close().catch(() => {});
      this._audioCtx = null;
      this._analyser = null;
    }
    const widget = this.container && this.container.querySelector('.vc-widget');
    if (widget) widget.classList.remove('vc-vad-active');
  }

  _updateWaveformFromAmplitude(rms) {
    if (!this.isRecording) return;
    const bars = this.container.querySelectorAll('.vc-wave-bar');
    if (!bars.length) return;

    const raw = Math.min(rms * 20, 1);
    this._visualLevel = this._visualLevel * 0.55 + raw * 0.45;

    bars.forEach((bar, i) => {
      const phase = (i / bars.length) * Math.PI;
      const envelope = 0.5 + 0.5 * Math.sin(phase);
      bar.style.height = `${(4 + this._visualLevel * 18 * envelope).toFixed(1)}px`;
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VoiceCaptcha;
}
if (typeof window !== 'undefined') {
  window.VoiceCaptcha = VoiceCaptcha;
}
