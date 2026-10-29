import {
  getNamedType,
  isEnumType,
  isInterfaceType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema,
} from 'graphql';

export interface SelectionNode {
  /** Chemin unique : "customer.fullName", fragments : "items.~Book.title". */
  path: string;
  name: string;
  typeLabel: string;
  leaf: boolean;
  fragment?: string;
  children?: SelectionNode[];
}

const MAX_DEPTH = 3;

function isLeaf(t: GraphQLNamedType) {
  return isScalarType(t) || isEnumType(t);
}

function hasRequiredArgs(f: GraphQLField<unknown, unknown>) {
  return f.args.some((a) => isNonNullType(a.type) && a.defaultValue === undefined);
}

function childrenOf(schema: GraphQLSchema, type: GraphQLNamedType, prefix: string, depth: number, seen: Set<string>): SelectionNode[] {
  if (depth > MAX_DEPTH) return [];
  const nodes: SelectionNode[] = [];
  if (isObjectType(type) || isInterfaceType(type)) {
    if (seen.has(type.name)) return [];
    const nextSeen = new Set(seen).add(type.name);
    for (const f of Object.values(type.getFields())) {
      if (hasRequiredArgs(f)) continue;
      const named = getNamedType(f.type);
      const path = prefix ? `${prefix}.${f.name}` : f.name;
      if (isLeaf(named)) {
        nodes.push({ path, name: f.name, typeLabel: String(f.type), leaf: true });
      } else if (depth < MAX_DEPTH) {
        const children = childrenOf(schema, named, path, depth + 1, nextSeen);
        if (children.length) nodes.push({ path, name: f.name, typeLabel: String(f.type), leaf: false, children });
      }
    }
    if (isInterfaceType(type)) {
      nodes.unshift({ path: prefix ? `${prefix}.__typename` : '__typename', name: '__typename', typeLabel: 'String!', leaf: true });
    }
  } else if (isUnionType(type)) {
    nodes.push({ path: prefix ? `${prefix}.__typename` : '__typename', name: '__typename', typeLabel: 'String!', leaf: true });
    for (const member of schema.getPossibleTypes(type)) {
      const path = prefix ? `${prefix}.~${member.name}` : `~${member.name}`;
      const children = childrenOf(schema, member, path, depth + 1, seen);
      if (children.length) nodes.push({ path, name: `… on ${member.name}`, typeLabel: member.name, leaf: false, fragment: member.name, children });
    }
  }
  return nodes;
}

/** Arbre des informations que l'on peut demander en retour. `null` si le retour est une simple valeur. */
export function selectionTree(schema: GraphQLSchema, returnType: GraphQLOutputType): SelectionNode[] | null {
  const named = getNamedType(returnType);
  if (isLeaf(named)) return null;
  return childrenOf(schema, named, '', 1, new Set());
}

/** Sélection par défaut : les valeurs simples du premier niveau, et celles des objets liés au deuxième niveau. */
export function defaultSelection(tree: SelectionNode[] | null): string[] {
  if (!tree) return [];
  const out: string[] = [];
  for (const n of tree) {
    if (n.leaf) out.push(n.path);
    else if (n.fragment) {
      for (const c of n.children ?? []) if (c.leaf) out.push(c.path);
    } else {
      const leaves = (n.children ?? []).filter((c) => c.leaf).slice(0, 4);
      for (const c of leaves) out.push(c.path);
    }
  }
  return out;
}

export function allLeafPaths(tree: SelectionNode[] | null): string[] {
  const out: string[] = [];
  const walk = (nodes: SelectionNode[]) => {
    for (const n of nodes) {
      if (n.leaf) out.push(n.path);
      else walk(n.children ?? []);
    }
  };
  if (tree) walk(tree);
  return out;
}

/** Rend la sélection au format GraphQL (sans les accolades extérieures). */
export function renderSelection(nodes: SelectionNode[], selected: Set<string>, indent: string): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.leaf) {
      if (selected.has(n.path)) lines.push(`${indent}${n.name}`);
      continue;
    }
    const inner = renderSelection(n.children ?? [], selected, indent + '  ');
    if (!inner.length) continue;
    const head = n.fragment ? `... on ${n.fragment}` : n.name;
    lines.push(`${indent}${head} {`, ...inner, `${indent}}`);
  }
  return lines;
}
