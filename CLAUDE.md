# GraphQA — notes pour les assistants de code

Application de bureau Tauri 2 + React 19 (TypeScript, Vite) : un IDE GraphQL pour le QA non technique. Interface et textes en **français**.

## Commandes

- `npm run app:dev` : application de bureau (Tauri) en développement
- `npm run dev` : interface seule dans le navigateur (repli `fetch`, soumis au CORS)
- `npm run mock` : API GraphQL de démonstration sur http://localhost:4000/graphql
- `npm test` : tests Vitest du cœur (`src/lib/graphql/core.test.ts`)
- `npm run typecheck` puis `cd src-tauri && cargo clippy` avant de livrer

## Principes

- Le cœur `src/lib/graphql/` ne dépend ni de React ni de Tauri, et reste **indépendant du framework back-end** : pas de logique propre à NestJS en dehors de la traduction des messages d'erreur courants.
- Les appels natifs passent par `src/lib/platform.ts` (avec un repli navigateur). Les commandes Rust sont dans `src-tauri/src/` (`http.rs`, `state.rs`, `agent.rs`).
- Ne jamais transmettre les jetons ni les en-têtes d'authentification à l'assistant IA (`src/lib/agent/prompt.ts`).
- Les couleurs viennent des variables CSS de `src/styles/app.css` (thèmes clair et sombre). Pas de couleur codée en dur dans les composants.
