import WebSocket from 'ws';
import { env } from './utils/env';
import logger, { createCallLogger } from './utils/logger';
import { TOOL_DEFINITIONS, executeTool } from './tools';
import {
  appendTranscript,
  appendToolCall,
  setOpenAISessionId,
} from './session-manager';
import { openaiToTwilio } from './audio-transcoder';
import { ConversationState } from './types/session';
import type { OpenAIServerEvent } from './types/openai';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

const SYSTEM_INSTRUCTIONS = `You are a professional and friendly medical office receptionist named Sarah. Your job is to help callers book appointments.

Conversation flow:
1. Greet the caller warmly
2. Ask for their full name
3. Ask what date they'd like to book (accept natural language like "next Tuesday" or specific dates)
4. Use the list_available_slots tool to check availability for that date
5. Present available times to the caller
6. Ask which time they prefer
7. Use create_appointment to book the slot
8. Confirm all details (name, date, time)
9. Thank them and say goodbye

Edge cases:
- If no slots available on requested date, offer to check nearby dates
- If caller is unsure, be patient and helpful
- If caller needs to reschedule mid-conversation, start over gracefully
- Keep responses concise (2-3 sentences max unless listing options)

Be natural, warm, and professional. You can use filler words like "um" or "let me check that for you" to sound human.`;

export interface OpenAIRealtimeCallbacks {
  /** Called with base64-encoded PCMU audio ready for Twilio */
  onAudioDelta: (pcmuBase64: string) => void;
  /** Called when AI finishes speaking */
  onAudioDone: (itemId: string) => void;
  /** Called when user speech is detected (for interruption handling) */
  onSpeechStarted: (audioStartMs: number, itemId: string) => void;
  /** Called when user speech stops */
  onSpeechStopped: (audioEndMs: number, itemId: string) => void;
  /** Called on any error */
  onError: (error: { type: string; code: string; message: string }) => void;
  /** Called when the WebSocket closes */
  onClose: (code: number, reason: string) => void;
}

export class OpenAIRealtimeClient {
  private ws: WebSocket | null = null;
  private callSid: string;
  private phoneNumber: string;
  private callbacks: OpenAIRealtimeCallbacks;
  private log: ReturnType<typeof createCallLogger>;
  private state: ConversationState = ConversationState.IDLE;
  private currentResponseItemId: string | null = null;
  private aiAudioStartMs = 0;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(
    callSid: string,
    phoneNumber: string,
    callbacks: OpenAIRealtimeCallbacks,
  ) {
    this.callSid = callSid;
    this.phoneNumber = phoneNumber;
    this.callbacks = callbacks;
    this.log = createCallLogger(callSid);
  }

  // ── Connection ────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${OPENAI_REALTIME_URL}?model=${env.OPENAI_REALTIME_MODEL}`;

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      const connectTimeout = setTimeout(() => {
        reject(new Error('OpenAI WebSocket connection timeout'));
        this.ws?.close();
      }, 10_000);

