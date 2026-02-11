/** Twilio Media Stream WebSocket event types */

export interface TwilioMediaStreamStart {
  event: 'start';
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    customParameters: Record<string, string>;
    mediaFormat: {
      encoding: 'audio/x-mulaw';
      sampleRate: 8000;
      channels: 1;
    };
  };
}

export interface TwilioMediaStreamMedia {
  event: 'media';
  sequenceNumber: string;
  media: {
    track: 'inbound' | 'outbound';
    chunk: string;
    timestamp: string;
    payload: string; // Base64-encoded PCMU audio
  };
}

export interface TwilioMediaStreamStop {
  event: 'stop';
  sequenceNumber: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
}

export interface TwilioMediaStreamMark {
  event: 'mark';
  sequenceNumber: string;
  mark: {
    name: string;
  };
}

export interface TwilioMediaStreamConnected {
  event: 'connected';
  protocol: string;
  version: string;
}

export type TwilioMediaStreamEvent =
  | TwilioMediaStreamConnected
  | TwilioMediaStreamStart
  | TwilioMediaStreamMedia
  | TwilioMediaStreamStop
  | TwilioMediaStreamMark;

/** Outbound message to Twilio Media Stream */
export interface TwilioMediaMessage {
  event: 'media';
  streamSid: string;
  media: {
    payload: string; // Base64-encoded PCMU audio
  };
}

export interface TwilioMarkMessage {
  event: 'mark';
  streamSid: string;
  mark: {
    name: string;
  };
}

export interface TwilioClearMessage {
  event: 'clear';
  streamSid: string;
}

export type TwilioOutboundMessage =
  | TwilioMediaMessage
  | TwilioMarkMessage
  | TwilioClearMessage;
