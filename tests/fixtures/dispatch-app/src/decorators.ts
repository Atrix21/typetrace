import { EmitEvent, JobName, Permission, QueueName, Worker } from './keys';
export const OnJob = (opts: { name: JobName; queue: QueueName }): MethodDecorator => () => undefined;
export const OnEvent = (opts: { name: EmitEvent; workers?: Worker[] }): MethodDecorator => () => undefined;
export const Process = (name: string): MethodDecorator => () => undefined;
export const Authenticated = (opts: { permission?: Permission }): MethodDecorator => () => undefined;
export const Roles = (...roles: number[]): MethodDecorator => () => undefined;
