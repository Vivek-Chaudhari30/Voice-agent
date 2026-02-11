import WebSocket from 'ws';
import { createCallLogger } from './utils/logger';
import { env } from './utils/env';
import { twilioToOpenAI } from './audio-transcoder';
import { OpenAIRealtimeClient } from './openai-realtime';
import {
  createSession,
  endSession,
  updateAudioStats,
} from './session-manager';
import type {
  TwilioMediaStreamEvent,
  TwilioMediaMessage,
  TwilioClearMessage,
} from './types/twilio';

/**
 * Handles one Twilio Media Stream WebSocket connection.
 * Bridges audio between Twilio and OpenAI Realtime API.
 */
export class TwilioStreamHandler {
  private twilioWs: WebSocket;
  private openai: OpenAIRealtimeClient | null = null;
  private callSid = '';
  private streamSid = '';
  private phoneNumber = '';
  private log = createCallLogger('pending');
  private callTimeout: ReturnType<typeof setTimeout> | null = null;
  private alive = true;

  constructor(ws: WebSocket) {
    this.twilioWs = ws;
    this.twilioWs.on('message', (data) => this.onTwilioMessage(data));
    this.twilioWs.on('close', () => this.onTwilioClose());
    this.twilioWs.on('error', (err) => this.log.error({ err }, 'Twilio WS error'));
  }

  // ── Twilio inbound events ────────────────────────────────────────────

  private async onTwilioMessage(raw: WebSocket.Data): Promise<void> {
    let event: TwilioMediaStreamEvent;
    try {
      event = JSON.parse(raw.toString()) as TwilioMediaStreamEvent;
    } catch {
      this.log.error('Failed to parse Twilio message');
      return;
    }

    switch (event.event) {
      case 'connected':
        this.log.info('Twilio Media Stream connected');
        break;

      case 'start':
        this.callSid = event.start.callSid;
        this.streamSid = event.start.streamSid;
        this.phoneNumber = event.start.customParameters?.from || '';
        this.log = createCallLogger(this.callSid);
        this.log.info(
          { streamSid: this.streamSid, tracks: event.start.tracks },
          'Media Stream started',
        );

        await this.initializeCall();
        break;

      case 'media':
        if (!this.openai || !this.alive) break;

        // Convert Twilio PCMU → OpenAI PCM16 and forward
        const pcm16Base64 = twilioToOpenAI(event.media.payload);
        this.openai.appendAudio(pcm16Base64);

        // Track stats (fire-and-forget)
        updateAudioStats(this.callSid, 'received', event.media.payload.length).catch(() => {});
        break;

      case 'stop':
        this.log.info('Twilio Media Stream stopped');
        this.cleanup('twilio_stop');
        break;

      case 'mark':
        this.log.debug({ mark: event.mark.name }, 'Twilio mark received');
        break;
    }
  }

  // ── Initialise OpenAI connection ─────────────────────────────────────

  private async initializeCall(): Promise<void> {
    // Create session in Redis
    await createSession(this.callSid, this.streamSid, this.phoneNumber);

    // Connect to OpenAI
    this.openai = new OpenAIRealtimeClient(this.callSid, this.phoneNumber, {
      onAudioDelta: (pcmuBase64) => this.sendAudioToTwilio(pcmuBase64),
      onAudioDone: () => {
        this.log.debug('AI audio done');
      },
      onSpeechStarted: (_audioStartMs, _itemId) => {
        // User started speaking while AI might be speaking → clear Twilio buffer
        this.clearTwilioAudioBuffer();
        this.openai?.cancelResponse();
      },
      onSpeechStopped: (_audioEndMs, _itemId) => {
        this.log.debug('User speech stopped');
      },
      onError: (error) => {
        this.log.error({ error }, 'OpenAI error during call');
      },
      onClose: (code, reason) => {
        this.log.warn({ code, reason }, 'OpenAI WS closed during call');
        if (this.alive) {
          this.attemptReconnect();
        }
      },
    });

    try {
      await this.openai.connect();
      this.log.info('OpenAI Realtime connected for call');
    } catch (err) {
      this.log.error({ err }, 'Failed to connect to OpenAI');
      this.cleanup('openai_connect_failed');
      return;
    }

    // Set call timeout
    const timeoutMs = env.MAX_CALL_DURATION_MINUTES * 60 * 1000;
    this.callTimeout = setTimeout(() => this.onCallTimeout(), timeoutMs);
  }

