/**
 * Experiment 10 (agents on SWE-bench Lite + Multilingual): prompts. The answer schema and the scoring are experiment
 * 3's (src/agent-eval/exp3/score.ts) unchanged: an ordered list of code locations, scored automatically against the
 * functions the gold patch changed (task score = a changed function among the first three locations).
 * The only difference from experiment 3 is language: these repositories are not all TypeScript.
 */
export const SWE_SYSTEM_PROMPT = [
  'You are a senior software engineer working in an unfamiliar repository checked out in the current directory.',
  'Answer the user\'s question about this codebase by exploring the code with the available read-only tools.',
  'Besides Read, Grep and Glob you may have a code-search tool provided through MCP (its name starts with mcp__); if you do, use it first to find candidate locations, then verify them by reading the code.',
  'When you are done, call the StructuredOutput tool once with your answer: the code locations (functions or methods) that answer the question, most important first, each with its repository-relative file path and qualified symbol name (ClassName.methodName or functionName), plus a short summary.',
].join(' ');

export function sweTaskPrompt(problemStatement: string): string {
  return `Issue report:\n\n${problemStatement}\n\nFind the code that must change to resolve this issue. List first the function(s) or method(s) that must change, most likely first, then other functions involved.`;
}
