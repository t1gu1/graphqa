import { parse, validate, type GraphQLSchema } from 'graphql';
import type { OperationInfo } from './schema';
import { renderSelection, type SelectionNode } from './selection';
import type { Values } from './values';

function pascal(name: string): string {
  return name.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Construit le document GraphQL d'une opération à partir des variables remplies
 * et des informations à recevoir. Les arguments facultatifs sans valeur ne sont
 * pas déclarés, pour garder la requête lisible.
 */
export function buildDocument(op: OperationInfo, tree: SelectionNode[] | null, selected: string[], variables: Values): string {
  const used = op.args.filter((a) => a.name in variables || String(a.type).endsWith('!'));
  const defs = used.map((a) => `$${a.name}: ${String(a.type)}`).join(', ');
  const call = used.map((a) => `${a.name}: $${a.name}`).join(', ');
  const header = `${op.kind} ${pascal(op.name)}${defs ? `(${defs})` : ''}`;
  const field = `${op.name}${call ? `(${call})` : ''}`;

  if (!tree) return `${header} {\n  ${field}\n}`;
  let lines = renderSelection(tree, new Set(selected), '    ');
  if (!lines.length) lines = ['    __typename'];
  return `${header} {\n  ${field} {\n${lines.join('\n')}\n  }\n}`;
}

/** Vérifie le document contre le schéma ; renvoie les messages d'erreur éventuels. */
export function validateDocument(schema: GraphQLSchema, doc: string): string[] {
  try {
    return validate(schema, parse(doc)).map((e) => e.message);
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}
