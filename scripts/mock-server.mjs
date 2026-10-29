// Petite API GraphQL de démonstration pour essayer GraphQA sans back-end.
// Elle reproduit des réponses réalistes : erreurs de validation au format
// NestJS / class-validator, accès refusé selon le rôle, erreurs métier.
//
//   npm run mock          → http://localhost:4000/graphql
//   Jeton admin : « admin-token » ; jeton éditeur : « editor-token ».

import { createServer } from 'node:http';
import { buildSchema, graphql, GraphQLError } from 'graphql';

const PORT = Number(process.env.PORT ?? 4000);

const schema = buildSchema(/* GraphQL */ `
  scalar DateTime

  enum Role { ADMIN EDITOR VIEWER }
  enum OrderStatus { PENDING PAID SHIPPED CANCELLED }

  type User { id: ID! email: String! fullName: String! role: Role! createdAt: DateTime! orders: [Order!]! }
  type Order { id: ID! status: OrderStatus! total: Float! customer: User! createdAt: DateTime! }
  type Product { id: ID! name: String! price: Float! }

  input CreateUserInput {
    "Adresse courriel unique"
    email: String!
    "Nom complet, 2 à 50 caractères"
    fullName: String!
    password: String!
    role: Role!
    birthDate: DateTime
    sendWelcomeEmail: Boolean = false
  }

  type Query {
    "Liste les utilisateurs. take: between 1 and 100"
    users(take: Int = 20, skip: Int = 0, role: Role, search: String): [User!]!
    "Retourne un utilisateur à partir de son identifiant."
    user(id: ID!): User
    "Commandes filtrées par statut et par période."
    orders(status: OrderStatus, from: DateTime, to: DateTime, take: Int = 20): [Order!]!
    products: [Product!]!
  }

  type Mutation {
    "Crée un nouvel utilisateur. Le courriel doit être unique."
    createUser(input: CreateUserInput!): User!
    "Change le statut d'une commande existante."
    updateOrderStatus(id: ID!, status: OrderStatus!, note: String): Order!
    "Supprime définitivement un produit. Réservé au rôle ADMIN."
    deleteProduct(id: ID!): Boolean!
  }
`);

const now = () => new Date().toISOString();
const users = [
  { id: 'u_101', email: 'marie.tremblay@exemple.com', fullName: 'Marie Tremblay', role: 'EDITOR', createdAt: '2026-09-02T14:10:00Z' },
  { id: 'u_102', email: 'luc.gagnon@exemple.com', fullName: 'Luc Gagnon', role: 'VIEWER', createdAt: '2026-09-15T09:30:00Z' },
  { id: 'u_103', email: 'amina.diallo@exemple.com', fullName: 'Amina Diallo', role: 'ADMIN', createdAt: '2026-10-01T16:45:00Z' },
];
const orders = [
  { id: 'o_5521', status: 'PAID', total: 84.9, customerId: 'u_102', createdAt: '2026-10-12T10:00:00Z' },
  { id: 'o_5524', status: 'PAID', total: 212, customerId: 'u_103', createdAt: '2026-10-20T13:20:00Z' },
  { id: 'o_5530', status: 'CANCELLED', total: 19.99, customerId: 'u_101', createdAt: '2026-10-25T08:05:00Z' },
];
const products = [{ id: 'p_310', name: 'Tasse GraphQA', price: 14.5 }];

const withOrders = (u) => ({ ...u, orders: () => orders.filter((o) => o.customerId === u.id).map(withCustomer) });
const withCustomer = (o) => ({ ...o, customer: () => withOrders(users.find((u) => u.id === o.customerId)) });

// Erreur au format d'un ValidationPipe NestJS (class-validator).
function badRequest(messages) {
  return new GraphQLError('Bad Request Exception', {
    extensions: { code: 'BAD_USER_INPUT', originalError: { statusCode: 400, message: messages, error: 'Bad Request' } },
  });
}

const root = {
  users: ({ take, skip, role, search }) => {
    // Bogue volontaire pour la démo : la limite de 100 n'est pas vérifiée.
    if (take < 1) throw badRequest(['take must not be less than 1']);
    return users
      .filter((u) => !role || u.role === role)
      .filter((u) => !search || `${u.fullName} ${u.email}`.toLowerCase().includes(search.toLowerCase()))
      .slice(skip, skip + take)
      .map(withOrders);
  },
  user: ({ id }) => {
    const u = users.find((x) => x.id === id);
    return u ? withOrders(u) : null;
  },
  orders: ({ status, take }) => orders.filter((o) => !status || o.status === status).slice(0, take).map(withCustomer),
  products: () => products,
  createUser: ({ input }) => {
    const errors = [];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) errors.push('email must be an email');
    if (input.fullName.trim().length < 2 || input.fullName.length > 50)
      errors.push('fullName must be longer than or equal to 2 and shorter than or equal to 50 characters');
    if (input.password.length < 8) errors.push('password must be longer than or equal to 8 characters');
    if (errors.length) throw badRequest(errors);
    if (users.some((u) => u.email === input.email))
      throw new GraphQLError('Un utilisateur avec ce courriel existe déjà.', { extensions: { code: 'CONFLICT' } });
    const user = { id: `u_${100 + users.length + 1}`, email: input.email, fullName: input.fullName, role: input.role, createdAt: now() };
    users.push(user);
    return withOrders(user);
  },
  updateOrderStatus: ({ id, status }) => {
    const o = orders.find((x) => x.id === id);
    if (!o) throw new GraphQLError(`Commande ${id} introuvable.`, { extensions: { code: 'NOT_FOUND' } });
    if (o.status === 'CANCELLED' && status !== 'CANCELLED')
      throw new GraphQLError('Une commande annulée ne peut plus changer de statut.', { extensions: { code: 'BAD_USER_INPUT' } });
    o.status = status;
    return withCustomer(o);
  },
  deleteProduct: ({ id }, ctx) => {
    if (!ctx.role) throw new GraphQLError('Unauthorized', { extensions: { code: 'UNAUTHENTICATED' } });
    if (ctx.role !== 'ADMIN') throw new GraphQLError('Forbidden resource', { extensions: { code: 'FORBIDDEN' } });
    const i = products.findIndex((p) => p.id === id);
    if (i === -1) return false;
    products.splice(i, 1);
    return true;
  },
};

const TOKENS = { 'admin-token': 'ADMIN', 'editor-token': 'EDITOR' };

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, accept, x-tenant-id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.url !== '/graphql' || req.method !== 'POST') return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');

  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }));
  }
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const result = await graphql({
    schema,
    source: payload.query ?? '',
    rootValue: root,
    variableValues: payload.variables,
    operationName: payload.operationName,
    contextValue: { role: TOKENS[token] },
  });
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
}).listen(PORT, () => {
  console.log(`API de démonstration : http://localhost:${PORT}/graphql`);
  console.log('Jetons : admin-token (ADMIN), editor-token (EDITOR)');
});
