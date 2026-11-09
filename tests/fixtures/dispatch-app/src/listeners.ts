import { EventRepository } from './bus';
import { OnEvent } from './decorators';
import { Worker } from './keys';

/** Five handlers share the worker-filter key (1 value / 5 registrations = broadcast): they link via their event names. */
export class Listeners {
  constructor(private events: EventRepository) {}
  @OnEvent({ name: 'UserCreated', workers: [Worker.Api] })
  a(): void {}
  @OnEvent({ name: 'UserCreated', workers: [Worker.Api] })
  b(): void {}
  @OnEvent({ name: 'UserDeleted', workers: [Worker.Api] })
  c(): void {}
  /** Re-emits its own event: forwarding, not a new dispatch (R3). */
  @OnEvent({ name: 'UserDeleted', workers: [Worker.Api] })
  forward(): void { this.events.emit('UserDeleted', {}); }
  @OnEvent({ name: 'UserDeleted', workers: [Worker.Api] })
  e(): void {}
}
