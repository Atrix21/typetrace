export enum JobName { ThumbnailGenerate = 'thumbnail-generate', FaceDetect = 'face-detect', Cleanup = 'cleanup' }
export enum QueueName { Media = 'media' }
export enum OtherJob { ThumbnailGenerate = 'thumbnail-generate' }
export enum Permission { AssetRead = 'asset.read' }
export enum RoleEnum { admin = 1 }
export type EmitEvent = 'UserCreated' | 'UserDeleted';
export interface JobItem { name: JobName; data?: unknown }
