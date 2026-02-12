import { getBookedSlots, insertAppointment, isSlotBooked } from '../services/database.service';
import { saveTranscript, trackMetric, incrementCounter, updateCallStatus } from '../services/redis.service';
import { logger } from '../utils/logger.util';

// ── Slot generation ─────────────────────────────────────────────────────────

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
}

function generateAllSlots(): string[] {
  const slots: string[] = [];
  for (let hour = 9; hour < 17; hour++) {
    if (hour === 12) continue; // Lunch break
    slots.push(formatTime(hour, 0));
    slots.push(formatTime(hour, 30));
  }
  return slots;
}

// ── Tool implementations ────────────────────────────────────────────────────

async function listAvailableSlots(date: string): Promise<{ available_slots: string[] }> {
  // Validate weekday
  const d = new Date(date + 'T12:00:00'); // noon to avoid timezone issues
  const day = d.getUTCDay();
  if (day === 0 || day === 6) {
    return { available_slots: [] };
  }

  const allSlots = generateAllSlots();
  const booked = getBookedSlots(date);
  const available = allSlots.filter((s) => !booked.includes(s));

  return { available_slots: available };
}

async function createAppointment(
  customerName: string,
  date: string,
  time: string,
  callSid: string,
  phoneNumber: string
): Promise<{ success: boolean; confirmation_number?: string; error?: string }> {
  // Double-check availability (race-condition guard)
  if (isSlotBooked(date, time)) {
    return { success: false, error: 'That time slot was just booked by someone else. Please choose another time.' };
  }

  const confirmationNumber = `APT-${Math.floor(10000 + Math.random() * 90000)}`;

  try {
    insertAppointment({
      customerName,
      phoneNumber,
      date,
      time,
      confirmationNumber,
      callSid,
    });

    await incrementCounter('appointments_booked');

    logger.info('Appointment created', { confirmationNumber, customerName, date, time, callSid });

    return { success: true, confirmation_number: confirmationNumber };
  } catch (err: any) {
    logger.error('Failed to create appointment', { error: err.message, customerName, date, time });
    return { success: false, error: 'Database error — please try again.' };
  }
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeToolCall(
  functionName: string,
  args: Record<string, any>,
  callSid: string,
  phoneNumber = 'unknown'
): Promise<any> {
  const start = Date.now();

  try {
    let result: any;

    switch (functionName) {
      case 'list_available_slots':
        result = await listAvailableSlots(args.date);
        await updateCallStatus(callSid, { currentStep: 'checking_slots', aiStatus: 'processing_tool' });
        break;

      case 'create_appointment':
        result = await createAppointment(args.customer_name, args.date, args.time, callSid, phoneNumber);
        if (result.success) {
          await updateCallStatus(callSid, { currentStep: 'farewell', customerName: args.customer_name });
        }
        break;

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }

    const duration = Date.now() - start;
    await trackMetric('tool_execution', duration);

    // Save function call & result to transcript
    await saveTranscript(callSid, {
      timestamp: new Date().toISOString(),
      role: 'function_call',
      content: `${functionName}(${JSON.stringify(args)})`,
      metadata: { functionName, arguments: args },
    });
    await saveTranscript(callSid, {
      timestamp: new Date().toISOString(),
      role: 'function_result',
      content: JSON.stringify(result),
      metadata: { functionName, result },
    });

    logger.info('Tool executed', { functionName, duration, callSid });
    return result;
  } catch (err: any) {
    logger.error('Tool execution failed', { functionName, args, error: err.message });
    return { error: true, message: "I'm having trouble with our system right now. Let me try again." };
  }
}
