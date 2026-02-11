/**
 * Audio transcoding between Twilio PCMU (G.711 μ-law, 8kHz) and
 * OpenAI Realtime PCM16 (linear, 24kHz).
 *
 * Pipeline:
 *   Twilio → PCMU decode → 8kHz PCM16 → resample to 24kHz → base64 → OpenAI
 *   OpenAI → base64 decode → 24kHz PCM16 → resample to 8kHz → PCMU encode → Twilio
 */

// ── μ-law decode lookup table ──────────────────────────────────────────────
const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildMulawDecodeTable() {
  // ITU-T G.711 μ-law decompression
  const BIAS = 0x84;
  const CLIP = 32635;

  for (let i = 0; i < 256; i++) {
    let mulaw = ~i & 0xff; // Complement
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    let mantissa = mulaw & 0x0f;

    mantissa = (mantissa << 4) + BIAS;
    mantissa <<= exponent;
    const sample = sign ? -(mantissa - BIAS) : mantissa - BIAS;

    // Clamp to 16-bit range
    MULAW_DECODE_TABLE[i] = Math.max(-32768, Math.min(32767, sample));
  }

  void CLIP; // used conceptually for the algorithm
})();

// ── μ-law encode lookup ────────────────────────────────────────────────────
const MULAW_ENCODE_TABLE: Uint8Array = new Uint8Array(65536);
(function buildMulawEncodeTable() {
  const BIAS = 0x84;
  const MAX = 32635;
  const expLut = [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
    4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7];

  for (let i = -32768; i <= 32767; i++) {
    let sample = i;
    let sign: number;

    if (sample < 0) {
      sign = 0x80;
      sample = -sample;
    } else {
      sign = 0;
    }

    if (sample > MAX) sample = MAX;
    sample += BIAS;

    const exponent = expLut[(sample >> 7) & 0xff];
    const mantissa = (sample >> (exponent + 3)) & 0x0f;

    const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
    // Map signed int16 to unsigned 16-bit index
    MULAW_ENCODE_TABLE[(i + 32768) & 0xffff] = mulawByte;
  }
})();

// ── Core conversion functions ──────────────────────────────────────────────

/** Decode PCMU buffer to PCM16 Int16Array (same sample rate) */
export function pcmuToPcm16(pcmuBuffer: Buffer): Int16Array {
  const pcm16 = new Int16Array(pcmuBuffer.length);
  for (let i = 0; i < pcmuBuffer.length; i++) {
    pcm16[i] = MULAW_DECODE_TABLE[pcmuBuffer[i]];
  }
  return pcm16;
}

/** Encode PCM16 Int16Array to PCMU Buffer */
export function pcm16ToPcmu(pcm16: Int16Array): Buffer {
  const pcmu = Buffer.alloc(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    pcmu[i] = MULAW_ENCODE_TABLE[(pcm16[i] + 32768) & 0xffff];
  }
  return pcmu;
}

/** Resample 8kHz → 24kHz using linear interpolation (3x upsample) */
export function resample8to24(input8k: Int16Array): Int16Array {
  if (input8k.length === 0) return new Int16Array(0);
  const outLen = input8k.length * 3;
  const output = new Int16Array(outLen);

  for (let i = 0; i < input8k.length - 1; i++) {
    const s0 = input8k[i];
    const s1 = input8k[i + 1];
    const base = i * 3;
    output[base] = s0;
    output[base + 1] = Math.round((2 * s0 + s1) / 3);
    output[base + 2] = Math.round((s0 + 2 * s1) / 3);
  }

  // Last sample: repeat
  const last = input8k.length - 1;
  const base = last * 3;
  output[base] = input8k[last];
  output[base + 1] = input8k[last];
  output[base + 2] = input8k[last];

  return output;
}

/** Resample 24kHz → 8kHz by picking every 3rd sample */
export function resample24to8(input24k: Int16Array): Int16Array {
  const outLen = Math.floor(input24k.length / 3);
  const output = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    output[i] = input24k[i * 3];
  }
  return output;
}

// ── Full pipeline helpers ──────────────────────────────────────────────────

/**
 * Twilio → OpenAI: base64 PCMU (8kHz) → base64 PCM16 (24kHz)
 */
export function twilioToOpenAI(pcmuBase64: string): string {
  const pcmuBuffer = Buffer.from(pcmuBase64, 'base64');
  const pcm16_8k = pcmuToPcm16(pcmuBuffer);
  const pcm16_24k = resample8to24(pcm16_8k);

  // Int16Array → Buffer (little-endian, which is the native Int16Array layout on LE systems)
  const buffer = Buffer.from(pcm16_24k.buffer, pcm16_24k.byteOffset, pcm16_24k.byteLength);
  return buffer.toString('base64');
}

/**
 * OpenAI → Twilio: base64 PCM16 (24kHz) → base64 PCMU (8kHz)
 */
export function openaiToTwilio(pcm16Base64: string): string {
  const buffer = Buffer.from(pcm16Base64, 'base64');
  // Ensure correct alignment for Int16Array
  const aligned = new Int16Array(buffer.length / 2);
  for (let i = 0; i < aligned.length; i++) {
    aligned[i] = buffer.readInt16LE(i * 2);
  }

  const pcm16_8k = resample24to8(aligned);
  const pcmu = pcm16ToPcmu(pcm16_8k);
  return pcmu.toString('base64');
}
