import { getSchemaPath, type SchemaObject } from '@nestjs/swagger';

const composedSchemas = new Map<string, SchemaObject>();

/**
 * Registers a component schema written by hand, for the shapes @nestjs/swagger can't build from a
 * class, such as an `allOf` of another schema and extra properties (`GenreWithCount` in the
 * home-page contract). Call it at module load, beside the DTO it documents, and reference the
 * returned `$ref` from `@ApiProperty({ items: { $ref } })`. `buildOpenApiDocument()` adds every
 * registered schema to `components.schemas`. A name registered twice with a different schema
 * throws, so two DTO files can't publish one name with two shapes.
 */
export function defineComposedSchema(name: string, schema: SchemaObject): string {
  const existing = composedSchemas.get(name);
  if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
    throw new Error(`Composed schema "${name}" is already defined with another shape`);
  }
  composedSchemas.set(name, schema);
  return getSchemaPath(name);
}

/** Every composed schema registered so far, by name. */
export function listComposedSchemas(): ReadonlyMap<string, SchemaObject> {
  return composedSchemas;
}
