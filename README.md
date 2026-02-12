# Voice AI Agent — Medical Appointment Booking

A production-ready AI phone agent built with Node.js, TypeScript, Twilio, and OpenAI's Realtime API. It answers inbound calls, has natural voice conversations, and books medical appointments — fully automated.

## Architecture

```
Caller (PSTN)
     |
  Twilio
     |  PCMU 8kHz via WebSocket
  Express Server (/media-stream)
     |  PCM16 24kHz via WebSocket
  OpenAI Realtime API (gpt-4o-realtime)
     |  Function calls
  SQLite (appointments) + Redis (sessions, transcripts)
```

## Features

- Real-time bidirectional voice streaming (Twilio ↔ OpenAI)
- PCMU/PCM16 codec conversion with 8kHz/24kHz resampling
- AI receptionist persona ("Sarah") with natural conversation flow
- Function calling: check available slots, book appointments
- SQLite database for appointment storage
- Redis for session management, transcripts, and metrics
- Live dashboard with active calls, transcripts, and performance charts
- Server-Sent Events for real-time dashboard updates
- Call timeout enforcement, error handling, graceful shutdown

## Prerequisites

- Node.js 20+
- Redis 7+ (local or Docker)
- Twilio account with a phone number
- OpenAI API key with Realtime API access
- ngrok (for local development)

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd voice-ai-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your Twilio and OpenAI credentials
```

### 3. Start Redis

```bash
# Option A: Docker
docker run -d -p 6379:6379 redis:7-alpine

# Option B: docker-compose (starts Redis + app)
docker-compose up
```

### 4. Start ngrok

```bash
ngrok http 3000
# Copy the https URL to .env → PUBLIC_URL
```

### 5. Configure Twilio

1. Go to your Twilio Console → Phone Numbers
2. Select your number → Voice Configuration
3. Set webhook URL to: `https://your-ngrok-url/voice` (HTTP POST)

### 6. Run the server

```bash
npm run dev
```

### 7. Test

Call your Twilio phone number. Sarah will greet you and help book an appointment.

Dashboard: http://localhost:3000/dashboard

## Using Docker Compose

```bash
docker-compose up --build
```

This starts both Redis and the application.

## Project Structure

```
src/
  server.ts                 # Express + WebSocket entry point
  config/
    environment.ts          # Env var loading & validation
    agent-instructions.ts   # AI system prompt
    twilio.config.ts        # Twilio client
  services/
    audio.service.ts        # PCMU ↔ PCM16 conversion
    database.service.ts     # SQLite setup & queries
    openai.service.ts       # OpenAI Realtime WebSocket client
    redis.service.ts        # Redis session & transcript management
  handlers/
    voice.handler.ts        # POST /voice — TwiML response
    media-stream.handler.ts # WebSocket /media-stream — audio bridge
    tools.handler.ts        # Function call execution
  utils/
    audio-codec.util.ts     # μ-law encode/decode
    audio-resampler.util.ts # 8kHz ↔ 24kHz resampling
    logger.util.ts          # Winston logger
  dashboard/
    routes.ts               # Dashboard Express routes + SSE
    public/index.html       # Dashboard UI
    public/app.js           # Dashboard frontend JS
    api/                    # REST API endpoints
  types/                    # TypeScript interfaces
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/voice` | POST | Twilio voice webhook — returns TwiML |
| `/media-stream` | WS | Twilio Media Stream WebSocket |
| `/health` | GET | Health check |
| `/dashboard` | GET | Live monitoring dashboard |
| `/dashboard/stream` | GET | SSE stream for real-time updates |
| `/dashboard/api/calls/active` | GET | Active calls |
| `/dashboard/api/calls/history` | GET | Call history |
| `/dashboard/api/calls/stats` | GET | Aggregate statistics |
| `/dashboard/api/metrics` | GET | Performance metrics |
| `/dashboard/api/transcripts/:callSid` | GET | Call transcript |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio phone number |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OPENAI_REALTIME_MODEL` | No | Model ID (default: gpt-4o-realtime-preview-2024-10-01) |
| `OPENAI_VOICE` | No | Voice ID (default: alloy) |
| `PORT` | No | Server port (default: 3000) |
| `PUBLIC_URL` | Yes | Public URL for Twilio webhooks |
| `REDIS_URL` | No | Redis connection URL (default: redis://localhost:6379) |
| `LOG_LEVEL` | No | Log level (default: info) |
| `ENABLE_WEBHOOK_VALIDATION` | No | Verify Twilio signatures (default: true) |
| `MAX_CALL_DURATION_MINUTES` | No | Max call length (default: 5) |

## License

MIT
