# Plan : « Create Your World », bac à sable voxel de survie en 3D pour navigateur

## Contexte

**Pourquoi et quoi.** Le dossier `/Users/killianherlant/Desktop/projets/Adventure` est vide. On y construit **Create Your World**, un jeu **original** de survie-aventure en voxels pour navigateur desktop. Le joueur part de rien dans un monde infini généré depuis une graine : il explore, mine, construit, fabrique selon des recettes, combat et survit.

Le code vit dans le dépôt GitHub privé et vide `git@github.com:hrltKillian/Create-Your-World.git` (accès SSH et `gh` vérifiés). Je crée et je merge les PR en autonomie.

Les trois jeux cités ne servent que de références de **mécaniques** :

- Last Day On Earth : jauges, progression du craft, base, butin ;
- Minecraft : voxels, grottes, minerais, paliers d'outils, nuits dangereuses ;
- No Man's Sky : biomes variés, dangers environnementaux, raffinage.

Aucun nom, créature, objet, texture, son ni écran n'en est repris.

**Boucle de jeu.** Récolter → Fabriquer → Se préparer → Survivre à la nuit → Aller plus loin.

- La première nuit tombe environ 10 minutes réelles après l'apparition.
- L'obscurité est la menace, la lumière la sécurité.
- Chaque biome hostile (froid, chaud, toxique) détient un ingrédient du palier d'outils suivant.

**Résultat visé à la fin de M11.**

- 7 biomes ; minage et construction bloc par bloc.
- Inventaire, Logbook (le carnet de craft) et stations jusqu'au fer.
- 6 jauges de survie (santé, faim, soif, endurance, température, toxicité) plus le souffle ; jour/nuit.
- 5 créatures, combat au corps à corps.
- Sauvegarde, sons synthétisés.
- 60 FPS sur un portable de classe M1 à la distance de rendu par défaut.
- Chaque jalon laisse le jeu lançable, se valide objectivement et arrive sur `main` par une PR.

| #   | Ta décision (définitive)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Monde **voxel**, entièrement minable et constructible, procédural et infini (bordure dure à ±1 000 000 blocs)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | **1re personne** par défaut ; une touche bascule en **3e personne** (avatar visible et animé)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | **Solo**, mais simulation séparée du rendu et des entrées (contrat `SimHost`), prête pour une coop future                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | **Chrome en priorité** (desktop, clavier + souris, Pointer Lock). Firefox et Safari sont aussi visés s'ils se comportent pareil, sans travail spécifique. Ni mobile ni manette                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | Thème non fixé : **tout le contenu est en données**, avec un pack neutre fourni                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | Survie : santé, **faim et soif**, **endurance**, **nuits dangereuses**, **dangers environnementaux** (froid, chaleur, toxicité)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | **Assets générés par le code** (pixel-art, modèles en boîtes, sons Web Audio) derrière une abstraction remplaçable                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | **Tranche verticale jouable**, livrée par jalons testables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Jeu **en anglais d'abord**, via des clés i18n : les traductions (le français en premier) viendront si le jeu plaît                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 10  | Mêmes **touches physiques** sur tous les claviers : ZQSD sur AZERTY = WASD sur QWERTY                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | Dépôt `hrltKillian/Create-Your-World` : une PR par jalon, que je crée puis merge moi-même après CI verte et revue                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | **KISS, DRY et SRP** appliqués dans tout le projet (code, tests, outillage), pour la maintenabilité et la structure (voir « Principes de code »)                                                                                                                                                                                                                                                                                                                                                                                                    |
| 13  | **Exécution autonome** (22/11/2026) : je déroule M4 → M11 sans te solliciter, puis j'améliore ce qui existe tant que tu ne m'interromps pas (voir « Exécution autonome »)                                                                                                                                                                                                                                                                                                                                                                           |
| 14  | **Priorité : un jeu qui fonctionne sans bug ni erreur**. Le style passe après ; tes avis sur le style sont facultatifs et ne bloquent jamais un jalon                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | **La logique avant le graphisme** : un jeu beau mais cassé est pire qu'un jeu moche qui marche. Les jalons graphiques (M20, M21) passent en dernier.                                                                                                                                                                                                                                                                                                                                                                                                |
| 16  | **Thème : colonie perdue sur une autre planète.** Ta capsule s'écrase sur une planète où une première colonie humaine a disparu. Faune et flore extraterrestres, ruines de la colonie avec reliques, journaux et plans. Les quêtes suivent la piste des anciens colons. Progression : de la récupération à la reconstruction. Le contenu actuel peut être repensé, c'est un brouillon.                                                                                                                                                              |
| 17  | **Les biomes avant les structures** : la génération est refaite et stabilisée (M16) avant de générer les structures du thème (M18), qui en dépendent. Cela couvre les biomes, les grottes (plus d'ouvertures sur la surface, plus larges par endroits, qui se croisent, noyées près du fond des lacs et scellées plus bas) et les minerais (tables de probabilité par couche, limites strictes, aucune couche sans minerai, minerais exclusifs à certains biomes pour pousser à l'exploration, sans règle implicite de rareté selon la profondeur). |
| 18  | **Établi = Logbook de l'établi** : clic droit dessus, un écran montre les recettes d'établi, avec recherche et filtre. L'établi a sa propre file et ses cases de sortie. Pas de grille 3×3.                                                                                                                                                                                                                                                                                                                                                         |
| 19  | **L'XP vient uniquement des quêtes**, mais le jeu reste jouable sans elles (plus dur). Aucune recette essentielle n'est bloquée par un niveau : un test d'atteignabilité le prouve. Les niveaux donnent des points de compétence et des recettes exclusives, comme un sac plus grand.                                                                                                                                                                                                                                                               |
| 20  | **Inventaire au clic façon Minecraft, seul** : clic gauche pour prendre ou poser une pile qui reste sur le curseur, clic droit pour la moitié ou un seul objet, Maj+clic pour un transfert. Un clic hors de l'interface jette toute la pile (gauche) ou un seul objet (droit). Le glisser-déposer est retiré. Dans la file de fabrication, une même recette occupe une seule case : 5 clics sur ×1 = une case de 5.                                                                                                                                 |
| 21  | **Piles de 64 par défaut**, avec une valeur propre à un objet si besoin (16…). Outils, armes, équipements et récipients : 1.                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Contraintes de forme.**

- Textes du jeu en anglais via des clés i18n ; code, identifiants et commentaires en anglais.
- Interface en HTML/CSS par-dessus le canvas WebGL.
- Logique pure, déterministe et testable sous Node.
- Messages de commit, titres et descriptions de PR, et README en anglais. Nos échanges et `docs/conception.md` restent en français.

**Principes de code (décision 12).** Ils s'appliquent à chaque ligne écrite, dans tout le projet, et sont vérifiés par une lentille dédiée de la revue adversariale de chaque jalon.

- **KISS** (garder simple) :
  - la solution la plus simple qui remplit le cahier des charges et ses tests ;
  - pas d'abstraction, d'option ni de paramètre « pour plus tard » ;
  - des fonctions courtes au flux linéaire ; une boucle chaude reste lisible, sans astuce non commentée ;
  - pas de nouvelle dépendance quand quelques lignes suffisent.
- **DRY** (une seule source de vérité) :
  - chaque règle, constante ou calcul n'existe qu'à un endroit : constantes de jeu dans `balance.ts`, `PHYSICS` ou `STAMINA`, coordonnées dans `world/coords.ts`, angles dans `core/angles.ts` ;
  - toute logique dupliquée deux fois est extraite à la troisième occurrence au plus tard, et dès la deuxième si elle porte une règle de jeu ;
  - helpers de test partagés dans `tests/helpers/` (monde plat, simulation avec `InlineColumnSource` et hôte) ;
  - helpers d'automatisation partagés entre `debugHook.ts` et les autotests (attente des chunks, téléportation, attente en temps réel).
- **SRP** (une responsabilité par module) :
  - un module ou une classe = une raison de changer ;
  - `Simulation` orchestre le tick et délègue à des systèmes dédiés : streaming des colonnes, commandes, joueurs, et plus tard interaction, inventaire, survie, IA ;
  - `App` compose et `GameSession` boucle ; l'UI, les entrées et le Pointer Lock ont leurs propres modules ;
  - un fichier qui dépasse environ 400 lignes ou mélange plusieurs raisons de changer est découpé, sauf le cœur d'une boucle chaude dont le découpage coûterait en performance (raison notée en commentaire).
- Ces principes ne priment jamais sur les règles dures du projet : déterminisme, zéro allocation dans les boucles chaudes, couches de `checker.ts`, i18n.
- Ils sont recopiés dans `CLAUDE.md` pour que tout agent les applique.

Projet vierge : rien à réutiliser. On s'appuie sur three.js, simplex-noise et idb.

## En bref

- **Technique** : three.js r187 (`WebGLRenderer` et shaders GLSL écrits à la main), Vite 8, TypeScript 7, Vitest 5, Biome, npm.
- **Architecture** :
  - une simulation pure (sans DOM, déterministe, exécutable sous Node) derrière un contrat `SimHost`, que le futur serveur coop réutilisera telle quelle ;
  - le rendu three.js, l'UI HTML/CSS et l'audio lisent l'état et envoient des commandes ;
  - génération et maillage dans des Web Workers ; IndexedDB dans un worker d'E/S.
- **Jalons** :
  - **M0** Échafaudage : dépôt git, CI, outillage, page de démarrage, cube texturé, hook de debug, workers.
  - **M1** Cœur voxel : registre de contenu, sections, maillage glouton avec occlusion ambiante, chunk de test.
  - **M2** Terrain et streaming : 7 biomes de surface, eau, arbres, chargement par workers, ciel, brouillard, mesures de perf.
  - **M3** Simulation, joueur et caméras : boucle 30 Hz, physique, touches physiques (ZQSD/WASD), Pointer Lock, 1re et 3e personne, avatar animé.
  - **M3.5** Passe KISS/DRY/SRP sur M0 à M3 (découpage de `Simulation`, helpers partagés), sans changer le comportement.
  - **M4** Minage et construction : casser et poser, outils de silex, objets au sol, barre rapide, premiers sons.
  - **M5** Lumière et temps : soleil, torches, cycle jour/nuit.
  - **M6** Sous-sol et décor : grottes, magma, minerais, campements, point d'apparition.
  - **M7** Sauvegarde et menus : IndexedDB, menus, réglages, export/import.
  - **M8** Objets, Logbook et stations : craft, établi, four, bas fourneau, coffres.
  - **M9** Survie et dangers : faim, soif, endurance, température, toxicité, abri, sommeil, mort.
  - **M10** Créatures et combat : 5 créatures, IA, apparitions nocturnes, combat.
  - **M11** Finition et performance : audio complet, réglages, prise en main, optimisation, tests e2e.
  - **Ensuite** : boucle d'amélioration autonome (bugs, robustesse, KISS/DRY/SRP, perf, tests), une PR par chantier.
- **Vérification** :
  - `npm run verify` (types, lint, tests, build), en local et dans la CI GitHub Actions ;
  - contrôles dans le navigateur intégré (Chromium) via `window.__game` (hook réservé au dev) et les autotests `?selftest=mN` ;
  - mesures de performance.
- **Git** :
  - une branche `claude/mN-<sujet>` par jalon ;
  - PR créée par moi ; squash-merge par moi quand la CI est verte et la revue faite ;
  - le jalon suivant repart de `main`.

## Stack & outillage

| Paquet                           | Version            | Rôle                                                                                 |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| three                            | 0.187.0 (exacte)   | `WebGLRenderer` ; importé **uniquement** sous `src/render`                           |
| simplex-noise                    | 4.0.3 (exacte)     | bruit ; importé **uniquement** via `src/core/noise.ts`, toujours avec un PRNG fourni |
| idb                              | 8.0.4 (exacte)     | IndexedDB, uniquement dans `io.worker`                                               |
| typescript (dev)                 | ~7.0.2             | compilateur natif, vérification de types seulement (`tsc -b`) ; repli `~6.0.3`       |
| vite (dev)                       | ^8.3.8             | serveur de dev et build (Rolldown/Oxc)                                               |
| vitest (dev)                     | ^5.1.1             | tests unitaires, d'équilibrage et de perf sous Node                                  |
| @types/three · @types/node (dev) | 0.187.0 · ^24.19.2 | types                                                                                |
| @biomejs/biome (dev)             | 2.6.8 (exacte)     | lint et formatage                                                                    |
| fake-indexeddb (dev)             | ^6.2.8             | test de l'adaptateur IndexedDB                                                       |
| @playwright/test (dev)           | ^1.65.1            | e2e de fumée : en local avec le Chrome installé, en CI avec Chromium                 |

**Volontairement exclus.**

