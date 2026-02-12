export * from './twilio.types';
export * from './openai.types';

export interface TranscriptEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'function_call' | 'function_result';
  content: string;
  metadata?: {
    functionName?: string;
    arguments?: any;
    result?: any;
  };
}

export interface ActiveCall {
  callSid: string;
  streamSid: string;
  phoneNumber: string;
  customerName: string | null;
  startTime: string;
  duration: number;
  currentStep: 'greeting' | 'collecting_name' | 'collecting_date' | 'checking_slots' | 'confirming' | 'booking' | 'farewell';
  aiStatus: 'listening' | 'speaking' | 'processing_tool';
  lastActivity: string;
}

export interface CallHistory {
  callSid: string;
  phoneNumber: string;
  customerName: string | null;
  startTime: string;
  endTime: string;
  duration: number;
  outcome: 'appointment_booked' | 'no_booking' | 'error' | 'user_hangup';
  confirmationNumber?: string;
  appointmentDetails?: {
    date: string;
    time: string;
  };
}

export interface AppointmentRow {
  id: number;
  customer_name: string;
  phone_number: string;
  appointment_date: string;
  appointment_time: string;
  confirmation_number: string;
  created_at: string;
  call_sid: string;
  status: string;
}
