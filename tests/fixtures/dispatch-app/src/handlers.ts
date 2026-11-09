import { Controller, Get } from '@nestjs/common';
import { Authenticated, OnEvent, OnJob, Process, Roles } from './decorators';
import { JobName, Permission, QueueName, RoleEnum } from './keys';

export class MediaWorker {
  @OnJob({ name: JobName.ThumbnailGenerate, queue: QueueName.Media })
  handleThumbnail(): void {}

  @OnJob({ name: JobName.FaceDetect, queue: QueueName.Media })
  handleFaces(): void {}

  @OnEvent({ name: 'UserCreated' })
  onUserCreated(): void {}
}

export class CleanupJob {
  @Process(CleanupJob.name)
  handle(): void {}
}

/** Decorated like a handler, but called directly from production code: not a dispatch handler. */
export class DirectlyCalled {
  @OnJob({ name: JobName.Cleanup, queue: QueueName.Media })
  run(): void {}
}

@Controller('v1')
export class AssetController {
  /** A route handler with a typed key in a decorator: not a dispatch handler. */
  @Get('assets')
  @Authenticated({ permission: Permission.AssetRead })
  list(): void {}

  /** Enum key whose decorator is typed `number`: never a key. */
  @Roles(RoleEnum.admin)
  admin(): void {}
}
