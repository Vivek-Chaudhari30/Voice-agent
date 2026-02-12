/**
 * Phone Simulator — Browser-side audio pipeline
 *
 * Captures mic audio, converts to PCMU 8kHz (Twilio format),
 * sends over WebSocket using Twilio Media Stream protocol,
 * receives AI audio back, decodes and plays through speakers.
 */

// ── State ──────────────────────────────────────────────────────────────────
let ws = null;
let audioCtx = null;
let micStream = null;
let scriptNode = null;
let callActive = false;
let callSid = '';
let streamSid = '';
let timerInterval = null;
let callStartTime = 0;
let transcriptPoll = null;

// Playback state
const playbackQueue = [];       // Array of Float32Array chunks
let playbackNode = null;
let playbackBufferPos = 0;
let currentPlaybackBuffer = null;
let audioChunksReceived = 0;
let audioChunksSent = 0;

// ── μ-law Codec ────────────────────────────────────────────────────────────
// Uses pre-computed decode table — matches server-side exactly

const MULAW_BIAS = 0x84;   // 132
const MULAW_CLIP = 32635;

// Pre-computed decode table (identical to server audio-codec.util.ts)
const MULAW_DECODE_TABLE = new Int16Array(256);
(function initDecodeTable() {
  for (let i = 0; i < 256; i++) {
    let mulaw = ~i & 0xFF;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;
    let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
    magnitude -= MULAW_BIAS;
    MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
  }
})();

// Encode exponent lookup (same as server)
const MULAW_EXP_TABLE = [
  0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
  4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
];

