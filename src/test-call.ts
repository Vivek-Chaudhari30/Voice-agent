/**
 * Test script: Makes an outbound call from your Twilio number to YOUR phone.
 * Twilio calls you, then connects to the same voice agent webhook.
 *
 * Usage:
 *   npx tsx src/test-call.ts +91XXXXXXXXXX
 *
 * This way you receive the call in India — no international dialing needed.
 * Note: Twilio trial accounts may need your number verified first.
 */

import dotenv from 'dotenv';
dotenv.config();

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER!;
const PUBLIC_URL = process.env.PUBLIC_URL!;

const TO_NUMBER = process.argv[2];

if (!TO_NUMBER) {
  console.error('Usage: npx tsx src/test-call.ts +91XXXXXXXXXX');
  console.error('  Provide your Indian phone number with country code (+91)');
  process.exit(1);
}

if (!TO_NUMBER.startsWith('+')) {
  console.error('Phone number must start with + (e.g., +919876543210)');
  process.exit(1);
}

async function makeCall() {
  console.log(`\nMaking outbound call...`);
  console.log(`  From: ${TWILIO_PHONE_NUMBER} (your Twilio number)`);
  console.log(`  To:   ${TO_NUMBER} (your phone)`);
  console.log(`  Webhook: ${PUBLIC_URL}/voice\n`);

  // Twilio REST API - Create a call
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;

  const params = new URLSearchParams({
    To: TO_NUMBER,
    From: TWILIO_PHONE_NUMBER,
    Url: `${PUBLIC_URL}/voice`,  // Same webhook as inbound calls
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (response.ok) {
    console.log('✅ Call initiated successfully!');
    console.log(`   Call SID: ${data.sid}`);
    console.log(`   Status: ${data.status}`);
    console.log('\n📱 Your phone should ring in a few seconds...');
    console.log('   Pick up and talk to the AI receptionist!\n');
  } else {
    console.error('❌ Failed to create call:');
    console.error(`   Status: ${response.status}`);
    console.error(`   Error: ${data.message || JSON.stringify(data)}`);

    if (data.code === 21219) {
      console.error('\n💡 Trial account? You need to verify your Indian number first:');
      console.error('   https://console.twilio.com/develop/phone-numbers/manage/verified');
    }
    if (data.code === 21215) {
      console.error('\n💡 Geographic permission needed. Enable India in:');
      console.error('   https://console.twilio.com/develop/voice/settings/geo-permissions');
    }
  }
}

makeCall().catch((err) => {
  console.error('Error:', err.message);
});
