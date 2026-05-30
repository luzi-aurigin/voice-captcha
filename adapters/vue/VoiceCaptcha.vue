<template>
  <div :id="resolvedId" :class="className" data-vc-vue="true" />
</template>

<script>
/**
 * Vue 3 wrapper for the VoiceCaptcha widget.
 *
 * Usage:
 *   import VoiceCaptcha from 'voice-captcha/adapters/vue/VoiceCaptcha.vue';
 *   import 'voice-captcha/src/voice-captcha.css';
 *
 *   <VoiceCaptcha
 *     api-endpoint="https://your-server.com/api/verify"
 *     @success="onSuccess"
 *     @error="onError"
 *   />
 *
 * Props:    apiEndpoint, challengeEndpoint, minDuration, privacyUrl, termsUrl, className, id
 * Events:   success(result), error(err, result?), recording-start,
 *           recording-stop({duration}), verification-start
 * Exposes:  reset()
 */
export default {
  name: 'VoiceCaptcha',

  props: {
    apiEndpoint: { type: String, required: true },
    challengeEndpoint: { type: String, default: undefined },
    minDuration: { type: Number, default: 2 },
    privacyUrl: { type: String, default: undefined },
    termsUrl: { type: String, default: undefined },
    className: { type: String, default: undefined },
    id: { type: String, default: undefined },
  },

  emits: ['success', 'error', 'recording-start', 'recording-stop', 'verification-start'],

  data() {
    return {
      resolvedId: this.id || `vc-${Math.random().toString(36).slice(2)}`,
      captcha: null,
    };
  },

  mounted() {
    if (typeof window === 'undefined' || !window.VoiceCaptcha) {
      console.error(
        'VoiceCaptcha is not loaded. ' +
        'Add <script src="path/to/voice-captcha.js"> or import it before mounting this component.'
      );
      return;
    }

    this.captcha = new window.VoiceCaptcha({
      apiEndpoint: this.apiEndpoint,
      challengeEndpoint: this.challengeEndpoint,
      minDuration: this.minDuration,
      privacyUrl: this.privacyUrl,
      termsUrl: this.termsUrl,
      onSuccess: (result) => this.$emit('success', result),
      onError: (err, result) => this.$emit('error', err, result),
      onRecordingStart: () => this.$emit('recording-start'),
      onRecordingStop: (info) => this.$emit('recording-stop', info),
      onVerificationStart: () => this.$emit('verification-start'),
    });

    this.captcha.init(this.resolvedId);
  },

  methods: {
    reset() {
      return this.captcha?.reset();
    },
  },

  expose: ['reset'],
};
</script>
