// Ambient stand-ins for external packages (experiment 3 dispatch / GraphQL / query-builder fixture).
declare module '@nestjs/common' {
  export function Get(path?: string): MethodDecorator;
  export function Controller(prefix?: string): ClassDecorator;
  export function Injectable(): ClassDecorator;
}
declare module '@nestjs/graphql' {
  export function Resolver(of?: unknown): ClassDecorator;
  export function Query(type?: unknown, options?: { name?: string }): MethodDecorator;
  export function Mutation(type?: unknown, options?: { name?: string }): MethodDecorator;
}
declare module 'kysely' {
  export class SelectQueryBuilder {
    innerJoin(table: string, a: string, b: string): SelectQueryBuilder;
    selectAll(): SelectQueryBuilder;
    execute(): Promise<unknown[]>;
  }
  export class Kysely<DB> {
    selectFrom(table: string): SelectQueryBuilder;
    deleteFrom(table: string): { where(a: string, op: string, b: unknown): { execute(): Promise<void> } };
  }
}
