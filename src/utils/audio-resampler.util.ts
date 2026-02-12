/**
 * Audio resampling utilities.
 * Converts between 8 kHz (PSTN/Twilio) and 24 kHz (OpenAI Realtime API).
 * Uses linear interpolation — sufficient quality for voice telephony.
 */

/**
 * Upsample from 8 kHz to 24 kHz (3x).
 */
export function resample8kTo24k(input: Int16Array): Int16Array {
  const ratio = 3; // 24000 / 8000
  const outputLength = input.length * ratio;
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i / ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcPos - idx0;

    output[i] = Math.round(input[idx0] * (1 - frac) + input[idx1] * frac);
  }

  return output;
}

/**
 * Downsample from 24 kHz to 8 kHz (1/3).
 */
export function resample24kTo8k(input: Int16Array): Int16Array {
  const ratio = 3; // 24000 / 8000
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, input.length - 1);
    const frac = srcPos - idx0;

    output[i] = Math.round(input[idx0] * (1 - frac) + input[idx1] * frac);
  }

  return output;
}
