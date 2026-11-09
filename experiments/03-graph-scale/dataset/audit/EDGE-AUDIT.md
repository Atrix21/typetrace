# Edge precision audit (independent, 50 sampled edges per repo)

Method: each sample judged by reading the pinned snapshot code. Precision = correct/(correct+incorrect); unclear reported separately.

| repo | kind | n | correct | incorrect | unclear | precision |
|---|---|---|---|---|---|---|
| immich | dispatch_pair | 35 | 12 | 23 | 0 | 0.34 |
| immich | query_builder | 15 | 15 | 0 | 0 | 1.00 |
| twenty | dispatch_pair | 35 | 11 | 24 | 0 | 0.31 |
| twenty | graphql_route | 15 | 15 | 0 | 0 | 1.00 |

## Incorrect cases

- immich-02 (immich): src/services/person.service.spec.ts:1524 is a spec-file expectation/mock (expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName...), not a runtime dispatch.
- immich-03 (immich): src/services/metadata.service.spec.ts:93 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-05 (immich): src/services/user.service.spec.ts:151 is a spec-file expectation/mock (expect(mocks.job.queue.mock.calls).toEqual([[{ name: JobName...), not a runtime dispatch.
- immich-10 (immich): src/services/person.service.spec.ts:1195 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([ { name: Jo...), not a runtime dispatch. Evidence also names a different job (FacialRecognitionQueueAll).
- immich-11 (immich): src/services/library.service.spec.ts:1192 is a spec-file expectation/mock (expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName...), not a runtime dispatch.
- immich-12 (immich): src/services/metadata.service.spec.ts:939 is a spec-file expectation/mock (expect(mocks.job.queue).toHaveBeenCalledExactlyOnceWith({ na...), not a runtime dispatch.
- immich-14 (immich): src/services/queue.service.spec.ts:47 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([ { name: Jo...), not a runtime dispatch.
- immich-17 (immich): src/services/library.service.spec.ts:31 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-18 (immich): src/services/media.service.spec.ts:106 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([ { name: Jo...), not a runtime dispatch.
- immich-19 (immich): src/services/library.service.spec.ts:31 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-20 (immich): Key is the ImmichWorker enum used as a worker filter, not a job/event name; src/repositories/config.repository.ts:220 only reads/configures workers and emits nothing to the handler.
- immich-22 (immich): src/services/ocr.service.spec.ts:14 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-24 (immich): src/services/duplicate.service.spec.ts:131 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([ { name: Jo...), not a runtime dispatch.
- immich-25 (immich): src/services/database-backup.service.spec.ts:61 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-26 (immich): src/services/job.service.spec.ts:15 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-27 (immich): src/services/person.service.spec.ts:1084 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([ { name: Jo...), not a runtime dispatch.
- immich-28 (immich): src/services/queue.service.spec.ts:15 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-29 (immich): src/services/ocr.service.spec.ts:14 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-30 (immich): src/services/duplicate.service.spec.ts:391 is a spec-file expectation/mock (expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: Job...), not a runtime dispatch.
- immich-31 (immich): Key is the ImmichWorker enum used as a worker filter, not a job/event name; src/repositories/config.repository.ts:220 only reads/configures workers and emits nothing to the handler.
- immich-32 (immich): src/services/media.service.spec.ts:4402 is a spec-file expectation/mock (expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName...), not a runtime dispatch.
- immich-33 (immich): src/services/smart-info.service.spec.ts:17 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- immich-35 (immich): src/services/metadata.service.spec.ts:93 is a spec-file expectation/mock (mocks.config.getWorker.mockReturnValue(ImmichWorker.Microser...), not a runtime dispatch.
- twenty-01 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:94 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-02 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:94 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-04 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:116 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-05 (twenty): src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts:141 is inside a @OnDatabaseBatchEvent listener that merely passes DESTROYED to its own handleEvent; it consumes the event rather than emitting it, so it does not trigger the claimed handler.
- twenty-10 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:94 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-11 (twenty): open-api.service.ts:173 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-12 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:116 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-13 (twenty): open-api.service.ts:170 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-14 (twenty): src/modules/workflow/workflow-builder/workflow-schema/utils/__tests__/generate-fake-object-record-event.spec.ts:35 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-15 (twenty): src/modules/workflow/workflow-builder/workflow-schema/utils/__tests__/generate-fake-object-record-event.spec.ts:66 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-16 (twenty): src/modules/workflow/workflow-trigger/automated-trigger/listeners/workflow-database-event-trigger.listener.ts:141 is inside a @OnDatabaseBatchEvent listener that merely passes DESTROYED to its own handleEvent; it consumes the event rather than emitting it, so it does not trigger the claimed handler.
- twenty-17 (twenty): src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener.ts:54 is a listener (handleCreate) that is itself triggered by the event and forwards it internally (handleEvent); it does not emit a database event to the claimed handler.
- twenty-18 (twenty): open-api.service.ts:164 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-19 (twenty): src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener.ts:59 is a listener (handleUpdate) that is itself triggered by the event and forwards it internally (handleEvent); it does not emit a database event to the claimed handler.
- twenty-20 (twenty): src/modules/workflow/workflow-builder/workflow-schema/utils/__tests__/generate-fake-object-record-event.spec.ts:128 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-22 (twenty): src/modules/timeline/utils/__tests__/resolve-timeline-activity-rule-action.util.spec.ts:90 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-23 (twenty): src/modules/workflow/workflow-builder/workflow-schema/utils/__tests__/generate-fake-object-record-event.spec.ts:66 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-24 (twenty): Self-edge: forward...queue.ts:21 adds to eventLogQueue, which is processed by CreateEventLogFromInternalEvent.handle (create-event-log-from-internal-event.ts:53), not by the forwarder's own @Process at :18.
- twenty-26 (twenty): Self-edge: handleCreate (entity-events-to-db.listener.ts:52) is both producer and handler; it passes the action to its own handleEvent at :54 and emits nothing.
- twenty-27 (twenty): open-api.service.ts:179 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-28 (twenty): open-api.service.ts:167 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-31 (twenty): open-api.service.ts:176 only uses the action to build OpenAPI webhook doc names (computeWebhooks/createWebhookEventName); it emits no database event.
- twenty-32 (twenty): src/engine/twenty-orm/utils/__tests__/format-twenty-orm-event-to-database-batch-event.util.spec.ts:217 is in a spec file (test input/assertion), not a runtime event emit or enqueue.
- twenty-35 (twenty): src/engine/twenty-orm/utils/__tests__/format-twenty-orm-event-to-database-batch-event.util.spec.ts:165 is in a spec file (test input/assertion), not a runtime event emit or enqueue.

## Systematic error patterns

1. Test files as producers: spec/__tests__ files (mock expectations like `expect(mocks.job.queue).toHaveBeenCalledWith(...)`, `mockReturnValue(ImmichWorker.X)`, it.each fixtures) are treated as dispatchers. Immich 21 of 23 incorrect, Twenty 12 of 24. Excluding test files from producers would remove most errors.
2. Non-job keys: Immich `ImmichWorker.*` enum values (worker filters in @OnEvent options) are matched as dispatch keys against any handler listing that worker; they do not name a job/event (12 of Immich's 23 incorrect; 10 of them via spec-file mocks, 2 via getEnv config at config.repository.ts:220).
3. Twenty `DatabaseEventAction.*` enum values are matched as keys regardless of the object name in @OnDatabaseBatchEvent(object, action); the action alone is not an emit. Incorrect producers include OpenAPI doc generation, listeners that forward an event they consume (entity-events-to-db, workflow-database-event-trigger), and self-edges (twenty-24, twenty-26). Real emits go through the workspace event emitter and are not recognized; no object-name match is checked.
4. Job-name keyed queue adds (`messageQueueService.add/addCron(X.name)` to `@Process(X.name)`) and Immich `jobRepository.queue/queueAll` with JobName keys were all correct in this sample (Immich 12/12, Twenty 11/11); precision problems concentrate in enum-keyed pairs and test producers.
5. Query-builder (Immich) and GraphQL route (Twenty) edges were all correct (15/15 each); note GraphQL sample uses custom resolver decorators (@MetadataResolver, @CoreResolver, @AdminResolver) which were handled.
6. Caveat: sample is 50 per repo drawn across kinds, so per-kind n is small (dispatch n=35, others n=15); the dispatch precision interval is wide.

## v2 (after R1-R3)

New seeded samples (50 per repo). Population after rules: Immich 206 dispatch pairs (was 404), Twenty 177 (was 525).

| repo | kind | n | correct | incorrect | unclear | precision |
|---|---|---|---|---|---|---|
| immich | dispatch_pair | 35 | 35 | 0 | 0 | 1.00 |
| immich | query_builder | 15 | 15 | 0 | 0 | 1.00 |
| twenty | dispatch_pair | 35 | 35 | 0 | 0 | 1.00 |
| twenty | graphql_route | 15 | 15 | 0 | 0 | 1.00 |

Immich dispatch sample: 18 event emits (`eventRepository.emit('X')`, now recognised via keyof map) and 17 job-name queue/queueAll pairs. Twenty dispatch sample: all `messageQueueService.add/addCron(X.name)` to `@Process(X.name)`; I checked that producer `@InjectMessageQueue` queue equals the handler's `@Processor` queue in all 35.

### Incorrect cases
None in this sample.

### Remaining systematic patterns / caveats
1. No false positives observed, but n=35 per dispatch cell: a 95% lower bound on precision is roughly 0.90 (rule of three), so a residual error rate of a few percent is not excluded.
2. Recall is not measured here. R2 drops worker filters and CRUD actions entirely, so legitimate Twenty `@OnDatabaseBatchEvent(object, action)` links (real emits through the workspace event emitter) are now absent; the v2 Twenty sample contains none, i.e. the graph there only covers queue-job dispatch.
3. Event dispatch with `workers`/`server` filters (Immich) is linked on name only; whether the handler runs depends on the worker role at runtime (event.repository.ts:198). Judged correct since emit reaches the registration; this is a runtime-configuration caveat, not an error.
4. Conditional dispatch (e.g. Twenty IMAP-only, cron started only under a lock) is counted as dispatch.
5. Query-builder edges include migration files (`schema/migrations/...up`) and helper functions taking a builder (`hasPeople`); correct as table access but not request-reachable code.
