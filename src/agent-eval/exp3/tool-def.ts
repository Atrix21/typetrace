/** The find_relevant_code tool definition (byte-identical across experiment arms and the packaged tool). No side effects. */
export const EXP3_TOOL_NAME = 'find_relevant_code';
export const EXP3_SERVER_NAME = 'code-context';
export const EXP3_TOOL_DESCRIPTION = 'Find where something is implemented in this codebase. Returns a short list of functions/methods with file:line ranges and signatures (and, when known, their direct callers, callees and handlers). Read the ranges you need.';
export const EXP3_TOOL_SCHEMA = { type: 'object', properties: { query: { type: 'string', description: 'What you are looking for, in natural language or identifiers' } }, required: ['query'] } as const;
