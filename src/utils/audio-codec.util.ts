/**
 * PCMU (G.711 μ-law) codec utilities.
 * Converts between μ-law encoded audio (Twilio PSTN) and linear PCM16 (OpenAI).
 */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

// Pre-computed μ-law decode table for fast lookup
const MULAW_DECODE_TABLE = new Int16Array(256);

(function initDecodingTable() {
  for (let i = 0; i < 256; i++) {
    let mulaw = ~i & 0xFF;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;

    let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
    magnitude -= MULAW_BIAS;

    MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
  }
})();

/**
 * Encode a single linear PCM16 sample to μ-law.
 */
function linearToMuLaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.abs(sample);

  if (magnitude > MULAW_CLIP) magnitude = MULAW_CLIP;
  magnitude += MULAW_BIAS;

  let exponent = 7;
  const exponentMask = 0x4000;
  for (let i = 0; i < 8; i++) {
    if (magnitude & (exponentMask >> i)) {
      exponent = 7 - i;
      break;
    }
  }

  const mantissa = (magnitude >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xFF;

  return mulawByte;
}

/**
 * Decode a buffer of PCMU (μ-law) samples to linear PCM16.
 */
export function decodePCMU(pcmu: Buffer): Int16Array {
  const pcm = new Int16Array(pcmu.length);
  for (let i = 0; i < pcmu.length; i++) {
    pcm[i] = MULAW_DECODE_TABLE[pcmu[i]];
  }
  return pcm;
}

/**
 * Encode a buffer of linear PCM16 samples to PCMU (μ-law).
 */
export function encodePCMU(pcm: Int16Array): Buffer {
  const pcmu = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    pcmu[i] = linearToMuLaw(pcm[i]);
  }
  return pcmu;
}
