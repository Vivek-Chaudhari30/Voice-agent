import WebSocket from 'ws';
import { logger } from '../utils/logger.util';
import { config } from '../config/environment';
import { AGENT_INSTRUCTIONS } from '../config/agent-instructions';

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;
  private callSid: string;

  constructor(callSid: string) {
    this.callSid = callSid;
  }

  async connect(): Promise<void> {
    const url = `wss://api.openai.com/v1/realtime?model=${config.openai.realtimeModel}`;

    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    return new Promise((resolve, reject) => {
      this.ws!.once('open', () => {
        logger.info('OpenAI Realtime connected', { callSid: this.callSid });
        this.initializeSession();
        resolve();
      });

      this.ws!.once('error', (err) => {
        logger.error('OpenAI connection error', { callSid: this.callSid, error: (err as Error).message });
        reject(err);
      });
    });
  }

  private initializeSession(): void {
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: AGENT_INSTRUCTIONS,
        voice: config.openai.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: [
          {
            type: 'function',
            name: 'list_available_slots',
            description:
              'Retrieves available appointment time slots for a specific date. Returns an array of available times. Only call this after the customer has provided a preferred date.',
            parameters: {
              type: 'object',
              properties: {
                date: {
                  type: 'string',
                  description: 'Appointment date in YYYY-MM-DD format (must be a future weekday)',
                },
              },
              required: ['date'],
            },
          },
          {
            type: 'function',
            name: 'create_appointment',
            description:
              'Creates a new appointment booking. Only call this after confirming all details (name, date, time) with the customer.',
            parameters: {
              type: 'object',
              properties: {
                customer_name: {
                  type: 'string',
                  description: "Customer's full name",
                },
                date: {
                  type: 'string',
                  description: 'Appointment date in YYYY-MM-DD format',
                },
                time: {
                  type: 'string',
                  description: "Appointment time in 12-hour format, e.g. '2:00 PM'",
                },
              },
              required: ['customer_name', 'date', 'time'],
            },
          },
        ],
        tool_choice: 'auto',
        temperature: 0.8,
      },
    });
  }

  send(event: Record<string, any>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  sendAudio(audioBase64: string): void {
    this.send({
      type: 'input_audio_buffer.append',
      audio: audioBase64,
    });
  }

  onMessage(callback: (event: any) => void): void {
    if (this.ws) {
      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const event = JSON.parse(data.toString());
          callback(event);
        } catch (err) {
          logger.error('Failed to parse OpenAI message', { callSid: this.callSid, error: (err as Error).message });
        }
      });
    }
  }

  onClose(callback: (code: number, reason: string) => void): void {
    if (this.ws) {
      this.ws.on('close', (code: number, reason: Buffer) => {
        callback(code, reason.toString());
      });
    }
  }

  onError(callback: (err: Error) => void): void {
    if (this.ws) {
      this.ws.on('error', callback);
    }
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