  // ── Send audio back to Twilio ────────────────────────────────────────

  private sendAudioToTwilio(pcmuBase64: string): void {
    if (this.twilioWs.readyState !== WebSocket.OPEN || !this.alive) return;

    const message: TwilioMediaMessage = {
      event: 'media',
      streamSid: this.streamSid,
      media: { payload: pcmuBase64 },
    };

    this.twilioWs.send(JSON.stringify(message));
    updateAudioStats(this.callSid, 'sent', pcmuBase64.length).catch(() => {});
  }

  private clearTwilioAudioBuffer(): void {
    if (this.twilioWs.readyState !== WebSocket.OPEN) return;

    const message: TwilioClearMessage = {
      event: 'clear',
      streamSid: this.streamSid,
    };
    this.twilioWs.send(JSON.stringify(message));
    this.log.debug('Cleared Twilio audio buffer (interruption)');
  }

  // ── Reconnection ─────────────────────────────────────────────────────

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT = 3;

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      this.log.error('Max reconnect attempts reached, ending call');
      this.cleanup('openai_reconnect_exhausted');
      return;
    }

    this.reconnectAttempts++;
    const delay = 1000 * this.reconnectAttempts;
    this.log.info({ attempt: this.reconnectAttempts, delay }, 'Attempting OpenAI reconnect');

    await new Promise<void>((r) => setTimeout(r, delay));

    if (!this.alive) return;

    try {
      this.openai?.close();
      this.openai = new OpenAIRealtimeClient(this.callSid, this.phoneNumber, {
        onAudioDelta: (pcmuBase64) => this.sendAudioToTwilio(pcmuBase64),
        onAudioDone: () => {},
        onSpeechStarted: () => {
          this.clearTwilioAudioBuffer();
          this.openai?.cancelResponse();
        },
        onSpeechStopped: () => {},
        onError: (error) => this.log.error({ error }, 'OpenAI error'),
        onClose: (_code, _reason) => {
          this.reconnectAttempts++;
          if (this.alive && this.reconnectAttempts < this.MAX_RECONNECT) {
            this.attemptReconnect();
          } else if (this.alive) {
            this.log.error('Max reconnect attempts reached, ending call');
            this.cleanup('openai_reconnect_exhausted');
          }
        },
      });

      await this.openai.connect();
      // Don't reset reconnectAttempts here — wait until we actually
      // receive a valid session event. The onClose callback will
      // trigger another reconnect if the key is invalid and the
      // connection drops immediately.
      this.log.info('OpenAI reconnect WebSocket opened, waiting for session...');
    } catch (err) {
      this.log.error({ err }, 'Reconnect attempt failed');
      if (this.alive) this.attemptReconnect();
    }
  }

  // ── Timeout ──────────────────────────────────────────────────────────

  private onCallTimeout(): void {
    this.log.warn('Call timeout reached');

    // Ask AI to politely end the call
    this.openai?.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '[System: The call has reached the maximum time limit. Please politely wrap up the conversation and say goodbye.]',
          },
        ],
      },
    });
    this.openai?.send({ type: 'response.create' });

    // Hard cutoff after 15 seconds
    setTimeout(() => {
      if (this.alive) {
        this.cleanup('timeout_hard');
      }
    }, 15_000);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  private onTwilioClose(): void {
    this.log.info('Twilio WebSocket closed');
    this.cleanup('twilio_closed');
  }

  private cleanup(reason: string): void {
    if (!this.alive) return;
    this.alive = false;

    this.log.info({ reason }, 'Cleaning up call');

    if (this.callTimeout) {
      clearTimeout(this.callTimeout);
      this.callTimeout = null;
    }

    this.openai?.close();
    this.openai = null;

    if (this.twilioWs.readyState === WebSocket.OPEN) {
      this.twilioWs.close();
    }

    endSession(this.callSid, reason).catch((err) =>
      this.log.error({ err }, 'Failed to end session'),
    );
  }
}
