# Manual Test Scenarios

## Prerequisites
- Server running (`npm run dev`)
- ngrok tunnel active
- Twilio webhook configured to your ngrok URL
- Redis running (`docker-compose up -d redis`)

---

## Test 1: Happy Path - Book Appointment

**Steps:**
1. Call your Twilio number
2. Wait for greeting
3. Say: "I'd like to book an appointment"
4. When asked for name, say: "John Smith"
5. When asked for date, say: "Tomorrow" (or a specific weekday date)
6. Listen for available slots
7. Choose a time: "10 AM please"
8. Confirm when asked
9. Say goodbye

**Expected:**
- Agent greets warmly
- Collects name, date, time in order
- Calls `list_available_slots` (check logs)
- Calls `create_appointment` (check logs)
- Confirms booking details
- Says goodbye

**Verify in Redis:**
```bash
docker exec -it voice-agent-redis-1 redis-cli
KEYS session:*
GET session:<callSid>
```

---

## Test 2: No Slots Available

**Steps:**
1. Call and request a weekend date (Saturday/Sunday)
2. Agent should report no availability
3. Agent should offer to check nearby dates

**Expected:**
- `list_available_slots` returns empty array
- Agent communicates this naturally
- Offers alternatives

---

## Test 3: Interruption Handling

**Steps:**
1. Call and start the booking flow
2. While the agent is speaking (listing available times), interrupt: "Actually, never mind"
3. Agent should stop speaking and respond to your interruption

**Expected:**
- Audio playback stops immediately
- Agent acknowledges the interruption
- Conversation continues naturally

---

## Test 4: Unclear / Ambiguous Input

**Steps:**
1. Call and mumble or give vague responses
2. Say something like "uh, maybe... next week sometime?"

**Expected:**
- Agent asks for clarification
- Remains patient and helpful
- Doesn't crash or hang

---

## Test 5: Change Mind Mid-Conversation

**Steps:**
1. Start booking for March 15th
2. After hearing slots, say "Actually, can we do the 16th instead?"

**Expected:**
- Agent calls `list_available_slots` again with new date
- Presents new options
- Continues smoothly

---

## Test 6: Call Timeout

**Steps:**
1. Call and stay on the line without completing the booking
2. Wait for the timeout (5 minutes by default)

**Expected:**
- Agent politely wraps up after timeout
- Call ends gracefully
- Session marked as ended in Redis

---

## Debugging Checklist

- [ ] Server logs show "Incoming call" on POST /voice
- [ ] TwiML response sent with correct stream URL
- [ ] WebSocket connection established on /media-stream
- [ ] "Media Stream started" appears in logs
- [ ] "OpenAI WebSocket connected" appears
- [ ] Audio chunks flowing (chunksReceived incrementing)
- [ ] AI audio being sent back (chunksSent incrementing)
- [ ] Transcripts appearing in logs
- [ ] Tool calls logged with args and results
- [ ] Session data persisted in Redis
