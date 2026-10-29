import {
  buildClientSchema,
  getIntrospectionQuery,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type IntrospectionQuery,
} from 'graphql';
import type { OperationKind } from '../types';

export const INTROSPECTION_QUERY = getIntrospectionQuery({
  descriptions: true,
  inputValueDeprecation: true,
});

export interface OperationInfo {
  kind: OperationKind;
  name: string;
  description: string | null;
  args: readonly GraphQLArgument[];
  returnType: GraphQLOutputType;
  returnTypeLabel: string;
  group: string;
  deprecated: boolean;
}

export function schemaFromIntrospection(data: IntrospectionQuery): GraphQLSchema {
  return buildClientSchema(data);
}

const VERBS =
  /^(create|update|upsert|delete|remove|add|set|get|list|find|fetch|search|toggle|archive|restore|publish|unpublish|assign|unassign|cancel|approve|reject|send|reset|confirm|invite|register|change|edit|save|mark|count|all|my)(?=[A-Z_]|$)/;
const WRAPPER_SUFFIX = /(Payload|Response|Result|Output|Connection|Edge|Page|List|Paginated)$/;
const GENERIC_TYPES = new Set(['Boolean', 'String', 'Int', 'Float', 'ID', 'JSON', 'Void', 'DateTime', 'Date']);

function singular(word: string): string {
  if (/ies$/.test(word) && word.length > 4) return word.replace(/ies$/, 'y');
  if (/(ss|us|is)$/.test(word)) return word;
  if (/s$/.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Regroupe une opération par « ressource », sans dépendre d'un framework :
 * d'abord le type retourné (User, Order…), sinon le nom de l'opération sans
 * son verbe (deleteProduct → Product).
 */
export function groupKeyFor(name: string, returnType: GraphQLOutputType): string {
  const named = getNamedType(returnType);
  if ((isObjectType(named) || isInterfaceType(named) || isUnionType(named)) && !GENERIC_TYPES.has(named.name)) {
    const base = named.name.replace(WRAPPER_SUFFIX, '');
    if (base && base !== named.name) {
      const fromName = groupFromName(name);
      return fromName ?? base;
    }
    return named.name;
  }
  return groupFromName(name) ?? 'Autres';
}

function groupFromName(name: string): string | null {
  const stripped = name.replace(VERBS, '');
  const firstWord = stripped.match(/^_?([A-Za-z][a-z0-9]*)/);
  if (!firstWord) return null;
  return capitalize(singular(firstWord[1]));
}

export function listOperations(schema: GraphQLSchema): OperationInfo[] {
  const out: OperationInfo[] = [];
  const add = (kind: OperationKind, fields: Record<string, GraphQLField<unknown, unknown>> | undefined) => {
    if (!fields) return;
    for (const field of Object.values(fields)) {
      if (field.name.startsWith('__')) continue;
      out.push({
        kind,
        name: field.name,
        description: field.description ?? null,
        args: field.args,
        returnType: field.type,
        returnTypeLabel: String(field.type),
        group: groupKeyFor(field.name, field.type),
        deprecated: field.deprecationReason != null,
      });
    }
  };
  add('query', schema.getQueryType()?.getFields());
  add('mutation', schema.getMutationType()?.getFields());
  return out;
}

export interface OperationGroup {
  key: string;
  operations: OperationInfo[];
}

export function groupOperations(ops: OperationInfo[]): OperationGroup[] {
  const map = new Map<string, OperationInfo[]>();
  for (const op of ops) {
    const list = map.get(op.group) ?? [];
    list.push(op);
    map.set(op.group, list);
  }
  return [...map.entries()]
    .map(([key, operations]) => ({
      key,
      operations: operations.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'query' ? -1 : 1,
      ),
    }))
    .sort((a, b) => (a.key === 'Autres' ? 1 : b.key === 'Autres' ? -1 : a.key.localeCompare(b.key)));
}

export function unwrap(type: GraphQLInputType | GraphQLOutputType): {
  named: GraphQLNamedType;
  required: boolean;
  list: boolean;
} {
  const required = isNonNullType(type);
  const inner = isNonNullType(type) ? type.ofType : type;
  return { named: getNamedType(type), required, list: isListType(inner) };
}

export function isLeafType(type: GraphQLNamedType): boolean {
  return isScalarType(type) || isEnumType(type);
}

export { isInputObjectType, isEnumType, isScalarType, isObjectType, isInterfaceType, isUnionType, isListType, isNonNullType };

/** Signature lisible d'une opération, utile pour l'assistant IA. */
export function operationSignature(op: OperationInfo): string {
  const args = op.args.map((a) => `${a.name}: ${String(a.type)}`).join(', ');
  return `${op.kind} ${op.name}${args ? `(${args})` : ''}: ${op.returnTypeLabel}`;
}
