import { EmitEvent, JobItem, OtherJob } from './keys';
export class JobRepository {
  queue(item: JobItem): void { void item; }
  queueAll(items: JobItem[]): void { void items; }
  queueOther(item: { name: OtherJob }): void { void item; }
}
export class EventRepository {
  emit<T extends EmitEvent>(event: T, payload: unknown): void { void event; void payload; }
}
export class MessageQueue {
  add(jobName: string, data: unknown): void { void jobName; void data; }
}
export function log(message: string): void { void message; }
export function check(opts: { permission: import('./keys').Permission }): void { void opts; }
export function createRole(row: { id: number }): void { void row; }
