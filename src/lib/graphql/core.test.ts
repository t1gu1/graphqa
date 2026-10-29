import { buildSchema, graphqlSync, getIntrospectionQuery, type IntrospectionQuery } from 'graphql';
import { describe, expect, it } from 'vitest';
import { parseProposal } from '../agent/prompt';
import { evaluate } from './checks';
import { buildDocument, validateDocument } from './document';
import { applyEdgeCase, edgeCasesFor } from './edgeCases';
import { normalize, toTable, translateMessage } from './errors';
import { constraintsFromDescription, fieldsForArgs, humanize, leafFields } from './fields';
import { groupOperations, listOperations, schemaFromIntrospection } from './schema';
import { defaultSelection, selectionTree } from './selection';
import { exampleVariables, missingRequired, prepareVariables, setAt } from './values';

const SDL = /* GraphQL */ `
  scalar DateTime
  enum Role { ADMIN EDITOR VIEWER }
  enum OrderStatus { PENDING PAID SHIPPED CANCELLED }

  type User { id: ID! email: String! fullName: String! role: Role! createdAt: DateTime orders: [Order!]! }
  type Order { id: ID! status: OrderStatus! total: Float! customer: User! }
  type UserConnection { nodes: [User!]! totalCount: Int! }

  input CreateUserInput {
    email: String!
    fullName: String!
    "8 caractères minimum"
    password: String!
    role: Role!
    birthDate: DateTime
    sendWelcomeEmail: Boolean = false
    tags: [String!]
  }

  type Query {
    "Liste les utilisateurs. take: between 1 and 100"
    users(take: Int = 20, skip: Int, role: Role, search: String): [User!]!
    user(id: ID!): User
    searchUsers(q: String!): UserConnection!
    orders(status: OrderStatus, from: DateTime, to: DateTime): [Order!]!
  }

  type Mutation {
    createUser(input: CreateUserInput!): User!
    updateOrderStatus(id: ID!, status: OrderStatus!): Order!
    deleteProduct(id: ID!): Boolean!
  }
`;

const sdlSchema = buildSchema(SDL);
const introspection = graphqlSync({ schema: sdlSchema, source: getIntrospectionQuery() }).data as unknown as IntrospectionQuery;
const schema = schemaFromIntrospection(introspection);
const ops = listOperations(schema);
const op = (name: string) => ops.find((o) => o.name === name)!;

describe('schéma', () => {
  it('liste les queries et mutations', () => {
    expect(ops.filter((o) => o.kind === 'query').map((o) => o.name)).toEqual(['users', 'user', 'searchUsers', 'orders']);
    expect(ops.filter((o) => o.kind === 'mutation')).toHaveLength(3);
  });

  it('regroupe par ressource sans dépendre du framework', () => {
    const groups = Object.fromEntries(groupOperations(ops).map((g) => [g.key, g.operations.map((o) => o.name)]));
    expect(groups.User).toEqual(expect.arrayContaining(['users', 'user', 'searchUsers', 'createUser']));
    expect(groups.Order).toEqual(expect.arrayContaining(['orders', 'updateOrderStatus']));
    expect(groups.Product).toEqual(['deleteProduct']);
  });
});

describe('formulaire', () => {
  it('transforme les arguments en champs lisibles', () => {
    const fields = fieldsForArgs(op('createUser').args);
    const input = fields[0];
    expect(input.kind).toBe('object');
    const byName = Object.fromEntries(input.children!.map((c) => [c.name, c]));
    expect(byName.email.constraints.format).toBe('email');
    expect(byName.email.rules).toContain('Format courriel');
    expect(byName.password.constraints.minLength).toBe(8);
    expect(byName.role.kind).toBe('enum');
    expect(byName.birthDate.kind).toBe('datetime');
    expect(byName.tags.kind).toBe('list');
    expect(byName.fullName.label).toBe('Full name');
  });

  it('lit les contraintes dans les descriptions', () => {
    expect(constraintsFromDescription('take: between 1 and 100')).toEqual({ min: 1, max: 100 });
    expect(constraintsFromDescription('Doit faire 8 caractères minimum')).toEqual({ minLength: 8 });
  });

  it('lit les limites d’un argument dans la description de l’opération', () => {
    const o = op('users');
    const take = fieldsForArgs(o.args, {}, o.description).find((f) => f.name === 'take')!;
    expect(take.constraints).toMatchObject({ min: 1, max: 100 });
    const labels = edgeCasesFor([take], { hasAuth: false, isMutation: false }).map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['take = 0', 'take = 101']));
  });

  it('garde des identifiants de cas limites stables', () => {
    const fields = fieldsForArgs(op('createUser').args);
    const before = edgeCasesFor(fields, { hasAuth: false, isMutation: true });
    const after = edgeCasesFor(fieldsForArgs(op('createUser').args, { email: { minLength: 5 } }), { hasAuth: false, isMutation: true });
    const id = before.find((c) => c.label === 'input.role = VALEUR_INEXISTANTE')!.id;
    expect(after.find((c) => c.id === id)?.label).toBe('input.role = VALEUR_INEXISTANTE');
  });

  it('applique les règles apprises', () => {
    const fields = fieldsForArgs(op('createUser').args, { password: { minLength: 10 } });
    const pwd = leafFields(fields).find((f) => f.name === 'password')!;
    expect(pwd.constraints.minLength).toBe(10);
  });

  it('génère un exemple valide et une requête acceptée par le schéma', () => {
    const o = op('createUser');
    const fields = fieldsForArgs(o.args);
    const vars = prepareVariables(fields, exampleVariables(fields));
    const input = vars.input as Record<string, unknown>;
    expect(input.email).toBe('marie.tremblay@exemple.com');
    expect((input.password as string).length).toBeGreaterThanOrEqual(8);
    expect(missingRequired(fields, vars)).toEqual([]);
    const tree = selectionTree(schema, o.returnType);
    const doc = buildDocument(o, tree, defaultSelection(tree), vars);
    expect(doc).toContain('mutation CreateUser($input: CreateUserInput!)');
    expect(validateDocument(schema, doc)).toEqual([]);
  });

  it('ne déclare pas les arguments facultatifs vides', () => {
    const o = op('users');
    const doc = buildDocument(o, selectionTree(schema, o.returnType), ['id', 'email'], { take: 10 });
    expect(doc).toContain('query Users($take: Int)');
    expect(doc).not.toContain('$skip');
    expect(validateDocument(schema, doc)).toEqual([]);
  });

  it('gère les retours scalaires et les connexions', () => {
    const del = op('deleteProduct');
    expect(selectionTree(schema, del.returnType)).toBeNull();
    expect(buildDocument(del, null, [], { id: '1' })).toContain('deleteProduct(id: $id)\n}');
    const search = op('searchUsers');
    const tree = selectionTree(schema, search.returnType);
    expect(defaultSelection(tree)).toEqual(expect.arrayContaining(['totalCount', 'nodes.id']));
  });

  it('nettoie les champs facultatifs vides', () => {
    const fields = fieldsForArgs(op('users').args);
    expect(prepareVariables(fields, { take: 5, search: '' })).toEqual({ take: 5 });
    expect(setAt({}, ['input', 'email'], 'a')).toEqual({ input: { email: 'a' } });
  });

  it('humanise les noms', () => {
    expect(humanize('sendWelcomeEmail')).toBe('Send welcome email');
    expect(humanize('created_at')).toBe('Created at');
  });
});

