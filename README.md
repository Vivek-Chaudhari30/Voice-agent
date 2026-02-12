# Voice AI Agent — Medical Appointment Booking

A production-ready AI phone agent built with Node.js, TypeScript, Twilio, and OpenAI's Realtime API. It answers inbound calls, has natural voice conversations, and books medical appointments — fully automated.

## Table of Contents

- [Architecture](#architecture)
- [Technical Stack](#technical-stack)
- [Features](#features)
- [Audio Processing Pipeline](#audio-processing-pipeline)
- [System Components](#system-components)
- [Database Schema](#database-schema)
- [Redis Data Structures](#redis-data-structures)
- [WebSocket Communication Flow](#websocket-communication-flow)
- [Function Calling & Tools](#function-calling--tools)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Development Workflow](#development-workflow)
- [Testing & Debugging](#testing--debugging)
- [Performance & Scalability](#performance--scalability)
- [Security Considerations](#security-considerations)
- [Monitoring & Observability](#monitoring--observability)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Call Flow Architecture                       │
└─────────────────────────────────────────────────────────────────────┘

Caller (PSTN/Mobile)
         |
         | (1) Inbound call
         ↓
  ┌──────────────┐
  │    Twilio    │ ← POST /voice (TwiML webhook)
  │ Media Stream │
  └──────────────┘
         |
         | (2) WebSocket: PCMU 8kHz audio stream
         ↓
  ┌────────────────────────────────────┐
  │   Express + WebSocket Server       │
  │   /media-stream (WS endpoint)      │
  │                                    │
  │   ┌─────────────────────┐         │
  │   │  Audio Processor    │         │
  │   │  - PCMU ↔ PCM16     │         │
  │   │  - 8kHz ↔ 24kHz     │         │
  │   └─────────────────────┘         │
  └────────────────────────────────────┘
         |
         | (3) WebSocket: PCM16 24kHz audio
         ↓
  ┌────────────────────────────┐
  │   OpenAI Realtime API      │
  │   gpt-4o-realtime-preview  │
  │   - STT (Whisper)          │
  │   - LLM (GPT-4o)           │
  │   - TTS (OpenAI Voice)     │
  │   - Function Calling       │
  └────────────────────────────┘
         |
         | (4) Function calls (list_available_slots, create_appointment)
         ↓
  ┌─────────────────────────────────────┐
  │  Storage Layer                      │
  │                                     │
  │  ┌──────────┐      ┌────────────┐  │
  │  │  SQLite  │      │   Redis    │  │
  │  │  (WAL)   │      │  (Cache)   │  │
  │  │          │      │            │  │
  │  │ • Appts  │      │ • Sessions │  │
  │  │          │      │ • Metrics  │  │
  │  └──────────┘      │ • Transc.  │  │
  │                    └────────────┘  │
  └─────────────────────────────────────┘
         |
         | (5) Server-Sent Events (SSE)
         ↓
  ┌────────────────────────────┐
  │   Live Dashboard (Web UI)  │
  │   - Active calls           │
  │   - Transcripts            │
  │   - Performance charts     │
  └────────────────────────────┘
```

## Technical Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Runtime** | Node.js | 20+ | JavaScript runtime environment |
| **Language** | TypeScript | 5.7+ | Type-safe development |
| **Web Framework** | Express.js | 4.21+ | HTTP server & REST API |
| **Telephony** | Twilio | 5.4+ | Phone call handling & media streaming |
| **AI/ML** | OpenAI Realtime API | gpt-4o-realtime | Real-time voice conversation |
| **Database** | SQLite3 (better-sqlite3) | 11.7+ | Persistent appointment storage |
| **Cache/Session** | Redis (ioredis) | 7+ | Session state & real-time metrics |
| **WebSocket** | ws | 8.18+ | Bidirectional streaming |
| **Logging** | Winston | 3.17+ | Structured logging |
| **Build Tool** | TSC (TypeScript Compiler) | 5.7+ | TypeScript compilation |
| **Dev Server** | tsx | 4.19+ | Hot-reload development |
| **Containerization** | Docker + Docker Compose | - | Production deployment |

## Features

### Core Capabilities
- **Real-time Bidirectional Voice Streaming**: WebSocket-based audio pipeline between Twilio and OpenAI
- **Advanced Audio Processing**: PCMU ↔ PCM16 codec conversion with 8kHz ↔ 24kHz resampling
- **Natural Language Understanding**: GPT-4o-powered conversational AI with context awareness
- **AI Receptionist Persona**: Configurable assistant ("Sarah") with empathetic, professional tone
- **Function Calling**: Dynamic tool execution (check availability, book appointments)
- **Multi-turn Conversations**: Maintains context throughout the entire call session

### Data & Storage
- **SQLite Database**: Persistent appointment storage with WAL mode for concurrent reads
- **Redis Cache**: High-performance session management, call transcripts, and real-time metrics
- **Indexed Queries**: Optimized database access for date/time lookups and confirmation numbers

### Monitoring & Dashboard
- **Live Web Dashboard**: Real-time visualization of active calls and system health
- **Server-Sent Events (SSE)**: Push-based updates for instant UI refresh
- **Call Transcripts**: Complete conversation history with timestamps
- **Performance Metrics**: Call duration, success rate, system latency tracking
- **Active Call Monitoring**: See live calls in progress with current conversation step

### Reliability & Security
- **Call Timeout Enforcement**: Configurable maximum call duration (default: 5 minutes)
- **Graceful Shutdown**: Clean WebSocket closure and state persistence on server stop
- **Error Handling**: Comprehensive error recovery with logging and retry logic
- **Webhook Validation**: Twilio signature verification for security (configurable)
- **Race Condition Guards**: Double-check slot availability before booking

### Developer Experience
- **TypeScript**: Full type safety with strict mode enabled
- **Hot Reload**: Fast development with tsx watch mode
- **Structured Logging**: Winston-based logging with configurable levels
- **Docker Support**: Production-ready containerization with Docker Compose
- **Phone Simulator**: Local testing without Twilio for development

## Audio Processing Pipeline

The system performs real-time audio format conversion to bridge Twilio's telephony format and OpenAI's requirements.

### Twilio → OpenAI (Inbound Audio)

```
┌─────────────────────────────────────────────────────────────────┐
│  Twilio Media Stream → Express Server → OpenAI Realtime API    │
└─────────────────────────────────────────────────────────────────┘

1. PCMU 8kHz (base64)          ← Twilio WebSocket message
        ↓
2. Decode μ-law → PCM16 8kHz   ← audioCodec.decodePCMU()
        ↓
3. Resample 8kHz → 24kHz       ← audioResampler.resample8kTo24k()
        ↓
4. PCM16 24kHz (base64)        → OpenAI WebSocket message
```

**Technical Details:**
- **Input Format**: PCMU (μ-law) 8kHz mono, 8-bit compressed
- **Output Format**: PCM16 (linear) 24kHz mono, 16-bit uncompressed
- **μ-law Decoding**: Logarithmic to linear PCM conversion using lookup table
- **Resampling**: 3x upsampling with linear interpolation
- **Payload**: Base64-encoded binary audio chunks (~20ms each)

### OpenAI → Twilio (Outbound Audio)

```
┌─────────────────────────────────────────────────────────────────┐
│  OpenAI Realtime API → Express Server → Twilio Media Stream    │
└─────────────────────────────────────────────────────────────────┘

1. PCM16 24kHz (base64)        ← OpenAI WebSocket message
        ↓
2. Resample 24kHz → 8kHz       ← audioResampler.resample24kTo8k()
        ↓
3. Encode PCM16 → PCMU         ← audioCodec.encodePCMU()
        ↓
4. PCMU 8kHz (base64)          → Twilio WebSocket message
```

**Technical Details:**
- **Input Format**: PCM16 24kHz mono from OpenAI TTS
- **Output Format**: PCMU 8kHz mono for telephony
- **Downsampling**: 3x decimation (keeps every 3rd sample)
- **μ-law Encoding**: Linear to logarithmic compression for bandwidth efficiency
- **Latency**: < 50ms processing time per chunk for real-time performance

### Audio Codec Implementation

**μ-law Codec** (`src/utils/audio-codec.util.ts`):
- 8-bit μ-law ↔ 16-bit linear PCM conversion
- North American telephony standard (G.711)
- ~2:1 compression ratio with good voice quality
- Lookup table for fast encoding/decoding

**Resampler** (`src/utils/audio-resampler.util.ts`):
- Simple linear interpolation for upsampling (8kHz → 24kHz)
- Decimation for downsampling (24kHz → 8kHz)
- Trade-off: simplicity and speed over perfect frequency response
- Suitable for voice (limited to ~4kHz bandwidth anyway)

## System Components

### 1. Express Server (`src/server.ts`)

**Responsibilities:**
- HTTP server for webhooks and API endpoints
- WebSocket server for Twilio Media Streams
- Route handling for dashboard and simulator
- Graceful shutdown and error handling

**Endpoints:**
- `POST /voice` - Twilio voice webhook (returns TwiML)
- `WS /media-stream` - Twilio Media Stream WebSocket
- `GET /health` - Health check endpoint
- `GET /dashboard/*` - Live monitoring dashboard
- `GET /simulator/*` - Phone call simulator for testing

### 2. OpenAI Realtime Client (`src/services/openai.service.ts`)

**Connection:**
```typescript
wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01
Headers: 
  Authorization: Bearer <OPENAI_API_KEY>
  OpenAI-Beta: realtime=v1
```

**Session Configuration:**
- **Modalities**: `['text', 'audio']` - bidirectional audio + text
- **Voice**: `alloy` (configurable: alloy, echo, fable, onyx, nova, shimmer)
- **Input Audio**: PCM16 24kHz
- **Output Audio**: PCM16 24kHz
- **Transcription**: Whisper-1 for speech-to-text
- **Turn Detection**: Server-side VAD (Voice Activity Detection)
  - Threshold: 0.5
  - Prefix padding: 300ms (captures start of speech)
  - Silence duration: 500ms (end-of-turn detection)
- **Temperature**: 0.8 (balanced creativity/consistency)

**Event Handling:**
- `session.updated` - Configuration confirmed
- `conversation.item.created` - New message in conversation
- `response.audio.delta` - Streaming audio chunks from TTS
- `response.audio_transcript.delta` - Streaming text transcript
- `response.function_call_arguments.done` - Function call request
- `input_audio_buffer.speech_started` - User started speaking
- `input_audio_buffer.speech_stopped` - User stopped speaking
- `error` - Error messages from OpenAI

### 3. Database Service (`src/services/database.service.ts`)

**SQLite Configuration:**
- **WAL Mode**: Write-Ahead Logging for concurrent reads
- **Location**: `./data/appointments.db` (configurable via `DATABASE_PATH`)
- **Auto-create**: Directory and tables created on first run

**Query Optimization:**
- Prepared statements for all queries (SQL injection prevention + performance)
- Indexed lookups on `(appointment_date, appointment_time)` and `confirmation_number`

### 4. Redis Service (`src/services/redis.service.ts`)

**Connection:**
```typescript
Redis client with retry strategy:
- Max retries: 5
- Backoff: min(200ms * attempt, 2000ms)
- Connection timeout: 3 seconds
```

**Data Management:**
- **Active Calls**: Session state with 1-hour TTL
- **Call History**: Persisted call records for dashboard
- **Transcripts**: Full conversation logs per call
- **Metrics**: Counters and gauges for monitoring

### 5. Media Stream Handler (`src/handlers/media-stream.handler.ts`)

**Lifecycle:**
1. **Connection**: Twilio opens WebSocket to `/media-stream`
2. **Start Event**: Extract `callSid`, `streamSid`, `callerNumber`
3. **OpenAI Connection**: Establish WebSocket to OpenAI Realtime API
4. **Audio Bridging**: Bidirectional streaming with format conversion
5. **Function Execution**: Handle tool calls (availability check, booking)
6. **Cleanup**: Close connections, save transcript, update metrics

**Timeout Handling:**
- Maximum call duration enforced (default: 5 minutes)
- Automatic graceful termination with goodbye message
- Prevents runaway costs and resource exhaustion

## Database Schema

### Appointments Table

```sql
CREATE TABLE appointments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name        TEXT NOT NULL,
  phone_number         TEXT NOT NULL,
  appointment_date     TEXT NOT NULL,        -- YYYY-MM-DD format
  appointment_time     TEXT NOT NULL,        -- "HH:MM AM/PM" format
  confirmation_number  TEXT UNIQUE NOT NULL, -- e.g., "APT-12345"
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  call_sid             TEXT,                 -- Twilio call identifier
  status               TEXT DEFAULT 'confirmed'
);

-- Performance indexes
CREATE INDEX idx_appointment_datetime 
  ON appointments(appointment_date, appointment_time);

CREATE INDEX idx_confirmation 
  ON appointments(confirmation_number);
```

**Data Example:**
```json
{
  "id": 1,
  "customer_name": "John Doe",
  "phone_number": "+15551234567",
  "appointment_date": "2026-02-20",
  "appointment_time": "2:00 PM",
  "confirmation_number": "APT-45123",
  "created_at": "2026-02-12T08:00:00.000Z",
  "call_sid": "CA1234567890abcdef",
  "status": "confirmed"
}
```

**Slot Availability Logic:**
1. Generate all possible slots (9 AM - 5 PM, 30-min intervals, skip lunch)
2. Query booked slots for the requested date: `SELECT appointment_time WHERE appointment_date = ?`
3. Return available slots = all slots - booked slots

## Redis Data Structures

### 1. Active Calls (Hash with TTL)

**Key Pattern**: `active_call:{callSid}`  
**TTL**: 3600 seconds (1 hour)  
**Data Structure**:
```json
{
  "callSid": "CA1234567890abcdef",
  "streamSid": "MZ1234567890abcdef",
  "phoneNumber": "+15551234567",
  "customerName": "John Doe",
  "startTime": "2026-02-12T08:00:00.000Z",
  "duration": 120,
  "currentStep": "booking",
  "aiStatus": "speaking",
  "lastActivity": "2026-02-12T08:02:00.000Z"
}
```

### 2. Call History (Sorted Set)

**Key Pattern**: `call_history`  
**Score**: Unix timestamp  
**Data**: JSON-encoded call summary

### 3. Transcripts (List)

**Key Pattern**: `transcript:{callSid}`  
**Data**: Array of transcript entries:
```json
[
  {
    "timestamp": "2026-02-12T08:00:15.000Z",
    "speaker": "ai",
    "text": "Hi! This is Sarah from Riverside Medical Clinic."
  },
  {
    "timestamp": "2026-02-12T08:00:20.000Z",
    "speaker": "user",
    "text": "Hi, I'd like to book an appointment."
  }
]
```

### 4. Metrics (Counters & Gauges)

**Key Patterns**:
- `metric:total_calls` - Total inbound calls
- `metric:appointments_booked` - Successful bookings
- `metric:call_duration:{callSid}` - Per-call duration tracking
- `metric:avg_call_duration` - Rolling average

## WebSocket Communication Flow

### Twilio Media Stream Protocol

**Message Types:**

1. **Start Message** (sent once at call start):
```json
{
  "event": "start",
  "start": {
    "streamSid": "MZ1234...",
    "callSid": "CA1234...",
    "customParameters": {
      "callerNumber": "+15551234567"
    }
  }
}
```

2. **Media Message** (streaming audio, ~50 msgs/sec):
```json
{
  "event": "media",
  "media": {
    "payload": "base64-encoded-pcmu-audio",
    "timestamp": 1234567890
  }
}
```

3. **Stop Message** (sent at call end):
```json
{
  "event": "stop"
}
```

**Sending Audio to Twilio:**
```json
{
  "event": "media",
  "streamSid": "MZ1234...",
  "media": {
    "payload": "base64-encoded-pcmu-audio"
  }
}
```

### OpenAI Realtime Protocol

**Client → Server Messages:**

1. **Session Update** (configuration):
```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text", "audio"],
    "instructions": "You are Sarah, a medical receptionist...",
    "voice": "alloy",
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16",
    "turn_detection": { "type": "server_vad", ... },
    "tools": [...],
    "temperature": 0.8
  }
}
```

2. **Audio Append** (streaming user audio):
```json
{
  "type": "input_audio_buffer.append",
  "audio": "base64-encoded-pcm16-audio"
}
```

3. **Function Call Response**:
```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "function_call_output",
    "call_id": "call_abc123",
    "output": "{\"available_slots\": [\"9:00 AM\", \"10:30 AM\"]}"
  }
}
```

**Server → Client Events:**

1. **Audio Delta** (streaming AI speech):
```json
{
  "type": "response.audio.delta",
  "delta": "base64-encoded-pcm16-audio"
}
```

2. **Function Call**:
```json
{
  "type": "response.function_call_arguments.done",
  "call_id": "call_abc123",
  "name": "list_available_slots",
  "arguments": "{\"date\": \"2026-02-20\"}"
}
```

3. **Transcript**:
```json
{
  "type": "response.audio_transcript.delta",
  "delta": "Hi! This is Sarah from"
}
```

## Function Calling & Tools

### Available Functions

#### 1. `list_available_slots`

**Purpose**: Check available appointment times for a specific date.

**Parameters:**
```typescript
{
  date: string // YYYY-MM-DD format, weekday, within 90 days
}
```

**Implementation:**
1. Validate date is a weekday (Mon-Fri)
2. Generate all clinic slots: 9 AM - 5 PM, 30-min intervals, skip 12-1 PM
3. Query SQLite for booked slots on that date
4. Return available slots = all slots - booked slots

**Response:**
```json
{
  "available_slots": ["9:00 AM", "9:30 AM", "10:00 AM", "2:30 PM", "4:30 PM"]
}
```

#### 2. `create_appointment`

**Purpose**: Book an appointment after user confirmation.

**Parameters:**
```typescript
{
  customer_name: string,  // Full name
  date: string,           // YYYY-MM-DD
  time: string            // "H:MM AM/PM"
}
```

**Implementation:**
1. Double-check slot availability (race condition guard)
2. Generate confirmation number: `APT-{random 5 digits}`
3. Insert into SQLite `appointments` table
4. Increment Redis counter `appointments_booked`
5. Log booking event

**Response:**
```json
{
  "success": true,
  "confirmation_number": "APT-45123"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "That time slot was just booked by someone else. Please choose another time."
}
```

### Tool Execution Flow

```
1. User says: "I'd like an appointment on February 20th"
        ↓
2. OpenAI generates function call:
   { name: "list_available_slots", args: { date: "2026-02-20" } }
        ↓
3. Express server receives function call event
        ↓
4. executeToolCall() in tools.handler.ts
        ↓
5. Query SQLite for booked slots
        ↓
6. Return available slots to OpenAI
        ↓
7. OpenAI speaks: "I have 9 AM, 10:30 AM, and 2 PM available..."
        ↓
8. User selects: "2 PM works for me"
        ↓
9. OpenAI confirms details, then calls create_appointment
        ↓
10. SQLite insert, confirmation number generated
        ↓
11. OpenAI speaks: "Perfect! Your appointment is booked. 
    Your confirmation number is APT-45123."
```

## Prerequisites

- **Node.js**: Version 20 or higher (for native fetch, modern JS features)
- **Redis**: Version 7 or higher (local installation or Docker container)
- **Twilio Account**: 
  - Active account with available phone number
  - Account SID and Auth Token
  - Phone number configured for voice calls
- **OpenAI API Access**:
  - OpenAI account with API key
  - Access to Realtime API (gpt-4o-realtime-preview)
  - Note: Realtime API requires pay-as-you-go billing
- **ngrok** (for local development): 
  - Free or paid account
  - Installed CLI tool
  - Used to expose local server to Twilio webhooks
- **Build Tools** (for native modules):
  - Python 3 (for node-gyp)
  - C++ compiler (gcc/clang on Linux/Mac, Visual Studio on Windows)
  - Required for better-sqlite3 native bindings

**Optional:**
- **Docker & Docker Compose**: For containerized deployment
- **PM2 or similar**: For production process management

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/Vivek-Chaudhari30/Voice-agent.git
cd Voice-agent
npm install
```

**Note**: `npm install` compiles native modules (better-sqlite3), which requires build tools.

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567

# OpenAI Configuration
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxx
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-10-01
OPENAI_VOICE=alloy

# Server Configuration
PORT=3000
NODE_ENV=development
PUBLIC_URL=https://your-ngrok-url.ngrok-free.dev  # Update after step 4

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# Logging & Features
LOG_LEVEL=info
ENABLE_WEBHOOK_VALIDATION=true
MAX_CALL_DURATION_MINUTES=5
```

### 3. Start Redis Server

**Option A: Using Docker**
```bash
docker run -d -p 6379:6379 --name redis-voice-agent redis:7-alpine
```

**Option B: Using Docker Compose (starts all services)**
```bash
docker-compose up -d redis
```

**Option C: Local Redis Installation**
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Verify Redis is running
redis-cli ping  # Should return "PONG"
```

### 4. Start ngrok (for Local Development)

```bash
ngrok http 3000
```

ngrok will output:
```
Forwarding  https://abc123.ngrok-free.dev -> http://localhost:3000
```

**Copy the HTTPS URL** and update `.env`:
```bash
PUBLIC_URL=https://abc123.ngrok-free.dev
```

**Note**: Free ngrok URLs change on restart. Paid accounts get persistent domains.

### 5. Configure Twilio Webhook

1. Go to [Twilio Console → Phone Numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming)
2. Select your phone number
3. Scroll to "Voice Configuration"
4. Set **"A Call Comes In"** webhook:
   - URL: `https://your-ngrok-url.ngrok-free.dev/voice`
   - Method: `HTTP POST`
5. Click **Save**

### 6. Run the Application

**Development Mode (with hot reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

You should see:
```
[info] Redis connected
[info] SQLite database initialized
[info] Server running on port 3000
[info] Twilio webhook:  https://your-ngrok-url.ngrok-free.dev/voice
[info] Dashboard:       http://localhost:3000/dashboard
[info] Health check:    http://localhost:3000/health
[info] Phone Simulator: http://localhost:3000/simulator
```

### 7. Test the Voice Agent

**Option 1: Real Phone Call**
- Call your Twilio phone number from any phone
- Sarah will greet you and help book an appointment

**Option 2: Phone Simulator** (no Twilio needed)
- Open http://localhost:3000/simulator
- Click "Start Call" to test voice AI locally

**Option 3: Dashboard Monitoring**
- Open http://localhost:3000/dashboard
- View active calls, transcripts, and metrics in real-time

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
# Build and start all services
docker-compose up --build

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

**What It Does:**
- Starts Redis container with persistent volume
- Builds and starts the application container
- Configures networking between containers
- Mounts `./logs` and `./data` for persistence

### Manual Docker Build

```bash
# Build image
docker build -t voice-agent:latest .

# Run container
docker run -d \
  --name voice-agent \
  -p 3000:3000 \
  -e TWILIO_ACCOUNT_SID=ACxxx \
  -e TWILIO_AUTH_TOKEN=xxx \
  -e OPENAI_API_KEY=sk-xxx \
  -e PUBLIC_URL=https://your-domain.com \
  -e REDIS_URL=redis://host.docker.internal:6379 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  voice-agent:latest
```

### Production Deployment

**Recommended Setup:**
1. Use managed Redis (AWS ElastiCache, Redis Cloud, etc.)
2. Deploy behind a reverse proxy (nginx) with SSL
3. Use environment-specific `.env` files
4. Set up log aggregation (CloudWatch, Datadog, etc.)
5. Configure health check endpoint for load balancer
6. Use process manager (PM2, systemd) for auto-restart

**Environment Variables for Production:**
```bash
NODE_ENV=production
LOG_LEVEL=warn
ENABLE_WEBHOOK_VALIDATION=true
REDIS_URL=redis://production-redis:6379
PUBLIC_URL=https://voice-agent.yourdomain.com
```

## Project Structure

```
voice-agent/
├── src/
│   ├── server.ts                      # Express + WebSocket server entry point
│   │
│   ├── config/
│   │   ├── environment.ts             # Environment variable validation & loading
│   │   ├── agent-instructions.ts      # AI system prompt & persona definition
│   │   └── twilio.config.ts           # Twilio client initialization
│   │
│   ├── services/
│   │   ├── audio.service.ts           # AudioProcessor: PCMU ↔ PCM16 conversion
│   │   ├── database.service.ts        # SQLite connection & queries
│   │   ├── openai.service.ts          # OpenAI Realtime WebSocket client
│   │   └── redis.service.ts           # Redis session & metrics management
│   │
│   ├── handlers/
│   │   ├── voice.handler.ts           # POST /voice — Twilio TwiML response
│   │   ├── media-stream.handler.ts    # WebSocket /media-stream — audio bridge
│   │   └── tools.handler.ts           # Function call execution & routing
│   │
│   ├── utils/
│   │   ├── audio-codec.util.ts        # μ-law encode/decode algorithms
│   │   ├── audio-resampler.util.ts    # 8kHz ↔ 24kHz resampling
│   │   └── logger.util.ts             # Winston logger configuration
│   │
│   ├── dashboard/
│   │   ├── routes.ts                  # Dashboard Express routes + SSE
│   │   ├── public/
│   │   │   ├── index.html             # Dashboard UI
│   │   │   └── app.js                 # Dashboard frontend JavaScript
│   │   └── api/
│   │       ├── calls.api.ts           # Active calls & history endpoints
│   │       ├── metrics.api.ts         # Performance metrics endpoint
│   │       └── transcripts.api.ts     # Call transcript retrieval
│   │
│   ├── simulator/
│   │   ├── routes.ts                  # Phone simulator routes
│   │   └── public/
│   │       ├── index.html             # Simulator UI
│   │       └── simulator.js           # Simulator frontend logic
│   │
│   └── types/
│       ├── index.ts                   # Shared TypeScript interfaces
│       ├── openai.types.ts            # OpenAI Realtime API types
│       └── twilio.types.ts            # Twilio message types
│
├── data/
│   └── appointments.db                # SQLite database (auto-created)
│
├── logs/                              # Winston log files
│   ├── error.log
│   ├── combined.log
│   └── app-YYYY-MM-DD.log
│
├── dist/                              # Compiled TypeScript output (gitignored)
│
├── node_modules/                      # Dependencies (gitignored)
│
├── .env                               # Environment variables (gitignored)
├── .env.example                       # Environment template
├── .gitignore                         # Git ignore rules
├── Dockerfile                         # Docker image definition
├── docker-compose.yml                 # Multi-container orchestration
├── package.json                       # NPM dependencies & scripts
├── package-lock.json                  # Locked dependency versions
├── tsconfig.json                      # TypeScript compiler configuration
└── README.md                          # This file
```

**Key Directories:**

| Directory | Purpose |
|-----------|---------|
| `src/config/` | Configuration & environment setup |
| `src/services/` | Core business logic & external integrations |
| `src/handlers/` | Request/WebSocket handlers |
| `src/utils/` | Reusable utility functions |
| `src/dashboard/` | Real-time monitoring web interface |
| `src/simulator/` | Local testing tool (no Twilio needed) |
| `src/types/` | TypeScript type definitions |
| `data/` | Persistent SQLite database storage |
| `logs/` | Application logs (rotation enabled) |

## API Reference

### REST Endpoints

#### 1. `POST /voice`

**Description**: Twilio voice webhook — called when an inbound call arrives.

**Request** (from Twilio):
```
Content-Type: application/x-www-form-urlencoded

CallSid=CAxxxxx
From=+15551234567
To=+15559876543
CallStatus=ringing
```

**Response** (TwiML):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://your-domain.com/media-stream">
      <Parameter name="callSid" value="CAxxxxx" />
      <Parameter name="callerNumber" value="+15551234567" />
    </Stream>
  </Connect>
</Response>
```

**What It Does:**
- Returns TwiML to establish Media Stream WebSocket
- Passes `callSid` and `callerNumber` as custom parameters
- Twilio then opens WebSocket to `/media-stream`

---

#### 2. `GET /health`

**Description**: Health check endpoint for monitoring/load balancers.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-12T08:00:00.000Z",
  "uptime": 3600.5
}
```

---

#### 3. `GET /dashboard`

**Description**: Serves the live monitoring dashboard HTML.

**Response**: HTML page with real-time call monitoring interface.

---

#### 4. `GET /dashboard/stream`

**Description**: Server-Sent Events (SSE) stream for real-time dashboard updates.

**Headers**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Types**:
```
event: call_started
data: {"callSid": "CA123", "phoneNumber": "+15551234567"}

event: call_updated
data: {"callSid": "CA123", "currentStep": "booking"}

event: call_ended
data: {"callSid": "CA123", "duration": 180}

event: metric_updated
data: {"total_calls": 42, "appointments_booked": 28}
```

---

#### 5. `GET /dashboard/api/calls/active`

**Description**: Get all currently active calls.

**Response**:
```json
{
  "success": true,
  "calls": [
    {
      "callSid": "CA1234567890abcdef",
      "streamSid": "MZ1234567890abcdef",
      "phoneNumber": "+15551234567",
      "customerName": "John Doe",
      "startTime": "2026-02-12T08:00:00.000Z",
      "duration": 120,
      "currentStep": "booking",
      "aiStatus": "speaking",
      "lastActivity": "2026-02-12T08:02:00.000Z"
    }
  ],
  "count": 1
}
```

---

#### 6. `GET /dashboard/api/calls/history?limit=50&offset=0`

**Description**: Get historical call records.

**Query Parameters**:
- `limit` (default: 50) - Number of records to return
- `offset` (default: 0) - Pagination offset

**Response**:
```json
{
  "success": true,
  "calls": [
    {
      "callSid": "CA1234567890abcdef",
      "phoneNumber": "+15551234567",
      "customerName": "John Doe",
      "startTime": "2026-02-12T08:00:00.000Z",
      "endTime": "2026-02-12T08:03:30.000Z",
      "duration": 210,
      "outcome": "appointment_booked",
      "confirmationNumber": "APT-45123"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

---

#### 7. `GET /dashboard/api/calls/stats`

**Description**: Aggregate call statistics.

**Response**:
```json
{
  "success": true,
  "stats": {
    "total_calls": 100,
    "active_calls": 2,
    "appointments_booked": 78,
    "success_rate": 0.78,
    "average_call_duration": 185.5,
    "today": {
      "calls": 15,
      "appointments": 12
    },
    "last_24h": {
      "calls": 42,
      "appointments": 35
    }
  }
}
```

---

#### 8. `GET /dashboard/api/metrics`

**Description**: Performance metrics for monitoring.

**Response**:
```json
{
  "success": true,
  "metrics": {
    "uptime": 3600.5,
    "memory": {
      "used": 125829120,
      "total": 536870912,
      "percentage": 23.4
    },
    "cpu": {
      "user": 1234567,
      "system": 234567
    },
    "calls": {
      "active": 2,
      "total": 100
    },
    "redis": {
      "connected": true,
      "keys": 150
    },
    "database": {
      "appointments": 78,
      "size_mb": 2.5
    }
  }
}
```

---

#### 9. `GET /dashboard/api/transcripts/:callSid`

**Description**: Get full transcript for a specific call.

**Response**:
```json
{
  "success": true,
  "callSid": "CA1234567890abcdef",
  "transcript": [
    {
      "timestamp": "2026-02-12T08:00:15.000Z",
      "speaker": "ai",
      "text": "Hi! This is Sarah from Riverside Medical Clinic. How can I help you today?"
    },
    {
      "timestamp": "2026-02-12T08:00:20.000Z",
      "speaker": "user",
      "text": "Hi, I'd like to book an appointment."
    },
    {
      "timestamp": "2026-02-12T08:00:25.000Z",
      "speaker": "ai",
      "text": "I'd be happy to help you with that. May I have your full name, please?"
    }
  ]
}
```

---

### WebSocket Endpoints

#### 1. `WS /media-stream`

**Description**: Twilio Media Stream WebSocket for bidirectional audio.

**Connection**: Established by Twilio after `/voice` webhook returns TwiML.

**Message Flow**: See [WebSocket Communication Flow](#websocket-communication-flow) section above.

---

#### 2. `WS /simulator/stream` (Simulator Only)

**Description**: WebSocket for phone simulator (local testing).

**Purpose**: Allows testing voice AI without Twilio/phone calls during development.

## Environment Variables

### Required Variables

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `TWILIO_ACCOUNT_SID` | String | Twilio Account SID from console | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TWILIO_AUTH_TOKEN` | String | Twilio Auth Token (keep secret) | `your_auth_token_here` |
| `TWILIO_PHONE_NUMBER` | String | Your Twilio phone number (E.164 format) | `+15551234567` |
| `OPENAI_API_KEY` | String | OpenAI API key with Realtime access | `sk-proj-xxxxxxxxxxxxxxxx` |
| `PUBLIC_URL` | String | Public URL for Twilio webhooks | `https://abc123.ngrok-free.dev` |

### Optional Variables (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_REALTIME_MODEL` | `gpt-4o-realtime-preview-2024-10-01` | OpenAI Realtime model ID |
| `OPENAI_VOICE` | `alloy` | TTS voice: alloy, echo, fable, onyx, nova, shimmer |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment: development, production |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `REDIS_PASSWORD` | (empty) | Redis password (if required) |
| `LOG_LEVEL` | `info` | Winston log level: error, warn, info, debug |
| `ENABLE_WEBHOOK_VALIDATION` | `true` | Verify Twilio webhook signatures |
| `MAX_CALL_DURATION_MINUTES` | `5` | Maximum call length before auto-hangup |
| `DATABASE_PATH` | `./data/appointments.db` | SQLite database file path |

### Environment-Specific Configurations

**Development (.env.development)**:
```bash
NODE_ENV=development
LOG_LEVEL=debug
ENABLE_WEBHOOK_VALIDATION=false  # Easier local testing
PUBLIC_URL=https://your-ngrok-url.ngrok-free.dev
```

**Production (.env.production)**:
```bash
NODE_ENV=production
LOG_LEVEL=warn
ENABLE_WEBHOOK_VALIDATION=true  # Security requirement
PUBLIC_URL=https://voice-agent.yourdomain.com
REDIS_URL=redis://production-redis:6379
REDIS_PASSWORD=your_secure_password
MAX_CALL_DURATION_MINUTES=10  # Longer for production
```

## Development Workflow

### 1. Local Development Setup

```bash
# Install dependencies
npm install

# Start Redis (if not using Docker)
redis-server

# Start development server with hot reload
npm run dev

# In another terminal, start ngrok
ngrok http 3000
```

### 2. Making Code Changes

**File Watching**:
- `npm run dev` uses `tsx watch` for instant hot-reload
- Changes to `.ts` files automatically restart the server
- No need to manually rebuild

**TypeScript Compilation**:
```bash
# Check for type errors
npx tsc --noEmit

# Build for production
npm run build
```

### 3. Code Style & Linting

**TypeScript Configuration** (`tsconfig.json`):
- **Strict Mode**: `true` (no implicit any, strict null checks)
- **Target**: ES2022 (modern JavaScript features)
- **Module**: CommonJS (Node.js compatibility)
- **Source Maps**: Enabled for debugging

**Recommended Linting**:
```bash
# Install ESLint (not included by default)
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin

# Run linter
npx eslint src/**/*.ts
```

### 4. Debugging

**VS Code Launch Configuration** (`.vscode/launch.json`):
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Voice Agent",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "skipFiles": ["<node_internals>/**"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  ]
}
```

**Logging Levels**:
- `error` - Only critical errors
- `warn` - Warnings and errors
- `info` - General information (default)
- `debug` - Verbose debugging output

**Common Debug Points**:
- WebSocket connection establishment
- Audio codec conversion
- OpenAI function calls
- Database operations

## Testing & Debugging

### Testing Tools

#### 1. Phone Simulator (No Twilio Required)

Access: `http://localhost:3000/simulator`

**Features**:
- Test voice AI without making real phone calls
- No Twilio charges
- Direct OpenAI Realtime API connection
- Useful for rapid development iteration

**How It Works**:
- Opens WebSocket to `/simulator/stream`
- Captures microphone audio from browser
- Converts to PCM16 24kHz and sends to OpenAI
- Plays AI responses through browser speakers

#### 2. Health Check Endpoint

```bash
curl http://localhost:3000/health
```

**Validates**:
- Server is running
- HTTP endpoint is accessible
- Process uptime

#### 3. Dashboard Testing

Access: `http://localhost:3000/dashboard`

**What to Monitor**:
- Active calls appear in real-time
- Transcripts update as conversation progresses
- Metrics update (total calls, appointments booked)
- SSE connection status

#### 4. Manual Call Testing

```bash
# 1. Check Twilio webhook is configured
curl -X POST https://your-ngrok-url.ngrok-free.dev/voice \
  -d "CallSid=TEST123" \
  -d "From=+15551234567"

# 2. Make a real call to your Twilio number
# 3. Monitor logs in real-time
tail -f logs/combined.log

# 4. Check Redis session data
redis-cli
> KEYS active_call:*
> GET active_call:CA1234567890abcdef
```

### Debugging Common Issues

#### Issue 1: WebSocket Not Connecting

**Symptoms**: Call starts but no audio, "Failed to connect to OpenAI" in logs

**Debug Steps**:
```bash
# Check OpenAI API key
echo $OPENAI_API_KEY

# Verify network connectivity
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models

# Check logs for WebSocket errors
grep "OpenAI" logs/combined.log
```

**Common Causes**:
- Invalid OpenAI API key
- No Realtime API access (requires pay-as-you-go billing)
- Firewall blocking WebSocket connections
- Missing `OpenAI-Beta: realtime=v1` header

#### Issue 2: Audio Quality Problems

**Symptoms**: Choppy audio, robotic voice, echo

**Debug Steps**:
```bash
# Check audio processing logs
grep -i "audio" logs/combined.log

# Monitor audio chunk count
# Should be ~50 chunks/second
```

**Common Causes**:
- Network latency > 200ms
- CPU throttling (check `top` or `htop`)
- Incorrect sample rate conversion
- Buffer overflow/underflow

#### Issue 3: Database Errors

**Symptoms**: "Database not initialized", SQLite locked errors

**Debug Steps**:
```bash
# Check database file exists
ls -lh data/appointments.db

# Verify WAL mode is enabled
sqlite3 data/appointments.db "PRAGMA journal_mode;"

# Check for lock files
ls -la data/appointments.db*
```

**Common Causes**:
- Directory permissions issue
- Another process has lock
- Corrupted database file

#### Issue 4: Redis Connection Failures

**Symptoms**: "Redis not initialized", "ECONNREFUSED"

**Debug Steps**:
```bash
# Check Redis is running
redis-cli ping

# Verify connection URL
echo $REDIS_URL

# Test connection
redis-cli -u $REDIS_URL ping
```

**Common Causes**:
- Redis not started
- Incorrect connection URL
- Redis password required but not provided
- Firewall blocking port 6379

## Performance & Scalability

### Current Architecture Limits

| Component | Limit | Bottleneck |
|-----------|-------|------------|
| **Concurrent Calls** | ~50-100 | CPU (audio processing), OpenAI API rate limits |
| **Database** | ~1000 req/sec | SQLite write throughput (WAL helps) |
| **Redis** | ~10,000 req/sec | Single-instance Redis memory |
| **Network** | Depends on bandwidth | WebSocket connections (~20KB/s per call) |

### Optimization Strategies

#### 1. Horizontal Scaling

**Current**: Single Node.js process

**Scale-Out Options**:
```bash
# Option A: PM2 Cluster Mode
pm2 start dist/server.js -i max  # Spawns worker per CPU core

# Option B: Docker Swarm/Kubernetes
# Deploy multiple replicas behind load balancer
```

**Considerations**:
- **Sticky Sessions**: Required (WebSocket connections are stateful)
- **Shared Redis**: All instances must use same Redis for session state
- **SQLite**: Replace with PostgreSQL/MySQL for multi-instance writes

#### 2. Database Scaling

**Current**: SQLite with WAL mode

**When to Migrate**:
- \> 100 concurrent calls
- Need for distributed writes
- Multi-region deployment

**Alternatives**:
```javascript
// PostgreSQL with connection pooling
import { Pool } from 'pg';
const pool = new Pool({ max: 20 });

// Or MySQL
import mysql from 'mysql2/promise';
const pool = mysql.createPool({ connectionLimit: 20 });
```

#### 3. Redis Clustering

**Current**: Single Redis instance

**Scale-Out**:
```yaml
# Redis Cluster (3 masters + 3 replicas)
redis-cluster:
  image: redis:7-alpine
  command: redis-cli --cluster create ...
```

**Or Managed Redis**:
- AWS ElastiCache
- Redis Enterprise Cloud
- Google Cloud Memorystore

#### 4. Audio Processing Optimization

**Current**: Synchronous processing per call

**Improvements**:
- Use Web Workers for parallel audio processing
- Offload to C++ native modules
- GPU acceleration for large-scale deployments

#### 5. Monitoring & Profiling

**CPU Profiling**:
```bash
# Node.js built-in profiler
node --prof dist/server.js

# Analyze profile
node --prof-process isolate-*.log > profile.txt
```

**Memory Profiling**:
```bash
# Heap snapshot
node --inspect dist/server.js
# Open chrome://inspect, take heap snapshot
```

**Metrics to Track**:
- WebSocket connection count
- Audio processing latency (target: < 50ms)
- Database query time (target: < 10ms)
- Redis latency (target: < 5ms)
- Memory usage (watch for leaks)

### Cost Optimization

**OpenAI Realtime API Pricing** (as of 2024):
- Input audio: ~$0.06/minute
- Output audio: ~$0.24/minute
- Average 3-minute call: ~$0.90

**Twilio Pricing**:
- Inbound call: ~$0.0085/minute
- Average 3-minute call: ~$0.026

**Total Cost per Call**: ~$0.93 (mostly OpenAI)

**Optimization Tips**:
- Implement call timeout (avoid runaway calls)
- Use cheaper models for non-critical use cases
- Cache common responses (if applicable)
- Monitor usage with dashboards

## Security Considerations

### 1. Twilio Webhook Validation

**Enabled by Default**: `ENABLE_WEBHOOK_VALIDATION=true`

**How It Works**:
```typescript
import { validateExpressRequest } from 'twilio';

// In voice.handler.ts
if (config.features.enableWebhookValidation) {
  const isValid = validateExpressRequest(
    req,
    config.twilio.authToken,
    twilioSignature
  );
  if (!isValid) {
    return res.status(403).send('Invalid signature');
  }
}
```

**Why**: Prevents malicious requests impersonating Twilio

### 2. Environment Variable Security

**Do NOT commit**:
- `.env` file (use `.gitignore`)
- API keys, tokens, passwords

**Best Practices**:
```bash
# Use environment-specific files
.env.development
.env.production

# Load in code
import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
```

**Production**: Use secret management
- AWS Secrets Manager
- HashiCorp Vault
- Kubernetes Secrets

### 3. SQL Injection Prevention

**All queries use prepared statements**:
```typescript
// SAFE: Parameterized query
db.prepare('SELECT * FROM appointments WHERE date = ?').all(date);

// UNSAFE: String concatenation (NOT USED)
// db.exec(`SELECT * FROM appointments WHERE date = '${date}'`);
```

### 4. Rate Limiting

**Not Implemented by Default**

**Recommended**:
```bash
npm install express-rate-limit

# In server.ts
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/voice', limiter);
```

### 5. HTTPS/TLS

**Local Development**: ngrok provides HTTPS

**Production**:
- Use reverse proxy (nginx, Caddy) with SSL certificate
- Let's Encrypt for free certificates
- Twilio REQUIRES HTTPS for webhooks

**Example nginx config**:
```nginx
server {
  listen 443 ssl;
  server_name voice-agent.yourdomain.com;
  
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  
  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
  }
}
```

### 6. Logging Sensitive Data

**Current**: Logs include callSid, phoneNumber

**Recommendations**:
- Do NOT log credit card numbers, SSNs, health data
- Implement PII redaction for HIPAA compliance
- Rotate logs frequently
- Restrict log access

### 7. Dependency Security

**Check for vulnerabilities**:
```bash
# NPM audit
npm audit
npm audit fix

# Or use Snyk
npx snyk test
```

**Keep dependencies updated**:
```bash
npm outdated
npm update
```

## Monitoring & Observability

### 1. Logging

**Winston Logger** (`src/utils/logger.util.ts`):

**Log Levels**:
- `error` - Critical failures requiring immediate attention
- `warn` - Potential issues (e.g., timeout warnings)
- `info` - Normal operations (call start/end, bookings)
- `debug` - Detailed debugging information

**Log Outputs**:
- **Console**: Colorized, formatted logs for development
- **File**: JSON-formatted logs for production parsing
  - `logs/error.log` - Error-level only
  - `logs/combined.log` - All levels
  - `logs/app-YYYY-MM-DD.log` - Daily rotation

**Log Structure**:
```json
{
  "timestamp": "2026-02-12T08:00:00.000Z",
  "level": "info",
  "message": "Appointment created",
  "callSid": "CA1234567890abcdef",
  "customerName": "John Doe",
  "date": "2026-02-20",
  "time": "2:00 PM",
  "confirmationNumber": "APT-45123"
}
```

### 2. Metrics

**Redis Counters**:
- `metric:total_calls` - Incremented on every inbound call
- `metric:appointments_booked` - Incremented on successful booking
- `metric:call_duration:{callSid}` - Call duration tracking

**Dashboard API** (`/dashboard/api/metrics`):
- Real-time metrics aggregation
- Call success rate calculation
- Average call duration

### 3. Real-Time Monitoring

**Server-Sent Events (SSE)**:
```javascript
// Dashboard subscribes to /dashboard/stream
const eventSource = new EventSource('/dashboard/stream');

eventSource.addEventListener('call_started', (e) => {
  const data = JSON.parse(e.data);
  // Update UI
});
```

**Events Emitted**:
- `call_started` - New call initiated
- `call_updated` - Call status changed
- `call_ended` - Call completed
- `metric_updated` - Counters updated

### 4. External Monitoring (Recommended)

**Application Performance Monitoring (APM)**:
- **Datadog**: `npm install dd-trace`
- **New Relic**: `npm install newrelic`
- **Sentry**: Error tracking and alerting

**Infrastructure Monitoring**:
- **Prometheus + Grafana**: Metrics scraping and visualization
- **CloudWatch** (AWS): Logs and metrics aggregation
- **Uptime Robot**: Endpoint availability checks

**Example Sentry Integration**:
```typescript
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

// Capture errors
app.use(Sentry.Handlers.errorHandler());
```

### 5. Alerting

**Set up alerts for**:
- High error rate (> 5% of calls)
- Long call duration (> 10 minutes)
- Database connection failures
- Redis connection failures
- OpenAI API errors
- High memory usage (> 80%)

## Troubleshooting

### Common Issues

#### 1. "Cannot connect to Redis"

**Error**: `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Solutions**:
```bash
# Check Redis is running
redis-cli ping

# Start Redis
# macOS: brew services start redis
# Ubuntu: sudo systemctl start redis
# Docker: docker run -d -p 6379:6379 redis:7-alpine

# Verify REDIS_URL in .env
echo $REDIS_URL
```

---

#### 2. "Twilio signature validation failed"

**Error**: `403 Invalid signature`

**Solutions**:
```bash
# Temporarily disable validation for testing
ENABLE_WEBHOOK_VALIDATION=false

# Verify PUBLIC_URL matches ngrok URL exactly
# ngrok URL: https://abc123.ngrok-free.dev
# .env: PUBLIC_URL=https://abc123.ngrok-free.dev (no trailing slash)

# Check TWILIO_AUTH_TOKEN is correct
```

---

#### 3. "OpenAI WebSocket closes immediately"

**Error**: `OpenAI connection error: Unexpected server response: 401`

**Solutions**:
```bash
# Verify API key
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models

# Check Realtime API access (requires pay-as-you-go)
# Visit: https://platform.openai.com/settings/organization/billing

# Verify model name is correct
echo $OPENAI_REALTIME_MODEL
```

---

#### 4. "No audio during call"

**Symptoms**: Call connects but silence

**Solutions**:
```bash
# Check logs for audio processing errors
grep -i "audio" logs/combined.log

# Verify Twilio Media Stream is established
# Look for: "Media stream started"

# Test with phone simulator first
open http://localhost:3000/simulator
```

---

#### 5. "Database locked" errors

**Error**: `SQLITE_BUSY: database is locked`

**Solutions**:
```bash
# Check WAL mode is enabled
sqlite3 data/appointments.db "PRAGMA journal_mode;"
# Should return: wal

# Remove lock files
rm data/appointments.db-shm data/appointments.db-wal

# Restart application
npm run dev
```

---

#### 6. ngrok URL keeps changing

**Issue**: Free ngrok URLs change on restart

**Solutions**:
```bash
# Option 1: Paid ngrok account (persistent domain)
ngrok http 3000 --domain=your-domain.ngrok-free.app

# Option 2: Use localtunnel
npx localtunnel --port 3000

# Option 3: Deploy to production early
```

---

### Getting Help

**Logs to Check**:
1. Application logs: `tail -f logs/combined.log`
2. Error logs: `cat logs/error.log`
3. Redis logs: `docker logs <redis-container>`

**Information to Provide**:
- Node.js version: `node --version`
- NPM version: `npm --version`
- Operating system
- Relevant error logs
- Steps to reproduce

**Resources**:
- [Twilio Media Streams Docs](https://www.twilio.com/docs/voice/twiml/stream)
- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [GitHub Issues](https://github.com/Vivek-Chaudhari30/Voice-agent/issues)

## License

MIT
