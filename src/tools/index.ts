import { listAvailableSlots, createAppointment } from './appointments';
import logger from '../utils/logger';
import type { OpenAITool } from '../types/openai';

/** Tool definitions sent to OpenAI during session.update */
export const TOOL_DEFINITIONS: OpenAITool[] = [
  {
    type: 'function',
    name: 'list_available_slots',
    description:
      'Check available appointment time slots for a specific date. Returns list of available times in HH:MM format. Call this before trying to book an appointment.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (e.g., 2024-03-15)',
        },
      },
      required: ['date'],
    },
  },
  {
    type: 'function',
    name: 'create_appointment',
    description:
      'Book an appointment slot for a customer. Only call this after confirming the slot is available via list_available_slots and the customer has confirmed they want this time.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Full name of the customer',
        },
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format',
        },
        time: {
          type: 'string',
          description: 'Time in HH:MM format (must be one of the available slots)',
        },
      },
      required: ['customer_name', 'date', 'time'],
    },
  },
];

export interface ToolCallResult {
  result: unknown;
  durationMs: number;
}

/**
 * Execute a named tool with parsed arguments. Returns a JSON-serialisable result.
 */
export function executeTool(
  name: string,
  args: Record<string, unknown>,
  phoneNumber?: string,
): ToolCallResult {
  const start = Date.now();

  try {
    let result: unknown;

    switch (name) {
      case 'list_available_slots':
        result = listAvailableSlots(args.date as string);
        break;

      case 'create_appointment':
        result = createAppointment(
          args.customer_name as string,
          args.date as string,
          args.time as string,
          phoneNumber,
        );
        break;

      default:
        logger.error({ name }, 'Unknown tool called');
        result = { error: `Unknown tool: ${name}` };
    }

    const durationMs = Date.now() - start;
    logger.info({ tool: name, args, durationMs }, 'Tool executed');
    return { result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error({ tool: name, args, err }, 'Tool execution failed');
    return {
      result: { success: false, error: 'Internal tool error. Please try again.' },
      durationMs,
    };
  }
}