function linearToMuLaw(sample) {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.abs(sample);
  if (magnitude > MULAW_CLIP) magnitude = MULAW_CLIP;
  magnitude += MULAW_BIAS;
  const exponent = MULAW_EXP_TABLE[(magnitude >> 7) & 0xFF];
  const mantissa = (magnitude >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function muLawToLinear(byte) {
  return MULAW_DECODE_TABLE[byte];
}

// ── Resampling ─────────────────────────────────────────────────────────────

function downsample(input, fromRate, toRate) {
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const s = i * ratio;
    const i0 = Math.floor(s);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = s - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

function upsample(input, fromRate, toRate) {
  const ratio = toRate / fromRate;
  const len = Math.floor(input.length * ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const s = i / ratio;
    const i0 = Math.floor(s);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const f = s - i0;
    out[i] = input[i0] * (1 - f) + input[i1] * f;
  }
  return out;
}

// ── Base64 ─────────────────────────────────────────────────────────────────

function uint8ToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// ── Call Control ───────────────────────────────────────────────────────────

async function toggleCall() {
  if (callActive) endCall();
  else await startCall();
}

async function startCall() {
  try {
    updateUI('connecting');

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    console.log('[SIM] AudioContext sampleRate:', audioCtx.sampleRate);

    const micSource = audioCtx.createMediaStreamSource(micStream);

    const id = Math.random().toString(36).substring(2, 10);
    callSid = 'SIM-' + id;
    streamSid = 'STREAM-' + id;
    audioChunksReceived = 0;
    audioChunksSent = 0;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/media-stream`);

    ws.onopen = () => {
      console.log('[SIM] WebSocket connected');

      ws.send(JSON.stringify({
        event: 'start',
        start: {
          streamSid,
          callSid,
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
          customParameters: { callSid, callerNumber: '+15550001234' },
        },
      }));

      callActive = true;
      callStartTime = Date.now();
      updateUI('active');
      startTimer();
      startTranscriptPolling();
      startPlayback();
      startMicCapture(micSource);
    };

    ws.onmessage = (evt) => handleServerMessage(evt.data);
    ws.onclose = () => { console.log('[SIM] WS closed'); if (callActive) endCall(); };
    ws.onerror = (err) => { console.error('[SIM] WS error', err); updateStatus('Connection error'); };

  } catch (err) {
    console.error('[SIM] Start failed:', err);
    updateStatus('Microphone access denied');
    updateUI('idle');
  }
}

function endCall() {
  callActive = false;
  console.log(`[SIM] Ended. Sent:${audioChunksSent} Recv:${audioChunksReceived}`);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'stop' }));
    ws.close();
  }
  ws = null;

  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  if (playbackNode) { playbackNode.disconnect(); playbackNode = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }

  playbackQueue.length = 0;
  currentPlaybackBuffer = null;
  playbackBufferPos = 0;

  if (timerInterval) clearInterval(timerInterval);
  if (transcriptPoll) clearInterval(transcriptPoll);

  updateUI('idle');
}

// ── Mic Capture ────────────────────────────────────────────────────────────

function startMicCapture(micSource) {
  scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);

  scriptNode.onaudioprocess = (e) => {
    if (!callActive || !ws || ws.readyState !== WebSocket.OPEN) return;

    const raw = e.inputBuffer.getChannelData(0);
    const down = downsample(raw, audioCtx.sampleRate, 8000);

    const pcmu = new Uint8Array(down.length);
    for (let i = 0; i < down.length; i++) {
      const clamped = Math.max(-1, Math.min(1, down[i]));
      pcmu[i] = linearToMuLaw(Math.round(clamped * 32767));
    }

    ws.send(JSON.stringify({ event: 'media', media: { payload: uint8ToBase64(pcmu) } }));
    audioChunksSent++;
  };

  micSource.connect(scriptNode);
  scriptNode.connect(audioCtx.destination);
  console.log('[SIM] Mic capture started');
}

// ── Receive & Play Audio ───────────────────────────────────────────────────

function handleServerMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.event === 'media' && msg.media && msg.media.payload) {
    audioChunksReceived++;

    if (audioChunksReceived === 1) {
      console.log('[SIM] *** First audio chunk from server! payload bytes:', msg.media.payload.length);
    }

    // base64 → PCMU → linear Int16 → Float32 at 8kHz
    const pcmuBytes = base64ToUint8(msg.media.payload);
    const samples = new Float32Array(pcmuBytes.length);
    for (let i = 0; i < pcmuBytes.length; i++) {
      samples[i] = muLawToLinear(pcmuBytes[i]) / 32768.0;
    }

    // 8kHz → browser rate
    const upsampled = upsample(samples, 8000, audioCtx ? audioCtx.sampleRate : 48000);
    playbackQueue.push(upsampled);

    setWaveformState('speaking');
    setAIStatus('Speaking');
  }
}

function startPlayback() {
  // Use smaller buffer for lower latency
  playbackNode = audioCtx.createScriptProcessor(2048, 1, 1);

  playbackNode.onaudioprocess = (e) => {
    const output = e.outputBuffer.getChannelData(0);
    let pos = 0;
    let playedAudio = false;

    while (pos < output.length) {
      if (!currentPlaybackBuffer || playbackBufferPos >= currentPlaybackBuffer.length) {
        if (playbackQueue.length > 0) {
          currentPlaybackBuffer = playbackQueue.shift();
          playbackBufferPos = 0;
        } else {
          // Silence
          for (let i = pos; i < output.length; i++) output[i] = 0;
          if (callActive && !playedAudio) {
            setWaveformState('listening');
            setAIStatus('Listening');
          }
          return;
        }
      }

      playedAudio = true;
      const avail = currentPlaybackBuffer.length - playbackBufferPos;
      const need = output.length - pos;
      const n = Math.min(avail, need);

      for (let i = 0; i < n; i++) {
        output[pos + i] = currentPlaybackBuffer[playbackBufferPos + i];
      }
      pos += n;
      playbackBufferPos += n;
    }
  };

  playbackNode.connect(audioCtx.destination);
  console.log('[SIM] Playback node connected');
}

// ── UI ─────────────────────────────────────────────────────────────────────

function updateUI(state) {
  const btn = document.getElementById('call-btn');
  const iconPhone = document.getElementById('icon-phone');
  const iconHangup = document.getElementById('icon-hangup');
  const pulse = document.getElementById('pulse');
  const waveform = document.getElementById('waveform');
  const aiBadge = document.getElementById('ai-badge');
  const timer = document.getElementById('timer');

  switch (state) {
    case 'idle':
      btn.className = 'relative z-10 w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl shadow-lg transition-all duration-300 bg-green-600 hover:bg-green-500 active:scale-95';
      iconPhone.classList.remove('hidden');
      iconHangup.classList.add('hidden');
      pulse.classList.add('hidden');
      waveform.classList.add('hidden');
      aiBadge.classList.add('hidden');
      timer.classList.add('hidden');
      updateStatus('Call ended');
      setWaveformState('idle');
      break;
    case 'connecting':
      btn.className = 'relative z-10 w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl shadow-lg transition-all duration-300 bg-yellow-600 cursor-wait';
      updateStatus('Connecting...');
      break;
    case 'active':
      btn.className = 'relative z-10 w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl shadow-lg transition-all duration-300 bg-red-600 hover:bg-red-500 active:scale-95';
      iconPhone.classList.add('hidden');
      iconHangup.classList.remove('hidden');
      pulse.classList.remove('hidden');
      waveform.classList.remove('hidden');
      aiBadge.classList.remove('hidden');
      timer.classList.remove('hidden');
      updateStatus('Connected — Sarah is here');
      setWaveformState('listening');
      break;
  }
}

function updateStatus(text) {
  document.getElementById('status-text').textContent = text;
}

function setAIStatus(label) {
  const dot = document.getElementById('ai-dot');
  document.getElementById('ai-status-label').textContent = label;
  dot.className = label === 'Speaking'
    ? 'w-2 h-2 rounded-full bg-purple-500 dot-pulse'
    : label === 'Processing'
    ? 'w-2 h-2 rounded-full bg-yellow-500 dot-pulse'
    : 'w-2 h-2 rounded-full bg-green-500 dot-pulse';
}

function setWaveformState(state) {
  document.querySelectorAll('.wave-bar').forEach(bar => {
    bar.classList.remove('idle', 'speaking');
    if (state === 'idle') bar.classList.add('idle');
    else if (state === 'speaking') bar.classList.add('speaking');
  });
}

function startTimer() {
  const el = document.getElementById('timer');
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}

// ── Transcript Polling ─────────────────────────────────────────────────────

function startTranscriptPolling() {
  const container = document.getElementById('transcript');
  const counter = document.getElementById('transcript-count');
  container.innerHTML = '';
  let last = 0;

  const poll = async () => {
    if (!callSid) return;
    try {
      const res = await fetch(`/dashboard/api/transcripts/${callSid}`);
      const entries = await res.json();
      if (entries.length > last) {
        for (let i = last; i < entries.length; i++) {
          const e = entries[i];
          const div = document.createElement('div');
          const t = new Date(e.timestamp).toLocaleTimeString();
          if (e.role === 'user') {
            div.className = 'msg-user px-3 py-2 text-sm text-white';
            div.innerHTML = `<span class="text-blue-300 text-xs">${t}</span><br>${esc(e.content)}`;
          } else if (e.role === 'assistant') {
            div.className = 'msg-ai px-3 py-2 text-sm text-slate-200';
            div.innerHTML = `<span class="text-green-400 text-xs">${t} &bull; Sarah</span><br>${esc(e.content)}`;
          } else if (e.role === 'function_call') {
            div.className = 'msg-fn px-3 py-1.5 text-xs text-yellow-300';
            div.textContent = `${t} | ${e.content}`;
          } else if (e.role === 'function_result') {
            div.className = 'msg-fn px-3 py-1.5 text-xs text-green-300';
            div.textContent = `${t} | ${e.content}`;
          }
          container.appendChild(div);
        }
        last = entries.length;
        counter.textContent = `${last} messages`;
        container.scrollTop = container.scrollHeight;
      }
    } catch {}
  };

  poll();
  transcriptPoll = setInterval(poll, 1500);
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

window.toggleCall = toggleCall;
