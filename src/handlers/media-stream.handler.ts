import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../utils/logger.util';
import { config } from '../config/environment';
import { OpenAIRealtimeClient } from '../services/openai.service';
import { AudioProcessor } from '../services/audio.service';
import { executeToolCall } from './tools.handler';
import {
  setActiveCall,
  updateCallStatus,
  removeActiveCall,
  saveTranscript,
  addCallHistory,
  trackMetric,
  incrementCounter,
} from '../services/redis.service';
import { ActiveCall } from '../types';

export default async function mediaStreamHandler(twilioWs: WebSocket, _req: IncomingMessage): Promise<void> {
  let callSid = '';
  let streamSid = '';
  let callerNumber = '';
  let openai: OpenAIRealtimeClient | null = null;
  let callActive = false;
  let callStartTime = Date.now();
  let callTimeout: NodeJS.Timeout | null = null;
  let audioChunkCount = 0;

  // ── Twilio WebSocket messages ───────────────────────────────────────────

  twilioWs.on('message', async (raw: WebSocket.RawData) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.event) {
      // ── Stream start ────────────────────────────────────────────────────
      case 'start': {
        streamSid = msg.start.streamSid;
        callSid = msg.start.customParameters?.callSid || msg.start.callSid || streamSid;
        callerNumber = msg.start.customParameters?.callerNumber || '';
        callStartTime = Date.now();
        callActive = true;

        logger.info('Media stream started', { callSid, streamSid, callerNumber });
        await incrementCounter('total_calls');

        // Register active call
        const callData: ActiveCall = {
          callSid,
          streamSid,
          phoneNumber: callerNumber,
          customerName: null,
          startTime: new Date().toISOString(),
          duration: 0,
          currentStep: 'greeting',
          aiStatus: 'listening',
          lastActivity: new Date().toISOString(),
        };
        await setActiveCall(callSid, callData);

        // Connect to OpenAI
        try {
          openai = new OpenAIRealtimeClient(callSid);
          await openai.connect();
          // Greeting will be triggered by setupOpenAIHandlers once session.updated is received
          setupOpenAIHandlers(openai, twilioWs, callSid, streamSid, callerNumber);
        } catch (err) {
          logger.error('Failed to connect to OpenAI', { callSid, error: (err as Error).message });
          twilioWs.close();
          return;
        }

        // Call timeout
        const maxMs = config.features.maxCallDurationMinutes * 60 * 1000;
        callTimeout = setTimeout(async () => {
          if (callActive) {
            logger.warn('Call timeout reached', { callSid });
            if (openai?.isOpen) {
              openai.send({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'user',
                  content: [{ type: 'input_text', text: '[SYSTEM: Call time limit reached. Please wrap up the conversation politely and say goodbye.]' }],
                },
              });
              openai.send({ type: 'response.create' });
            }
            // Force close after 10 s
            setTimeout(() => {
              if (callActive) cleanup('timeout');
            }, 10_000);
          }
        }, maxMs);

        break;
      }

      // ── Audio from Twilio ───────────────────────────────────────────────
      case 'media': {
        if (!callActive || !openai?.isOpen || !msg.media?.payload) break;

        audioChunkCount++;
        const start = Date.now();

        const openaiAudio = AudioProcessor.twilioToOpenAI(msg.media.payload);
        openai.sendAudio(openaiAudio);

        const latency = Date.now() - start;
        if (audioChunkCount % 100 === 0) {
          await trackMetric('audio_processing_latency', latency);
          logger.debug('Audio chunk batch', { callSid, count: audioChunkCount, latency });
        }

        break;
      }

      // ── Stream stop ─────────────────────────────────────────────────────
      case 'stop': {
        logger.info('Twilio stream stopped', { callSid });
        cleanup('twilio_stop');
        break;
      }
    }
  });

  twilioWs.on('close', () => {
    logger.info('Twilio WebSocket closed', { callSid });
    cleanup('ws_close');
  });

  twilioWs.on('error', (err) => {
    logger.error('Twilio WebSocket error', { callSid, error: (err as Error).message });
    cleanup('ws_error');
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────

  async function cleanup(reason: string): Promise<void> {
    if (!callActive) return;
    callActive = false;

    if (callTimeout) clearTimeout(callTimeout);
    openai?.close();

    const duration = Math.round((Date.now() - callStartTime) / 1000);
    await trackMetric('call_duration', duration);

    await addCallHistory({
      callSid,
      phoneNumber: callerNumber,
      customerName: null,
      startTime: new Date(callStartTime).toISOString(),
      endTime: new Date().toISOString(),
      duration,
      outcome: reason === 'timeout' ? 'error' : 'user_hangup',
    });

    await removeActiveCall(callSid);
    logger.info('Call cleaned up', { callSid, reason, duration });
  }
}

// ── OpenAI event handlers ─────────────────────────────────────────────────

function setupOpenAIHandlers(
  openai: OpenAIRealtimeClient,
  twilioWs: WebSocket,
  callSid: string,
  streamSid: string,
  callerNumber: string
): void {
  let audioOutCount = 0;

  openai.onMessage(async (event: any) => {
    // Debug: log all event types (except audio deltas which are noisy)
    if (event.type !== 'response.audio.delta' && event.type !== 'input_audio_buffer.speech_started' && event.type !== 'input_audio_buffer.speech_stopped') {
      const extra: Record<string, any> = { callSid, type: event.type };
      if (event.type === 'response.done' && event.response) {
        extra.status = event.response.status;
        extra.outputCount = event.response.output?.length ?? 0;
        if (event.response.status_details) extra.statusDetails = event.response.status_details;
      }
      logger.info('OpenAI event', extra);
    }

    switch (event.type) {
      // ── AI audio response ─────────────────────────────────────────────
      case 'response.audio.delta': {
        if (twilioWs.readyState !== WebSocket.OPEN) {
          logger.warn('Twilio WS not open, dropping audio', { callSid, wsState: twilioWs.readyState });
          break;
        }

        try {
          const twilioAudio = AudioProcessor.openAIToTwilio(event.delta);
          twilioWs.send(
            JSON.stringify({
              event: 'media',
              streamSid,
              media: { payload: twilioAudio },
            })
          );

          audioOutCount++;
          if (audioOutCount === 1) {
            logger.info('>>> First audio chunk sent to browser', { callSid, payloadLen: twilioAudio.length });
          }
          if (audioOutCount % 50 === 0) {
            logger.info('Audio chunks sent to browser', { callSid, count: audioOutCount });
          }
        } catch (err) {
          logger.error('Audio conversion error', { callSid, error: (err as Error).message });
        }

        // Don't await Redis on every audio chunk — too slow
        updateCallStatus(callSid, { aiStatus: 'speaking' }).catch(() => {});
        break;
      }

      // ── AI finished speaking ──────────────────────────────────────────
      case 'response.audio.done': {
        logger.info('AI finished speaking', { callSid, totalAudioChunks: audioOutCount });
        updateCallStatus(callSid, { aiStatus: 'listening' }).catch(() => {});
        break;
      }

      // ── User transcription ────────────────────────────────────────────
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = event.transcript?.trim();
        if (transcript) {
          await saveTranscript(callSid, {
            timestamp: new Date().toISOString(),
            role: 'user',
            content: transcript,
          });
          logger.info('User said', { callSid, transcript });
        }
        break;
      }

      // ── AI text transcript ────────────────────────────────────────────
      case 'response.output_item.done': {
        if (event.item?.type === 'message') {
          const parts = event.item.content || [];
          // Collect text from both 'text' and 'audio' content parts
          const texts: string[] = [];
          for (const c of parts) {
            if (c.type === 'text' && c.text) texts.push(c.text);
            if (c.type === 'audio' && c.transcript) texts.push(c.transcript);
          }
          const content = texts.join(' ');
          if (content) {
            await saveTranscript(callSid, {
              timestamp: new Date().toISOString(),
              role: 'assistant',
              content,
            });
            logger.info('AI said', { callSid, content: content.substring(0, 100) });
          }
        }
        break;
      }

      // ── AI audio transcript (realtime streaming) ──────────────────────
      case 'response.audio_transcript.done': {
        const transcript = event.transcript?.trim();
        if (transcript) {
          await saveTranscript(callSid, {
            timestamp: new Date().toISOString(),
            role: 'assistant',
            content: transcript,
          });
          logger.info('AI said', { callSid, content: transcript.substring(0, 100) });
        }
        break;
      }

      // ── Function call from AI ─────────────────────────────────────────
      case 'response.function_call_arguments.done': {
        const fnName = event.name;
        let args: Record<string, any>;
        try {
          args = JSON.parse(event.arguments);
        } catch {
          args = {};
        }

        logger.info('Function call received', { callSid, fnName, args });
        await updateCallStatus(callSid, { aiStatus: 'processing_tool' });

        const result = await executeToolCall(fnName, args, callSid, callerNumber);

        // Return result to OpenAI
        openai.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: event.call_id,
            output: JSON.stringify(result),
          },
        });

        // Trigger AI to respond with the result
        openai.send({ type: 'response.create' });
        break;
      }

      // ── Errors ────────────────────────────────────────────────────────
      case 'error': {
        logger.error('OpenAI error', { callSid, error: event.error });
        break;
      }

      // ── Session created ───────────────────────────────────────────────
      case 'session.created': {
        logger.info('OpenAI session created', { callSid });
        break;
      }

      case 'session.updated': {
        logger.info('OpenAI session configured — sending greeting', { callSid });

        // NOW the session is ready with audio modality — trigger greeting
        openai.send({
          type: 'response.create',
          response: {
            modalities: ['text', 'audio'],
            instructions: 'Greet the caller warmly as Sarah from Riverside Medical Clinic. Ask how you can help them today.',
          },
        });
        break;
      }
    }
  });

  openai.onClose((code, reason) => {
    if (code !== 1000) {
      logger.warn('OpenAI disconnected unexpectedly', { callSid, code, reason });
    }
  });

  openai.onError((err) => {
    logger.error('OpenAI WebSocket error', { callSid, error: err.message });
  });
}
