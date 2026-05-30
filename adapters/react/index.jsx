import { useEffect, useRef, useCallback } from 'react';

/**
 * React wrapper for the VoiceCaptcha widget.
 *
 * Usage:
 *   import VoiceCaptchaWidget from 'voice-captcha/adapters/react';
 *   import 'voice-captcha/src/voice-captcha.css';
 *
 *   <VoiceCaptchaWidget
 *     apiEndpoint="https://your-server.com/api/verify"
 *     onSuccess={(result) => console.log('Passed', result)}
 *     onError={(err) => console.error('Failed', err)}
 *   />
 *
 * Props:
 *   apiEndpoint        string   Backend verify URL (required)
 *   challengeEndpoint  string   Override challenge URL (optional)
 *   minDuration        number   Minimum recording seconds (default 2)
 *   privacyUrl         string   HTTPS URL for Privacy link in footer (optional)
 *   termsUrl           string   HTTPS URL for Terms link in footer (optional)
 *   onSuccess          fn(result) Called on successful verification
 *   onError            fn(error, result?) Called on failure
 *   onRecordingStart   fn()     Called when recording begins
 *   onRecordingStop    fn({duration}) Called when recording ends
 *   onVerificationStart fn()   Called when upload starts
 *   className          string   Extra class on the container div
 *   id                 string   Container element ID (default: auto-generated)
 */
export default function VoiceCaptchaWidget({
  apiEndpoint,
  challengeEndpoint,
  minDuration,
  privacyUrl,
  termsUrl,
  onSuccess,
  onError,
  onRecordingStart,
  onRecordingStop,
  onVerificationStart,
  className,
  id,
}) {
  const containerId = useRef(id || `vc-${Math.random().toString(36).slice(2)}`).current;
  const captchaRef = useRef(null);

  // Stable callback refs so the captcha instance doesn't need to be rebuilt
  // when the parent re-renders with new inline function props
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onRecordingStartRef = useRef(onRecordingStart);
  const onRecordingStopRef = useRef(onRecordingStop);
  const onVerificationStartRef = useRef(onVerificationStart);

  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onRecordingStartRef.current = onRecordingStart; }, [onRecordingStart]);
  useEffect(() => { onRecordingStopRef.current = onRecordingStop; }, [onRecordingStop]);
  useEffect(() => { onVerificationStartRef.current = onVerificationStart; }, [onVerificationStart]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.VoiceCaptcha) {
      console.error(
        'VoiceCaptcha is not loaded. ' +
        'Add <script src="path/to/voice-captcha.js"> before using this component, ' +
        'or import it: import "voice-captcha/src/voice-captcha.js"'
      );
      return;
    }

    const captcha = new window.VoiceCaptcha({
      apiEndpoint,
      challengeEndpoint,
      minDuration,
      privacyUrl,
      termsUrl,
      onSuccess: (...args) => onSuccessRef.current?.(...args),
      onError: (...args) => onErrorRef.current?.(...args),
      onRecordingStart: (...args) => onRecordingStartRef.current?.(...args),
      onRecordingStop: (...args) => onRecordingStopRef.current?.(...args),
      onVerificationStart: (...args) => onVerificationStartRef.current?.(...args),
    });

    captcha.init(containerId);
    captchaRef.current = captcha;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once — options are accessed via refs

  const reset = useCallback(() => captchaRef.current?.reset(), []);

  return <div id={containerId} className={className} data-vc-react="true" ref={(el) => { if (el) el._vcReset = reset; }} />;
}