describe('erreurs lisibles', () => {
  it('traduit une erreur de validation NestJS / class-validator', () => {
    const body = JSON.stringify({
      errors: [
        {
          message: 'Bad Request Exception',
          extensions: {
            code: 'BAD_USER_INPUT',
            originalError: {
              statusCode: 400,
              message: ['email must be an email', 'password must be longer than or equal to 8 characters'],
            },
          },
        },
      ],
      data: null,
    });
    const r = normalize({ ok: true, status: 200, durationMs: 12, sizeBytes: body.length, body });
    expect(r.outcome).toBe('error');
    expect(r.title).toBe('Données refusées par le serveur');
    expect(r.codes).toEqual(['BAD_USER_INPUT']);
    expect(r.issues.map((i) => i.field)).toEqual(['email', 'password']);
    expect(r.issues[1].message).toBe('Doit contenir au moins 8 caractères.');
    expect(r.learned).toEqual([
      { field: 'email', rule: { format: 'email' } },
      { field: 'password', rule: { minLength: 8 } },
    ]);
  });

  it('traduit les messages de graphql-js', () => {
    expect(translateMessage('Variable "$take" got invalid value 1.5; Int cannot represent non-integer value: 1.5')).toEqual({
      field: 'take',
      message: 'Doit être un nombre entier (sans décimales).',
    });
    expect(
      translateMessage('Variable "$input" got invalid value { email: "a" }; Field "fullName" of required type "String!" was not provided.').field,
    ).toBe('input.fullName');
    expect(translateMessage('Value "FOO" does not exist in "Role" enum.').message).toContain('FOO');
  });

  it('reconnaît les erreurs réseau et les réponses non GraphQL', () => {
    expect(normalize({ ok: false, error: 'CONNECT|connection refused' }).title).toBe('Impossible de joindre le serveur');
    const html = normalize({ ok: true, status: 404, durationMs: 3, sizeBytes: 9, body: '<html/>' });
    expect(html.title).toBe('Adresse introuvable (404)');
  });

  it('décrit un succès et le met en tableau', () => {
    const body = JSON.stringify({ data: { users: [{ id: '1', email: 'a@b.c', customer: { fullName: 'X' } }, { id: '2', email: 'd@e.f', customer: null }] } });
    const r = normalize({ ok: true, status: 200, durationMs: 5, sizeBytes: body.length, body });
    expect(r.outcome).toBe('success');
    expect(r.subtitle).toBe('2 résultats');
    expect(toTable(r.data)?.columns).toEqual(['id', 'email', 'customer.fullName']);
  });
});

describe('cas limites et tests', () => {
  it('génère des cas aux limites connues', () => {
    const fields = fieldsForArgs(op('createUser').args);
    const cases = edgeCasesFor(fields, { hasAuth: true, isMutation: true });
    const labels = cases.map((c) => c.label);
    expect(labels).toContain('input.password × 7');
    expect(labels).toContain('input.email sans @');
    expect(labels).toContain('input.role = VALEUR_INEXISTANTE');
    expect(cases.at(-1)?.noAuth).toBe(true);
    const short = cases.find((c) => c.label === 'input.password × 7')!;
    expect(applyEdgeCase({ input: { password: 'longpassword' } }, short)).toEqual({ input: { password: 'xxxxxxx' } });
  });

  it('évalue un test « doit échouer » accepté comme non conforme', () => {
    const body = JSON.stringify({ data: { users: [] } });
    const r = normalize({ ok: true, status: 200, durationMs: 5, sizeBytes: body.length, body });
    const run = evaluate('error', 'BAD_USER_INPUT', 'users', r, 'Staging');
    expect(run.status).toBe('fail');
    expect(run.summary).toContain('accepté');
  });

  it('lit les propositions de l’assistant', () => {
    const answer = 'Voici la correction.\n```json\n{"variables": {"input": {"email": "a@b.com"}}}\n```';
    const { text, proposal } = parseProposal(answer);
    expect(text).toBe('Voici la correction.');
    expect(proposal?.variables).toEqual({ input: { email: 'a@b.com' } });
  });
});
