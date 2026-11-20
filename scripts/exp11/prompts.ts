/**
 * Experiment 11: prompts and answer schemas. The same in every arm. Unlike experiment 10, the system text names no tool
 * and does not ask the agent to use one: steering toward a tool is what each vendor's setup does, and is what is tested.
 * The text is appended to Claude Code's own system prompt, as a user's instructions would be.
 */
const ANSWER_RULE = 'When you are done, call the StructuredOutput tool once with your answer: the code locations (functions or methods) that answer the task, most important first, each with its repository-relative file path and qualified symbol name (ClassName.methodName or functionName), plus a short summary.';

export const TASK_SYSTEM_PROMPT: Record<'T1' | 'T2' | 'T3', string> = {
  T1: ['You are a senior software engineer working in an unfamiliar repository checked out in the current directory.', 'Explore the code with the tools available to you. Do not modify any file.', ANSWER_RULE].join(' '),
  T2: ['You are a senior software engineer working in an unfamiliar repository checked out in the current directory.', 'Explore the code with the tools available to you. Do not modify any file.', ANSWER_RULE].join(' '),
  T3: ['You are a senior software engineer working in an unfamiliar repository checked out in the current directory.', 'Explore the code with the tools available to you. Do not modify any file.',
    'When you are done, call the StructuredOutput tool once with your answer: the complete answer to the question in prose, and the code locations (repository-relative file path and qualified symbol name) it relies on.'].join(' '),
};

/** Experiment 10's task prompt, unchanged. */
export function T1_PROMPT(problem: string): string {
  return `Issue report:\n\n${problem}\n\nFind the code that must change to resolve this issue. List first the function(s) or method(s) that must change, most likely first, then other functions involved.`;
}

/** code-review-graph's co-change design: one file of the real change is given; the rest must be found. */
export function T2_PROMPT(problem: string, seed: string, diff: string): string {
  return `Issue report:\n\n${problem}\n\nTo resolve it, this change is being made to ${seed}:\n\n\`\`\`diff\n${diff}\n\`\`\`\n\nThis change is being made. Which other files and functions must also change to complete it? List the other function(s) or method(s) that must change, most likely first. Do not list the code already changed in the diff above.`;
}

export function T3_PROMPT(question: string): string {
  return `Question about this repository:\n\n${question}\n\nAnswer it from the code in this repository.`;
}

export const T3_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'locations'],
  properties: {
    answer: { type: 'string', description: 'The complete answer to the question, in prose' },
    locations: {
      type: 'array', minItems: 0, maxItems: 20,
      items: {
        type: 'object', additionalProperties: false, required: ['file'],
        properties: {
          file: { type: 'string', description: 'Repository-relative file path' },
          symbol: { type: 'string', description: 'Qualified function/method/class name, if any' },
        },
      },
    },
  },
} as const;

export interface T3Answer { answer: string; locations: { file: string; symbol?: string }[] }
export function parseT3Answer(raw: unknown): T3Answer | null {
  const o = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!o || typeof o !== 'object' || typeof (o as any).answer !== 'string' || !(o as any).answer.trim()) return null;
  const locs = Array.isArray((o as any).locations) ? (o as any).locations.filter((l: any) => l && typeof l.file === 'string').map((l: any) => ({ file: l.file, ...(typeof l.symbol === 'string' ? { symbol: l.symbol } : {}) })) : [];
  return { answer: (o as any).answer, locations: locs };
}
