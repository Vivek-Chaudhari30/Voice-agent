/** OpenAI Realtime API types */

export interface OpenAISessionConfig {
  modalities: ('text' | 'audio')[];
  instructions: string;
  voice: 'alloy' | 'echo' | 'shimmer';
  input_audio_format: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  output_audio_format: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  input_audio_transcription: {
    model: string;
  };
  turn_detection: {
    type: 'server_vad';
    threshold: number;
    prefix_padding_ms: number;
    silence_duration_ms: number;
    create_response: boolean;
  };
  tools: OpenAITool[];
  tool_choice: 'auto' | 'none' | 'required';
  temperature: number;
  max_response_output_tokens: number;
}

export interface OpenAITool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, OpenAIToolParameter>;
    required: string[];
  };
}

export interface OpenAIToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

// --- Client -> Server events ---

export interface SessionUpdateEvent {
  type: 'session.update';
  session: Partial<OpenAISessionConfig>;
}

export interface InputAudioBufferAppendEvent {
  type: 'input_audio_buffer.append';
  audio: string; // Base64 PCM16
}

export interface InputAudioBufferCommitEvent {
  type: 'input_audio_buffer.commit';
}

export interface InputAudioBufferClearEvent {
  type: 'input_audio_buffer.clear';
}

export interface ConversationItemCreateEvent {
  type: 'conversation.item.create';
  item: {
    type: 'message' | 'function_call_output';
    role?: 'user' | 'assistant' | 'system';
    content?: Array<{
      type: 'input_text' | 'input_audio' | 'text';
      text?: string;
      audio?: string;
    }>;
    call_id?: string;
    output?: string;
  };
}

export interface ConversationItemTruncateEvent {
  type: 'conversation.item.truncate';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ResponseCreateEvent {
  type: 'response.create';
}

export interface ResponseCancelEvent {
  type: 'response.cancel';
}

export type OpenAIClientEvent =
  | SessionUpdateEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | ConversationItemCreateEvent
  | ConversationItemTruncateEvent
  | ResponseCreateEvent
  | ResponseCancelEvent;

// --- Server -> Client events ---

export interface SessionCreatedEvent {
  type: 'session.created';
  session: OpenAISessionConfig & { id: string };
}

export interface SessionUpdatedEvent {
  type: 'session.updated';
  session: OpenAISessionConfig & { id: string };
}

export interface InputAudioBufferSpeechStartedEvent {
  type: 'input_audio_buffer.speech_started';
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedEvent {
  type: 'input_audio_buffer.speech_stopped';
  audio_end_ms: number;
  item_id: string;
}

export interface InputAudioBufferCommittedEvent {
  type: 'input_audio_buffer.committed';
  item_id: string;
}

export interface ConversationItemCreatedEvent {
  type: 'conversation.item.created';
  item: {
    id: string;
    type: string;
    role?: string;
    status?: string;
  };
}

export interface ResponseCreatedEvent {
  type: 'response.created';
  response: {
    id: string;
    status: string;
  };
}

export interface ResponseAudioDeltaEvent {
  type: 'response.audio.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // Base64 PCM16
}

export interface ResponseAudioDoneEvent {
  type: 'response.audio.done';
  response_id: string;
  item_id: string;
}

export interface ResponseAudioTranscriptDeltaEvent {
  type: 'response.audio_transcript.delta';
  response_id: string;
  item_id: string;
  delta: string;
}

export interface ResponseAudioTranscriptDoneEvent {
  type: 'response.audio_transcript.done';
  response_id: string;
  item_id: string;
  transcript: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: 'response.function_call_arguments.done';
  response_id: string;
  item_id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseDoneEvent {
  type: 'response.done';
  response: {
    id: string;
    status: string;
    output: Array<{
      id: string;
      type: string;
      role?: string;
      content?: Array<{
        type: string;
        transcript?: string;
        text?: string;
      }>;
    }>;
  };
}

export interface ConversationItemInputAudioTranscriptionCompletedEvent {
  type: 'conversation.item.input_audio_transcription.completed';
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ErrorEvent {
  type: 'error';
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
  };
}

export interface RateLimitsUpdatedEvent {
  type: 'rate_limits.updated';
  rate_limits: Array<{
    name: string;
    limit: number;
    remaining: number;
    reset_seconds: number;
  }>;
}

export type OpenAIServerEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | InputAudioBufferCommittedEvent
  | ConversationItemCreatedEvent
  | ConversationItemInputAudioTranscriptionCompletedEvent
  | ResponseCreatedEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ResponseDoneEvent
  | ErrorEvent
  | RateLimitsUpdatedEvent;
