import { defineConfig } from 'vitest/config';

// Test files run one at a time: the experiment-2 harness tests share scoring workspaces and use wall-clock timeouts
// for their fake agents (frozen harness code, not changed), which made them flaky under parallel CPU load.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: ['vendor/**', 'targets/**', 'node_modules/**'], fileParallelism: false },
});
