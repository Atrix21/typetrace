export enum JobName { ThumbnailGenerate = 'thumbnail-generate', FaceDetect = 'face-detect', Cleanup = 'cleanup' }
export enum QueueName { Media = 'media' }
export enum OtherJob { ThumbnailGenerate = 'thumbnail-generate' }
export enum Permission { AssetRead = 'asset.read' }
export enum RoleEnum { admin = 1 }
/** Event names as `keyof` a payload map (the form real event buses use; the union reaches the checker without an alias). */
export interface EventMap { UserCreated: [unknown]; UserDeleted: [unknown] }
export type EmitEvent = keyof EventMap;
export interface JobItem { name: JobName; data?: unknown }
export enum Worker { Api = 'api', Microservices = 'microservices' }
