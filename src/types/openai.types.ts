export interface OpenAIRealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

export interface SessionUpdateEvent {
  type: 'session.update';
  session: {
    modalities: string[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription: {
      model: string;
    };
    turn_detection: {
      type: string;
      threshold: number;
      prefix_padding_ms: number;
      silence_duration_ms: number;
    };
    tools: ToolDefinition[];
    tool_choice: string;
    temperature: number;
  };
}

export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

export interface FunctionCallEvent {
  type: 'response.function_call_arguments.done';
  event_id: string;
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  name: string;
  arguments: string;
}

export interface AudioDeltaEvent {
  type: 'response.audio.delta';
  event_id: string;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface TranscriptionEvent {
  type: 'conversation.item.input_audio_transcription.completed';
  event_id: string;
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ResponseDoneEvent {
  type: 'response.done';
  event_id: string;
  response: {
    id: string;
    status: string;
    output: any[];
  };
}

export interface ErrorEvent {
  type: 'error';
  event_id: string;
  error: {
    type: string;
    code: string;
    message: string;
    param: string | null;
  };
}
