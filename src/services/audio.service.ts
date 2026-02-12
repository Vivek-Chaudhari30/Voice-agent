import { decodePCMU, encodePCMU } from '../utils/audio-codec.util';
import { resample8kTo24k, resample24kTo8k } from '../utils/audio-resampler.util';

/**
 * AudioProcessor handles codec conversion and resampling between
 * Twilio's PCMU 8 kHz format and OpenAI's PCM16 24 kHz format.
 */
export class AudioProcessor {
  /**
   * Twilio → OpenAI
   * PCMU 8 kHz (base64) → PCM16 24 kHz (base64)
   */
  static twilioToOpenAI(pcmuBase64: string): string {
    // 1. Base64 → raw μ-law bytes
    const pcmuBuf = Buffer.from(pcmuBase64, 'base64');

    // 2. μ-law → linear PCM16
    const pcm8k = decodePCMU(pcmuBuf);

    // 3. 8 kHz → 24 kHz
    const pcm24k = resample8kTo24k(pcm8k);

    // 4. Int16Array → Buffer → base64
    const outBuf = Buffer.from(pcm24k.buffer, pcm24k.byteOffset, pcm24k.byteLength);
    return outBuf.toString('base64');
  }

  /**
   * OpenAI → Twilio
   * PCM16 24 kHz (base64) → PCMU 8 kHz (base64)
   */
  static openAIToTwilio(pcm24kBase64: string): string {
    // 1. Base64 → raw PCM16 bytes
    const pcm24kBuf = Buffer.from(pcm24kBase64, 'base64');
    const pcm24k = new Int16Array(
      pcm24kBuf.buffer,
      pcm24kBuf.byteOffset,
      pcm24kBuf.byteLength / 2
    );

    // 2. 24 kHz → 8 kHz
    const pcm8k = resample24kTo8k(pcm24k);

    // 3. Linear PCM16 → μ-law
    const pcmuBuf = encodePCMU(pcm8k);

    // 4. Buffer → base64
    return pcmuBuf.toString('base64');
  }
}
