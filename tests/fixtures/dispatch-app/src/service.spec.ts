import { JobRepository } from './bus';
import { JobName } from './keys';

/** Test code that queues a job (a mock expectation in real suites): never a producer (R1). */
export function expectQueued(): void {
  new JobRepository().queue({ name: JobName.ThumbnailGenerate });
}
