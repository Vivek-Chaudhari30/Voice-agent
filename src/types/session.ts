/** Session state types */

export interface TranscriptEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export interface ToolCallLog {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  durationMs: number;
}

export type CallStatus = 'active' | 'ended' | 'failed';

export interface CallSession {
  callSid: string;
  streamSid: string;
  phoneNumber: string;
  startTime: number;
  transcript: TranscriptEntry[];
  toolCalls: ToolCallLog[];
  openaiSessionId: string | null;
  status: CallStatus;
  audioStats: {
    chunksReceived: number;
    chunksSent: number;
    totalBytesReceived: number;
    totalBytesSent: number;
  };
}

export enum ConversationState {
  IDLE = 'idle',
  USER_SPEAKING = 'user_speaking',
  AI_SPEAKING = 'ai_speaking',
  PROCESSING_TOOL = 'processing_tool',
}
