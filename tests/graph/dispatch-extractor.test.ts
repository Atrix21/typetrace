/**
 * Experiment 3 (M2.2) generic extraction rules on a dedicated fixture (tests/fixtures/dispatch-app):
 * keyed dispatch (job/event handlers), GraphQL operations as entry points, query-builder table access.
 * Positive and negative cases; the experiment-1 fixture and S snapshots must be unaffected (see regression-s.ts).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listCorpusFiles } from '../../src/config.js';
import { buildGraph, type BuiltGraph } from '../../src/graph/graph-builder.js';
import { fixtureGraph } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/dispatch-app');
let cached: BuiltGraph | null = null;
const graph = () => (cached ??= buildGraph({ repoRoot: ROOT, files: listCorpusFiles(ROOT, ['src']) }));
const pairs = (type: string) => graph().edges.filter((e) => e.type === type).map((e) => `${e.src} -> ${e.dst}`).sort();
const M = (cls: string, m: string, file = 'src/handlers.ts') => `method:${file}#${cls}.${m}`;
const S = (m: string) => `method:src/service.ts#AssetService.${m}`;
const K = (v: string) => `event:keyed:${v}`;

describe('keyed dispatch', () => {
  it('links each dispatching call to the handler registered for the same typed key', () => {
    expect(pairs('PUBLISHES_EVENT')).toEqual([
      `${S('createUser')} -> ${K('src/keys.ts::EmitEvent:UserCreated')}`,
      `${S('detectAll')} -> ${K('src/keys.ts::JobName.FaceDetect')}`, // key inside a map() callback's returned object
      `${S('scheduleCleanup')} -> ${K('class:src/handlers.ts#CleanupJob')}`, // SomeJob.name as the key
      `${S('upload')} -> ${K('src/keys.ts::JobName.ThumbnailGenerate')}`,
    ].sort());
    expect(pairs('CONSUMES_EVENT')).toEqual([
      `${M('CleanupJob', 'handle')} -> ${K('class:src/handlers.ts#CleanupJob')}`,
      `${M('MediaWorker', 'handleFaces')} -> ${K('src/keys.ts::JobName.FaceDetect')}`,
      `${M('MediaWorker', 'handleThumbnail')} -> ${K('src/keys.ts::JobName.ThumbnailGenerate')}`, // primary key: job name, not the shared queue
      `${M('MediaWorker', 'onUserCreated')} -> ${K('src/keys.ts::EmitEvent:UserCreated')}`, // generic emit<T extends EmitEvent>
      ...['a', 'b'].map((m) => `${M('Listeners', m, 'src/listeners.ts')} -> ${K('src/keys.ts::EmitEvent:UserCreated')}`),
      ...['c', 'forward', 'e'].map((m) => `${M('Listeners', m, 'src/listeners.ts')} -> ${K('src/keys.ts::EmitEvent:UserDeleted')}`),
    ].sort());
  });

  it('never links comparisons, other enums, untyped literals, number-typed enum positions, routes or directly-called methods', () => {
    const all = graph().edges.filter((e) => e.type === 'PUBLISHES_EVENT' || e.type === 'CONSUMES_EVENT');
    for (const neg of ['isThumb', 'other', 'plainString', 'authorise', 'seedRole', 'runDirect', 'workerCheck']) expect(all.filter((e) => e.src === S(neg))).toEqual([]);
    // R1: a producer in a spec file; R3: a handler re-emitting its own key
    expect(all.filter((e) => e.type === 'PUBLISHES_EVENT' && (e.file?.endsWith('.spec.ts') || e.src.endsWith('Listeners.forward')))).toEqual([]);
    expect(all.filter((e) => e.src === M('AssetController', 'list') || e.src === M('AssetController', 'admin') || e.src === M('DirectlyCalled', 'run'))).toEqual([]);
    expect(graph().nodes.filter((n) => n.id.startsWith('event:keyed:') && /OtherJob|Permission|RoleEnum|QueueName|Worker|JobName\.Cleanup/.test(n.id)).map((n) => n.id)).toEqual([]);
  });

  it('keeps provenance: evidence location, extraction, framework_inferred verification, confidence by key kind', () => {
    const up = graph().edges.find((e) => e.type === 'PUBLISHES_EVENT' && e.src === S('upload'))!;
    expect(up).toMatchObject({ extraction: 'keyed-dispatch', verification: 'framework_inferred', confidence: 0.8, file: 'src/service.ts', line: 9 });
    expect(up.evidence).toContain('this.jobs.queue');
    const ev = graph().edges.find((e) => e.type === 'CONSUMES_EVENT' && e.src === M('MediaWorker', 'onUserCreated'))!;
    expect(ev).toMatchObject({ confidence: 0.7, line: 12, meta: expect.objectContaining({ key_kind: 'literal' }) });
    expect(graph().nodes.find((n) => n.id === K('src/keys.ts::JobName.FaceDetect'))!.meta).toMatchObject({ handlers: 1, producer_sites: 1 });
    expect(graph().nodes.find((n) => n.id === K('src/keys.ts::EmitEvent:UserDeleted'))!.meta).toMatchObject({ handlers: 3, producer_sites: 0 });
  });
});

describe('GraphQL operations and query-builder tables', () => {
  it('creates GraphQL routes (operation, field name from options) with ROUTES_TO', () => {
    expect(pairs('ROUTES_TO').filter((p) => p.startsWith('route:GRAPHQL'))).toEqual([
      `route:GRAPHQL mutation deleteAsset#src/resolver.ts::AssetResolver.remove -> ${M('AssetResolver', 'remove', 'src/resolver.ts')}`,
      `route:GRAPHQL query assets#src/resolver.ts::AssetResolver.assets -> ${M('AssetResolver', 'assets', 'src/resolver.ts')}`,
    ]);
  });

  it('links Kysely table access (alias stripped, joins included) as QUERIES_DATABASE', () => {
    expect(pairs('QUERIES_DATABASE')).toEqual([
      `${M('AssetResolver', 'assets', 'src/resolver.ts')} -> db_entity:kysely#asset`,
      `${M('AssetResolver', 'assets', 'src/resolver.ts')} -> db_entity:kysely#exif`,
      `${M('AssetResolver', 'remove', 'src/resolver.ts')} -> db_entity:kysely#asset`,
    ]);
    const e = graph().edges.find((x) => x.type === 'QUERIES_DATABASE' && x.dst === 'db_entity:kysely#exif')!;
    expect(e.meta).toMatchObject({ op: 'join', table: 'exif', orm: 'kysely' });
  });

  it('adds nothing to the experiment-1 fixture (no keyed handlers, GraphQL or query builder there)', () => {
    const g = fixtureGraph();
    expect(g.edges.filter((e) => e.extraction === 'keyed-dispatch' || e.extraction === 'graphql-decorator' || e.extraction.endsWith('-query-builder'))).toEqual([]);
  });
});
