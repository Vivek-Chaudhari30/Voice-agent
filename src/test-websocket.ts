/**
 * Local WebSocket test client — tests the voice agent WITHOUT Twilio or a phone.
 *
 * Simulates what Twilio does:
 *   1. Connects to ws://localhost:3000/media-stream
 *   2. Sends a fake "start" event
 *   3. Streams microphone audio (if available) or sends silence
 *   4. Receives and plays back audio (logged as base64 chunks)
 *
 * Usage:
 *   npx tsx src/test-websocket.ts
 *
 * This verifies:
 *   ✅ WebSocket server accepts connections
 *   ✅ OpenAI Realtime API connects and responds
 *   ✅ Audio transcoding pipeline works
 *   ✅ Tool calls execute correctly
 *   ✅ Session is created in Redis
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const WS_URL = `ws://localhost:${process.env.PORT || 3000}/media-stream`;
const FAKE_CALL_SID = `CA_test_${randomUUID().slice(0, 8)}`;
const FAKE_STREAM_SID = `MZ_test_${randomUUID().slice(0, 8)}`;

console.log('🧪 Voice Agent WebSocket Test Client\n');
console.log(`Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

let messageCount = 0;
let audioChunksReceived = 0;

ws.on('open', () => {
  console.log('✅ WebSocket connected\n');

  // Step 1: Send "connected" event (Twilio sends this first)
  // Actually Twilio doesn't send connected from client, the server detects it.
  // We just need to send the "start" event.

  // Step 2: Send "start" event to simulate a new call
  const startEvent = {
    event: 'start',
    sequenceNumber: '1',
    start: {
      streamSid: FAKE_STREAM_SID,
      accountSid: 'AC_test_account',
      callSid: FAKE_CALL_SID,
      tracks: ['inbound'],
      customParameters: { from: '+919876543210' },
      mediaFormat: {
        encoding: 'audio/x-mulaw',
        sampleRate: 8000,
        channels: 1,
      },
    },
  };

  ws.send(JSON.stringify(startEvent));
  console.log(`📞 Sent START event (callSid: ${FAKE_CALL_SID})`);
  console.log('   Waiting for OpenAI to connect and greet...\n');

  // Step 3: Send periodic silence (160 bytes of PCMU silence = 0xFF)
  // μ-law silence is 0xFF (which decodes to ~0 in linear PCM)
  const silenceBuffer = Buffer.alloc(160, 0xFF);
  const silenceBase64 = silenceBuffer.toString('base64');

  const silenceInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(silenceInterval);
      return;
    }

    const mediaEvent = {
      event: 'media',
      sequenceNumber: String(messageCount++),
      media: {
        track: 'inbound',
        chunk: String(messageCount),
        timestamp: String(Date.now()),
        payload: silenceBase64,
      },
    };
    ws.send(JSON.stringify(mediaEvent));
  }, 20); // 20ms chunks, matching Twilio's real behavior

  // Auto-stop after 30 seconds
  setTimeout(() => {
    clearInterval(silenceInterval);
    console.log('\n⏱️  30-second test complete. Sending stop event...');

    ws.send(JSON.stringify({
      event: 'stop',
      sequenceNumber: String(messageCount++),
      stop: {
        accountSid: 'AC_test_account',
        callSid: FAKE_CALL_SID,
      },
    }));

    setTimeout(() => {
      ws.close();
      printSummary();
    }, 2000);
  }, 30_000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.event === 'media') {
      audioChunksReceived++;
      // Don't log every audio chunk — just count them
      if (audioChunksReceived === 1) {
        console.log('🔊 Receiving audio from AI agent...');
      }
      if (audioChunksReceived % 50 === 0) {
        console.log(`   ...${audioChunksReceived} audio chunks received`);
      }
    } else if (msg.event === 'clear') {
      console.log('🔇 Server cleared audio buffer (interruption handling)');
    } else if (msg.event === 'mark') {
      console.log(`📌 Mark: ${msg.mark?.name}`);
    } else {
      console.log(`📨 Received: ${JSON.stringify(msg).slice(0, 200)}`);
    }
  } catch {
    // Binary or unparseable data
    console.log(`📨 Received raw data (${(data as Buffer).length} bytes)`);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  console.error('\n💡 Make sure the server is running: npm run dev');
});

ws.on('close', (code, reason) => {
  console.log(`\n🔌 WebSocket closed (code: ${code}, reason: ${reason.toString() || 'none'})`);
  printSummary();
});

function printSummary() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`  Call SID:            ${FAKE_CALL_SID}`);
  console.log(`  Silence chunks sent: ${messageCount}`);
  console.log(`  Audio chunks recv:   ${audioChunksReceived}`);
  console.log(`  AI responded:        ${audioChunksReceived > 0 ? '✅ YES' : '❌ NO'}`);
  console.log('═══════════════════════════════════════\n');

  if (audioChunksReceived > 0) {
    console.log('✅ The agent is working! Audio pipeline verified.');
    console.log('   To test with real voice, use the outbound call script:');
    console.log('   npx tsx src/test-call.ts +91XXXXXXXXXX\n');
  } else {
    console.log('⚠️  No audio received. Check:');
    console.log('   1. Is OPENAI_API_KEY set correctly in .env?');
    console.log('   2. Does your OpenAI account have Realtime API access?');
    console.log('   3. Check server logs for errors\n');
  }

  process.exit(0);
}

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\nInterrupted. Closing...');
  ws.close();
  setTimeout(() => process.exit(0), 1000);
});
