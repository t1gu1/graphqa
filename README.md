# GraphQA

IDE GraphQL de bureau pensé pour le **QA** : on teste des queries et des mutations **sans écrire de code**, on comprend les erreurs en français, et on se monte une bibliothèque d'exemples et de tests rejouables.

Construit avec **Tauri 2** (Rust) et **React 19** (TypeScript, Vite). Fonctionne avec n'importe quel back-end GraphQL (NestJS, Apollo, Hot Chocolate, Strawberry…).

## Ce que fait l'application

- **Explorateur** : lit le schéma par introspection (ou depuis un fichier `.graphql`), puis regroupe les queries et mutations par ressource (`User`, `Order`…). Les groupes peuvent être renommés.
- **Formulaires générés** : chaque argument devient un champ adapté (texte, nombre, liste de choix, oui/non, date, groupe, liste). Les règles sont affichées sous chaque champ (« Obligatoire · Format courriel · 8 caractères minimum »).
- **Exemple en un clic** : remplit des valeurs plausibles qui respectent les règles connues.
- **Erreurs lisibles** : les réponses sont traduites en français (class-validator / NestJS, graphql-js, erreurs réseau, droits). Chaque erreur est rattachée au champ concerné.
- **Règles apprises** : quand le serveur répond « password must be longer than or equal to 8 characters », la règle est retenue et réutilisée dans le formulaire et dans les cas limites.
- **Cas limites** : valeurs juste à côté des limites, formats invalides, textes très longs, injection HTML, requête sans jeton… GraphQA signale en rouge ce que le serveur accepte alors qu'il devrait le refuser.
- **Bibliothèque** : collections d'exemples et de tests (« doit réussir » / « doit échouer », avec un code d'erreur attendu), exécution en lot, export/import JSON pour partager avec l'équipe.
- **Projets, environnements, rôles** : plusieurs projets, chacun avec ses environnements (adresse, en-têtes, lecture seule pour bloquer les mutations en production) et des jetons par rôle pour tester les droits.
- **Assistant IA** : **Claude CLI** ou **Copilot CLI**, un seul actif à la fois. Il explique une erreur, propose des valeurs corrigées (« Appliquer et relancer »), suggère des cas de test à ajouter à la bibliothèque ou rédige un rapport de bogue. Les jetons ne lui sont jamais transmis.
- **Thème clair / sombre**.

## Prérequis

- [Node.js](https://nodejs.org) 20 ou plus
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Les dépendances système de Tauri pour votre OS : <https://tauri.app/start/prerequisites/>

## Démarrer

```bash
npm install
npm run app:dev      # lance l'application de bureau en mode développement
```

Pour essayer sans back-end, lancez l'API de démonstration dans un autre terminal, puis choisissez l'environnement **Démo** dans la barre du haut :

```bash
npm run mock         # http://localhost:4000/graphql
```

Jetons de démo (Réglages › Jetons et rôles) : `admin-token` (ADMIN), `editor-token` (EDITOR). L'API contient un bogue volontaire : `users(take: 101)` est accepté alors que la limite est 100. Les cas limites le détectent.

### Autres commandes

| Commande | Rôle |
| --- | --- |
| `npm run app:build` | Construit l'installeur de l'application pour l'OS courant |
| `npm run dev` | Interface seule dans le navigateur (le serveur doit autoriser CORS, et l'assistant IA n'est pas disponible) |
| `npm test` | Tests unitaires du cœur GraphQL |
| `npm run typecheck` | Vérification TypeScript |

## Assistant IA

Dans **Réglages › Assistant IA**, choisissez l'outil, puis suivez la configuration guidée :

```bash
npm install -g @anthropic-ai/claude-code   # Claude CLI, puis « claude » pour se connecter
npm install -g @github/copilot             # Copilot CLI, puis « copilot » et « /login »
```

GraphQA appelle l'outil en mode non interactif (`claude -p`, `copilot -p`), dans un dossier temporaire, avec un contexte préparé : la signature de l'opération, les types utilisés, les données envoyées et la réponse. Vous choisissez ce qui est partagé. Les jetons et en-têtes d'authentification ne sont jamais inclus.

## Données

Projets, environnements, jetons, bibliothèque et réglages sont enregistrés dans un fichier `state.json` du dossier de données de l'application :

- macOS : `~/Library/Application Support/com.t1gu1.graphqa/`
- Windows : `%APPDATA%\com.t1gu1.graphqa\`
- Linux : `~/.local/share/com.t1gu1.graphqa/`

Les jetons y sont stockés en clair, sur ce poste uniquement. Ils ne sont jamais inclus dans les exports de collections.

## Architecture

```
src/
  lib/graphql/      cœur indépendant de l'interface (testé)
    schema.ts       introspection, liste et groupement des opérations
    fields.ts       arguments → champs de formulaire et règles
    values.ts       exemples, nettoyage des variables
    selection.ts    informations à recevoir (sélection)
    document.ts     construction et validation de la requête
    errors.ts       normalisation et traduction des erreurs
    edgeCases.ts    génération des cas limites
    checks.ts       vérification des tests enregistrés
  lib/agent/        préparation des demandes à l'assistant
  state/            état (zustand) et actions
  components/, screens/   interface (Atelier, Bibliothèque, Réglages)
src-tauri/src/
  http.rs           envoi des requêtes GraphQL (sans contrainte CORS)
  state.rs          sauvegarde locale
  agent.rs          pont vers Claude CLI / Copilot CLI
scripts/mock-server.mjs   API de démonstration
```

## Pistes pour la suite

- Rangement des jetons dans le trousseau du système
- Abonnements (subscriptions) et envoi de fichiers
- Exécution des collections en ligne de commande (CI)
- Historique des exécutions par test