      this.ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.log.info('OpenAI WebSocket connected');
        this.sendSessionUpdate();
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as OpenAIServerEvent;
          this.handleEvent(event);
        } catch (err) {
          this.log.error({ err }, 'Failed to parse OpenAI event');
        }
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        this.log.error({ err }, 'OpenAI WebSocket error');
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        const reasonStr = reason.toString();
        this.log.warn({ code, reason: reasonStr }, 'OpenAI WebSocket closed');
        if (!this.closed) {
          this.callbacks.onClose(code, reasonStr);
        }
      });
    });
  }

  private sendSessionUpdate(): void {
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: SYSTEM_INSTRUCTIONS,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
        },
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.8,
        max_response_output_tokens: 4096,
      },
    });
  }

  // ── Send helpers ──────────────────────────────────────────────────────

  send(event: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  /** Append a chunk of audio (base64 PCM16 24kHz) from the caller */
  appendAudio(pcm16Base64: string): void {
    this.send({
      type: 'input_audio_buffer.append',
      audio: pcm16Base64,
    });
  }

  /** Cancel the current AI response (interruption) */
  cancelResponse(): void {
    if (this.state === ConversationState.AI_SPEAKING) {
      this.log.info('Cancelling AI response (interruption)');
      this.send({ type: 'response.cancel' });

      if (this.currentResponseItemId) {
        this.send({
          type: 'conversation.item.truncate',
          item_id: this.currentResponseItemId,
          content_index: 0,
          audio_end_ms: this.aiAudioStartMs,
        });
      }
      this.state = ConversationState.IDLE;
    }
  }

  close(): void {
    this.closed = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      } else if (this.ws) {
        this.ws.terminate(); // Force-kill if still connecting
      }
    } catch {
      // Ignore close errors
    }
    this.ws = null;
  }

  get conversationState(): ConversationState {
    return this.state;
  }

  // ── Event handling ────────────────────────────────────────────────────

  private handleEvent(event: OpenAIServerEvent): void {
    switch (event.type) {
      case 'session.created':
        this.log.info({ sessionId: event.session.id }, 'OpenAI session created');
        setOpenAISessionId(this.callSid, event.session.id).catch(() => {});
        break;

      case 'session.updated':
        this.log.info('OpenAI session updated');
        break;

      // ── VAD events ──────────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.state = ConversationState.USER_SPEAKING;
        this.callbacks.onSpeechStarted(event.audio_start_ms, event.item_id);
        break;

      case 'input_audio_buffer.speech_stopped':
        this.state = ConversationState.IDLE;
        this.callbacks.onSpeechStopped(event.audio_end_ms, event.item_id);
        break;

      // ── Response audio ──────────────────────────────────────────────
      case 'response.audio.delta': {
        this.state = ConversationState.AI_SPEAKING;
        this.currentResponseItemId = event.item_id;

        // Convert 24kHz PCM16 → 8kHz PCMU for Twilio
        const pcmuBase64 = openaiToTwilio(event.delta);
        this.callbacks.onAudioDelta(pcmuBase64);
        break;
      }

      case 'response.audio.done':
        this.state = ConversationState.IDLE;
        this.currentResponseItemId = null;
        this.callbacks.onAudioDone(event.item_id);
        break;

      // ── Transcripts ─────────────────────────────────────────────────
      case 'response.audio_transcript.done':
        appendTranscript(this.callSid, {
          role: 'assistant',
          text: event.transcript,
          timestamp: Date.now(),
        }).catch(() => {});
        this.log.info({ role: 'assistant', text: event.transcript }, 'Transcript');
        break;

      case 'conversation.item.input_audio_transcription.completed':
        appendTranscript(this.callSid, {
          role: 'user',
          text: event.transcript,
          timestamp: Date.now(),
        }).catch(() => {});
        this.log.info({ role: 'user', text: event.transcript }, 'Transcript');
        break;

      // ── Function calls ──────────────────────────────────────────────
      case 'response.function_call_arguments.done':
        this.handleFunctionCall(event.call_id, event.name, event.arguments);
        break;

      // ── Errors ──────────────────────────────────────────────────────
      case 'error':
        this.log.error({ error: event.error }, 'OpenAI error');
        this.callbacks.onError(event.error);
        break;

      case 'response.done':
        // Check if the response completed normally
        if (event.response.status === 'failed') {
          this.log.warn({ response: event.response }, 'Response failed');
        }
        break;

      case 'rate_limits.updated':
        this.log.debug({ rateLimits: event.rate_limits }, 'Rate limits');
        break;

      default:
        // Other events we just log at debug level
        this.log.debug({ eventType: (event as { type: string }).type }, 'OpenAI event');
    }
  }

  private handleFunctionCall(callId: string, name: string, argsStr: string): void {
    this.state = ConversationState.PROCESSING_TOOL;
    this.log.info({ tool: name, callId }, 'Function call received');

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsStr);
    } catch {
      args = {};
      this.log.error({ argsStr }, 'Failed to parse function call arguments');
    }

    const { result, durationMs } = executeTool(name, args, this.phoneNumber);

    // Log tool call to session
    appendToolCall(this.callSid, {
      name,
      args,
      result,
      timestamp: Date.now(),
      durationMs,
    }).catch(() => {});

    // Send result back to OpenAI
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    });

    // Trigger response generation with the tool result
    this.send({ type: 'response.create' });
    this.state = ConversationState.IDLE;
  }
}
