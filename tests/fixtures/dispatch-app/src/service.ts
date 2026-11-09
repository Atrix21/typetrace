import { EventRepository, JobRepository, MessageQueue, check, createRole, log } from './bus';
import { CleanupJob, DirectlyCalled } from './handlers';
import { JobName, OtherJob, Permission, RoleEnum } from './keys';

export class AssetService {
  constructor(private jobs: JobRepository, private events: EventRepository, private mq: MessageQueue, private direct: DirectlyCalled) {}

  upload(): void {
    this.jobs.queue({ name: JobName.ThumbnailGenerate });
  }

  detectAll(ids: string[]): void {
    this.jobs.queueAll(ids.map(() => ({ name: JobName.FaceDetect })));
  }

  createUser(): void {
    this.events.emit('UserCreated', {});
  }

  scheduleCleanup(): void {
    this.mq.add(CleanupJob.name, {});
  }

  // ---- negatives
  isThumb(name: JobName): boolean {
    return name === JobName.ThumbnailGenerate; // comparison, not a dispatch
  }
  other(): void {
    this.jobs.queueOther({ name: OtherJob.ThumbnailGenerate }); // different enum, same member name
  }
  plainString(): void {
    log('UserCreated'); // literal with an untyped (string) context
  }
  authorise(): void {
    check({ permission: Permission.AssetRead }); // key only shared with a route handler
  }
  seedRole(): void {
    createRole({ id: RoleEnum.admin }); // enum in a number-typed position
  }
  runDirect(): void {
    this.direct.run();
    this.jobs.queue({ name: JobName.Cleanup });
  }
}