- Frameworks et utilitaires : framework UI, Zod, lit-html, bibliothèque ECS, moteur physique, lil-gui.
- Outillage : ESLint + typescript-eslint (il exige TypeScript < 6.1), Prettier.
- Rendu et threads :
  - SharedArrayBuffer (et les en-têtes COOP/COEP qu'il exige) ;
  - WebGPURenderer/TSL ;
  - `three/addons` : ciel, contrôles et stats sont écrits à la main.

**Gestionnaire de paquets : npm 11.**

- Tous tes autres projets utilisent npm (`package-lock.json`).
- Pas de corepack ni d'approbation de scripts d'installation : le seul paquet concerné, fsevents, est livré précompilé.
- `package.json` :
  - `"name": "create-your-world"`, `"private": true`, `"type": "module"` ;
  - `"engines": { "node": ">=22.18.0" }` : cette version exécute le TypeScript sans option, ce dont a besoin `tools/headless.ts`.
- Ne jamais installer avec `--omit=optional` : Rolldown, Lightning CSS, Biome et TS 7 y livrent leurs binaires natifs.
- Si un binding natif manque : supprimer `node_modules` et `package-lock.json`, puis réinstaller.

**Scripts de `package.json`**

| Script              | Commande                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `dev`               | `vite`                                                                                                     |
| `build`             | `tsc -b && vite build`                                                                                     |
| `preview`           | `vite preview`                                                                                             |
| `bench`             | `vite build --mode bench --outDir dist-bench && vite preview --outDir dist-bench --port 4174 --strictPort` |
| `typecheck`         | `tsc -b`                                                                                                   |
| `lint` / `lint:fix` | `biome check .` / `biome check --write .`                                                                  |
| `test`              | `vitest run`                                                                                               |
| `test:perf`         | `vitest run --mode perf --reporter=verbose`                                                                |
| `test:slow`         | `vitest run --mode slow`                                                                                   |
| `headless`          | `node tools/headless.ts`                                                                                   |
| `e2e`               | `playwright test`                                                                                          |
| `verify`            | `npm run typecheck && npm run lint && npm run test && npm run build`                                       |

**Pièges.**

- `vitest` sans `run` est un mode watch qui ne rend jamais la main : interdit comme étape bloquante.
- `tsc` sans `-b` sur la solution ne vérifie rien : toujours `tsc -b`, avec `--force` si l'incrémental est périmé.
- `npm run headless -- --seed=42` : npm retire le `--`, et l'outil tolère malgré tout un `--` en tête.
- Vite et Vitest détectent l'agent (variables `CLAUDECODE` et `AI_AGENT`) :
  - Vitest n'affiche alors que les échecs, d'où `--reporter=verbose` pour `test:perf` ;
  - Vite renvoie les erreurs du navigateur dans le log du serveur.

**TypeScript 7 : quatre projets `noEmit`**

- `tsconfig.json` est une « solution » : `{ "files": [], "references": [core, worker, app, node] }`.
- Aucune autre `references`, et aucun commentaire dans les `tsconfig.*.json` (Biome ne les lit pas en JSONC).
- `tsconfig.base.json` :

```json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "allowArbitraryExtensions": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "erasableSyntaxOnly": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

| Projet                                         | `lib`             | `types`               | `include`                                         |
| ---------------------------------------------- | ----------------- | --------------------- | ------------------------------------------------- |
| `tsconfig.core.json` (prouve l'absence de DOM) | ES2023            | `[]`                  | `src/core`, `src/content`, `src/world`, `src/sim` |
| `tsconfig.worker.json`                         | ES2023, WebWorker | `[]`                  | `src/**/*.worker.ts`                              |
| `tsconfig.app.json`                            | ES2023, DOM       | `vite/client`         | `src` sauf `*.worker.ts`                          |
| `tsconfig.node.json`                           | ES2023, DOM       | `node`, `vite/client` | configs, `tests`, `tools`, `e2e`, `src/types`     |

Chaque projet a son `tsBuildInfoFile` dans `node_modules/.tmp/`.

Conséquences sur le code :

- **Syntaxe** : ni `enum`, ni namespace, ni propriétés-paramètres (on utilise des objets `as const`) ; `import type` obligatoire.
- **Imports relatifs en `.ts`**, vérifiés par la règle Biome `useImportExtensions`. Node 24.9 exécute donc le cœur sans build.
- **Boucles chaudes** : écrire `a[i]!`.
- **Cœur** : ni `console` ni minuteries ; on journalise via `core/log.ts`, dont la sortie est injectée par l'appelant.
- **Workers** :
  - le code côté worker est fait de modules purs qui reçoivent un port injecté (`WorkerPort { post(m, transfer); listen(cb) }`) ;
  - `self` n'est lié que dans chaque entrée `*.worker.ts`, par un adaptateur de 5 lignes ;
  - configuration par message `init`, sans `import.meta.env`.
- **M0 crée `world.worker.ts`**, sinon `tsc -b` échoue (« No inputs were found »).
- **Repli** : si `@types/three` 0.187 ne compile pas sous TS 7.0.2, passer à `typescript@~6.0.3`.

**`vite.config.ts`**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  define: { __DEBUG_HOOK__: JSON.stringify(mode !== 'production') }, // true en dev, bench et test
  server: { port: 5173, strictPort: true, forwardConsole: true }, // erreurs du navigateur → log du serveur
  preview: { port: 4173, strictPort: true },
  worker: { format: 'es' },
  optimizeDeps: { include: ['simplex-noise', 'idb'] },
  build: {
    sourcemap: mode !== 'production',
    chunkSizeWarningLimit: 1024,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /[\\/]node_modules[\\/]three[\\/]/ }] },
      },
    },
  },
  test: {
    environment: 'node',
    fileParallelism: mode !== 'perf',
    testTimeout: mode === 'slow' ? 180_000 : 10_000,
    include:
      mode === 'perf'
        ? ['tests/perf/**/*.perf.ts']
        : mode === 'slow'
          ? ['tests/slow/**/*.slow.ts']
          : ['tests/**/*.test.ts'],
  },
}));
```

- **Workers** : toujours le motif littéral `new Worker(new URL('../workers/world.worker.ts', import.meta.url), { type: 'module', name: 'world' })`, uniquement dans `platform/WorkerPool.ts` et `platform/IdbStorage.ts`.
- **Hook de debug** :
  - `if (__DEBUG_HOOK__) await import('./debugHook.ts')`, et pareil pour les autotests ;
  - `__DEBUG_HOOK__` est déclaré dans `src/types/env.d.ts`, de même que l'augmentation de `Window` ; ce fichier n'est jamais bundlé ;
  - absent du build de production, présent dans le build `bench`, qui est minifié.

**Biome** (schéma local dans `node_modules`) :

- `vcs.enabled: true`, `clientKind: "git"`, `useIgnoreFile: true` ;
- `files.includes` exclut `dist`, `dist-bench`, `coverage`, `.vitest`, `playwright-report`, `test-results`, `.claude` ;
- formatage : espaces, indentation 2, largeur 100, guillemets simples ;
- règles : `linter.rules.preset: "recommended"`, `useImportExtensions: "error"`, `noNonNullAssertion: "off"`, et le tri des imports `assist.actions.source.organizeImports: "on"` ;
- override JSONC pour `tsconfig.*.json` ;
- le GLSL vit dans des modules `*.glsl.ts` : pas d'import `?raw`.

**`.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "game-dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 },
    {
      "name": "game-bench",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "bench"],
      "port": 4174
    }
  ]
}
```

**Playwright (introduit en M2)**

- `testDir: 'e2e'`, `workers: 1`.
- En local : `channel: 'chrome'` (le Chrome 158 installé), arguments `--enable-gpu`. En CI (`process.env.CI`) : Chromium de Playwright.
- `webServer` : `npm run dev`, `reuseExistingServer: !process.env.CI`.
- Le premier spec vérifie WebGL2 ; en local, en cas d'échec en headless, passer en `headless: false`.
- Pas de WebKit ni de Firefox : Chrome est la cible.

**`.gitignore`** : `node_modules`, `dist*`, `.vitest`, `coverage`, `test-results`, `playwright-report`, `blob-report`, `*.tsbuildinfo`, `.DS_Store`, `.claude/worktrees`.

**Dépôt et CI**

- **Amorçage (M0)** :
  - `git init -b main` dans le dossier, `origin` = `git@github.com:hrltKillian/Create-Your-World.git` ;
  - premier commit sur `main` (`.gitignore`, README minimal), poussé directement : le dépôt est vide, une PR a besoin d'une base ;
  - tout le reste passe par des PR.
- **Une branche par jalon** : `claude/m0-scaffold`, `claude/m1-voxel-core`, `claude/m2-terrain-streaming`… Commits atomiques en anglais.
- **PR** créée avec `gh pr create`, titre et description en anglais : résumé, comment tester, checklist du jalon, captures.
- **CI** (`.github/workflows/ci.yml`) :
  - déclencheurs : `pull_request` et `push` sur `main` ;
  - étapes : Node 24, `npm ci`, `npm run verify` ;
  - un job e2e de fumée (`npx playwright install --with-deps chromium`, puis `npm run e2e`) à partir de M2 ;
  - les tests de perf restent locaux (non fiables sur les machines de CI) ;
  - le dépôt étant privé, cette CI consomme les minutes gratuites de GitHub Actions, quelques minutes par PR.
- **Merge** :
  - quand la CI est verte et que la revue adversariale du jalon est faite, je fais un squash-merge et je supprime la branche ;
  - le jalon suivant repart de `main` à jour ;
  - jamais de force-push sur `main`.
- **Ruleset** : GitHub indique que les rulesets ne s'appliquent pas aux dépôts privés d'un compte gratuit, donc je respecte ce circuit par discipline. Si tu passes le dépôt en public ou en Pro, la règle s'appliquera telle quelle.

**Fichiers créés en M0, en plus du code :**

- **`CLAUDE.md`** :
  - commandes et protocole de vérification ;
  - circuit Git/PR ;
  - table des couches, déterminisme, zéro allocation dans les boucles chaudes, budgets ;
  - i18n (aucun texte en dur), et quand incrémenter `GEN_VERSION` / `SAVE_VERSION` ;
  - jamais d'import de `*.worker.ts`, pas de three dans les workers ;
  - automatisation via `noLock`, `fixedStep` et `__game` ;
  - tout état persistant vient avec sérialiseur, valeur par défaut et test d'aller-retour ;
  - pas de gros téléchargement sans ton accord ;
  - **checklist d'originalité** (voir Interface).
- **`docs/conception.md`** : copie de ce plan, la spécification de référence pendant le développement.
- **`README.md`** en anglais, avec une section « Try this milestone » mise à jour à chaque jalon.

## Architecture

**Couches et dépendances autorisées**

| Couche     | Rôle                                                                                                                            | Imports autorisés (valeurs)                                         | `import type` en plus | S'exécute                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------- | -------------------------------------------- |
| `core`     | math, rng, hash, noise, files, varint, log, ids                                                                                 | aucun (simplex-noise seulement dans `noise.ts`)                     | —                     | partout                                      |
| `content`  | schéma, registre, validation, packs                                                                                             | core                                                                | —                     | partout                                      |
| `world`    | voxels, slots de colonnes, lumière, raycast, génération, maillage, codec, `protocol.ts` (types `JobRunner`, jobs, résultats)    | core, content                                                       | —                     | thread principal, workers, Node              |
| `sim`      | `Simulation`, systèmes, IA, ports, persistance abstraite, hôtes                                                                 | core, content, world                                                | —                     | thread principal en v1, Node (futur serveur) |
| `workers`  | entrées `*.worker.ts`, runtime à deux files, jobs, `io/idbStore`                                                                | core, content, world, idb                                           | —                     | Web Worker                                   |
| `i18n`     | `t()`, `fmt` (via `Intl`), chaînes du moteur                                                                                    | core, content                                                       | —                     | navigateur, Node                             |
| `assets`   | `AssetProvider`, génération procédurale                                                                                         | core, content                                                       | —                     | navigateur, Node (tests)                     |
| `input`    | clavier, souris, liaisons, étiquettes, Pointer Lock, `CommandBuilder`, interface `LookTarget`                                   | core, content, i18n                                                 | sim                   | navigateur                                   |
| `platform` | porte de capacités, `WorkerPool` (implémente `JobRunner`), proxy `IdbStorage`, `SaveManager`, verrou de monde, réglages, export | core, content, world, sim                                           | —                     | navigateur                                   |
| `render`   | three.js, matériaux, maillages, ciel, entités, caméra (`CameraRig` implémente `LookTarget`)                                     | core, content, world, assets, **three**                             | sim, input            | navigateur                                   |
| `audio`    | moteur, sons, ambiances                                                                                                         | core, content, assets, `platform/settings`                          | sim                   | navigateur                                   |
| `ui`       | HUD, écrans, menus, prise en main, overlay de debug                                                                             | core, content, i18n, assets, `input/keyLabels`, `platform/settings` | sim                   | navigateur                                   |
| `app`      | racine de composition, boucle, hook de debug, autotests                                                                         | tout                                                                | —                     | navigateur                                   |

**Règles vérifiées par `tests/architecture/boundaries.test.ts`**

- La table ci-dessus est un littéral dans le test, et le vérificateur lui-même est testé sur une arborescence fixture.
- Le test échoue s'il trouve :
  - un import hors de la table ;
  - `three` hors de `render` ;
  - `simplex-noise` hors de `noise.ts` (sans PRNG fourni, il retomberait sur `Math.random`) ;
  - un import d'un fichier `*.worker.ts` ;
  - `self` ou `DedicatedWorkerGlobalScope` hors des entrées `*.worker.ts` ;
  - `Math.random`, `Date`, `performance.now`, des minuteries ou `console` dans core, content, world ou sim ;
  - dans `world/gen`, `noise.ts`, `rng.ts` et `hash.ts` : `Math.sin|cos|tan|exp|log|pow|atan2|hypot|cbrt` **ou l'opérateur `**`** (résultats qui dépendent du moteur JS) ;
  - une clé de contenu littérale (`'block:…'` et autres) hors de `src/content/packs` et des tests ;
  - dans `src/ui`, un littéral de texte passé à `h()` (tout texte passe par `t()`).

Le moteur ne nomme jamais un élément de contenu. Il réagit à des propriétés (`blockEntity`, `liquid`, `heat`, `light.emit`, `friction`, `contact`…) et aux _bindings_ du manifeste du pack (air, bloc inconnu, objet inconnu, sac abandonné, avatar, biomes d'apparition, objectifs de départ).

**Contrat sim ⇄ client**

```ts
export interface SimHost {
  readonly view: SimView; // read-only world, entities, players, time, block entities
  send(cmd: Command): void; // queued; host stamps playerId + seq
  advance(ticks: number, out: SimEvent[]): void; // appends into a caller-owned array (no per-tick allocation)
  pumpWorld(budget: WorldPumpBudget): void; // ingest + light outside play (loading screen, tests)
}
```

- **`createLocalServer()`** construit la `Simulation`, le joueur et l'hôte ; le client ne garde que le `SimHost` et lit tout via `host.view`.
- **`LocalSimHost`** (v1) : `view` expose les objets vivants typés `DeepReadonly`, sans copie.
- **`SerializingSimHost`** (`?host=serialize` et tests) : chaque commande et chaque événement passe par JSON, ce qui prouve que le protocole tient sur le réseau.
- **`RemoteSimHost`** (après la v1) : même interface, avec une réplique du monde et une prédiction locale via la fonction pure `stepBody()`.
- **Déjà prêt pour le multijoueur en v1** :
  - `players: Map`, avec un rayon de vue par joueur (`client.view`) ;
  - validation côté sim : portée, ligne de vue, propriété des emplacements (l'écran ouvert et la pile du curseur de chaque joueur), l'établi ouvert pour ses recettes ;
  - événements avec une `audience` ;
  - ids d'entités persistés et jamais réutilisés ;
  - règle de sommeil `allPlayersSleeping`.
- **Ciblage** :
  - la commande porte yaw/pitch **et** la cible vue par le client (cellule + face, depuis l'œil interpolé) ;
  - la sim l'accepte si elle est à portée (4,5 + 0,3) de l'œil de simulation et si un test de ligne de vue DDA passe ; sinon elle lance son propre rayon.

**Boucle fixe à 30 Hz avec interpolation**

```ts
const TICK_MS = 1000 / 30,
  MAX_STEPS = 4;
renderer.setAnimationLoop((now: number) => {
  perf.frameStart(); // CPU work time of the frame (not the rAF interval)
  const frameMs = last < 0 ? 0 : Math.min(now - last, 250);
  last = now;
  input.applyMouseLook(lookTarget); // view rotation every frame
  if (!paused && !fixedStep) {
    acc += frameMs;
    let n = 0;
    while (acc >= TICK_MS && n < MAX_STEPS) {
      host.send(cmdBuilder.sample()); // edge-latched buttons, move, yaw, pitch, client target, slot
      ui.drainCommandsInto(host);
      host.advance(1, events);
      acc -= TICK_MS;
      n++;
    }
    if (n === MAX_STEPS) acc = 0; // drop backlog, never spiral
  }
  bus.dispatch(events);
  events.length = 0; // meshes, entities, particles, UI, audio, saves (pooled events)
  meshScheduler.update(budgets); // padded copies, dispatch, uploads (ms budgets)
  renderer.info.reset(); // autoReset = false
  view.render(fixedStep ? 1 : acc / TICK_MS); // lerp prev → cur
  ui.flush(); // DOM writes ≤ 10 Hz
  perf.frameEnd();
});
```

- **Onglet caché** : pause, sauvegarde immédiate (voir Sauvegarde), `audio.suspend()`, et `last = -1` (le temps caché n'est pas simulé).
- **L'inventaire ne met pas la sim en pause.**
- **Panneau du navigateur caché** (rAF bridé) : une boucle `MessageChannel` continue de pomper le monde en mode `fixedStep` ou en automatisation.
- Les événements très fréquents (`sectionsDirty`) sont mis en pool ou regroupés dans un tableau typé.

**Ordre d'un tick : `Simulation.step()`**

1. **Monde** :
   - intégrer au plus 2 colonnes générées par tick, ×6 en mode chargement ;
   - sous Node, avec `InlineJobRunner`, cette étape est synchrone, donc déterministe ;
   - décider les chargements et déchargements par joueur ;
   - n'intégrer aucune colonne tant que la file de couture de lumière dépasse 65 536 entrées.
2. **Commandes**, validées ou rejetées avec `rejected {reason}`.
3. **Temps** et phase du jour.
4. **Contrôle du joueur**, limité par l'endurance.
5. **IA** : réflexion à 10 Hz, étalée selon l'id ; au plus 2 recherches A* par tick.
6. **Physique**.
7. **Interaction** ; les changements de voxels sont collectés.
8. **Combat**.
9. **Entités de bloc, files de craft et états temporisés** (baies mûres, minuteries des objets au sol), dans le rayon de simulation de 4 colonnes :
   - à la ré-entrée dans ce rayon ou au chargement de la colonne, rejeu tick par tick depuis `lastTick` ;
   - rejeu plafonné à 36 000 ticks, soit un jour de jeu.
10. **Mises à jour de blocs** (au plus 256).
11. **Survie et environnement**.
12. **Objets au sol**.
13. **Apparitions** (tous les 30 ticks).
14. **Mort et réapparition**.
15. **Lumière** :
    - BFS de retrait puis de ré-ajout pour les éditions, mené **jusqu'au bout** ;
    - puis couture des bords de colonnes sous un budget fixe de **8 192 nœuds par tick** ;
    - émission de `sectionsDirty`.
16. **Objectifs** et marquage `saveDue`.

**Workers**

- **`world.worker` × N**, N = clamp(`hardwareConcurrency` − 2, 1, 4), aucun réservé :
  - tâches sans état `gen` (terrain, grottes, minerais, décor, structures, lumière locale, heightmap, biomes) et `mesh` ;
  - tables de blocs reçues une fois, par le message `init`.
- **Deux files par worker, urgente et normale** :
  - une tâche à la fois, relance via `MessageChannel`, donc une tâche urgente passe devant ;
  - au plus 2 tâches normales en vol par worker ; les urgentes partent tout de suite vers le worker le moins chargé ;
  - latence d'une édition : environ 12 ms + 4 ms.
- **Transferts** :
  - `ArrayBuffer` transférés et recyclés ; on poste des copies à la taille exacte, jamais un sous-tableau d'un tampon de travail ;
  - versions par section : les résultats périmés sont jetés ;
  - worker relancé après 10 s sans réponse, avec remise en file.
- **`io.worker` × 1** : codec, deflate-raw et IndexedDB ; `platform/IdbStorage` n'en est que le proxy côté thread principal.
- three ne va jamais dans un worker. `InlineJobRunner` exécute les mêmes fonctions de façon synchrone sous Node.

**Flux de données**

```
DOM → InputManager → CommandBuilder ─usercmd 30 Hz─┐
Écrans UI (clics sur les cases, Logbook, stations) ┤→ SimHost.send → Simulation.step
SimEvent[] → EventBus → MeshScheduler · EntityView · Particles · UiBridge · AudioEngine · SaveManager
Rendu, UI et audio lisent SimView ; seule une commande modifie l'état.
```

**Propriété de l'état**

| Propriétaire       | État                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sim (sérialisable) | voxels, lumière, heightmaps, pipeline des colonnes, entités de bloc, entités, joueurs (stats, inventaires, craft, objets vus, tombes), temps, flux RNG, compteur d'ids |
| Client (jetable)   | angles de vue, maillages GPU, particules, caméra, UI transitoire, voix audio                                                                                           |
| Plateforme         | IndexedDB (via `io.worker`), réglages en `localStorage`, verrou de monde                                                                                               |

**Entités** : pas d'ECS.

- Union discriminée d'enregistrements JSON `player | creature | itemDrop`, rangés dans une `Map` dont l'ordre d'insertion est déterministe.
- Ids persistés ; l'état de l'IA est inclus dans l'enregistrement.
- Hachage spatial en tableaux typés ; transformations `prev/cur` pour l'interpolation.

**Déterminisme**

- Flux sfc32 (graine via xmur3) dans l'état : `world`, `ai`, `loot`, `spawn`, `fauna`.
- Le temps est le numéro de tick ; aucun `await` dans `step()`.
- Les budgets de la sim se comptent en nœuds et en ticks, jamais en millisecondes ; seuls ceux du client s'adaptent à la machine.
- `sim.hash()` = FNV-1a 32 bits sur une sérialisation canonique.

## Arborescence

```
Adventure/  CLAUDE.md · README.md (EN) · docs/conception.md (FR) · index.html (favicon en data URI) · package.json · package-lock.json
            tsconfig.json · tsconfig.{base,core,worker,app,node}.json · vite.config.ts · biome.json · playwright.config.ts
            .claude/launch.json · .github/workflows/ci.yml · .gitignore
src/main.ts                boot: capability gate → URL params → App
src/types/env.d.ts         __DEBUG_HOOK__, Window augmentation (never bundled)
src/app/                   App.ts (unsupported/fatal/menu/loading/playing/paused/dead) · GameSession · GameLoop · bootParams
                           budgets · perf · UiBridge · debugHook · selftest/{runner,suites}
src/core/                  math · rng (xmur3, sfc32 streams) · hash (FNV, hash32) · noise (seeded wrapper, fbm) · queues · varint · log · ids
src/content/               schema · registry (flattened state ids, raw-value tables, bindings) · validate · reachability
src/content/packs/base/    manifest · blocks · items · recipes · processes · stations · tiers · creatures · models · biomes · worldgen
                           ores · features · structures · loot · textures · sounds · balance · palette · objectives · i18n.en (.ts)
src/world/                 coords · Section · Column · ColumnSlots · VoxelWorld · heightmap · raycast · shapes · protocol
src/world/gen/             generateColumn · climate · terrain · biomes · caves · ores · features · structures · spawnPoint · flat · arena · goldenHash
src/world/light/           columnLight (worker) · LightEngine (seams, edits, node budget, pending counters)
src/world/mesh/            vertexFormat · padded · greedyMesher · shapeMesher · visibility
src/world/codec/           sectionCodec · columnRecord · migrations
src/sim/                   Simulation · host · commands · events · state · stateHash · entities · spatialHash · streaming · ports · InlineJobRunner
                           physics · player · interaction · inventory · crafting · stations · blockEntities · blockUpdates · liquids
                           survival · environment · shelter · time · combat · drops · loot · spawning · objectives · persistence · MemoryStorage
src/sim/ai/                brains · pathfind · senses
src/sim/testing/           bots (wander, wanderMineBuild)
src/workers/               world.worker · io.worker (5-line adapters) · runtime (urgent/normal queues) · worldJobs · ioJobs · io/idbStore
src/platform/              capabilities · WorkerPool · IdbStorage (proxy) · SaveManager · worldLock · settings · exportWorld
src/assets/                AssetProvider · procedural/{textureGen, patterns, iconGen, itemBoxes, sfxSynth}
src/render/                Renderer · textureArray · voxelMaterial · shaders/{voxel,box,sky}.glsl.ts · ChunkMeshes · MeshScheduler
                           Occlusion · Sky · BoxBatch · EntityView · rigs · CameraRig · ViewModel · Highlight · Particles · capture · debugViews
src/audio/                 AudioEngine · cues · Ambience
src/input/                 InputManager · bindings · keyLabels · pointerLock · CommandBuilder · LookTarget
src/ui/                    signals (~80 lines) · h · UiRoot · store · slotBoard · tooltip · hud/* · screens/* · onboarding · debug/DebugOverlay · styles/*.css
src/i18n/                  i18n (t(), Intl.PluralRules) · fmt (Intl) · en
tests/                     unit/** · golden/ · sim/ · balance/ · content/ (incl. altPack/) · architecture/ · perf/*.perf.ts · slow/*.slow.ts · fixtures/
e2e/                       boot · selftest · save · input · perf (.spec.ts)
tools/headless.ts          plain Node: N ticks → {hash, tps, columns, census}
```

Le dossier local reste `Adventure` ; seul le dépôt GitHub porte le nom `Create-Your-World`.

**Fichiers critiques** :

- `src/sim/Simulation.ts`
- `src/world/light/LightEngine.ts`
- `src/world/mesh/greedyMesher.ts`
- `src/render/voxelMaterial.ts` et `src/render/ChunkMeshes.ts`
- `src/content/schema.ts` et `src/content/registry.ts`
- `tests/architecture/boundaries.test.ts`

## Systèmes

### Monde

**Encodage**

- Un voxel = un `Uint16` qui contient un **id d'état global aplati**. Le registre attribue des ids contigus à chaque combinaison (bloc, valeurs d'états), par exemple `block:door[facing=n,open=1]`.
  - Air = 0 ; au plus 65 535 états au total.
  - Propriétés d'état : `axis`, `facing4`, `open`, `lit`, `half`, `ripe` ; le registre fournit `withState(id, prop, valeur)` via des tables.
- Le registre construit des **tables indexées par la valeur brute** : 65 536 entrées, environ 1,3 Mo, envoyées une fois aux workers.
  - Tables : `BLOCK_OF`, `SOLID`, `OPAQUE`, `LIGHT_FILTER`, `EMIT`, `PASS`, `SHAPE`, `TINT`, `FACE_LAYER` ×6, `CULL_GROUP`, `FLAGS`.
- L'opacité à la lumière est distincte du culling et dépend de l'état : porte fermée = bloque, four allumé = émet.
- Règle validée : tout bloc à collision est `opaque` ou a un `filter` ≥ 1.
- Les sauvegardes stockent `stateKeys[]` (en texte) pour remapper les ids au chargement.

**Tailles et coordonnées**

| Élément   | Valeur                                                                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Section   | 32³, index `x \| z<<5 \| y<<10`. Blocs : `Uint16Array(32768)` **ou** un id uniforme. Lumière : `Uint8Array(32768)` (ciel en bits hauts, bloc en bits bas) **ou** un niveau uniforme. Les deux sont paresseux **indépendamment** : promotion à la première écriture différente, rétrogradation au remaillage |
| Colonne   | 32×256×32 = 8 sections, plus heightmap `Int16Array(1024)`, biomes `Uint8Array(1024)`, entités de bloc, état du pipeline, masque de coutures, versions, bits `persisted` et `dirty` par section                                                                                                              |
| Slots     | `ColumnSlots` : grille de 32×32 indexée par `(cx & 31, cz & 31)`, clé vérifiée à l'accès (le diamètre chargé est ≤ 27)                                                                                                                                                                                      |
| Axes      | +Y vers le haut, nord = −Z ; `cx = x >> 5`, `lx = x & 31` (jamais `%`)                                                                                                                                                                                                                                      |
| Hauteur   | y 0–255 ; Worldrock incassable en y 0 ; mer à 62                                                                                                                                                                                                                                                            |
| Bordure   | ±1 000 000 blocs ; au-delà : solide et jamais chargé                                                                                                                                                                                                                                                        |
| Clés      | entiers sûrs : colonne `(cx+2²⁰)·2²¹ + (cz+2²⁰)`, section `col·8 + sy`                                                                                                                                                                                                                                      |
| Précision | positions en float64 dans la sim, sommets locaux à la section ; three compose `modelViewMatrix` en float64, donc pas d'origine flottante (sauf `BoxBatch`, voir Rendu)                                                                                                                                      |
| Mémoire   | 64 Ko de blocs + 32 Ko de lumière par section non uniforme ; `voxelBytes` compte les deux ; budget ≤ 140 Mo à RD 6                                                                                                                                                                                          |

**Génération**
Pure, dans les workers. Chaque couche de bruit a son PRNG neuf `rngFor(seed, salt)`.

1. **Climat** : treillis ancré au monde, un point tous les 4 blocs, interpolation bilinéaire.
   - Champs : C (1/1400), E (1/700), M (crêtes, 1/450), T (1/900), H (1/700), X (toxicité, 1/550), détail (1/48).
   - **Bande de latitude** sur T : onde triangulaire d'amplitude 0,45 et de période 3 000 blocs. Froid vers z = −750 (nord), chaud vers z = +750 (sud) : toundra et désert à environ 1 km.
2. **Hauteur** : `h = 62 + splineC(C) + splineE(E)·ridge(M) + detail(±4)`, de 20 à 210 environ.
   - Les splines sont dans `worldgen.ts`.
   - La hauteur ne dépend pas du biome, donc pas de falaise aux frontières.
3. **Biome** : la première règle vraie l'emporte, avec une gigue de ±0,04 :
   1. C < −0,35 → Lake Basin ;
   2. X > 0,45 et T > −0,2 → Fungal Marsh ;
   3. T < −0,35 → Tundra ;
   4. T > 0,45 et H < 0,1 → Ochre Desert ;
   5. M > 0,55 ou h > 134 → Highlands ;
   6. H > 0,15 → Forest ;
   7. sinon Meadow.
4. **Remplissage** :
   - Worldrock, Darkstone sous y 32, pierre, 3 à 4 blocs de remplissage, surface ;
   - liquide jusqu'à 62 : eau, eau croupie dans le marais, glace en toundra.
5. **Grottes** : treillis 4×4×4 en trilinéaire.
   - Tunnels « nouilles » si `n1² + n2² < 0,0045` ; cavernes si `n3 > 0,62`, pour y de 12 à 50.
   - Rien à moins de 4 blocs de la surface (sauf une entrée si le bruit > 0,7), ni sous l'eau.
   - Sous y 10 : magma (lumière 15, chaleur).
6. **Minerais** : flux RNG par section ; centres des filons à au moins 2 blocs des faces de la section ; ils ne remplacent que la pierre.

   | Minerai                  | Où                                         | Y       | Palier |
   | ------------------------ | ------------------------------------------ | ------- | ------ |
   | Copper Ore               | prairie, forêt, plateaux (6 filons de 4–8) | 40–110  | 1      |
   | Cassiterite              | **toundra** uniquement                     | 50–100  | 2      |
   | Bog Iron                 | fonds de mares du **marais**               | 54–62   | 2      |
   | Fireclay                 | strates du **désert**                      | 60–85   | 2      |
   | Dawn Crystal (lumière 7) | parois de grottes                          | 5–28    | 3      |
   | Gravel (silex), Clay     | rives                                      | surface | 0      |

7. **Décor** : au plus un candidat par cellule de 8×8.
   - Chaque candidat est une fonction pure de la graine, de `biomeAt`, `surfaceHeight` et `caveAt`.
   - Chaque colonne évalue le voisinage 3×3 mais n'écrit que ses propres voxels (rayon ≤ 7). Le résultat ne dépend donc pas de l'ordre de génération.
   - Types : feuillu, conifère, champignon géant (lumière 6), épineux, palmthorn, rochers.
8. **Structures** : au plus une par région de 128×128.
   - Campement abandonné (15 % en prairie, forêt et désert) ou cairn (10 % en toundra, plateaux et marais).
   - Gabarits en grilles de caractères de 24×10×24 au plus.
   - Le coffre porte `{lootTable, lootSeed}` ; le butin est tiré à la **première ouverture**, via `hash(seed, x, y, z)`.
9. **Finition** : heightmap, sections uniformes rendues au pool, lumière locale (dès M5), graines des hardes.

**Point d'apparition**

- **Définitif (M6)** : recherche en spirale d'une colonne de prairie ou de forêt avec de l'eau et du gravier à 40 blocs au plus, et un marais, une toundra et un désert à 1 000 blocs au plus (échantillonnage analytique).
- **Provisoire (M2 à M5)** : la colonne d'herbe sèche la plus proche de l'origine.

**Mondes de test**

- `flat` : herbe à y 64.
- `arena` : cabane fermée de 5×4×5 (porte, fenêtre de verre), mare, gravier, arbres, mur de minerais, stations, coffre.

**Hachages dorés** : FNV par colonne, calculé sur le hash de la clé d'état de chaque voxel, par `GEN_VERSION`. Réordonner le contenu ne casse pas les tests ; seul un vrai changement de génération impose d'incrémenter la version.

**Streaming** (`sim/streaming.ts`, par joueur)

| Rayon (en colonnes)    | Valeur                                   |
| ---------------------- | ---------------------------------------- |
| RD (maillage et rendu) | 6, soit 192 blocs ; préréglages 4/6/8/10 |
| Lumière                | RD + 1                                   |
| Génération             | RD + 2                                   |
| Déchargement           | au-delà de RD + 3                        |
| Simulation             | 4                                        |

- **Spirale** précalculée jusqu'au rayon 16 ; au plus 2 × N générations en vol.
- **États d'une colonne** :
  1. **GENERATED** : arrivée avec sa lumière locale ;
  2. **LIT** : ses 4 voisins de face sont présents, ses 4 coutures sont analysées, et ni elle ni ses voisins n'ont d'entrée de lumière en attente (un compteur par slot, incrémenté à la mise en file et décrémenté à la sortie) ;
  3. **MESHABLE** : ses 8 voisins sont LIT.
- Le joueur reste figé tant que sa colonne n'est pas LIT.
- **Colonne déjà modifiée** : `io.worker` la décode d'abord, puis `gen` reçoit les sections sauvegardées et calcule la lumière sur les voxels finaux.
- **Déchargement** : les sections `persisted` partent à la sauvegarde ; les objets au sol et les hardes partent avec la colonne ; les hostiles sont supprimés.
- **Mode chargement** :
  - `pumpWorld` avec des budgets ×6, derrière un overlay ;
  - utilisé au démarrage, après une téléportation, à la réapparition loin et en rejoignant un monde ;
  - on en sort quand la colonne du joueur est LIT et que le rayon 3 est maillé.
- **Objectifs** : rayon 3 en moins de 3 s ; RD 6 complet en moins de 5 s.

**Maillage** (dans les workers)

- **Entrée** : copie paddée de 34³ (ids, lumière, biomes 34×34), construite en environ 0,1 ms.
- **Culling** : une face est visible si le voisin n'est pas opaque et n'est pas du même `cullGroup` (eau/eau, verre/verre, feuilles/feuilles et glace/glace sont cachées).
- **Glouton** par direction et par tranche, sur des masques de 32×32.
  - Deux faces fusionnent si leurs couche, teinte, drapeaux et **4 valeurs de coin (AO + lumière) sont égales**.
  - Comme un sommet partagé a la même valeur pour toutes les faces coplanaires qui le touchent, cette égalité impose des valeurs constantes le long de la fusion : la fusion est exacte.
- **AO** classique sur 0–3. La diagonale du quad est choisie selon l'AO, en décalant les sommets ; index partagé `0,1,2, 2,3,0`.
- **Lumière lissée** :
  - pour chaque canal (ciel, bloc), on prend les 4 cellules autour du sommet, dans le plan devant la face ;
  - `somme = round(4 × Σ(échantillons non opaques) / nombre(non opaques))`, sur 6 bits (0–60) ;
  - la valeur ne dépend que des cellules autour du sommet, donc deux faces voisines voient la même au sommet commun, sans couture.
- **Formes** :
  - `cross` : 2 quads diagonaux ;
  - `liquid` : dessus à 14/16 ;
  - `boxes` en 1/16 de bloc (torche, porte, coffre, établi, four, bas fourneau, feu, natte, sac), maillées dans la section et remaillées par la file urgente quand leur état change.
- **3 passes** :
  - **opaque**, sans `discard` (indispensable sur les GPU Apple à tuiles) ;
  - **cutout**, seuil alpha 0,35 ;
  - **translucide**.
- **Sortie** : sommets `Uint32Array`, nombre de quads, masque de connectivité sur 15 bits (pour le culling des grottes).

| Mot | Bits  | Champ du sommet `uvec2` (8 octets)                     |
| --- | ----- | ------------------------------------------------------ |
| w0  | 0–29  | x, y, z en 1/16 de bloc (10 bits chacun, 0–512)        |
| w0  | 30–31 | AO (coins d'UV pour les faces 6–7)                     |
| w1  | 0–8   | couche du texture array (≤ 256)                        |
| w1  | 9–11  | face (0–5 : axes, 6–7 : diagonales)                    |
| w1  | 12–23 | somme ciel / somme bloc (6 + 6 bits)                   |
| w1  | 24–28 | index de teinte dans `uTintColors[32]` (biome × canal) |
| w1  | 29–31 | drapeaux SWAY, EMISSIVE, UV_ROTATE                     |

Les UV se déduisent de la position et de la face. Avec `RepeatWrapping`, la texture se répète bloc par bloc sur un quad fusionné, sans couture.

**Éclairage** : deux canaux 0–15, propagés par remplissage.

- **Règles** :
  - perte de `1 + FILTER` par pas ;
  - le ciel à 15 descend sans perte à travers les blocs de filtre 0 ;
  - filtres : feuilles 1, verre 1, eau 2, glace 2.
- **Dans le worker** : ciel vertical, puis BFS depuis les bords de hauteur et les émetteurs. L'extérieur de la colonne compte comme opaque, donc le résultat n'est **jamais plus clair que la vérité**.
- **Dans la sim** (`LightEngine`) :
  - couture : comparaison des 2×32×256 paires de cellules d'un bord, environ 0,1 ms ; les écarts supérieurs à 1 alimentent la file d'ajout ;
  - éditions en 3 passes : appliquer, retirer (FIFO), ré-ensemencer ;
  - files : anneaux `Int32Array` dont les entrées valent `slot << 18 | (x | z<<5 | y<<10)` (28 bits) ;
    - l'encodage reste valable quand le joueur bouge ;
    - le niveau est relu à la sortie de file ;
    - on avance dans une section par arithmétique d'index, et on ne résout le slot qu'en franchissant un bord ;
    - les anneaux doublent de taille s'ils sont pleins ;
  - les sections touchées, et les sections voisines quand on est en bord, sont marquées à remailler.
- **Budgets** : éditions menées jusqu'au bout (une torche représente environ 3 600 cellules) ; coutures limitées à 8 192 nœuds par tick. Le résultat final est un point fixe unique.
- **Jour/nuit** : uniforme `uDaylight`, jamais de ré-éclairage.
- **Lumière effective** (règles de jeu) = `max(bloc, floor(ciel × daylight))`.

**Textures procédurales**

- **Recettes** dans `textures.ts` : motif + palette sRGB de 3 à 8 couleurs + graine.
  - Motifs : speckle, strata, planks, bark, rings, leaves (au moins 60 % de pixels opaques, pour résister aux mipmaps), turfSide, ore, bricks, cutStone, ripple, crystal, sludge, frost, cross, fracture (8 stades, motif de fracture propre au jeu).
  - Aussi : les peaux de créatures, et les icônes en masques ASCII de 16×16.
- **`textureGen.ts`**, pur et testé par hachage :
  - tuiles sans couture, tramage Bayer 4×4, ligne 0 en bas ;
  - résolution déclarée par le pack (`textureSize`, 16 par défaut).
- **Canal alpha**, défini par les drapeaux de la face :
  - EMISSIVE → masque émissif (paillettes de minerai visibles dans le noir) ;
  - teinte non nulle → masque de teinte (`color *= mix(1, tint, a)`) : seule l'herbe d'un côté de bloc d'herbe est teintée ;
  - sinon, ignoré ;
  - `validate.ts` refuse une face à la fois teintée et émissive.
- **Texture array** : une `DataArrayTexture(16, 16, ≈140)`.
  - Réglages : SRGB, mag `Nearest`, min `NearestMipmapLinear`, `generateMipmaps`, `RepeatWrapping`, `needsUpdate`.
  - **Pas d'anisotropie** : r187 l'ignore avec un filtre mag `Nearest`.
  - Au plus 256 couches.
- **Icônes de l'UI** : RGBA → canvas → `toBlob` → URL objet, affichées en `pixelated` ; les blocs en vue isométrique.

**Eau**

- Sources statiques.
- Remplissage borné :
  - 5 ticks après qu'un voisin devient de l'air ;
  - chaîne de 64 cellules au plus ;
  - jamais au-dessus de la source.
- Sous l'eau : nage, brouillard bleu, passe-bas audio, souffle.
- Les blocs liquides portent une propriété `liquid` (boire, remplir ; voir Gameplay). L'eau croupie est toxique au contact (`contact.toxicityPerMin`). La glace est glissante (`friction: 0,2`).

### Rendu

- **Renderer** : `WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })`.
  - Sortie : `SRGBColorSpace`, `NoToneMapping`.
  - Ratio de pixels `min(DPR, 1,5)` (préréglages 1 / 1,5 / 2), rendu `pixelated`.
  - `info.autoReset = false`.
  - **Précompilation** : pendant le chargement, on ajoute à la scène un mini-maillage par variante de matériau (opaque, cutout, translucide, BoxBatch, surlignage, fissures, particules) ; puis `await renderer.compileAsync(scene, camera)` et `await renderer.compileAsync(handScene, handCamera)` ; puis on retire ces maillages.
    - Assertion de debug : `renderer.info.programs.length` ne grandit plus pendant la première minute de jeu.
  - Perte de contexte : les tableaux CPU sont gardés, et three les retéléverse.
- **Matériau voxel** (`ShaderMaterial` en GLSL ES 3.00) :
  - **`glslVersion` reste null** : `GLSL3` supprimerait l'alias `pc_fragColor` dont `<colorspace_fragment>` a besoin ;
  - `in uvec2 aPacked` est lié par `vertexAttribIPointer`, puisque c'est un `Uint32Array` ; les varyings entiers sont `flat` ;
  - `index0AttributeName = 'aPacked'`, posé après la construction ;
  - uniformes de brouillard issus de `UniformsLib.fog` ; textures et uniformes partagés **par référence**, jamais clonés ;
  - 3 variantes : opaque ; cutout (`ALPHA_CUTOUT`, `DoubleSide`) ; translucide (`DoubleSide`, `forceSinglePass`, `depthWrite`).
- **Éclairage dans le shader** :
  - courbe `b(L) = 0,82^(15(1−L))` ;
  - `max(b(ciel·daylight)·teinteCiel, b(bloc)·teinteTorche·scintillement, minimum)` × AO (0,45 / 0,65 / 0,83 / 1) × ombrage de face ;
  - puis tonemapping → colorspace → fog, dans cet ordre ;
  - brouillard sphérique : `vFogDepth = length(mvPosition.xyz)`.
- **Géométrie d'une section** : une `BufferGeometry` par section et par passe.
  - Attribut `new BufferAttribute(u32, 2)` (jamais `Uint32BufferAttribute`, qui copie).
  - **Un seul index de quads `Uint32` partagé**, alloué pour le pire cas (98 304 quads, 2,4 Mo) ; `setDrawRange(0, quads·6)`.
  - Bornes posées à la main ; `matrixAutoUpdate = false`.
  - Remaillage : `array.set` + `addUpdateRange` si ça tient dans la capacité (une puissance de 2), sinon nouvelle géométrie.
  - **Libération : `setIndex(null)` puis `dispose()`**, sinon l'index partagé serait supprimé.
  - La vue debug « quads » est faite dans le shader, pas avec `material.wireframe` (qui dupliquerait l'index).
- **Ordre de rendu et culling** :
  - `renderOrder` : ciel −1, opaque 0, cutout 1, entités 2, translucide 10, particules 11 ;
  - frustum culling sur les bornes posées ;
  - **culling des grottes** : BFS sur les masques de connectivité, jamais vers l'arrière ; met `visible = false` ;
    - relancé au plus une fois par image, quand la caméra change de section ou quand un masque change dans la RD ;
    - une section dont le maillage est en attente compte comme entièrement connectée ;
    - désactivable avec `?occlusion=0`.
- **Ciel et brouillard** :
  - dôme en dégradé (images-clés de palette), soleil et lune **ronds**, étoiles ;
  - `THREE.Fog` posé une seule fois : near = 0,55·R, far = R − 8 avec R = RD·32 ; plan far de la caméra = R + 48 ;
  - couleur du brouillard = horizon = couleur d'effacement ;
  - brouillard par biome interpolé sur 2 s ; sous l'eau : bleu, de 1 à 20 blocs.
- **BoxBatch** : un seul `InstancedMesh` (`frustumCulled = false`) pour les créatures, l'avatar, les objets au sol, l'objet tenu en 3e personne et les particules.
  - Par instance : matrice + `aInst: uvec2` (couches dessus/dessous/côtés, drapeaux émissif/flash, lumière ciel/bloc, teinte, décalage d'UV).
  - **Origine** : à chaque image, la position du batch est mise à l'origine de la section de la caméra (en float64), et les translations d'instance sont relatives à cette origine. Même chose pour le batch de la vue en main.
  - Les objets tenus et les objets au sol proches sont extrudés en ≤ 32 boîtes (rectangles du masque alpha), donc aucun `discard`.
  - Au-delà de 8 blocs, un objet au sol est une seule boîte texturée ; seuls les 64 objets au sol les plus proches sont rendus en détail.
  - Seules les instances qui bougent sont mises à jour (plages statique et dynamique, `addUpdateRange`) ; capacité 8 192.
  - Lumière par instance = celle du voxel occupé.
- **Avatar** :
  - un explorateur original en boîtes (capuche, lunettes, besace), aux proportions humaines (pas de grosse tête cubique), sur un squelette bipède ;
  - animations procédurales dès M3 : repos, marche/course, accroupi, saut/chute, nage ;
  - dès M4 : frappe et minage, objet tenu, sursaut.
- **Vue en main** : scène séparée (FOV 70, near 0,01), rendue après `clearDepth()`, avec un petit BoxBatch.
- **Surlignage** : contour ×1,004, fissures (`polygonOffset`), fantôme de pose.
- **Budgets à RD 6** : ≤ 400 draws en surface, ≤ 150 sous terre, ≤ 1,5 M triangles, géométrie ≤ 64 Mo.

### Joueur

| Paramètre                  | Valeur                           | Paramètre              | Valeur                         |
| -------------------------- | -------------------------------- | ---------------------- | ------------------------------ |
| Boîte                      | 0,6×1,8 (1,5 accroupi)           | Yeux                   | 1,62 / 1,27                    |
| Marche / sprint / accroupi | 4,3 / 6,4 / 1,6 m/s              | Gravité                | 28 m/s²                        |
| Saut                       | 8,4 m/s (apogée 1,26, au tick 9) | Accélération sol / air | 50 / 12                        |
| Coyote / tampon de saut    | 0,1 / 0,1 s                      | Vitesse terminale      | 50 m/s                         |
| Nage                       | 2,4 m/s, gravité ×0,25           | Souffle                | 15 s, puis −5 PV/s             |
| Chute                      | 6 PV par bloc au-delà de 3,5     | Glace                  | accélération ×0,2 (`friction`) |

- **Physique** : `stepBody()` pure.
  - Intégration exacte à accélération constante : `y += v·dt − ½·g·dt²` puis `v −= g·dt`, puis limite à la vitesse terminale. Un test vérifie l'apogée de 1,26 au tick 9.
  - Résolution Y, puis X, puis Z, en balayant toutes les cellules couvertes : aucun effet tunnel, ε = 1e-4.
  - Natte et feu sans collision, donc pas de marche montante.
  - Garde de bord en position accroupie ; les colonnes non chargées sont solides.
- **Caméra 1re personne** :
  - œil interpolé ; yaw et pitch appliqués à chaque image (±89°) ;
  - FOV 75, réglable de 60 à 100, +8° en sprint ;
  - balancement de 0,035 m (option), creux à l'atterrissage, roulis vers le côté touché.
- **Caméra 3e personne** (`KeyV`) :
  - 4 m derrière et 0,5 m au-dessus ;
  - rayon DDA depuis la tête pour éviter les murs (distance minimale 0,6 m) ; lissage 12/s ;
  - le réticule disparaît, le contour montre la cible du rayon de l'œil.
- **Ciblage** :
  - DDA d'Amanatides–Woo, portée 4,5 ; les créatures sont testées d'abord ;
  - un départ depuis l'intérieur d'un solide donne une normale nulle ;
  - la cible du client part dans la commande (voir Architecture).
- **Priorité des actions**

  | Bouton                  | Ordre de priorité                                                                                                                                            |
  | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Principal (clic gauche) | créature à portée → attaque ; sinon bloc → minage (maintenu)                                                                                                 |
  | Secondaire (clic droit) | bloc interactif (station, coffre, porte, natte) → consommer l'objet tenu (maintenu `consume.seconds`) → remplir un récipient ou boire sur un liquide → poser |
  | Accroupi + secondaire   | force la pose, par exemple contre un coffre                                                                                                                  |
  - Maintenir le clic gauche ≥ 0,5 s **sur une créature** donne une attaque chargée, appliquée au relâchement.
  - Pendant qu'on mange ou boit, on avance à ×`consume.moveFactor` (0,4) et sans sprint ; changer d'objet en main ou viser un bloc interactif arrête l'action jusqu'au prochain appui (M12).
  - Sur un bloc, maintenir mine ; si la cible change pendant le maintien, la progression repart de zéro.
- **Casser** :
  - `t = dureté × 1,5 / vitesse de l'outil` si le type d'outil correspond ; sinon vitesse 1 ;
  - palier inférieur à `minTier` : ×3,3 et **aucun butin**, avec l'indice HUD « Tool too weak: copper pickaxe required » (nom tiré de `tiers.ts`) ;
  - joueur épuisé : ×1/0,6 ;
  - 8 stades de fissure, −2,5 d'endurance/s, usure −1 (−2 avec un mauvais outil).
- **Poser** :
  - cellule `replaceable`, dans la bordure, sans entité, à portée ;
  - supports exigés ; orientation déduite du yaw ou de la face visée ; portes sur 2 blocs ;
  - clic droit maintenu = une pose toutes les 6 ticks.
- **Barre rapide** : 8 emplacements (`Digit1`–`Digit8`). La molette accumule `deltaY` avec un seuil avant de changer d'emplacement, pour que le défilement inertiel du trackpad ne fasse pas tourner la barre.

### Gameplay

**Registres**

- Données TS `as const satisfies …Def`, avec des clés préfixées (`block:`, `item:`, `tag:`, `recipe:`, `process:`, `station:`, `creature:`, `biome:`, `loot:`, `tex:`, `sfx:`, `model:`, `objective:`).
- `nameKey` est typé par `PackI18nKey` (dérivé de `i18n.en.ts as const`) : une faute de frappe fait échouer `tsc`.
- Chaque bloc posable a un objet implicite `item:<id>`.
- `validate.ts` contrôle :
  - les références, l'i18n, les textures et les états ;
  - les bindings, la limite de 256 couches, la règle collision ⇒ opacité ;
  - la règle teinte/émissif.
- Test d'aller-retour JSON. Ids numériques dans l'ordre du pack (air = 0) ; les sauvegardes utilisent les clés texte.
- **Clés inconnues au chargement** :
  - un état inconnu devient le « bloc inconnu » ;
  - un objet inconnu devient `item:unknown`, qui garde la clé d'origine ;
  - une créature inconnue est ignorée ;
  - une recette inconnue en file est remboursée.

**Outils et paliers** (`tiers.ts`, noms via i18n)

| Palier | Matériau        | Vitesse | Durabilité | Débloque                                        |
| ------ | --------------- | ------- | ---------- | ----------------------------------------------- |
| 0      | main            | 1       | ∞          | terre, sable, plantes, bois lentement           |
| 1      | silex (flint)   | 2       | 60         | pierre, cuivre                                  |
| 2      | cuivre (copper) | 3,5     | 160        | cassitérite, fer des marais, argile réfractaire |
| 3      | bronze          | 5       | 320        | Darkstone, Dawn Crystal                         |
| 4      | fer (iron)      | 7       | 640        | plafond de la tranche                           |

**Inventaire**

- Barre de 8, sac de 24 (6×4), 5 emplacements d'équipement (tête, visage, torse, jambes, pieds). L'inventaire a de 32 à 64 cases (`inventorySize`, sa longueur ; les améliorations de M19 l'agrandissent).
- Piles `{ item: ItemKey, count, durability?, charges?, orig? }`. Maximum : 64 (`DEFAULT_STACK`), ou le `maxStack` de l'objet ; outils, armes, équipements et récipients : 1 (`stackLimit`). Une pile au-delà d'un maximum abaissé est redécoupée au chargement (`fitStacks`).
- Opérations pures qui renvoient le reste.
- L'UI n'envoie que des commandes, validées par la sim : `screen.open {kind: 'bag'}` / `screen.close`, `slot.click {slot, button, shift}`, `slot.hotkey {slot, hotbar}` (`sim/slotClicks.ts`, pile du curseur `PlayerState.cursor`), `inv.drop`. Les cases de l'écran ouvert sont numérotées à partir de 64 (`OPEN_SLOTS_BASE`).
- Coffre de 18 emplacements, ouvert par un seul joueur à ≤ 5 blocs ; casser un conteneur répand son contenu.

**Craft : le « Logbook »** (une liste originale, pas de grille)

- Recettes `known: 'start'` connues dès le départ ; les autres sont **révélées dès qu'un de leurs ingrédients a été vu**.
- Un ingrédient inconnu s'affiche avec un indice, par exemple « Found in the frozen lands to the north ».
- Recherche (noms du résultat et des ingrédients affichés, sans casse ni accents) et filtre « Can craft now » (M13).
- Les recettes non découvertes sont listées en bas de leur onglet, grisées (M13) : leur résultat est visible, leurs ingrédients jamais vus s'affichent en « ? » avec leur indice. Elles ne se fabriquent pas, suivent l'onglet et la recherche, et le filtre les masque.
- File de 5 ; ingrédients réservés à l'ajout et remboursés à l'annulation. Une recette déjà dans la file s'ajoute à son entrée, jusqu'à une pile du résultat (`entryCrafts`), puis une nouvelle entrée s'ouvre : cinq ×1 font la même file qu'un ×5 (M13).
- Temps de craft à la main dans les données : 1 à 3 s (Flint Hatchet : 2 s).
- Recettes à la main : file du joueur ; le résultat va dans l'inventaire, ou au sol s'il est plein.
- Recettes d'établi (M13, décision 18) : l'établi est une entité de bloc (`blockEntity: 'workbench'`) avec sa file de 5 et 4 cases de sortie. Ajouter à sa file exige l'établi ouvert ; les ingrédients sont réservés sur le joueur qui ajoute, et rendus à celui qui annule (`craft.cancel { workbench: true }`). L'établi fabrique seul vers ses sorties, avec le rattrapage des stations ; des sorties pleines mettent la file en pause. Casser l'établi répand ses sorties et ses réservations.
- Les objectifs qui demandent une station la cherchent à ≤ 4 blocs du joueur (`stationNear`).

**Stations de transformation**

- Ce sont des entités de bloc avec entrées, combustible, sortie, `burnTicksLeft`, `progressTicks`, `keepLit` et un état `lit` qui pilote lumière et chaleur.
- Une station ne brûle son combustible que pendant un traitement valide. Le feu de camp peut aussi rester allumé sans traitement : interrupteur « Keep burning » (`keepLit`, éteint par défaut, sauvegardé ; chaque commande `station.keepLit` l'inverse) (M12).
- Sortie pleine → pause.
- Hors du rayon de simulation, ou après un déchargement : rejeu tick par tick depuis `lastTick` à la ré-entrée, plafonné à 36 000 ticks.

| Station   | Fabrication                                           | Procédés                                                                                                                                    |
| --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Campfire  | à la main : 2 bûches (`tag:log`) + 4 bâtons + 1 silex | viande grillée 8 s ; cuisson d'une gourde crue 10 s ; eau bouillie 6 s ; antidote 10 s                                                      |
| Clay Kiln | établi : 4 argile + 6 éclats de pierre                | cuivre 10 s ; briques et verre 8 s ; charbon de bois 12 s ; brique réfractaire 12 s ; **alliage** 3 cuivre + 1 cassitérite → 3 bronze, 15 s |
| Bloomery  | établi : 8 briques réfractaires + 2 bronze + 4 éclats | 2 fer des marais → 1 fer, 20 s, charbon de bois uniquement                                                                                  |

Combustibles : bâton 5 s, planche 15 s, bûche 40 s, tourbe 60 s, charbon de bois 80 s.

**Eau potable** (la soif est la jauge qui tue le plus vite)

- **Gorgée** : main vide + clic droit maintenu 0,8 s sur un liquide `drinkable`.
  - Eau douce : soif +8, toxicité +2.
  - Eau croupie : soif +8, toxicité +10.
- **Clay Flask**, avant toute chasse :
  - 3 mottes d'argile (des rives) donnent une Unfired Flask, à la main en 2 s ;
  - cuite au feu de camp (10 s), elle devient une gourde vide de 3 charges.
- **Leather Waterskin** : à l'établi, 6 charges.
- **Remplir** : clic droit avec un récipient vide sur un liquide (`liquid.fills`) → « Raw Water » ou « Foul Water ».
- **Faire bouillir** : feu de camp, 6 s → « Boiled Water ».
- **Boire** une charge (maintien 1,2 s) : soif +25. Toxicité : brute +3, bouillie 0, croupie +12.

**Rythme visé** (`objectives.ts` et événements de phase du jour)

| Temps réel | Étape                                                 |
| ---------- | ----------------------------------------------------- |
| 0–1:30     | fibres, bâtons, silex, baies ; gorgées au point d'eau |
| 1:30–4     | hachette, torches, arbre, établi                      |
| 4–5:30     | pioche, lance, feu de camp, gourde                    |
| 5:30–8     | chasse, cuisson, eau bouillie                         |
| 8–10:30    | cabane ; alerte à 18:30                               |
| ~10:30     | crépuscule, yeux de Prowler ; dormir ou tenir         |

**Objectifs jusqu'au fer** : une chaîne en données, avec indices et points cardinaux sur la boussole.

1. Récolter fibres, bâtons et silex.
2. Fabriquer une hachette et des torches.
3. Boire, puis fabriquer une gourde.
4. Construire un établi.
5. Bâtir un abri et un feu de camp avant la nuit.
6. Survivre à la nuit 1.
7. Bâtir un four et produire un lingot de cuivre.
8. Fabriquer des outils en cuivre.
9. « Cold lies to the north » : rapporter de la cassitérite, avec capuche et manteau de fourrure.
10. Fondre du bronze.
11. Obtenir un Prowler Sinew, puis fabriquer des outils en bronze.
12. « Heat lies to the south » : rapporter de l'argile réfractaire, avec chapeau et voile.
13. Marais : rapporter du fer des marais, avec un masque.
14. Bâtir un bas fourneau.
15. Produire le premier lingot de fer.

En monde sans hostiles, les cairns contiennent aussi des Prowler Sinews : la progression reste atteignable, et le test d'atteignabilité tourne pour chaque règle de monde.

### Survie

Toutes les valeurs sont dans `balance.ts`. Les tests d'équilibrage **calculent leurs attendus à partir de ce code partagé** plutôt que de chiffres recopiés à la main.

| Jauge                 | Évolution                                                                                                                                                           | Seuils                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Santé 100             | régénère 0,4/s si faim ≥ 50, soif ≥ 50, toxicité < 35, aucun statut thermique et 6 s sans dégâts ; +0,5 de faim consommée par PV régénéré                           | < 25 : battement de cœur et vignette                                              |
| Faim 100              | −4/min ; ×2 en sprint, ×1,5 en Cold ; +1 par 50 d'endurance dépensée                                                                                                | < 15 : endurance max 50 ; 0 : −12 PV/min                                          |
| Soif 100              | −6,25/min ; ×2 en Hot, ×1,5 en sprint                                                                                                                               | < 20 : régénération d'endurance ×0,5 ; 0 : −18 PV/min                             |
| Endurance 100         | +25/s après 0,8 s de repos ; sprint −10/s, saut −5, attaque −6 (chargée −14), minage −2,5/s                                                                         | 0 : Exhausted jusqu'à 30 (pas de sprint, attaques ×1,5 plus lentes, minage ×0,6)  |
| Température −100…+100 | tend vers la cible à 16/min (30/min en revenant vers 0)                                                                                                             | ±40 : Cold (faim ×1,5) / Hot (soif ×2) ; ±70 : Freezing / Overheating, −20 PV/min |
| Toxicité 0–100        | marais +4/min le jour et +7 la nuit ; eau croupie aux pieds +8/min ; morsure +8 ; viande crue +10 ; boissons (voir Eau potable) ; −3/min sans source ; antidote −40 | ≥ 35 Nauseous (pas de régénération) ; ≥ 65 −10 PV/min ; ≥ 90 −30 PV/min           |
| Souffle 15 s          | se vide quand la tête est sous l'eau                                                                                                                                | 0 : −5 PV/s                                                                       |

Un joueur inactif meurt en environ 21,6 min (fenêtre cible : 18 à 26 min).

**Modèle thermique**

1. Facteur de jour `t = clamp((daylight − 0,12) / 0,88, 0, 1)`, pour que les valeurs de nuit des biomes soient vraiment atteintes.
2. Base = `lerp(nuit, jour, t) − 0,15 × max(0, y − 100)`. En grotte (ciel 0 et ≥ 8 blocs sous la surface) : 12 °C.
3. Abri **fermé** : `lerp(base, 18, 0,6)`. Abri **couvert**, au-dessus de 28 °C : −8.
4. Sources de chaleur (les 2 plus fortes, décroissance linéaire) : feu +25 °C (rayon 4), four ou bas fourneau allumé +15 (r 3), magma +40 (r 3), torche +3 (r 1).
5. Dans l'eau : −8.
6. Équipement, sans dépasser le confort : `min(10, amb + chaleur)` sous 10 °C, `max(28, amb − fraîcheur)` au-dessus de 28 °C.
7. Cible : `−min(100, 5·(10 − eff))` sous 10 °C, `+min(100, 5·(eff − 28))` au-dessus de 28 °C, sinon 0.

Exemples verrouillés par les tests :

- **Toundra** (−6/−16 °C) sans équipement : Cold à environ 2,5 min, Freezing à environ 4,4 min.
  - En fourrure : confort le jour, Cold sans dégâts la nuit.
  - Abri fermé de nuit : 4,4 °C, cible −28.
- **Désert** (44/8 °C) : Overheating à environ 4,4 min ; voile + chapeau (fraîcheur 14) → sûr.
- **Marais** : Nauseous à environ 8,75 min de jour ; avec masque (×0,15, durabilité de 60 min d'usage), plus de 40 min.

**Abri** (tous les 30 ticks, et après une édition à ≤ 10 blocs)

- BFS 6-connexe depuis la tête, à travers les cellules sans collision :
  - ≤ 384 cellules et ≤ 10 blocs de la tête sur chaque axe (une petite pièce fermée l'est aussi depuis ses coins) ;
  - les portes fermées comptent comme des murs.
- Atteindre une cellule de **ciel 15**, ou dépasser les limites → exposé. File vidée → **fermé**.
- Coût environ 20 µs, sans allocation.
- **Couvert** = `heightmap > tête` sans être fermé.
- Effets :
  - fermé : climat adouci, toxicité ×0,2, sommeil permis ;
  - couvert : ombre, toxicité ×0,7.

**Équipement de danger**

| Biome   | Équipement                                                                           |
| ------- | ------------------------------------------------------------------------------------ |
| Toundra | Fur Hood (chaleur 6) + Fur Coat (10)                                                 |
| Désert  | Straw Hat (fraîcheur 6) + Fiber Veil (8)                                             |
| Marais  | Filter Mask (×0,15, 60 min d'usage) + Waxed Boots (annulent l'eau croupie aux pieds) |

Armures (valeur d'armure) : tunique et jambières de cuir 2 et 1, pièces de bronze 3 et 6, cuirasse de carapace 5. Chaque coup de créature reçu use d'un point chaque pièce portée (sauf le masque filtrant, qui s'use à la seconde d'air toxique filtré) ; une pièce usée disparaît.

**Jour/nuit**

- 1 jour = 36 000 ticks = 20 min ; 1 h de jeu = 50 s ; un monde commence à 07:00.
- Plein jour 06:00–18:30, crépuscule jusqu'à 20:30, nuit jusqu'à 04:30 (`daylight` 0,12), aube jusqu'à 06:00.
- Hostiles en surface environ de 20:00 à 04:50, soit environ 7,4 min réelles.
- Messages : « The sun is setting… » à 18:30, un son au crépuscule, « Night N survived » à 06:00.

**Sommeil** : natte (Bedroll), entre 19:30 et 05:00, abri **fermé**, aucun hostile à ≤ 16 blocs.

- On saute à 06:00 ; coût : faim −10, soif −15.
- Le point de réapparition est fixé là.

**Mort**

- L'inventaire va dans un **Abandoned Pack** permanent, dans la cellule libre la plus proche des pieds (≤ 2 pas de cellule en cellule sans collision depuis les pieds, le haut d'abord ; jamais à travers la roche ni hors du monde : sans cellule, les objets tombent au sol). Il est enregistré dans `graves[]` du joueur, donc son marqueur sur la boussole survit au rechargement.
- L'écran de mort affiche la cause (`death.cause.*`).
- Réapparition :
  - à la natte, sinon au point d'apparition tant qu'on peut s'y tenir (sol solide dessous, pieds et tête libres) ; sinon sur la première cellule où l'on tient à ±2 blocs de sa hauteur, dans sa colonne puis dans les plus proches (jamais au-dessus d'un puits, ni sur un toit ou une canopée, ni dans un buisson : une colonne non chargée est générée pour le test, sous ses sections sauvegardées, donc le point est le même que l'on meure près ou loin) ; sinon au fond de la fosse creusée dessous ; en mode chargement si c'est loin ;
  - santé 60, faim 50, soif 50 ;
  - statut « Weakened » (−20 % de dégâts) pendant 2 min, et 5 s sans être ciblé.

### Créatures et combat

| Clé                  | Nom       | Catégorie   | PV  | Marche / course (m/s) | Attaque                      | Où                                               | Particularités                                                                                                                                                            | Butin              |
| -------------------- | --------- | ----------- | --- | --------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `creature:trotter`   | Trotter   | passif      | 12  | 1,6 / 5,8             | —                            | prairie, forêt ; hardes de 2 à 4                 | fuit 8 s                                                                                                                                                                  | viande 1–2, peau 1 |
| `creature:shagback`  | Shagback  | défensif    | 26  | 1,3 / 4,8             | charge 6                     | toundra, plateaux                                | six pattes ; alerte sa harde à ≤ 12 blocs                                                                                                                                 | fourrure 1–2       |
| `creature:prowler`   | Prowler   | hostile     | 22  | 2,2 / 5,0             | bond 7 (0,4 s, recharge 2 s) | surface de nuit, grottes                         | silhouette basse et quadrupède, yeux ambrés émissifs ; 30 % de vitesse quand on le regarde ; fuit la lumière ≥ 10 ; s'enfouit à l'aube ; dégâts ×(1 + 0,05·min(jour, 10)) | Prowler Sinew 1    |
| `creature:swarmling` | Swarmling | hostile     | 8   | 2,5 / 6,0             | morsure 3, toxicité +8       | marais (nuit, ombre), grottes ; groupes de 3 à 5 | approche en zigzag                                                                                                                                                        | glande 0–1         |
| `creature:shellback` | Shellback | territorial | 45  | 1,2 / charge 7        | charge 12 (0,8 s)            | désert, à toute heure                            | attaque à ≤ 6 blocs ; −60 % de dégâts de face ; étourdi 1,5 s s'il percute un mur                                                                                         | plaque 1–2         |

- **Bruits du joueur** (rayon d'audition, en blocs) : accroupi 2, marche 6, minage 10, combat 12, sprint 14.
- **Comportements** : machines à états paramétrées par les données : `grazer`, `defender`, `stalker`, `swarmer`, `charger`.
  - Le Prowler voit à 24 blocs sur 140°, avec un test de ligne de vue DDA tous les 10 ticks.
  - « Regardé » = à moins de 30° du regard, avec ligne de vue.
- **A\*** :
  - 8 directions sans couper les coins ; monte 1 bloc, descend ≤ 3 ;
  - nage : un nœud flotte dans la cellule du haut d'un liquide (surcoût 1) ; un nageur qui flotte (pas de bloc solide sous sa cellule) remonte sur une berge jusqu'à 1 bloc au-dessus de la surface (saut de sortie du corps), mais dans un liquide posé sur le sol il ne monte qu'1 bloc, comme à terre (jamais par-dessus un mur de 2) ; un chemin n'y descend que si le mouvement inverse existe : 1 bloc depuis une colonne solide, ou 2 dans un liquide où il flotte depuis une colonne solide jusqu'à sa cellule du haut (pas depuis un ponton, un pont ou une berge creusée) : une créature n'entre jamais dans une eau dont elle ne peut sortir ;
  - tas typé et table de nœuds à estampilles de 16 384 entrées ;
  - ≤ 600 nœuds développés par recherche et ≤ 2 recherches par tick ; si le budget est épuisé, chemin partiel vers le nœud au meilleur h ;
  - recalcul si la cible bouge de plus de 2 cellules, ou tous les 20 ticks ;
  - ligne droite à ≤ 6 blocs si la cible est visible ;
  - colonnes non chargées interdites ; lumière ≥ 10 interdite pour les créatures qui la fuient.
- **Apparition** (tous les 30 ticks ; 4 candidats dans un anneau de 24 à 56 blocs ; jamais à ≤ 16 blocs d'un joueur) :
  - hostiles seulement si la **lumière effective est ≤ 4** : une torche (14) protège jusqu'à une distance de Manhattan de 9 ;
  - plafonds : surface `3 + floor(jour/2)` (max 9) sur 96 blocs ; grottes 4 sur 48 ; territoriaux et défensifs 4 ; passifs 8 ; ≤ 3 par colonne ;
  - période de grâce : aucun hostile pendant les 3 premières minutes réelles (`rules.spawnGraceTicks = 5400`, `?grace=0` pour les tests) ;
  - hardes passives placées à la première génération (la colonne est alors sauvegardée), et repeuplées au plus une fois par minute de jour.
- **Disparition** :
  - au-delà de 96 blocs, ou de 48 blocs après 30 s sans être vu ;
  - les Prowlers s'enfouissent à l'aube ;
  - les hostiles ne sont jamais sauvegardés.
- **Animation** (côté rendu) :
  - parties en boîtes avec pivots en 1/16 ;
  - phase de marche liée à la distance parcourue (2,2 rad/bloc) ;
  - respiration, regard, poses d'armement, sursaut, flash rouge, gel de 80 ms à l'impact, chute puis rétrécissement à la mort.
- **Combat** (corps à corps) :
  - clic = attaque légère ; maintien ≥ 0,5 s sur une créature = attaque chargée (×1,8 dégâts, ×1,5 recul) ;
  - **furtive** ×1,5 : la cible n'est pas en alerte et le joueur est hors de son champ de vision ;
  - armure : `dégâts × 20/(20 + A)` ;
  - recul : 6 + 3 m/s × (1 − résistance) ;
  - invulnérabilité : joueur 15 ticks, créatures 8 ;
  - attaques télégraphiées et esquivables (portée + 0,3 et ligne de vue au moment de l'impact : de l'œil de la créature à l'œil du joueur ou au sommet de sa tête, côté créature ; seules les boîtes de collision coupent la ligne, un coup passe au-dessus d'un feu de camp ou d'un coffre, même joueur accroupi) ;
  - marqueur d'impact et arcs indiquant la direction des dégâts.

| Arme                                    | Dégâts        | Recharge | Portée |
| --------------------------------------- | ------------- | -------- | ------ |
| Main                                    | 2             | 0,4 s    | 3      |
| Flint Knife                             | 4             | 0,4 s    | 3      |
| Flint Spear                             | 6             | 0,8 s    | 4      |
| Hatchets flint / copper / bronze / iron | 4 / 5 / 6 / 8 | 0,6 s    | 3      |
| Blades copper / bronze / iron           | 7 / 9 / 12    | 0,5 s    | 3      |

**Objets au sol**

- Aimant à 1,6 m, fusion tous les 10 ticks, disparition après 5 min, 200 au maximum.
- Délai de reprise de 0,6 s **uniquement pour les objets jetés par un joueur** : un objet miné se ramasse tout de suite.
- Sauvegardés avec leur colonne ; minuteries rattrapées à la ré-entrée.

### Interface

Tous les textes ci-dessous sont en anglais dans le jeu (clés i18n, fichier `i18n.en.ts`).

**HUD** (disposition originale)

- **Bas gauche** : fioles de santé, faim et soif avec icônes, thermomètre avec tendance, toxicité si > 0, souffle sous l'eau.
- **Centre** : point de visée, arc d'endurance, anneau de minage, marqueur d'impact, arcs de dégâts.
- **Bas centre** : barre de 8 avec durabilité et touches.
- **Haut centre** : boussole (N/S/E/W, sac abandonné, soleil/lune), horloge « 07:30 · Day 1 », nom de la cible avec indice de palier.
- **Haut droite** : objectifs et leurs indices.
- **Droite** : effets actifs.
- **Gauche** : messages de ramassage.
- **Plein écran (CSS)** : vignettes de santé, givre, chaleur, toxicité, sous l'eau ; nom du biome à l'entrée.

**Écrans**

- **Bag** (E ou Tab) : une barre d'onglets, Inventory et Logbook (Quests, Bestiary et Status viendront avec M17 et M19), à côté du sac 6×4 et de la barre ; l'onglet choisi en dernier revient à l'ouverture (M13) :
  - **Inventory** : la silhouette et ses 5 emplacements, avec le détail des protections ;
  - **Logbook** :
    - recherche et filtre « Can craft now » ;
    - onglets, recettes à la main faisables en premier, les non découvertes grisées en bas ;
    - pastilles possédé/requis ;
    - boutons ×1/×5/Max, file de 5 ;
    - « N more at the Workbench » pour les recettes d'établi révélées.
- **Établi** (M13) : son Logbook (ses recettes et sa file), ses 4 cases de sortie, le sac et la barre.
- **Conteneur** : « Take all » / « Store all ».
- **Station** : entrées, combustible (flamme), progression, sortie, procédés connus ; l'interrupteur « Keep burning » du feu de camp (M12).
- **Manipulation** (M13, décision 20) : clic gauche pour prendre ou poser une pile, qui suit la souris sur le curseur ; clic droit pour en prendre la moitié (arrondie au-dessus) ou poser un seul objet ; Maj+clic pour transférer ; un clic hors du panneau jette la pile (gauche) ou un objet (droit) ; chiffre au survol pour échanger. Fermer l'écran range la pile du curseur dans l'inventaire.

**Menus**

- **Main** ; **Worlds** (cartes, Play, Delete avec confirmation, Export/Import) ; **New world** (nom, graine, hostiles oui/non) ; **Loading** ; « Click to play » ; **Pause** ; **Death**.
- **Settings** :
  - graphismes : préréglage, distance, FOV, résolution, particules, balancement ;
  - commandes : réassignation, sensibilité, inversion Y, accroupi maintenu ou bascule ;
  - audio : 4 bus ;
  - interface : échelle.
- Anglais seul en v1, donc pas de sélecteur de langue ; la structure i18n est prête pour le français.

**Prise en main**

- Au premier lancement, une carte des commandes avec les vraies étiquettes de touches du clavier du joueur.
- Indices contextuels :
  - premier E/Tab ;
  - premier minage (« Hold to mine ») ;
  - soif < 50 (« Right-click water to drink ») ;
  - premier crépuscule.
- Panneau d'objectifs.

**Écrans d'erreur**

- **Porte de capacités** avant le boot, qui vérifie :
  - un contexte WebGL2 avec `MAX_ARRAY_TEXTURE_LAYERS ≥ 256` ;
  - les workers de module ;
  - l'API Pointer Lock.
- Si une capacité manque : `#screen-unsupported`, qui conseille Chrome. Un appareil tactile sans souris reçoit un avertissement.
- `#screen-fatal` : bouton « Reload » et, si possible, « Export save ».
- IndexedDB indisponible → `MemoryStorage` et un bandeau « Saving unavailable ».
- Monde déjà ouvert dans un autre onglet (Web Locks) → message.
- Paramètres de test : `?forceNoWebGL=1` et `?forceNoIdb=1`.

**Debug**

- Touche **F3** (sur Mac : fn+F3), **Backquote** ou **IntlBackslash** (la touche @/# du Mac AZERTY) ; étiquette lue depuis la disposition.
- Panneau stylé propre au jeu, rafraîchi à 4 Hz : FPS, travail p95, temps par sous-système, draws, triangles, sections, files, position, biome, lumière, abri, températures, entités.

**Technique**

- TS vanilla + `ui/signals.ts` (signal, computed, effect, batch ; environ 80 lignes) + `h()`.
- Écrans construits une fois ; `UiBridge` rafraîchit à 10 Hz, et tout de suite sur un événement d'inventaire.
- Seules les variables CSS, `transform` et `opacity` changent ; pas de `backdrop-filter`.
- Jetons de thème depuis `palette.ts` ; police système.
- **i18n** :
  - `t()` avec `Intl.PluralRules` ; `fmt` s'appuie sur `Intl` et la locale du pack (`en`) ;
  - aucune chaîne en dur, pour que la future traduction française soit un simple fichier `i18n.fr.ts` ;
  - `i18nMissing()` vide dès M4.

**Entrées** : liaison par **position physique** (`KeyboardEvent.code`). Les mêmes touches physiques servent sur tous les claviers : ZQSD sur AZERTY correspond à WASD sur QWERTY. Seules les étiquettes affichées changent.

| Action                              | `code` (position physique)                     | Étiquette QWERTY  | Étiquette AZERTY                |
| ----------------------------------- | ---------------------------------------------- | ----------------- | ------------------------------- |
| Déplacement                         | KeyW/S/A/D                                     | W/S/A/D           | Z/S/Q/D                         |
| Saut / sprint / accroupi            | Space / ShiftLeft / KeyC                       | Space / Shift / C | Espace / Maj / C                |
| Miner-attaquer / utiliser-poser     | Mouse0 / Mouse2                                | Clics             | Clics                           |
| Barre                               | Digit1–8, molette                              | 1–8               | 1–8 (toujours des chiffres)     |
| Sac                                 | KeyE, ou Tab (comportement par défaut empêché) | E / Tab           | E / Tab                         |
| Jeter (Maj = pile entière) / caméra | KeyG / KeyV                                    | G / V             | G / V                           |
| Debug / pause                       | F3, Backquote ou IntlBackslash / Escape        | F3 ou ` / Esc     | F3 (fn+F3 sur Mac) ou @ / Échap |

- Saut maintenu : un saut à chaque retour au sol. Double appui sur « avancer » (≤ 300 ms) : sprint tant que la touche reste tenue (M12).
- Jamais lié : Ctrl, Cmd, Alt, F5, F11, F12.
- `contextmenu` empêché ; toutes les touches relâchées sur `blur`.
- **Étiquettes**, par ordre de préférence :
  1. `navigator.keyboard.getLayoutMap()` (Chrome : étiquettes exactes) ;
  2. table apprise depuis les `keydown` ;
  3. préréglage déduit de `navigator.language` (fr-FR et fr-BE : AZERTY ; fr-CH et de : QWERTZ) ;
  4. QWERTY.

**Pointer Lock**

1. Le clic appelle `requestPointerLock({ unadjustedMovement: true })`, puis réessaie sans options en cas de refus.
   - On gère une promesse **ou** `undefined`, plus l'événement `pointerlockerror`.
   - Ensuite `audio.resume()`.
2. Perte du verrou sans écran ouvert → pause.
3. Ouvrir le sac → le jeu appelle lui-même `exitPointerLock()` ; la sim continue.
4. Fermer un écran (sa touche, Échap, ou la sim qui le ferme) revient au jeu sans pause et re-verrouille. Si le navigateur refuse (Échap n'est pas un geste utilisateur), une simple invite « Click to resume » s'affiche et la simulation continue (M12).
5. Le premier mouvement et les sauts de plus de 400 px sont ignorés.
6. Pas de plein écran intégré en v1.
7. `?noLock=1` pour l'automatisation.

**Checklist d'originalité** (dans `CLAUDE.md`, relue en M1, M3, M4, M8 et M10)

- Pas de grille de craft 3×3 ni de barre à 9 cases.
- Pas d'icônes cœur ou cuisse : des fioles.
- Soleil et lune ronds.
- Palette propre (`palette.ts`), motifs d'herbe et de fissure propres.
- Avatar aux proportions humaines.
- Prowler bas et quadrupède, aux yeux ambrés.
- Overlay de debug en panneau stylé.
- Aucun nom de bloc, d'objet ou de créature des jeux de référence ; sons synthétisés.

### Sauvegarde

| Store     | Clé                   | Contenu                                                                                                                                             |
| --------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds`  | `id`                  | nom, graine, dates, `saveVersion`, `genVersion`, `contentHash`, `stateKeys[]`, tick, jour, états RNG, `nextEntityId`, apparition, règles (hostiles) |
| `players` | `[worldId, playerId]` | position, regard, stats, effets, inventaire et équipement (clés texte), craft, objets vus, réapparition, objectifs, `graves[]`                      |
| `columns` | `[worldId, cx, cz]`   | `{ v, codec: 'raw' \| 'deflate-raw', payload, blockEntities, entities (objets au sol + hardes), populated, lastTick }`                              |
| `kv`      | texte                 | dernier monde, divers                                                                                                                               |

- Base IndexedDB nommée `create-your-world`.
- **Contenu** : seules les sections `persisted`, en instantanés complets.
  - Le bit `persisted` d'une section est posé à l'édition, ou quand la section vient d'une sauvegarde.
  - L'enregistrement de colonne est toujours reconstruit à partir de **toutes** ses sections `persisted` : une nouvelle édition dans une autre section n'efface donc pas les anciennes.
- **Codec** (dans `io.worker`) :
  - par section : en-tête, palette `u16`, séries en varint ; une section uniforme pèse environ 6 octets ;
  - par enregistrement de colonne : sections concaténées, puis **un seul** deflate-raw ; on garde le brut si la compression n'est pas plus petite ;
  - une section typique pèse de 0,5 à 3 Ko.
- **Au chargement** : états remappés via `stateKeys` ; clés inconnues traitées comme décrit dans Gameplay.
- **Non sauvegardé** : lumière, maillages, terrain intact, hostiles.
- **Sauvegarde automatique** :
  - déclencheurs : toutes les 30 s, à la pause, en quittant, au déchargement d'une colonne modifiée ;
  - **onglet caché ou `pagehide`** : les enregistrements modifiés sont écrits tout de suite, en codec brut, dans une seule transaction ; ils seront recompressés à la sauvegarde suivante ;
  - procédure normale : tout encoder d'abord, puis **une seule** transaction d'écriture ;
  - le drapeau « modifiée » n'est effacé que si les versions n'ont pas changé entre-temps ;
  - quota plein → notification, et les données restent en mémoire ; autre erreur → nouvel essai avec un délai doublé ;
  - `storage.persist()` demandé à la création du monde ; `estimate()` affiché.
- **Verrou** : `navigator.locks` par monde ; un deuxième onglet reçoit un message.
- **Versions** :
  - une sauvegarde plus récente que le jeu est refusée ;
  - mondes et joueurs migrés immédiatement, colonnes migrées à la lecture ;
  - fixtures dans `tests/fixtures/saves/vN` ;
  - suppression d'un monde via `IDBKeyRange.bound([id], [id, []])`.
- **Export/import** en gzip, pour garder une copie hors du navigateur.
- **Réglages** : `localStorage`, clé `cyw.settings.v1`.

### Audio

- **Moteur** :
  - un `AudioContext`, repris au premier clic ;
  - toutes les recettes sont **pré-rendues** en `AudioBuffer` par `OfflineAudioContext` au démarrage (sinon après le premier clic) ;
  - 24 voix ; on vole d'abord la voix la moins audible (distance × gain), puis la plus ancienne ;
  - sons ponctuels en `PannerNode` equalpower, modèle **linéaire** de 2 à 32 m ; au-delà de 32 m, le son n'est pas joué ;
  - bus effets, ambiance et UI → master → compresseur ;
  - hauteur ±8 %, gain ±10 %, 30 ms au minimum entre deux mêmes sons ; passe-bas sous l'eau.
- **Environ 45 sons** :
  - blocs : casser, frapper, poser, pour 9 matériaux ;
  - joueur : pas, saut, atterrissage, eau, coups, manger, boire, blessure, cœur, mort ;
  - interface : ramassage (hauteur qui monte en série), craft, clics ;
  - créatures : 5 voix chacune ;
  - lieux : feu, four, porte, coffre ;
  - transitions de crépuscule et d'aube.
- **Ambiances** : fondus de 3 s selon le biome et l'heure (insectes, vent, sable, bulles, gouttes en grotte). Pas de musique.

## Contenu placeholder

Noms affichés en anglais dans le jeu (`i18n.en.ts`) ; la traduction française est indiquée entre parenthèses quand elle aide.

| Élément            | Quantité                            |
| ------------------ | ----------------------------------- |
| Blocs              | 53                                  |
| Objets             | environ 62, plus les objets de bloc |
| Recettes           | environ 40, plus 14 procédés        |
| Créatures          | 5                                   |
| Biomes             | 7                                   |
| Tables de butin    | environ 14                          |
| Structures         | 2                                   |
| Sons               | environ 45                          |
| Couches de texture | environ 140                         |
| Chaînes anglaises  | environ 480                         |

**Blocs**

| Famille                 | Blocs                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain                 | Worldrock (socle incassable), Stone, Darkstone (roche profonde), Cut Stone, Dirt, Grass, Sand, Ochre Sand, Ochre Sandstone, Gravel, Clay, Fireclay, Snow, Permafrost, Ice, Peat, Silt, Magma |
| Liquides                | Water, Foul Water (eau croupie)                                                                                                                                                              |
| Arbres et champignons   | Broadleaf Log, Foliage, Conifer Log, Needles, Giant Mushroom Stem, Glowcap                                                                                                                   |
| Plantes                 | Tall Grass, Shrub, Berry Bush, Thornbush, Palmthorn, Frost Lichen, Glowbloom                                                                                                                 |
| Minerais                | Copper Ore, Cassiterite, Bog Iron, Dawn Crystal                                                                                                                                              |
| Construction et lumière | Planks, Bricks, Fire Bricks, Glass, Torch, Glowbloom Lantern                                                                                                                                 |
| Stations et mobilier    | Campfire, Workbench (établi), Clay Kiln (four), Bloomery (bas fourneau), Chest, Gate, Bedroll (natte), Abandoned Pack (sac abandonné)                                                        |
| Techniques              | air, Unknown Block                                                                                                                                                                           |

**Objets**

| Famille      | Objets                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matériaux    | Stick, Plant Fiber, Cord, Flint, Stone Shard, Resin, Raw Hide, Leather, Fur, Clay Lump, Copper / Bronze / Iron Ingot, Charcoal, Shell Plate, Toxic Gland, Prowler Sinew, Crystal Shard |
| Outils       | Flint Knife, Flint Hatchet, Flint Pickaxe, Flint Spear ; hachette, pioche et lame en Copper, Bronze et Iron                                                                            |
| Équipement   | Leather Tunic, Leather Leggings, Fur Hood, Fur Coat, Straw Hat, Fiber Veil, Filter Mask, Waxed Boots, Bronze Helmet, Bronze Cuirass, Shell Cuirass                                     |
| Consommables | Berries, Raw Meat, Grilled Meat, Palmthorn Fruit, Bandage, Antidote Tea                                                                                                                |
| Récipients   | Unfired Flask ; Clay Flask (empty, Raw Water, Boiled Water, Foul Water ; 3 charges) ; Leather Waterskin (mêmes états ; 6 charges)                                                      |
| Techniques   | Unknown Item                                                                                                                                                                           |

**Biomes** (températures jour/nuit)

| Biome              | Climat    | Danger      | Ressources             |
| ------------------ | --------- | ----------- | ---------------------- |
| Meadow (prairie)   | 22/12 °C  | aucun       | cuivre, silex          |
| Forest             | 20/11 °C  | aucun       | bois, baies            |
| Highlands          | 12/2 °C   | froid léger | —                      |
| Tundra (nord)      | −6/−16 °C | froid       | cassitérite, fourrure  |
| Ochre Desert (sud) | 44/8 °C   | chaleur     | argile réfractaire     |
| Fungal Marsh       | 24/16 °C  | toxicité    | fer des marais, tourbe |
| Lake Basin         | 18/10 °C  | —           | argile, silex          |

**Progression**

| Étape           | Contenu                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mains nues      | fibres (Tall Grass, 60 %), bâtons, silex (Gravel, 35 %), baies, mottes d'argile                                                                         |
| Craft à la main | cordelette, outils de silex, torches, feu de camp, planches, Unfired Flask, établi (8 planches + 4 fibres)                                              |
| Établi          | coffre, portillon, natte, outre, cuir (2 peaux + résine), four, Cut Stone                                                                               |
| Cuivre          | minerai fondu au four → outils (lingots + bâtons + cuir)                                                                                                |
| Bronze          | cassitérite (**toundra**, au nord) + cuivre ; les outils demandent un **Prowler Sinew** (chasse de nuit, ou cairns en monde sans hostiles)              |
| Fer             | fer des **marais** fondu au bas fourneau ; celui-ci exige des briques d'**argile du désert** (au sud) et 2 bronze, ce qui oblige à visiter les 3 biomes |

**Schéma** (extrait de `src/content/schema.ts`)

```ts
export type Tier = 0 | 1 | 2 | 3 | 4;
export type Box16 = readonly [number, number, number, number, number, number]; // x0 y0 z0 x1 y1 z1, in 1/16 block
export interface LiquidDef {
  drinkable: boolean;
  thirstPerSip: number;
  toxicityPerSip: number;
  fills: Partial<Record<ItemKey, ItemKey>>;
} // empty container → filled
export interface BlockDef {
  key: BlockKey;
  nameKey: PackI18nKey;
  shape: 'cube' | 'cross' | 'liquid' | 'none' | { boxes: readonly Box16[] };
  pass: 'opaque' | 'cutout' | 'translucent' | 'invisible';
  cullGroup?: string;
  textures: Partial<Record<'all' | 'top' | 'bottom' | 'side' | 'front', TexKey>>;
  tint?: 'grass' | 'foliage' | 'water';
  collision: 'full' | 'none' | 'liquid' | { boxes: readonly Box16[] };
  opaque: boolean;
  replaceable?: boolean;
  light?: { emit?: number; filter?: number };
  friction?: number;
  contact?: { toxicityPerMin?: number; damagePerSec?: number };
  liquid?: LiquidDef;
  hardness: number;
  tool?: ToolKind;
  minTier?: Tier;
  drops: LootKey | 'self' | 'none';
  states?: readonly StateProp[]; // axis, facing4, open, lit, half, ripe
  whenState?: Partial<Record<'lit' | 'open' | 'ripe', BlockOverride>>; // emit, heat, collision, light, textures
  heat?: { celsius: number; radius: number };
  blockEntity?: 'container' | 'station' | 'grave' | 'bed';
  station?: StationKey;
  placement?: { support?: 'below' | 'face'; orient?: 'axis' | 'facing'; tall?: 2 };
  sound: SoundMaterial;
}
export interface ItemDef {
  key: ItemKey;
  nameKey: PackI18nKey;
  icon: TexKey | { block: BlockKey };
  maxStack: number;
  tags?: readonly TagKey[];
  tool?: { kind: ToolKind; tier: Tier; speed: number; durability: number };
  weapon?: {
    damage: number;
    cooldown: number;
    reach: number;
    knockback: number;
    durability?: number;
  }; // durabilité d'une arme qui n'est pas un outil (couteau, lance, lames : celle de leur palier)
  wear?: {
    slot: 'head' | 'face' | 'body' | 'legs' | 'feet';
    armor?: number;
    warmth?: number;
    cooling?: number;
    airFilter?: number;
    waterproof?: boolean;
    durability: number;
  };
  consume?: {
    seconds: number;
    hunger?: number;
    thirst?: number;
    health?: number;
    toxicity?: number;
    returns?: ItemKey;
  };
  container?: { charges: number; contents: 'empty' | 'raw' | 'boiled' | 'foul'; emptyAs: ItemKey };
  fuel?: { seconds: number; charcoal?: boolean };
}
export interface CreatureDef {
  key: CreatureKey;
  nameKey: PackI18nKey;
  model: ModelKey;
  hitbox: [number, number];
  health: number;
  speed: { walk: number; run: number };
  brain: 'grazer' | 'defender' | 'stalker' | 'swarmer' | 'charger';
  category: 'passive' | 'defensive' | 'territorial' | 'hostile';
  attack?: {
    damage: number;
    reach: number;
    windup: number;
    cooldown: number;
    knockback: number;
    toxicity?: number;
  };
  senses: { sight: number; fovDeg: number; hearing: number };
  traits?: {
    watchedSpeedMul?: number;
    lightAversion?: number;
    burrowAtDawn?: boolean;
    frontArmor?: number;
    wallStunSec?: number;
  };
  spawn: readonly {
    biomes: readonly BiomeKey[] | '*';
    when: 'day' | 'night' | 'any';
    where: 'surface' | 'cave';
    maxLight?: number;
    group: [number, number];
    weight: number;
  }[];
  loot: LootKey;
  sounds: Partial<Record<'idle' | 'alert' | 'hurt' | 'attack' | 'death', SfxKey>>;
}
```

| Type                          | Champs                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecipeDef`                   | key, category, station?, seconds, inputs [{item ou tag, count}], output {item, count}, known?: 'start', hintKey?                                                                                  |
| `ProcessDef`                  | key, station, seconds, fuel: 'any' \| 'charcoal' \| 'none', inputs, output                                                                                                                        |
| `StationDef`                  | key, inputSlots, fuelSlot, outputSlots, burns?: boolean, keepLit?: boolean                                                                                                                        |
| `BiomeDef`                    | key, nameKey, rule {order, conditions sur C/E/M/T/H/X et h}, climate {dayC, nightC}, toxicity? {day, night}, surface, filler, liquid, tints, fog, ambience, features [{feature, weight}], hintKey |
| `WorldgenDef`                 | seaLevel, bedrockY, deepStoneBelowY, magmaBelowY, splines C et E, échelles de bruit, bande de latitude {amplitude, period}, seuils des grottes                                                    |
| `OreDef`                      | key, block, biomes, yRange, veinsPerSection, veinSize, replaces                                                                                                                                   |
| `FeatureDef`                  | key, kind 'tree' \| 'mushroom' \| 'boulder' \| 'plant', blocs, rayon ≤ 7, paramètres                                                                                                              |
| `StructureDef`                | key, biomes, chance, template (couches en grilles de caractères), legend → clés d'état, lootTables                                                                                                |
| `LootTableDef`                | key, rolls [min, max], entries [{item, count [min, max], weight}]                                                                                                                                 |
| `ObjectiveDef`                | key, textKey, hintKey?, compass? ('north' \| 'south' \| …), condition en données (hasItem, placed, surviveNight, reachBiome…)                                                                     |
| `ModelDef`                    | key, parts [{name, box, pivot, parent?, texture}], gait 'biped' \| 'quadruped' \| 'hexapod', stride, idle                                                                                         |
| `TierDef`                     | tier, nameKey                                                                                                                                                                                     |
| `TextureRecipe` / `SfxRecipe` | motif ou type de synthèse, palette ou paramètres, graine, drapeaux émissif et teinte                                                                                                              |
| `PackManifest`                | id, version, locale ('en'), textureSize (16), bindings {air, unknownBlock, unknownItem, grave, avatarModel, spawnBiomes, startObjectives}                                                         |

**Exemples de données**

```ts
{ key: 'block:kiln', nameKey: 'block.kiln', shape: 'cube', pass: 'opaque', opaque: true, collision: 'full',
  textures: { side: 'tex:kiln_side', top: 'tex:kiln_top', front: 'tex:kiln_front' }, hardness: 2.5, tool: 'pick', minTier: 1,
  drops: 'self', states: ['facing4', 'lit'], blockEntity: 'station', station: 'station:kiln', placement: { orient: 'facing' },
  whenState: { lit: { emit: 12, heat: { celsius: 15, radius: 3 }, textures: { front: 'tex:kiln_front_lit' } } }, sound: 'stone' },
{ key: 'block:fresh_water', nameKey: 'block.fresh_water', shape: 'liquid', pass: 'translucent', cullGroup: 'water', opaque: false,
  collision: 'liquid', light: { filter: 2 }, tint: 'water', textures: { all: 'tex:water' }, hardness: 0, drops: 'none', sound: 'water',
  liquid: { drinkable: true, thirstPerSip: 8, toxicityPerSip: 2, fills: { 'item:flask_empty': 'item:flask_raw' } } },
{ key: 'item:fur_coat', nameKey: 'item.fur_coat', icon: 'tex:icon_fur_coat', maxStack: 1, wear: { slot: 'body', armor: 2, warmth: 10, durability: 400 } },
{ key: 'process:bronze_ingot', station: 'station:kiln', seconds: 15, fuel: 'any',
  inputs: [{ item: 'item:copper_ingot', count: 3 }, { item: 'item:tin_ore', count: 1 }], output: { item: 'item:bronze_ingot', count: 3 } },
// i18n.en.ts (as const → PackI18nKey)
'block.kiln': 'Clay Kiln', 'item.fur_coat': 'Fur Coat', 'creature.prowler': 'Prowler',
'biome.fungal_marsh': 'Fungal Marsh', 'death.cause.cold': 'Froze to death', 'hud.day': 'Day {n}',
```

**Preuve que le jeu se re-thématise (décision 5)** : la fixture `tests/content/altPack/` a d'autres clés, noms et palette, 3 biomes et 2 créatures. Elle doit passer `validate`, générer des colonnes sans interface et tenir 1 000 ticks.

## Jalons

**Protocole commun à chaque jalon**

1. Branche `claude/mN-<sujet>` créée depuis `main` à jour.
2. `npm run verify` vert.
3. `game-dev` démarré dans le navigateur intégré. Dans la page : `await __game.ready()`, `__game.errors().length === 0`, et aucune erreur dans le log du serveur.
4. `?selftest=mN` affiche `SELFTEST PASS n/n`, et les suites des jalons précédents restent vertes.
5. Captures d'écran prises et relues.
6. Dès M2 :
   - `npm run test:perf` vert ;
   - sur `game-bench`, les seuils de perf du jalon (voir Vérification) ;
   - `npm run e2e` vert.
7. Dès M4 : `__game.ui.i18nMissing()` vide.
8. Section « Try this milestone » du README mise à jour.
9. Checklist d'originalité relue en M1, M3, M4, M8 et M10.
10. Revue adversariale du jalon, puis corrections et nouvelle vérification :
    - lentilles : exactitude, conformité à la spec, performance et outillage, et **KISS/DRY/SRP** ;
    - une **deuxième passe** sur le commit de corrections : régressions, et corrections réellement complètes ;
    - chaque correction confirmée vient avec un test qui échoue sans elle.
11. Push et PR ; CI verte ; squash-merge ; compte rendu en français.

`B` désigne `http://localhost:5173/?seed=42&storage=memory&noLock=1&debug=1`.

**Ce que montre `http://localhost:5173/` à chaque étape**

- M0 : titre et cube.
- M1 : chunk de test.
- M2 : survol libre du terrain, sur une graine aléatoire.
- M3 à M6 : nouveau monde à graine aléatoire, puis « Click to play ».
- Dès M7 : menu principal.

### M0 — Échafaudage

- **Livrables** :
  - dépôt : `git init -b main`, `origin`, commit d'amorçage poussé sur `main`, puis branche `claude/m0-scaffold` ;
  - configs (package.json, 6 fichiers tsconfig, vite, biome, launch.json, .gitignore) et CI `.github/workflows/ci.yml` ;
  - `CLAUDE.md`, `docs/conception.md`, `README.md` ;
  - `index.html`, avec un favicon en data URI ;
  - `main.ts`, la porte de capacités, `#screen-unsupported` et `#screen-fatal`, `App` ;
  - `Renderer` et un cube en `sampler2DArray` (3 motifs procéduraux) ;
  - `t()` + en ; `debugHook`, avec un compteur de FPS minimal ; `bootParams` ;
  - `world.worker` + `WorkerPool` (ping) via l'adaptateur `WorkerPort` ;
  - core rng/hash/log ; tests rng et boundaries (dont le test du vérificateur) ; `tools/headless.ts`.
- **Fait quand** :
  - `npm install` passe, et `verify` est vert (sinon, passer à TS ~6.0.3) ;
  - `npm run headless -- --ping` affiche du JSON ;
  - avec `B` : `__game.workers.ping() === 'pong'`, capture du cube et du titre, FPS ≥ 55 ;
  - `?forceNoWebGL=1` affiche `#screen-unsupported` ;
  - `grep -rl __game dist --include='*.js'` ne trouve rien, et `dist/` ne contient que du html, du js et du css ;
  - la CI passe sur la première PR, qui est mergée.

### M1 — Cœur voxel

- **Livrables** :
  - schéma, registre (ids d'états aplatis, tables brutes), validateur, pack de 20 blocs ;
  - `Section`, `Column`, `ColumnSlots`, `VoxelWorld` ;
  - mailleurs (glouton + formes, 3 passes), matériau complet ;
  - caméra libre, `scene=testchunk`, overlay de debug v0, vues `quads` et `ao`.
- **Fait quand** :
  - tests :
    - clés négatives ; promotion uniforme, des blocs et de la lumière séparément ;
    - tables brutes (porte, four) ; fixture cassée → chemin exact de l'erreur ; aller-retour JSON ;
    - goldens de maillage : 1 cube = 6 quads, dalle 32×1×32 = 6, deux blocs différents = 10, AO en L, diagonale, eau/eau, plante = 2 ;
    - **fusion == sans fusion** par échantillonnage, lumière lissée comprise ;
    - pack/unpack, hash des textures ;
  - navigateur, `B&scene=testchunk&freecam=1` : draws = nombre de passes non vides, `capture().uniqueColors > 24`, vue `quads` sans fissures ;
  - checklist d'originalité (textures), et je te montre une capture pour avoir ton avis sur le style.

### M2 — Terrain et streaming

- **Livrables** :
  - génération v1 (climat, latitude, hauteur, 7 biomes de surface, eau, arbres), `GEN_VERSION 1`, point d'apparition provisoire ;
  - protocole, jobs, pool (2 files, versions, relance) ;
  - squelette de `Simulation` + `LocalSimHost` + boucle 30 Hz ; streaming piloté par `client.view` ;
  - `MeshScheduler` et `ChunkMeshes` ; ciel et brouillard ;
  - `perf.ts`, `pump`, `waitForChunks`, tests de perf, build bench, Playwright et job e2e en CI.
- **Fait quand** :
  - tests :
    - goldens (graine 1337) ; requêtes ponctuelles == génération en masse ; arbres indépendants de l'ordre ;
    - recensement de 4 096 échantillons analytiques `biomeAt()` : chaque biome ≥ 3 %, marais entre 5 et 20 % ;
    - pool avec un faux worker ;
    - perf Node : génération ≤ 10 ms et maillage ≤ 3 ms (médianes) ;
  - sur bench, `/?seed=1&skipMenu=1&rd=6&freecam=1` :
    - rayon 3 en moins de 3 s et RD 6 en moins de 5 s (`waitForChunks`) ;
    - `benchmark('fly')` : travail p95 ≤ 11 ms ;
    - `voxelBytes` ≤ 140 Mo (médiane de 3 trajets de 2 km) ;
    - `memory.geometries` revient à sa valeur après RD 6 → RD 2 ;
    - `genHash(3,-2)` identique à Node ;
  - le premier spec e2e vérifie WebGL2, en local et en CI.

### M3 — Simulation, joueur et caméras

- **Livrables** :
  - `Simulation` complète, `SerializingSimHost`, entités et hachage spatial, physique ;
  - entrées par position physique et étiquettes de touches, Pointer Lock ;
  - caméras 1re et 3e personne, avec collision ;
  - `BoxBatch`, avatar et `rigs` (repos, marche/course, accroupi, saut/chute, nage) ;
  - `fixedStep`, `worldType=flat`, bots, headless ; endurance (sprint, saut).
- **Fait quand** :
  - tests :
    - physique : apogée 1,26 ± 0,02 au tick 9, murs, plafond, bord, nage, coyote ;
    - raycast ;
    - endurance : sprint −10/s, saut −5, régénération 25/s après 0,8 s, épuisement jusqu'à 30 ;
    - étiquettes : `KeyW` donne « W » en QWERTY et « Z » en AZERTY, pour la même action ;
  - même hash sur deux exécutions, et via `SerializingSimHost` ;
  - `npm run headless -- --seed=42 --ticks=3000 --bot=wander` stable ;
  - navigateur, `B&worldType=flat&skipMenu=1&fixedStep=1&spawns=0` :
    - `teleport(0.5,80,0.5); sim.step(120)` → y = 65,00 ± 0,01, au sol ;
    - `press('forward',60)` → 8,6 ± 0,9 m ;
    - un `KeyboardEvent({code:'KeyW', key:'z'})` (AZERTY) et un `KeyboardEvent({code:'KeyW', key:'w'})` (QWERTY) font tous deux avancer ;
    - `render.rig('player')` : balancement des membres > 20° après `press('forward',30)`, < 2° à l'arrêt ; l'accroupi abaisse le pivot de la tête ;
    - avec un mur à 2 m derrière, `camera().distance < 2` ; `KeyV` bascule `camera().mode` ;
    - capture en 3e personne ;
    - téléport à 4 000 blocs : colonne LIT et rayon 3 maillé en moins de 3 s ;
  - checklist d'originalité (avatar), et une capture pour ton avis.

### M3.5 — Passe KISS/DRY/SRP (branche `claude/m3.5-structure`)

But : appliquer la décision 12 au code de M0–M3 **sans changer le comportement** avant que M4 ne s'appuie dessus. Les cibles viennent d'un audit en lecture seule du code, classées par valeur.

- **SRP de la simulation** : `src/sim/Simulation.ts` (525 lignes) est découpé.
  - `sim/ColumnPipeline.ts` reçoit les vues, arrivées, états GENERATED/LIT/MESHABLE, show/hide, stream et unload, avec un seul `anyViewWithin()` à la place des trois boucles quasi identiques.
  - `sim/commandRules.ts` reçoit la validation des commandes et un `reject(out, playerId, type, reason)` qui remplace les 7 littéraux.
  - `sim/debugCommands.ts` reçoit fill, teleport et setStat.
  - `stepPlayer` passe dans `player.ts` ; un `resetBody()` sert à `createBody` et à la téléportation.
  - `Simulation` ne garde que l'ordre du tick et l'état.
- **Ports et hôtes** :
  - `connect(sink)` entre dans le port `ColumnSource` et est appelé par le constructeur de `Simulation` (plus de câblage manuel dans `GameSession`, `runBot` et les tests) ;
  - `generateResult()` dans `world/` est partagé par `InlineColumnSource` et `workers/worldJobs.ts` ;
  - `SerializingSimHost` reçoit un helper `relay()` ; `canPause`, jamais lu, est retiré ;
  - `createLocalServer()` construit `Simulation` + joueur + hôte autour d'une source de colonnes injectée (la couche `sim` ne peut pas importer `platform`, où vit `WorkerColumnSource`). Le client ne lit plus que `host.view` (avec `spawn`), jamais `sim` directement (préparation coop).
- **App** :
  - un seul `app/automation.ts` (`nextFrame`, `yieldTask`, `waitUntil(cond, {timeout, label})`, `waitForChunks`, `teleport`, `fill`) partagé par `debugHook.ts` et les autotests ;
  - une fabrique `noErrorsCase()` remplace les 4 cas copiés ;
  - dans `GameSession`, un `afterTicks(budgets)` privé remplace la fin dupliquée de `frame`, `step` et `pumpOnce` ;
  - dans `App`, `mountDebug()` et `runSceneLoop()` sont communs aux scènes, le câblage pause/Pointer Lock va dans `app/playGate.ts`, et les lignes de l'overlay dans `app/debugLines.ts`.
- **Helpers du monde** :
  - `coords.ts` gagne `blockToColumn`, `columnIndex` et `sectionKeyParts` (8 copies de `toColumn(Math.floor())`, 5 encodages de `x | z << 5`) ;
  - `world/light.ts` contient `skyOf`, `blockOf` et `FULL_SKY` ;
  - un `faceW1()` dans le mailleur ; `internBoxes()` et `textureSets()` dans le registre ;
  - le validateur est découpé par section ;
  - les constantes copiées (hauteurs d'œil, emplacements de barre, `QUAD_WORDS`) sont importées de leur seule source.
- **FreeCam** piloté par les actions d'`InputManager` (fin des écouteurs dupliqués).
- **Fonctions longues** (KISS) : `stepBody` découpé en phases (accroupi, horizontal, saut/gravité, Y, X/Z) et `meshCubes` en `buildSliceMask` + `mergeSlice`. Ce sont des fonctions statiques sur les tampons de module existants : toujours zéro allocation, sans perte de perf.
- **Tests** : `tests/helpers/` contient `registry`, `flatWorld` et `simHarness` ; `runBot` utilise le même harnais.
- **Code mort retiré** : `noise3`, `withinRadius` et le champ `light` de `streamRadii`, `SEA_LEVEL`, `PASS_COUNT`, `setLocale`/`hasString`. `ColumnSlots` reste pour M5.
- **CLAUDE.md** reçoit les principes KISS/DRY/SRP et les nouveaux emplacements des helpers.
- **`docs/conception.md`** est remplacé par cette version du plan (décisions 12 à 14, M3.5, exécution autonome).
- **Fait quand** :
  - `verify`, perf, slow et e2e verts, et les autotests m0–m3 verts ;
  - **même hash** pour `npm run headless -- --seed=42 --ticks=3000 --bot=wander` avant et après, et goldens de génération inchangés (`GEN_VERSION` reste 1) ;
  - bench `fly` p95 pas plus de 10 % au-dessus de la mesure avant refactor ;
  - aucun fichier de `src` au-delà d'environ 400 lignes, sauf justification en commentaire ;
  - la lentille KISS/DRY/SRP de la revue ne confirme plus de remarque de valeur élevée.

### M4 — Minage et construction

- **Livrables** :
  - interaction : progression, règles d'outils, pose, fantôme, répétition, table de priorité ;
  - surlignage et fissures (8 stades) ; objets au sol ;
  - modèle d'inventaire, barre et sac de base ;
  - vue en main, animations de frappe et objet tenu ; particules de base ;
  - file urgente et échange atomique des maillages ;
  - `AudioEngine` et sons de base ; monde `arena` ; outils de silex (sans recettes).
- **Fait quand** :
  - tests :
    - temps de cassage : terre 0,75 s ; bûche 3 s à la main et 1,5 s à la hachette ; pierre sans butin à la main ;
    - refus `occupied`, `reach` et `support` ;
    - inventaire, objets au sol ;
  - navigateur sur `worldType=flat` :
    - `look(0,-90); press('primary',60)` → air dessous et 1 Dirt dans l'inventaire ; compteur HUD « 1 » ;
    - la pose secondaire fonctionne ;
    - `editToMeshMs` ≤ 50, et `sectionVersionLag() === 0` en 3 images au plus ;
    - rig en pose de frappe pendant `primary` ;
    - capture des fissures ;
    - `audio.log()` contient `sfx:break_soil` ;
    - `i18nMissing()` vide ;
  - checklist d'originalité (HUD, barre, sac).

### M5 — Lumière et temps

- **Livrables** :
  - `columnLight` ; `LightEngine` (slots, files encodées, compteurs d'entrées en attente) ;
  - état LIT réel, lumière lissée, torches ;
  - `time.ts`, palette jour/nuit, brouillard sous l'eau, vue `light`.
- **Fait quand** :
  - tests :
    - torche = 14 − distance, retrait → 0 ; surplomb → 14 ; puits garde 15 ;
    - 2×2 cousu == BFS de référence ; découpage == un seul passage ;
    - une édition en bord remaille le voisin ; porte ; feuilles ;
    - LIT seulement sans entrée en attente ;
  - navigateur :
    - luminance à 12 h ≥ 2,5 × celle de 0 h ;
    - cavité scellée : ciel 0 ; torche 14, et 11 à 3 blocs ;
    - `step(1500)` = +1 h ;
    - vue `light` continue ;
    - ≤ 400 draws.

### M6 — Sous-sol et décor

- **Livrables** :
  - grottes, magma, minerais par biome, décor complet, campements et cairns ;
  - point d'apparition définitif, extras de biome, toutes les textures ;
  - `GEN_VERSION 2`, `findBiome`, `findStructure`, vue `xray`.
- **Fait quand** :
  - nouveaux goldens ;
  - minerais seulement dans la pierre, et à au moins 2 blocs du bord de section ;
  - pas de grotte sous l'eau ; grottes sous au moins 40 % des colonnes ; troncs soutenus ;
  - graines 1 à 20 : biomes dangereux à 1 km au plus de l'apparition ;
  - génération ≤ 10 ms ;
  - captures de chaque biome (`findBiome` + téléport), d'une vue `xray`, d'un campement et d'un minerai lumineux.

### M7 — Sauvegarde et menus

- **Livrables** :
  - codec et migrations ; `io.worker` et `idbStore` ; proxy `IdbStorage` ; `MemoryStorage` ;
  - persistance avec remappage ; `SaveManager` (toutes les 30 s, et à la sortie de l'onglet) ;
  - verrou de monde ; repli « Saving unavailable » ; export/import ;
  - menus, réglages de base.
- **Fait quand** :
  - tests :
    - codec sur 1 000 sections : uniforme ≤ 6 octets avant compression ; enregistrement brut si deflate n'est pas plus petit ;
    - deflate sous Node, remappage des états, migration v1, fake-indexeddb, drapeaux versionnés ;
    - **colonne rechargée → édition d'une autre section → sauvegarde → rechargement : les deux éditions sont présentes** ;
    - **sauver → recharger → reprendre** = même hash de l'état persistant (`spawns=0`, ticks 1 500 → 3 000) ;
    - objets au sol conservés ;
  - navigateur avec `storage=idb` :
    - monde créé par clics, 3 éditions et 1 objet jeté ; `save.now(); save.reload()` → tout est restauré (± 0,01) ;
    - suppression du monde → `inspect()` à 0 ;
    - réglages persistés ; export puis import identiques ;
    - un deuxième onglet sur le même monde reçoit un message ;
    - avec `forceNoIdb=1`, le bandeau s'affiche et la partie reste jouable.

### M8 — Objets, Logbook et stations

- **Livrables** :
  - objets et recettes de tous les paliers ; crafting ; stations (rejeu plafonné) ; coffres ;
  - sac complet et Logbook ; écrans Conteneur et Station ; icônes ;
  - atteignabilité pour chaque règle de monde ; persistance étendue ; clés inconnues.
- **Fait quand** :
  - tests :
    - 1 000 opérations d'inventaire conservent les totaux ; 70 objets → [64, 6] (piles de 64 depuis M13) ;
    - craft : réservation, remboursement, établi, révélation dès qu'un ingrédient est vu ;
    - stations : alliage, pause, rejeu == tick par tick ;
    - conteneur cassé ;
    - atteignabilité jusqu'au fer, hostiles activés **et** désactivés ;
    - un objet inconnu au chargement devient `item:unknown` en gardant sa clé ;
  - navigateur sur `arena` :
    - clic sur « Flint Hatchet » puis `step(90)` → obtenue ; la bûche se casse au moins 1,9 fois plus vite ;
    - four → `ui.screen() === 'station'` ; minerai et combustible posés au clic (glisser-déposer avant M13) puis `step(330)` → un lingot ;
    - le coffre survit à `reload()` ; la porte fonctionne ;
    - `i18nMissing()` vide ;
  - checklist d'originalité (Logbook, écrans).

### M9 — Survie et dangers

- **Livrables** :
  - survival, environment, shelter ; eau potable (gorgée, remplissage, ébullition) ; consommables, équipement ;
  - HUD complet ; mort, Abandoned Pack et réapparition ; natte et sommeil ;
  - objectifs et indices.
- **Fait quand** :
  - tests d'équilibrage, calculés depuis `balance.ts` :
    - faim 25 min ± 1 %, soif 16 min, mort inactive entre 18 et 26 min ;
    - toundra : Cold à 2,5 ± 0,3 min, Freezing à 4,4 ± 0,5 ; en fourrure, jamais Freezing ;
    - désert : 4,4 ± 0,5 min ;
    - marais : Nauseous à 8,75 ± 1 min de jour ; avec masque, plus de 40 min ;
    - chute de 10 blocs = 39 ± 1 PV ; endurance ;
  - fixtures d'abri : fermé, toit troué, fenêtre ouverte, toit de verre fermé, abri sans murs = couvert, plein champ ;
  - navigateur :
    - toundra, `time.set(23)` puis `step(5400)` → ≤ −40 et Cold ;
    - cabane avec feu → `shelter === 'enclosed'` et température ≥ −10 ;
    - marais à midi (`freezeTime`), `step(9000)` → toxicité 20 ± 2, ≤ 3,3 avec masque ;
    - gorgée au lac → soif +8 ; gourde remplie → « Raw Water » ×3 ; feu de camp → « Boiled Water » ;
    - `#screen-death`, puis réapparition correcte ; le marqueur du sac est conservé après `reload()` ;
    - sommeil → 06:00 ;
  - ta première partie test de 10 min (facultative à ce stade).

### M10 — Créatures et combat

- **Livrables** :
  - modèles et animation ;
  - cerveaux `grazer`, `defender`, `stalker`, `swarmer`, `charger` ; sens ; A* ;
  - apparition et disparition ; hardes persistées ;
  - combat (attaque chargée, furtive) ; butin ; sons ; escalade nocturne.
- **Fait quand** :
  - tests :
    - A* : mur, marche, chute ≤ 3, passage d'un bloc refusé, chemin partiel, lumière évitée, table jamais saturée ;
    - apparitions : aucune si la lumière est ≥ 5, plafonds, période de grâce ;
    - formules de combat, cerveaux ;
    - 60 créatures en un tick ≤ 3 ms (Node) ;
  - navigateur, `time=23&spawns=0` :
    - Prowler placé à 10 blocs face au joueur → santé < 100 en 300 ticks ;
    - Trotter : premier coup de lance furtif = 9 dégâts (6 sans furtivité) ; tué, il laisse viande et peau ;
  - navigateur, `spawns=1&grace=0` :
    - au moins 3 hostiles en 3 600 ticks la nuit ;
    - chaque entrée de `spawnLog` a une lumière effective ≤ 4, et aucune n'est à une distance de Manhattan ≤ 9 d'une torche ;
    - à midi : 0 hostile en surface sur 3 600 ticks ;
  - `benchmark('mobs')` : tick p95 ≤ 1,5 ms ; capture en 3e personne avec des créatures ;
  - checklist d'originalité (créatures), et des captures pour ton avis.

### M11 — Finition et performance

- **Livrables** :
  - audio complet (environ 45 sons, ambiances) ; réglages complets (réassignation) ;
  - culling des grottes ; passe de performance ;
  - particules et vue en main finalisées : éclats colorés par matériau, poussière, traînée d'attaque, inertie de la vue en main ;
  - prise en main (carte des commandes, indices contextuels) ; objectifs jusqu'au fer ;
  - autotests m0 à m11 consolidés ; 4 specs e2e et un spec de perf ; README complet.
- **Fait quand** :
  - `?selftest=all` → 0 échec, et `npm run e2e` vert ;
  - sur bench, RD 6, préréglage Medium :
    - `walk` : travail p95 ≤ 9 ms et moins de 1 % d'intervalles > 20 ms ;
    - `cave` : ≤ 150 draws ;
    - culling des grottes : −30 % de draws sous terre par rapport à `occlusion=0`, à la même pose ;
    - `dig` : édition → maillage ≤ 50 ms p95 ;
    - chargement (navigation → « Play » actif) ≤ 3 s ; JS gzip ≤ 400 Ko ;
  - CPU ralenti ×1,7 (Playwright) : travail p95 ≤ 15 ms ;
  - `audio.log()` contient les sons attendus ; la réassignation est persistée ;
  - un bot `wanderMineBuild` tourne 5 min dans le navigateur → `errors()` vide ;
  - un parcours scripté (téléports et actions réelles via `__game`) valide chaque objectif dans l'ordre ;
  - la carte des commandes s'affiche au premier lancement ; les indices contextuels apparaissent (premier E, premier minage, premier crépuscule) ;
  - vérification rapide dans Safari (installé) : si le comportement est identique, il est supporté ; sinon, je note les écarts et ne les corrige que s'ils sont simples ;
  - ta partie test de 10 min (et `?bench=walk` sur un M1 ou un PC à GPU intégré, si tu en as un).
- **Retenu à l'intégration** :
  - les specs e2e sont `boot`, `selftest`, `saves` et `input`, plus `perf` (bench, en local) ;
  - `selftest.spec.ts` lance `?selftest=all` dans 8 configurations (scène de test ; monde généré en temps réel, en caméra libre, en pas fixes avec IndexedDB ; monde plat avec IndexedDB, sans IndexedDB, avec apparitions naturelles ; arène) : aucun échec, et chaque cas doit avoir tourné, non sauté, dans au moins une ;
  - un cas appartient à sa configuration par `scenes` et `skip` ; m7 finit sur l'écran Worlds, donc les cas de jeu suivants sautent dans ce démarrage ; le parcours des objectifs repart d'un nouveau monde de la même graine si des objectifs sont déjà faits ;
  - le bot `wanderMineBuild` de 5 min tourne en pas fixes dans `boot.spec.ts`, en local seulement (trop long en rendu logiciel) ; la CI joue la minute du cas m11 ;
  - le parcours des objectifs (`sim/testing/objectiveWalk.ts`) obtient par des actions réelles chaque objet qu'un objectif nomme et que le monde fournit : fibres, bâtons et silex cassés (clic principal maintenu, le bon outil en main) dans les hautes herbes, le feuillage et le gravier, puis ramassés en marchant dessus (un téléport sur l'objet quand la marche n'y mène pas) ; cassitérite, argile réfractaire et fer des marais minés dans leur biome ; Prowler Sinew pris sur un Prowler abattu à la lance ; la cabane est posée bloc par bloc au clic secondaire (murs, toit, porte). Les commandes de débogage ne font que la mise en place : le terrain de la maison, la mare et la fosse de chasse (`debug.fill`), un bloc source posé à côté du joueur quand aucun n'est à portée de la recherche (le désert et le marais de la graine 7, souvent), les matériaux qu'aucun objectif ne nomme (`debug.give` : bûches, pierre, argile, tourbe, minerai de cuivre, peaux, fourrure, résine), le Prowler placé (`debug.spawn`) de nuit (`debug.setTime`) dans la fosse, les stations ouvertes sans viser (`debug.open`) et les téléports d'un poste à l'autre.

## Vérification

| Commande                                                           | Rôle                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm run verify`                                                   | `tsc -b` (4 projets), Biome, Vitest, build : à chaque jalon, en local et en CI         |
| `npm run test:perf`                                                | seuils sous Node (génération, maillage, couture, 60 créatures), dès M2, en local       |
| `npm run test:slow`                                                | bot de 2 jours de jeu aux hashes identiques, en M3, M10 et M11                         |
| `npm run headless -- --seed=42 --ticks=9000 --bot=wanderMineBuild` | sim en Node natif → `{hash, tps, columns, census}`, dès M3                             |
| `npm run e2e`                                                      | Playwright (Chrome en local, Chromium en CI), charge `?selftest=…`, dès M2             |
| `game-dev` / `game-bench`                                          | navigateur intégré ; les mesures de perf se font uniquement sur bench, panneau visible |

**Tests**

- **Unitaires, par couche** :
  - core : rng golden, bruit, varint ;
  - content : registre, validation, atteignabilité, i18n, JSON, `altPack` ;
  - world : coords, sections, raycast, maillage, lumière, codec ;
  - sim : physique, endurance, inventaire (propriétés), craft, stations, survie, abri, eau, combat, A*, apparitions, butin (10 000 tirages à ±2 %), rejets de commandes ;
  - platform : idb ; workers : runtime avec un faux port ; input : étiquettes QWERTY/AZERTY/QWERTZ ; ui : signaux.
- **Autres suites** :
  - `golden/` : génération ;
  - `sim/` : rejeu de 3 000 ticks, `SerializingSimHost`, reprise de sauvegarde ;
  - `balance/`, `architecture/` ;
  - `slow/` : le bot de 2 jours.

**Hook `window.__game`**

- Chargé uniquement si `__DEBUG_HOOK__` (dev et bench), par import dynamique : absent du build de production.
- Toute mutation passe par une commande `debug.*`, refusée si `rules.allowDebug` est faux.
- `press(action, ticks)` maintient l'entrée pendant N ticks et avance de N ticks en `fixedStep`.

| Groupe                 | Méthodes                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cycle                  | `version`, `params`, `ready()`, `errors()`, `state()`, `selftest()`, `pump(ms)`                                                                                            |
| sim                    | `step(n)`, `pause()`, `resume()`, `hash()`                                                                                                                                 |
| input                  | `look()`, `press(action, ticks)`, `release()`, `keyLabel()`                                                                                                                |
| player                 | `get()`, `teleport(x, y\|'surface', z)`, `setStat()`, `give()`, `equip()`, `inventory()`, `kill()`, `god()`                                                                |
| world                  | `block()`, `setBlock()`, `fill()`, `light()`, `biome()`, `surface()`, `findBiome()`, `findStructure()`, `waitForChunks()`, `genHash()`                                     |
| time / entities        | `set(heures)`, `freeze()` / `spawn()`, `list()`, `kill()`, `census()`, `spawnLog()`                                                                                        |
| craft / container / ui | `enqueue()`, `queue()`, `contents()` / `screen()`, `open()`, `close()`, `text()`, `i18nMissing()`                                                                          |
| save                   | `now()`, `reload()`, `worlds()`, `inspect()`, `wipeAll()`                                                                                                                  |
| render                 | `info()`, `camera()` (`mode`, `distance`), `rig(id)`, `capture()` (`avgLuma`, `uniqueColors`), `debugView()`, `sectionVersionLag()`, `setRenderDistance()`, `setQuality()` |
| perf, events, audio    | `snapshot()`, `benchmark('walk'\|'fly'\|'cave'\|'mobs'\|'dig')`, `events.tail()`, `events.waitFor()`, `audio.log()`, `workers.ping()`                                      |

**Paramètres d'URL de démarrage** (dev et bench uniquement)

| Famille             | Paramètres                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Monde               | `seed`, `world`, `new=1`, `skipMenu=1`, `worldType=default\|flat\|arena`, `pos`, `look`, `time`, `freezeTime=1`        |
| Simulation          | `fixedStep=1`, `spawns=0\|1`, `grace=0`, `god=1`, `give=`                                                              |
| Rendu               | `rd`, `quality`, `occlusion=0`, `workers`                                                                              |
| Stockage et entrées | `storage=memory\|idb`, `noLock=1`, `kb=azerty\|qwerty\|qwertz` (étiquettes seulement)                                  |
| Pannes simulées     | `forceNoWebGL=1`, `forceNoIdb=1`                                                                                       |
| Divers              | `mute=1`, `debug=1`, `scene=testchunk`, `freecam=1`, `host=serialize`, `selftest=`, `bench=walk\|fly\|cave\|mobs\|dig` |

**Mesure de performance**

- **Métriques** :
  - **travail CPU d'une image** : `performance.now()` au début et à la fin du callback rAF ; ce n'est pas l'intervalle rAF, qui est quantifié par l'écran ;
  - **régularité** : part des intervalles supérieurs à 20 ms, et image la plus longue ;
  - tick de sim ; jobs des workers, mesurés dans les workers ; téléversements ;
  - compteurs déterministes, indépendants de la machine et donc seuils durs : draws, triangles, octets de géométrie, `voxelBytes`, `memory.geometries` ;
  - aucun seuil sur le tas JS (`performance.memory` est quantifié par Chrome).
- `PerfMonitor` : tampons circulaires de 240 images par sous-système ; moyenne, p50, p95, p99, max.
- **Seuils mesurés sur ton M4**, réglés à environ 0,6 × la cible M1 (estimation, à recalibrer sur un vrai M1) :
  - build bench, tampon de rendu fixé à 2160×1350 pour que le coût de remplissage ne dépende pas de la taille du panneau.

  | Mesure                                                             | Seuil             |
  | ------------------------------------------------------------------ | ----------------- |
  | Travail d'image p95, `walk` / `fly`                                | ≤ 9 ms / ≤ 11 ms  |
  | Intervalles > 20 ms en `walk`                                      | < 1 %             |
  | Tick de sim p95, `mobs` (environ 25 créatures)                     | ≤ 1,5 ms          |
  | Génération d'une colonne / maillage d'une section (Node, médianes) | ≤ 10 ms / ≤ 3 ms  |
  | Couture d'un bord (Node)                                           | ≤ 0,5 ms          |
  | Un tick avec 60 créatures (Node)                                   | ≤ 3 ms            |
  | Draws à RD 6, surface / grotte                                     | ≤ 400 / ≤ 150     |
  | Triangles / géométrie                                              | ≤ 1,5 M / ≤ 64 Mo |
  | `voxelBytes` (médiane de 3 trajets de 2 km)                        | ≤ 140 Mo          |
  | Chargement, rayon 3 / RD 6                                         | < 3 s / < 5 s     |
  | Édition → maillage visible                                         | ≤ 50 ms p95       |
  | JS gzip                                                            | ≤ 400 Ko          |

- **Approximations d'un M1** :
  - GPU : RD 8 à DPR 2 sur le M4 garde moins de 5 % d'intervalles supérieurs à 20 ms ;
  - CPU : le spec Playwright `perf.spec.ts`, avec `Emulation.setCPUThrottlingRate(1.7)`, doit tenir un travail p95 ≤ 15 ms en `walk` (M11).
- **Ralentissement adaptatif**, côté client uniquement :
  - travail d'image > 12 ms pendant 2 s → tranches du client −30 % ;
  - < 8 ms pendant 5 s → +10 %, jusqu'au nominal ;
  - les budgets de la sim ne changent jamais.

**Budgets du thread principal par image** (cible M1)

| Poste            | Budget                                                 |
| ---------------- | ------------------------------------------------------ |
| Entrées          | 0,2 ms                                                 |
| Tick de sim      | ≤ 2 ms p95                                             |
| Copies et envois | 1,5 ms                                                 |
| Téléversements   | 1 ms ; au plus 8 sections ou 1 Mo, les urgents d'abord |
| Entités          | 0,5 ms                                                 |
| Rendu CPU        | ≤ 4 ms                                                 |
| UI               | 0,5 ms                                                 |
| **Total**        | **≤ 11,7 ms**                                          |

Aucune allocation dans les boucles chaudes : tableaux de travail, vecteurs réutilisés, files typées, clés numériques, tampons recyclés.

**Navigateurs**

- **Cible : Chrome desktop** (≥ 120, à jour). Edge, basé sur Chromium, suit naturellement.
- Toute l'automatisation tourne sous Chromium : navigateur intégré, Playwright en local et en CI.
- **Firefox et Safari** :
  - le code n'utilise que des API standard, avec la porte de capacités ;
  - une vérification rapide dans Safari en M11 ;
  - s'ils se comportent pareil, ils sont supportés ; sinon les écarts sont notés et corrigés seulement s'ils sont simples.

## Exécution et collaboration

**Chaque jalon se déroule en 4 temps**

1. **Implémentation** sur la branche du jalon. Les modules indépendants peuvent être confiés à des sous-agents en parallèle, par exemple en M8 les données de contenu, les systèmes de sim et les écrans. Les sous-agents travaillent dans des worktrees isolés s'ils écrivent en même temps.
2. **Vérification** : protocole commun, autotests, contrôles dans le navigateur intégré, captures, perf.
3. **Revue adversariale** : un workflow de relecture sur le diff du jalon, en deux passes.
   - Lentilles : exactitude, performance, règles d'architecture, originalité, KISS/DRY/SRP.
   - Seules les remarques confirmées par un sceptique sont corrigées.
   - Une seconde passe vérifie ensuite les corrections.
4. **Livraison** :
   - push et PR en anglais ;
   - suivi de la CI ;
   - squash-merge quand tout est vert ;
   - compte rendu en français : ce qui marche, comment l'essayer, ce qui reste.

**Ce que je te demanderai**

- Rien pendant l'exécution autonome (décision 13). Les captures de style (créatures en M10) sont jointes à la PR, sans attendre ton avis.
- Une partie test de 10 min, quand tu le voudras (facultative).
- Ton accord avant tout gros téléchargement hors `npm install`. En autonomie, je n'en fais aucun : je contourne ou je reporte et je le note.

## Exécution autonome (décision 13)

**Déroulé.**

1. **M3.5 — Passe KISS/DRY/SRP** sur le code de M0 à M3 (voir « M3.5 » dans « Jalons »).
2. **M4 à M11**, dans l'ordre, chacun avec le protocole commun complet et sa PR.
3. **Boucle d'amélioration** sans fin tant que tu ne m'interromps pas. Chaque itération :
   - choisit le chantier le plus utile, dans cet ordre de priorité :
     1. bugs et erreurs (jeu réel, bots, autotests, revue de tout le code) ;
     2. robustesse et cas limites ;
     3. dette KISS/DRY/SRP ;
     4. performance (seuils de « Vérification ») ;
     5. couverture de tests ;
     6. finition de gameplay dans le périmètre v1 ;
   - est livrée comme une PR `claude/improve-<sujet>` avec le même protocole qu'un jalon (vérification, revue adversariale en deux passes, CI verte, squash-merge).

**Règles d'autonomie.**

- Aucune question, ni via AskUserQuestion ni via les boutons de fin de tour.
- Quand un choix n'est pas tranché par ce plan, je prends l'option la plus simple qui respecte la spec (KISS). Je note la décision et sa raison dans la description de la PR et, si elle change la spec, dans `docs/conception.md`.
- Je ne m'arrête jamais sur une CI rouge, une revue négative ou un test qui échoue : je corrige, je revérifie et je repousse. Auto-fix reste activé sur chaque PR.
- Si un élément du plan s'avère irréalisable tel quel (API indisponible, seuil de perf intenable), je livre la meilleure version qui marche. J'écris l'écart dans la PR et dans le compte rendu.
- Garde-fous inchangés :
  - jamais de force-push sur `main` ;
  - aucun téléchargement hors des paquets npm de la stack ;
  - aucune action hors du dépôt et de ce dossier ;
  - aucun secret commité.
- Chaque jalon et chaque amélioration se termine par un court compte rendu en français, que tu liras au réveil.

**Téléchargements** :

- en local, seulement `npm install` des paquets listés plus haut, depuis le registre npm ;
- en CI, Playwright télécharge Chromium sur les machines de GitHub.

## Risques et parades

| Risque                                                        | Parade                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Coutures de lumière fausses ou BFS trop coûteux               | lumière du worker jamais trop claire, état LIT avec compteurs d'attente, tests contre un BFS de référence, budget en nœuds, vue `light`      |
| À-coups du thread principal (streaming, téléversements, GC)   | budgets, transferts, pools, zéro allocation, précompilation des shaders, seuils de perf dès M2                                               |
| Le M4 masque des lenteurs sur un M1                           | seuils à 0,6× la cible, compteurs durs indépendants de la machine, ralentissement CPU ×1,7, test sur un M1 par toi si possible               |
| Trop de draws sur GPU intégré                                 | sections de 32³, 3 matériaux partagés, frustum culling + culling des grottes, préréglages                                                    |
| Perte du déterminisme                                         | interdictions vérifiées par le test `boundaries`, RNG dans l'état, goldens + `GEN_VERSION`, wrapper du bruit, tests `SerializingSimHost`     |
| `@types/three` sous TS 7 non vérifié                          | `typecheck` dès M0 ; repli sur `typescript@~6.0.3`                                                                                           |
| Pointer Lock capricieux (délai après Échap)                   | machine à états, overlay de reprise, liaison par `code`, `noLock`, pilotage via `__game`                                                     |
| WebGL2 en headless (local Apple Silicon, CI Linux)            | premier spec dédié ; en local, mode headed si besoin ; en CI, SwiftShader (activé par Playwright) ; le navigateur intégré reste la référence |
| CI lente ou instable sur le rendu                             | la CI ne gère que `verify` et une fumée e2e ; la perf et les vérifications visuelles restent locales                                         |
| rAF bridé quand le panneau est caché                          | `step`, `pump`, boucle `MessageChannel`                                                                                                      |
| Perte de données (quota, onglet tué, deux onglets)            | `persist()`, écriture immédiate à la sortie de l'onglet, bits `persisted`, drapeaux versionnés, verrou Web Locks, export/import              |
| Perte de contexte WebGL, plantage de worker                   | copies CPU conservées ; délai de 10 s, puis relance et remise en file                                                                        |
| Dérive de périmètre ou d'originalité, équilibrage peu amusant | contenu en données, test d'atteignabilité, checklist d'originalité, `balance.ts` + tests, parties test                                       |
| three.js recentré sur WebGPU                                  | three confiné à `src/render` et GLSL isolé : un futur portage en TSL reste local                                                             |

## Hors périmètre v1

- Serveur coop (le contrat `RemoteSimHost` est prêt).
- Mobile, tactile, manette ; plein écran intégré.
- Travail spécifique à Firefox ou Safari au-delà de corrections simples.
- WebGPU et TSL ; lumière colorée, ombres, post-traitement ; LOD lointain.
- Écoulement de l'eau ; météo ; véhicules.
- Armes à distance et projectiles ; creusement par les Prowlers ; moral des groupes de Swarmlings.
- Musique (hors courts sons de transition) ; sous-titres sonores directionnels.
- Niveaux de difficulté ; agriculture et élevage ; succès.
- Traductions (le français en premier) et sélecteur de langue : la structure i18n est prête.
- Packs JSON chargés à l'exécution et mods ; sauvegarde dans le cloud.

# Plan v2 : « Create Your World », après la première partie test

## Contexte v2

Le plan v1 (M0–M11) est livré et mergé. Le premier tour d'amélioration (PR #14–16) aussi. Après une première partie test, tu as fait 18 retours :

- un jeu trop « correct » : quêtes dépendantes d'un bon point d'apparition, sans récompense ;
- des créatures trop fortes et irréalistes ;
- des feuilles et une eau sans physique ;
- des bordures de biomes en dégradé et trop de pierre en surface ;
- un sac et un Logbook peu pratiques ;
- un établi sans interface et du combustible gaspillé ;
- aucun thème ;
- un HUD mal placé et des mots ou effets visuels incompris ;
- des contrôles à améliorer (saut, sprint, manger).

Ce plan v2 répond à chacun d'eux.

**Décisions** : les décisions 15 à 21 de ce plan sont dans le tableau des décisions du « Contexte » (en tête de ce document).

**Inchangé** : KISS/DRY/SRP, déterminisme, couches, i18n, protocole de jalon (vérifications, autotests, revue adversariale en deux passes, PR, CI verte, squash-merge), exécution autonome avec un compte rendu en français à chaque jalon.

**Règles communes aux jalons v2**

- Tout nouvel état persistant vient avec un sérialiseur, une valeur par défaut, un test d'aller-retour et une étape de migration (`SAVE_VERSION` +1 par jalon concerné). `GEN_VERSION` +1 dès que la génération ou une clé d'état change, avec mise à jour des snapshots dorés.
- **Lecture tolérante des clés d'état (M14)** : `registry.stateIdOrUnknown` lit `block:x[props]`, garde les valeurs encore valides et complète avec les défauts. Les anciennes sauvegardes s'ouvrent donc sans réécrire `stateKeys` (eau = source, torche = au sol, feuilles = non posées par le joueur).

## Jalons v2

### M12 — Contrôles et combustible (retours 12, 9, 18 côté logique)

- **Saut continu** : `sim/physics.ts` relance le saut à chaque tick où la touche est tenue au sol (on retire `jumpHeldLast`). Le temps de coyote empêche le double saut ; le coût d'endurance reste.
- **Double appui sur « avancer » = sprint** tant que la touche reste tenue :
  - nouveau module pur `input/sprintLatch.ts` (fenêtre de 300 ms) ;
  - `InputManager` envoie `sprint: shift || verrou` ;
  - la sim ne change pas.
- **Manger ou boire ralentit** : `stepPlayer` applique ×`balance.consume.moveFactor` (0,4) et retire le sprint pendant une consommation.
- **Bug : Échap sur le sac affiche la pause.** Aujourd'hui `inventoryUi` → `playGate.closeScreen(false)` met la simulation en pause et affiche « Click to resume ».
  - Échap ferme désormais le sac (ou un coffre, une station) et revient au jeu sans pause ni menu.
  - On tente de recapturer la souris. Si le navigateur refuse (Échap ne compte pas comme un geste de l'utilisateur), un simple « Cliquez pour reprendre » s'affiche ; la simulation continue, comme quand on ferme l'inventaire dans Minecraft.
  - Le menu pause ne s'ouvre qu'avec Échap en jeu, sans écran ouvert.
  - Tests unitaires de la porte (`playGate`) et cas d'autotest au clavier.
- **Combustible** : toutes les stations ne brûlent que si une recette valide tourne.
  - Le feu de camp gagne un interrupteur « Garder allumé (chaleur, lumière) », éteint par défaut : `StationEntity.keepLit`, commande `station.keepLit` (qui l'inverse), bouton sur l'écran Station.
  - Migration SAVE 6 : les feux déjà allumés le restent.
- **Fichiers** : `sim/physics.ts`, `sim/player.ts`, `input/InputManager.ts`, `sim/stations.ts`, `packs/base/recipes.ts`, `ui/screens/station.ts`, `world/codec/migrations.ts`.
- **Tests** :
  - N sauts en tenant la touche ;
  - verrou de sprint avec temps simulé ;
  - un feu de camp oisif ne consomme rien, sauf avec `keepLit` ;
  - migration v5 ;
  - suite m12.
- **Risque** : les bots et la marche des objectifs supposent un saut à l'appui ; ils sont à adapter.

### M13 — Sac, curseur, Logbook et établi (retours 7, 8)

**Pile sur le curseur, autoritaire côté sim** (prête pour le multijoueur) :

- `PlayerState.cursor` (sauvegardé) et commandes `screen.open/close`, `slot.click {slot, button, shift}`, `slot.hotkey`.
- Un seul module de règles, `sim/slotClicks.ts`, qui réutilise `moveStack`, `moveInto`, `addToRange`, `stationAccepts` et `wearFilters` :
  - clic gauche : prendre, poser, fusionner ou échanger ;
  - clic droit : prendre la moitié ou poser un seul objet ;
  - Maj+clic : transfert rapide ;
  - clic hors de l'interface avec une pile sur le curseur, comme dans Minecraft : clic gauche, toute la pile est jetée ; clic droit, un seul objet est jeté.
- La pile du curseur revient dans l'inventaire à la fermeture, à la fermeture automatique et à la réapparition. À la mort, elle va dans le sac abandonné.
- Les anciennes commandes de déplacement sont retirées. Le client dessine la pile sous la souris ; `ui/slotBoard.ts` perd le fantôme de glisser.

**Piles et taille du sac** :

- `DEFAULT_STACK = 64`, `maxStack` facultatif, validation (outils, équipements et récipients à 1). `fitStacks` redécoupe au chargement.
- Inventaire de taille variable : 32 de base, 64 au plus, via les améliorations de M19. Les cases portées et celles des entités de bloc sont renumérotées au-delà de 64. Partout, `inventory.length` remplace le littéral 32.

**Établi** :

- Entité de bloc avec sa file (5 entrées) et 4 cases de sortie. Ajouter à sa file exige l'établi ouvert.
- Les ingrédients sont réservés sur le joueur, la file avance avec rattrapage, la sortie pleine met en pause. Casser l'établi rend les réservations.

**File de fabrication regroupée** (file du joueur comme file de l'établi) :

- Ajouter une recette déjà présente dans la file augmente le nombre de cette entrée au lieu d'occuper une nouvelle case. Cliquer 5 fois sur ×1 donne donc une seule case de 5, comme un clic sur ×5.
- Plafond par entrée : la taille de pile du résultat. Au-delà, une nouvelle case s'ouvre.
- Annuler une entrée rend tous ses ingrédients réservés.
- Test : 5 clics ×1 et 1 clic ×5 donnent la même file.

**Logbook** :

- Recherche (noms de sortie et d'ingrédients, sans accents ni casse) et filtre « Fabricable maintenant ».
- **Recettes non découvertes affichées en bas, grisées**, à la place du simple compteur « encore à découvrir » : le joueur voit ce qu'il lui reste à fabriquer.
  - Le résultat est visible ; un ingrédient jamais vu s'affiche en « ? » avec son indice de provenance.
  - Ces recettes ne se fabriquent pas.
  - Elles suivent l'onglet et la recherche, et le filtre « Fabricable maintenant » les masque.
  - Les recettes à plan ou à niveau (M18, M19) indiquent ce qui les débloque.
- Le Logbook du sac montre les recettes à la main plus « N de plus à l'établi ».
- Nouvelle barre d'onglets du sac : Inventaire, Logbook, puis Quêtes, Bestiaire et État dans les jalons suivants.

**Sauvegarde** : SAVE 7 (curseur, file de l'établi, renumérotation).

**Fichiers** : `sim/commands.ts`, `sim/slotClicks.ts` (nouveau), `sim/inventory.ts`, `sim/blockEntityCommands.ts`, `sim/craftQueue.ts`, `sim/stations.ts`, `content/items.ts`, `content/validateItems.ts`, `ui/slotBoard.ts`, `ui/inventoryGestures.ts`, `ui/logbook.ts`, `ui/screens/{bag,logbook,station}.ts`, `app/inventoryUi.ts`, `app/automation.ts`.

**Tests** :

- chaque cas de clic, y compris les cases de sortie et les cases refusées ;
- curseur rangé à la fermeture, à la fermeture automatique et à la mort ;
- file d'établi qui avance sans joueur proche ;
- recherche et filtre du Logbook ;
- `?host=serialize` ;
- m8 réécrite au clic, nouvelle suite m13.

### M14 — Mises à jour de blocs, feuilles, torches (retours 5, 15)

**Ordonnanceur déterministe** (`sim/blockUpdates.ts`, étape 10 du tick prévue par la spec) :

- Tas binaire en tableaux typés trié par (échéance, n°), dédupliqué par cellule et type (`support`, `liquid`, `decay`), inclus dans le hash d'état.
- Budgets : 256 mises à jour par tick ; le reste passe en tête au tick suivant, sans blocage.
- Exécution seulement dans le rayon de simulation, colonnes LIT. Au déchargement, les mises à jour sont garées avec la colonne (`ColumnRecord.updates`) et reprises au chargement.
- Un seul chemin d'édition, `changeBlock` = `editBlock` + avertissement des 6 voisins.
- Un seul chemin de casse, `removeBlock(…, by)` extrait de `breakBlock` : il sert au joueur comme au monde. Les blocs soutenus deviennent des mises à jour `support`, comme pour la porte.

**Feuilles** :

- Champ `decay {anchor: tag:log, radius: 5, seconds: [2, 12]}` et état `placed` : les feuilles posées par le joueur ne tombent jamais.
- Retirer une bûche planifie toutes les feuilles du rayon. Un parcours en largeur cherche une bûche ; sans bûche, la feuille tombe avec son butin, comme cassée par le joueur.
- Délai pseudo-aléatoire déterministe.

**Torches** :

- `RAY_TARGET` teste les boîtes dessinées (table `targetBoxes`, au moins 4/16). Viser le vide à côté de la torche vise donc le bloc derrière.
- Torches murales : état `attach` (sol, n, e, s, w) et `support: 'face'` enfin implémenté. Une torche sur un mur tombe avec ce mur ; la pose au plafond est refusée.

**Versions** : SAVE 8, GEN 4, lecture tolérante des clés.

**Tests** :

- ordre, dédoublonnage, report de budget et garage de l'ordonnanceur ;
- les feuilles de chaque arbre généré touchent une bûche ;
- couper le tronc fait disparaître la canopée en 12 s au plus, et les feuilles posées restent ;
- une torche tombe avec son mur ;
- viser à côté d'une torche ;
- une ancienne sauvegarde s'ouvre ;
- perf « coupe de 30 bûches » : étape 10 ≤ 0,5 ms en médiane.

**Retenu à la réalisation** (choix les plus simples qui tiennent la spec) :

- Les mises à jour des colonnes non simulées attendent avec leur colonne (dans la file, sauvegardée avec l'enregistrement du monde), au lieu d'un champ `ColumnRecord.updates`.
- Pas de fonction `changeBlock` : `removeBlock` (le seul chemin de casse, `by` = joueur ou `BY_WORLD` = −1) avertit les voisins (`noteRemoved`) ; une porte qui s'ouvre avertit ceux qu'elle portait (`noteChanged`). Les remplissages de debug n'avertissent personne.
- Les feuilles tiennent si une bûche se trouve à 5 blocs au plus (distance de Manhattan), sans exiger un chemin de feuilles : les couronnes générées ont des trous. Une colonne non chargée dans ce rayon compte comme une bûche (on ne fait jamais tomber sur l'inconnu). Les feuilles d'un tronc abattu tombent toutes, avec leur butin.
- Le support `face`, jamais utilisé, est remplacé par `attach` ; la forme murale vient de `BlockDef.wallShape`, tournée vers le mur. La moitié haute d'une porte repose sur sa moitié basse.
- La visée fine teste directement les boîtes dessinées (élargies à 4/16) ; la confirmation d'une cible vise aussi le milieu de la première boîte (une natte basse, un battant fin).
- `GEN_VERSION` 4 (les clés des feuilles et des torches changent), `SAVE_VERSION` 8 (le monde garde ses mises à jour).

### M15 — L'eau, règles de Minecraft (retour 17)

**États** : niveau `level` (0 = source, 1–7 = écoulement) et `falling`. Tables précalculées pour éviter `withState` dans les boucles chaudes.

**Règles** (données `LiquidDef.flow`) :

- Eau douce : délai de 8 ticks (≈ 5 ticks à 20 Hz), portée 7, recherche de trou à 4, sources infinies (2 sources voisines sur sol solide créent une source).
- Eau croupie : plus lente et sans source infinie.
- Écoulement :
  - l'eau descend d'abord ;
  - sinon elle s'étale vers le ou les chemins les plus courts menant à une chute dans un rayon de 4 ;
  - elle s'assèche quand plus rien ne l'alimente.
- Les plantes emportées lâchent leur butin. Budget d'écritures par tick : un lac éventré s'écoule sur plusieurs ticks, sans bloquer.

**Rendu** : hauteur du dessus selon le niveau. Le mailleur ne fusionne que les dessus de même hauteur ; faces latérales entre niveaux.

**Physique** : `isLiquid` dépend de la hauteur, donc une flaque ne fait pas nager. Lumière et maillage via le chemin normal.

**Version** : GEN 5.

**Tests** :

- scènes unitaires : losange de 7 niveaux, trou attracteur, source infinie, assèchement, chute ;
- colonne voisine non chargée ;
- snapshot du maillage ;
- perf « barrage cédé dans une fosse de 20×20 » : tick p95 ≤ 4 ms sous Node ;
- suite m15 dans la mare de l'arène.

**Retenu à la réalisation** (choix les plus simples qui tiennent la spec) :

- L'eau est une mise à jour de bloc de plus (genre `LIQUID`, `sim/liquids.ts`), due `flow.seconds` après un changement voisin : elle partage la file, la sauvegarde et le budget de l'étape 10 (256 par tick).
- Les règles suivent celles de la référence, y compris une source en l'air qui déborde d'un bloc tout autour et l'eau à côté d'une chute qu'elle alimente déjà, qui ne va nulle part ailleurs. Les sources ne se vident jamais.
- Toute modification de bloc (casse, pose, porte, sac abandonné récupéré) réveille les liquides voisins (`noteChanged`). La génération et les remplissages de debug ne réveillent rien : un monde chargé reste immobile tant qu'on n'y touche pas.
- Hauteurs du dessus en seizièmes, du niveau 0 au niveau 7 : 14, 12, 10, 9, 7, 5, 3, 2 ; un écoulement qui tombe est plein (16). Eau croupie : un pas toutes les 0,5 s.
- `GEN_VERSION` 5 (les clés d'eau gagnent `level` et `falling`) ; pas de nouvelle version de sauvegarde : la lecture tolérante des clés fait de l'eau d'une ancienne sauvegarde des sources.

### M16 — Biomes, grottes et minerais de la planète (retours 6, 16, le thème côté génération, le sous-sol)

**Bible du thème** (`docs/theme.md`) : la planète, ses biomes, sa faune, sa flore, ses matériaux et le nom de chaque élément. Les noms sont proposés dans la PR ; tu peux les changer plus tard, ce ne sont que des chaînes.

**Biomes repensés pour la planète** :

- Climat, surface, remplissage, liquides, teintes, flore et décor en données.
- Les clés restent stables quand c'est possible.
- Le jeu de biomes peut changer, avec les mêmes garanties : danger froid, chaud et toxique à moins de 1 km de l'apparition.

**Bordures nettes** : la gigue par colonne (bruit blanc de `biomeOf`) est remplacée par un champ lisse (longueur d'onde ≈ 40 blocs) interpolé comme le climat. Les bordures deviennent des lignes ondulées et propres ; recherches, apparition et structures restent cohérentes.

**Grottes repensées** :

- Beaucoup plus d'ouvertures sur la surface : trous, gouffres et entrées à flanc de colline ou de falaise.
- **Grottes sous l'eau, deux cas.**
  - Près du fond d'un lac ou de la mer : grottes noyées, générées déjà remplies d'eau (sources). Rien ne coule au chargement, le lac ne se vide pas, et on peut plonger pour les explorer.
  - Plus en profondeur : grottes sèches et scellées, avec au moins 3 blocs de roche entre elles et toute eau. Si le joueur perce ce plafond, l'eau s'y déverse selon les règles du M15.
  - La génération ne laisse jamais d'eau posée sur de l'air : aucune mise à jour d'eau au chargement d'une colonne intacte.
- Des grottes plus larges et plus grandes par endroits : grandes cavernes et salles, réparties sur plusieurs bandes de profondeur, plus seulement y 12–50.
- Des réseaux qui se croisent : plusieurs familles de tunnels indépendantes, de largeur variable, se rejoignent en carrefours.
- Paramètres en données (`CaveDef`).
- Tests :
  - part des colonnes ouvertes sur la surface dans une fourchette cible ;
  - présence de carrefours et de grandes salles sur 10 graines ;
  - grottes sous l'eau noyées près du fond, scellées par au moins 3 blocs plus bas ;
  - une colonne générée ne produit aucune mise à jour d'eau à son chargement ;
  - perf de génération ≤ 10 ms par colonne.

**Minerais en tables de répartition par couche** :

- Chaque minerai (y compris ceux de la bible du thème) déclare une courbe de probabilité par profondeur : des couches avec un pourcentage de chance d'apparition (filons par section), une taille de filon, et des limites basse et haute strictes.
- Aucune règle implicite de rareté ou de richesse selon la profondeur : la fréquence et la taille à chaque profondeur viennent uniquement des probabilités et des limites déclarées par chaque minerai.
- Aucune couche sans minerai, du socle jusqu'au sommet de la pierre : la validation du pack vérifie que chaque tranche de hauteur est couverte par au moins un minerai.
- **Minerais exclusifs à certains biomes**, pour obliger à explorer plusieurs biomes :
  - chaque palier de la progression exige au moins un minerai qu'on ne trouve que dans un biome précis ;
  - ces biomes sont garantis à moins de 1 km de l'apparition, comme aujourd'hui pour le froid, le chaud et le toxique ;
  - des minerais communs, présents partout, assurent la couverture de chaque couche.
  - La bible du thème fixe quel minerai appartient à quel biome ; `reachable` et les quêtes d'histoire s'appuient sur cette garantie.
- Une table récapitulative, générée depuis les données, va dans `docs/theme.md`.
- Tests :
  - recensement sur 10 graines : la fréquence observée par couche suit la table (±20 %) ;
  - aucun minerai hors de ses limites ni hors de son biome ;
  - aucune couche vide ;
  - sur 20 graines, chaque minerai exclusif est trouvable à moins de 1 km de l'apparition.

**Pierre en surface** : rochers seulement dans le biome rocheux. `writeBoulder` ne crée plus de piliers sur les pentes (enfoncé de 1, colonnes trop basses ignorées).

**Version** : GEN 6.

**Tests** :

- sur 256×256 blocs et 5 graines, aucune colonne isolée dans un autre biome que ses 4 voisines ;
- rochers seulement dans leur biome, sans pilier ;
- apparition, `findBiome` et goldens.

**Retenu à la réalisation** (choix les plus simples qui tiennent la spec) :

- Bordures : un bruit lisse (longueur d'onde 40 blocs, ± 0,05) décale les seuils de biome ; les règles de hauteur lisent la hauteur sans son petit détail ; une colonne qu'aucune de ses 4 voisines ne partage (la pointe d'un coin où deux seuils se croisent) prend le biome du plus grand nombre de voisines. Le passage groupé calcule les biomes bruts d'une grille une fois, avec la même règle (`settledBiome`).
- Grottes : deux familles de galeries (largeur modulée par un bruit 2D), salles dans deux bandes (y 8–36, 40–76), entrées plus fréquentes (environ 2,4 % de la terre ferme ouverte, contre 0,2 %), gouffres (bruit en crête, jusqu'à 30 blocs, seulement là où un bruit de porte le permet). Ces ouvertures ne se font que sur la terre ferme à plus de 3 blocs de tout liquide.
- Sous les lacs : les grottes à 12 blocs au plus du fond sont générées pleines du liquide du biome ; toute grotte sèche garde au moins 3 blocs de roche sous le fond noyé le plus haut à 3 colonnes à la ronde (hauteurs lues avec une marge de 3, `MARGIN`). `caveAt` ne répond que pour les grottes sèches.
- Minerais : couches `{ y, chance, veins, size }`, tirages identiques que la veine démarre ou non ; nouvelle pierre ardente (Emberstone, combustible de 50 s), commune à toutes les hauteurs (1–210 : la validation calcule la hauteur maximale du terrain depuis les splines). Les minerais propres à un biome (cuivre, étain, fer des marais, argile réfractaire) sont à moins de 1 km de l'apparition (20 graines testées).
- Rochers de pierre seulement dans les hautes terres, enfoncés d'un bloc, sans colonne sous un bord trop bas ; l'apparition évite toute ouverture à 8 blocs ; `surfaceY` descend au fond d'une ouverture (une téléportation n'y fait plus tomber).
- Biomes renommés pour la planète Veyra (Amberfield, Veilwood, Shard Highlands, Rimefrost, Ochre Waste, Sporefen, Mirror Basin), clés inchangées ; bible du thème dans `docs/theme.md`.
- `GEN_VERSION` 6 ; génération d'une colonne environ 4 ms en médiane (10 ms permises).
- Le masquage des grottes économise moins depuis une poche (14 à 28 % selon la poche, contre plus de 30 % au M11) : les galeries croisées et les salles ouvrent vraiment le sous-sol. Le seuil passe à −10 % de draws (toujours ≤ 150 draws).

### M17 — Créatures équitables et vivantes, bestiaire, scanner (retours 3, 4, 2)

**Mouvement juste** :

- Agilité en données : accélération au sol ≈ 20 m/s², 4 en l'air, rotation 120–240°/s.
- La vitesse suit l'orientation : on peut feinter et esquiver une charge.
- Les petits sauts coûtent de l'endurance et ont un temps de recharge.

**Endurance des créatures** :

- Course limitée ; endurance vide = marche jusqu'à 50 %.
- Les blessures ralentissent.
- Invulnérabilité ramenée à 5 ticks, et les brouteurs résistent au recul.

**Sens et limites** :

- Plus de suivi à distance sans vue : un chasseur va à la dernière position vue ou entendue, cherche 6 s, puis abandonne.
- Une poursuite sans touche s'arrête après 25 s.
- La fuite dure tant que l'endurance tient, puis la créature reste méfiante 20 s : elle observe au lieu de fuir.

**Besoins** :

- Faim et soif : les créatures cherchent de la nourriture et de l'eau. Elles broutent les plantes et les carnivores sont attirés par la viande au sol (appât).
- Régénération si nourries.
- Dégâts de chute.

**Nouvelle faune extraterrestre** : noms, modèles et comportements selon la bible.

**Bestiaire** (onglet du sac) :

- Une créature est « rencontrée » quand on la voit ou qu'on la frappe, « étudiée » quand le scanner a fini de la scanner ou qu'on la tue.
- Texte généré depuis les données : catégorie, où et quand elle apparaît, régime, comportement. Les statistiques s'affichent une fois la créature étudiée.

**Scanner : un équipement de tête** (recette connue dès le départ, à partir de pièces de la capsule). Il va dans l'emplacement tête, à la place d'une capuche ou d'un casque : c'est un choix pour le joueur.

- **Scan automatique** quand on regarde une créature pendant X secondes à Y blocs au plus, en ligne de vue. X et Y sont des données (`wear.scanner {seconds, range}` ; par exemple 2 s et 24 blocs).
- Un anneau de progression autour du réticule montre le scan en cours ; détourner le regard l'interrompt.
- Une fois le scan fini, la créature est « étudiée ».
- Tant que le scanner est porté, le panneau de cible affiche le nom, la vie, l'endurance et l'état de la créature regardée.
- Le Scanner Mk II (M19) scanne plus vite et plus loin.
- Sans scanner, une créature jamais rencontrée apparaît comme « Créature inconnue ».

**Sauvegarde** : SAVE 9.

**Tests** (headless, 10 graines) :

- un joueur qui sprinte rattrape un brouteur en 30 s ;
- casser la ligne de vue fait perdre un chasseur ;
- un pas de côté esquive une charge ;
- manger et boire dans une scène herbe + mare ;
- benchmark `mobs` inchangé.

### M18 — Structures et contenu de la colonie perdue (retour 10, après M16)

**Moteur** :

- `StructureDef.place` (au point d'apparition, ou dans un anneau de distance et de biomes) et `storySites(ctx)`, mémoïsé et calculé à partir de `findSpawn`.
- `ItemDef.lore` : des journaux à lire dans une section Journal du Logbook.
- `ItemDef.blueprint` : des plans qui révèlent des recettes `known: 'blueprint'`.

**Contenu** :

- **Site du crash** au point d'apparition : la capsule et un casier de récupération au contenu fixe, avec le premier journal.
- **Avant-poste de la colonie** à 120–250 blocs.
- **Relais du nord** (froid) et **station du marais** (toxique).
- **Ruines aléatoires** avec butin (journaux, plans). Plus de cairns ni de cercles de pierre.

**Progression** : récupération et silex, puis cuivre, bronze et fer, puis la reconstruction avec les blocs de la colonie débloqués par des plans. Renommages selon la bible.

**Version** : GEN 7.

**Tests** :

- les sites d'histoire sont présents et déterministes sur 20 graines ;
- `reachable` atteint le fer sans les recettes à plan ni à niveau ;
- checklist d'originalité.

### M19 — Quêtes, XP, niveaux, compétences (retours 1, 13 onglet État)

**Données** : `QuestDef` avec `kind` (`story` ou `task`), XP, prérequis, objectif et récompenses d'objets. L'objectif est soit une condition existante (`conditionHolds`, plus « atteindre un site »), soit un compteur.

**Compteurs** (`PlayerState.tally`) : distance à pied, blocs cassés et posés, objets fabriqués, créatures tuées, aliments consommés, créatures scannées, nuits. Ils sont alimentés à l'étape 16 par les événements du tick.

**Chaîne d'histoire** :

- Capsule, outils, eau, abri et feu, première nuit, avant-poste, établi, cuivre, relais du nord, bronze, station du marais, fer.
- Chaque étape vise un site garanti, un biome garanti ou un objet fabricable près de l'apparition : jamais un point d'apparition chanceux.

**Tâches générales** :

- 3 tirées au hasard dans le tableau de quêtes, selon le palier du joueur : marcher 500 blocs, casser 64 blocs, fabriquer 10 objets, tuer 3 créatures, manger 5 fois, poser 50 blocs, scanner 2 créatures.
- Réclamer donne l'XP et une nouvelle tâche ; on peut en relancer une par jour de jeu.

**Progression** :

- XP uniquement par les quêtes ; niveaux ; points de compétence.
- Compétences :
  - vitalité (+10 PV) ;
  - endurance (+10) ;
  - portage (+4 cases) ;
  - métabolisme (−6 % faim et soif) ;
  - résistance (+1,5 °C de confort) ;
  - force (+6 % corps à corps et minage).
- `playerStats(player)` passe par les points d'accroche existants : `clampGauge`, `staminaCap`, taux des jauges, `thermalStatus`, dégâts, minage, taille de l'inventaire.

**Recettes exclusives** (`RecipeDef.level`) : armature de sac à dos (+8 cases, deux fois), Scanner Mk II, combinaison isolante. `reachable` sans recettes à niveau doit atteindre le fer.

**Interface** :

- Les objectifs quittent le HUD : seul un message de progression ou de réussite reste.
- Onglets Quêtes (réclamer, relancer, épingler à la boussole) et État (compétences, effets actifs avec leur règle exacte).

**Sauvegarde** : SAVE 10. Les anciens objectifs deviennent des quêtes d'histoire réussies, avec leur XP.

**Tests** :

- marche d'histoire sur 5 graines ;
- chaque tâche réussie en monde plat ;
- calcul d'XP et de niveaux ;
- chaque effet de compétence ;
- migration v9 ;
- suite m19.

### M20 — Lisibilité (retours 14, 18 côté client, 13 affichage)

- **Coup chargé visible** :
  - la main recule selon la charge et tremble une fois prête ;
  - un anneau au réticule se remplit et flashe à 0,5 s, avec un son « prêt » ;
  - la traînée n'apparaît que pour un coup chargé, avec un marqueur d'impact plus fort.
- **Manger et boire** : la main porte l'objet à la bouche avec un léger balancement (miettes ou inclinaison).
- **Mots d'état** :
  - icône et infobulle pour chacun ;
  - « À couvert » et « Abrité » fusionnés en une seule ligne d'abri ;
  - « Inaperçu » devient un œil au réticule ;
  - « Épuisé » passe par l'arc d'endurance rouge.

### M21 — Disposition du HUD (retour 11, dernier)

- Placement :
  - jauges et effets en bas à gauche, au-dessus de la barre ;
  - boussole en haut au centre, avec le panneau de cible dessous ;
  - horloge en haut à droite, avec l'épingle de quête ;
  - messages à droite.
- Test e2e en 1024×768, 1280×720 et 1920×1080 : chaque `#hud-*` reste dans l'écran sans chevauchement.

**Ensuite** : la boucle d'amélioration reprend (audits, corrections, une PR par chantier).

## Réponses aux questions de la partie test

**Les mots du HUD.** Aucun n'est décoratif, tous changent les règles :

| Mot       | Effet en jeu                                                         |
| --------- | -------------------------------------------------------------------- |
| Abrité    | température tirée vers 18 °C, toxicité ×0,2 ; nécessaire pour dormir |
| À couvert | −8 °C seulement au-dessus de 28 °C, toxicité ×0,7                    |
| Épuisé    | pas de sprint, minage plus lent                                      |
| Affamé    | endurance plafonnée à 50                                             |
| Assoiffé  | endurance récupérée moitié moins vite                                |
| Froid     | faim ×1,5, pas de régénération                                       |
| Chaud     | soif ×2, pas de régénération                                         |
| Nauséeux  | pas de régénération                                                  |
| Affaibli  | dégâts ×0,8                                                          |
| Inaperçu  | les créatures t'ignorent 5 s                                         |

Ce qui manquait, c'est l'explication. M20 ajoute les infobulles et M19 l'onglet État.

**Les pointillés.** C'est la traînée d'attaque, affichée à chaque fin de coup visant une créature, identique pour un coup léger ou chargé. Le coup chargé existe bien : 0,5 s tenu donne ×1,8 dégâts et ×1,5 recul. Mais rien ne le montrait ; M20 le rend lisible.

## Fichiers critiques v2

- `src/sim/Simulation.ts` : ordre du tick, étape 10.
- `src/sim/edits.ts`, `src/sim/blockUpdates.ts` (nouveau), `src/sim/blockRemoval.ts`.
- `src/sim/inventory.ts`, `src/sim/slotClicks.ts` (nouveau), `src/sim/blockEntityCommands.ts`, `src/sim/stations.ts`.
- `src/world/gen/{sample,climate,decor,structures}.ts`, `src/content/packs/base/worldgen.ts`.
- `src/world/mesh/greedyMesher.ts`, `src/world/raycast.ts`.
- `src/sim/ai/{brains,senses,behaviours,creatureStep}.ts`, `src/sim/creatureBody.ts`.
- `src/content/schema.ts`, `src/content/registry.ts`, `src/content/reachability.ts`.

## Vérification v2 (à chaque jalon)

1. `npm run verify` vert : types, Biome, Vitest, build, budget gzip ≤ 400 Ko.
2. `npm run test:perf`, `npm run test:slow`, et `npm run headless -- --seed=42 --ticks=3000 --bot=wander` deux fois avec le même hash. Si le hash change volontairement, la raison est écrite dans la PR.
3. Navigateur intégré : `?selftest=mN` puis `?selftest=all` dans ses configurations, `__game.errors()` vide, `i18nMissing()` vide, captures relues.
4. `npm run e2e` vert (dont `selftest.spec` sur les 8 configurations et la couverture de chaque cas) ; `npm run e2e:perf` en local quand le rendu ou la sim change.
5. Revue adversariale en deux passes, avec un test qui échoue sans chaque correction ; PR, CI verte, squash-merge, compte rendu en français.

## Risques v2

- La réécriture des autotests et des bots (M13, M19).
- Le coût de l'eau en lumière et en remaillage (M15), protégé par des budgets et un test de perf.
- Le réglage de l'IA (M17) : les chiffres sont en données, et les tests vérifient des résultats plutôt que des ticks exacts.
- Les sites d'histoire calculés dans les workers (M18, mémoïsés).
- Le budget gzip avec les nouveaux écrans.
