# Structure Complète de Projet Backend pour Génération LLM
## Social Finance Impact Platform MVP

## 1. Architecture complète des dossiers et fichiers

### 1.1 Arborescence exacte à générer

```
social-impact-backend/
├── .gitignore                          # Exclusions Git
├── .firebaserc                         # Configuration projets Firebase
├── firebase.json                       # Configuration Firebase
├── firestore.rules                     # Règles de sécurité Firestore
├── firestore.indexes.json              # Index composites Firestore
├── storage.rules                       # Règles de sécurité Storage
├── functions/                          # Dossier Firebase Functions
│   ├── package.json                    # Dépendances et scripts
│   ├── package-lock.json               # Lock file dépendances
│   ├── tsconfig.json                   # Configuration TypeScript
│   ├── .eslintrc.js                    # Configuration ESLint
│   ├── .env.example                    # Template variables d'environnement
│   ├── jest.config.js                  # Configuration Jest
│   ├── src/                            # Code source TypeScript
│   │   ├── index.ts                    # Point d'entrée principal
│   │   ├── types/                      # Types TypeScript globaux
│   │   │   ├── global.ts               # Interfaces globales
│   │   │   ├── firestore.ts            # Types documents Firestore
│   │   │   ├── api.ts                  # Types API requests/responses
│   │   │   └── external.ts             # Types APIs externes
│   │   ├── utils/                      # Utilitaires partagés
│   │   │   ├── logger.ts               # Logging structuré
│   │   │   ├── errors.ts               # Gestion d'erreurs
│   │   │   ├── validation.ts           # Validateurs Joi
│   │   │   ├── auth.ts                 # Helpers authentification
│   │   │   ├── firestore.ts            # Helpers Firestore
│   │   │   ├── constants.ts            # Constantes globales
│   │   │   └── helpers.ts              # Fonctions utilitaires
│   │   ├── auth/                       # Module authentification
│   │   │   ├── completeProfile.ts      # Complétion profil
│   │   │   ├── initKYC.ts              # Initialisation KYC
│   │   │   ├── handleKYCWebhook.ts     # Webhook KYC Sumsub
│   │   │   ├── updateProfile.ts        # Mise à jour profil
│   │   │   └── __tests__/              # Tests module auth
│   │   │       ├── completeProfile.test.ts
│   │   │       ├── initKYC.test.ts
│   │   │       ├── handleKYCWebhook.test.ts
│   │   │       └── updateProfile.test.ts
│   │   ├── projects/                   # Module projets
│   │   │   ├── createProject.ts        # Création projet
│   │   │   ├── submitProject.ts        # Soumission approbation
│   │   │   ├── moderateProject.ts      # Modération IA
│   │   │   ├── publishProject.ts       # Publication projet
│   │   │   ├── getProjectDetails.ts    # Détails projet
│   │   │   ├── searchProjects.ts       # Recherche projets
│   │   │   └── __tests__/              # Tests module projects
│   │   │       ├── createProject.test.ts
│   │   │       ├── submitProject.test.ts
│   │   │       ├── moderateProject.test.ts
│   │   │       ├── publishProject.test.ts
│   │   │       ├── getProjectDetails.test.ts
│   │   │       └── searchProjects.test.ts
│   │   ├── payments/                   # Module paiements
│   │   │   ├── createContribution.ts   # Création contribution
│   │   │   ├── confirmPayment.ts       # Confirmation paiement
│   │   │   ├── handleStripeWebhook.ts  # Webhook Stripe
│   │   │   ├── processRefunds.ts       # Gestion remboursements
│   │   │   ├── releaseEscrow.ts        # Déblocage fonds
│   │   │   └── __tests__/              # Tests module payments
│   │   │       ├── createContribution.test.ts
│   │   │       ├── confirmPayment.test.ts
│   │   │       ├── handleStripeWebhook.test.ts
│   │   │       ├── processRefunds.test.ts
│   │   │       └── releaseEscrow.test.ts
│   │   ├── audits/                     # Module audits
│   │   │   ├── assignAuditor.ts        # Assignment auditeur
│   │   │   ├── acceptAudit.ts          # Acceptation audit
│   │   │   ├── submitAuditReport.ts    # Soumission rapport
│   │   │   ├── releaseFunds.ts         # Déblocage après audit
│   │   │   └── __tests__/              # Tests module audits
│   │   │       ├── assignAuditor.test.ts
│   │   │       ├── acceptAudit.test.ts
│   │   │       ├── submitAuditReport.test.ts
│   │   │       └── releaseFunds.test.ts
│   │   ├── notifications/              # Module notifications
│   │   │   ├── sendNotification.ts     # Envoi notification
│   │   │   ├── processEmailQueue.ts    # Queue emails SendGrid
│   │   │   ├── cleanupNotifications.ts # Nettoyage notifications
│   │   │   └── __tests__/              # Tests module notifications
│   │   │       ├── sendNotification.test.ts
│   │   │       ├── processEmailQueue.test.ts
│   │   │       └── cleanupNotifications.test.ts
│   │   ├── triggers/                   # Functions déclenchées
│   │   │   ├── onUserCreate.ts         # Trigger création utilisateur
│   │   │   ├── onProjectUpdate.ts      # Trigger mise à jour projet
│   │   │   ├── onContributionCreate.ts # Trigger nouvelle contribution
│   │   │   ├── onAuditComplete.ts      # Trigger audit terminé
│   │   │   └── __tests__/              # Tests triggers
│   │   │       ├── onUserCreate.test.ts
│   │   │       ├── onProjectUpdate.test.ts
│   │   │       ├── onContributionCreate.test.ts
│   │   │       └── onAuditComplete.test.ts
│   │   ├── scheduled/                  # Tâches programmées
│   │   │   ├── dailyStats.ts           # Statistiques quotidiennes
│   │   │   ├── projectDeadlines.ts     # Vérification échéances
│   │   │   ├── cleanupExpired.ts       # Nettoyage données expirées
│   │   │   └── __tests__/              # Tests scheduled
│   │   │       ├── dailyStats.test.ts
│   │   │       ├── projectDeadlines.test.ts
│   │   │       └── cleanupExpired.test.ts
│   │   └── integrations/               # Intégrations API externes
│   │       ├── stripe/                 # Service Stripe
│   │       │   ├── stripeService.ts    # Client Stripe
│   │       │   └── webhookHandlers.ts  # Handlers webhooks
│   │       ├── sumsub/                 # Service Sumsub KYC
│   │       │   ├── sumsubService.ts    # Client Sumsub
│   │       │   └── webhookHandlers.ts  # Handlers webhooks
│   │       ├── sendgrid/               # Service SendGrid
│   │       │   ├── emailService.ts     # Client SendGrid
│   │       │   └── templates.ts        # Templates emails
│   │       └── __tests__/              # Tests intégrations
│   │           ├── stripe.test.ts
│   │           ├── sumsub.test.ts
│   │           └── sendgrid.test.ts
│   ├── test/                           # Configuration tests
│   │   ├── setup.ts                    # Setup global tests
│   │   ├── utils/                      # Utilitaires tests
│   │   │   ├── testHelpers.ts          # Helpers tests
│   │   │   ├── mockData.ts             # Données de test
│   │   │   └── fixtures.ts             # Fixtures tests
│   │   └── mocks/                      # Mocks services externes
│   │       ├── stripe.mock.ts
│   │       ├── sumsub.mock.ts
│   │       └── sendgrid.mock.ts
│   └── lib/                            # Code compilé TypeScript (généré)
└── docs/                               # Documentation (optionnel pour LLM)
    ├── api/                            # Documentation API
    ├── deployment/                     # Guides déploiement
    └── troubleshooting/                # Guide dépannage
```

### 1.2 Fichiers de configuration obligatoires

**`.gitignore`** (complet) :
```
# Dependencies
node_modules/
npm-debug.log*

# Firebase
.firebase/
.firebaserc.local

# Environment variables
.env
.env.local
.env.development
.env.staging
.env.production

# TypeScript
*.tsbuildinfo
lib/
dist/

# Tests
coverage/
.nyc_output/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Runtime
*.pid
*.seed
*.pid.lock

# Firebase Functions
functions/lib/
functions/.env*
```

**`.firebaserc`** (configuration projets) :
```json
{
  "projects": {
    "development": "social-impact-mvp-dev",
    "staging": "social-impact-mvp-staging",
    "production": "social-impact-mvp-prod"
  },
  "targets": {},
  "etags": {}
}
```

## 2. Séquence exacte de génération par un LLM

### 2.1 Étape 1: Fichiers de configuration racine

**Ordre obligatoire** :
1. `package.json` (functions/) avec toutes les dépendances
2. `tsconfig.json` avec configuration stricte
3. `firebase.json` avec configuration complète
4. `.firebaserc` avec projets multi-environnements
5. `jest.config.js` pour la configuration des tests
6. `.eslintrc.js` pour la qualité de code

### 2.2 Étape 2: Types et interfaces globaux

**Générer dans l'ordre** :
1. `src/types/global.ts` - Interfaces de base
2. `src/types/firestore.ts` - Types documents Firestore
3. `src/types/api.ts` - Types requêtes/réponses API
4. `src/types/external.ts` - Types APIs externes

**Template `src/types/global.ts`** :
```typescript
export interface BaseDocument {
  id?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  startAfter?: any;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
    nextPageToken?: string;
  };
}

export type UserType = 'contributor' | 'creator' | 'auditor' | 'admin';
export type KYCStatus = 'pending' | 'approved' | 'rejected' | 'requires_action';
export type ProjectStatus = 'draft' | 'pending_approval' | 'live' | 'funded' | 'completed' | 'cancelled';
export type ContributionStatus = 'pending' | 'confirmed' | 'refunded' | 'released';
export type AuditStatus = 'assigned' | 'in_progress' | 'completed' | 'overdue';
```

### 2.3 Étape 3: Modules utilitaires (base)

**Générer dans l'ordre strict** :
1. `src/utils/constants.ts` - Toutes les constantes
2. `src/utils/logger.ts` - Système de logging
3. `src/utils/errors.ts` - Gestion d'erreurs typées
4. `src/utils/validation.ts` - Schémas Joi réutilisables
5. `src/utils/firestore.ts` - Helpers base de données
6. `src/utils/auth.ts` - Helpers authentification
7. `src/utils/helpers.ts` - Fonctions utilitaires

### 2.4 Étape 4: Services d'intégration externe

**Ordre critique (dépendances)** :
1. `src/integrations/stripe/stripeService.ts`
2. `src/integrations/sumsub/sumsubService.ts`
3. `src/integrations/sendgrid/emailService.ts`
4. Tests correspondants pour chaque service

### 2.5 Étape 5: Functions Firebase par module

**Ordre de génération des modules** :
1. **auth/** - Module authentification (4 functions + tests)
2. **projects/** - Module projets (6 functions + tests)
3. **payments/** - Module paiements (5 functions + tests)
4. **audits/** - Module audits (4 functions + tests)
5. **notifications/** - Module notifications (3 functions + tests)
6. **triggers/** - Functions déclenchées (4 functions + tests)
7. **scheduled/** - Tâches programmées (3 functions + tests)

**Pour chaque function, générer** :
- Le fichier TypeScript principal
- Son test unitaire complet
- Les types d'interface spécifiques

### 2.6 Étape 6: Point d'entrée et configuration finale

**Générer** :
1. `src/index.ts` - Export de toutes les functions
2. `firestore.rules` - Règles de sécurité complètes
3. `firestore.indexes.json` - Index composites
4. `storage.rules` - Règles Storage
5. Configuration utilitaires tests

## 3. Template du point d'entrée principal

### 3.1 `src/index.ts` complet

```typescript
// Export de toutes les Firebase Functions
// Ce fichier est le point d'entrée principal généré automatiquement

// Auth module
export { completeProfile } from './auth/completeProfile';
export { initKYC } from './auth/initKYC';
export { handleKYCWebhook } from './auth/handleKYCWebhook';
export { updateProfile } from './auth/updateProfile';

// Projects module
export { createProject } from './projects/createProject';
export { submitProject } from './projects/submitProject';
export { moderateProject } from './projects/moderateProject';
export { publishProject } from './projects/publishProject';
export { getProjectDetails } from './projects/getProjectDetails';
export { searchProjects } from './projects/searchProjects';

// Payments module
export { createContribution } from './payments/createContribution';
export { confirmPayment } from './payments/confirmPayment';
export { handleStripeWebhook } from './payments/handleStripeWebhook';
export { processRefunds } from './payments/processRefunds';
export { releaseEscrow } from './payments/releaseEscrow';

// Audits module
export { assignAuditor } from './audits/assignAuditor';
export { acceptAudit } from './audits/acceptAudit';
export { submitAuditReport } from './audits/submitAuditReport';
export { releaseFunds } from './audits/releaseFunds';

// Notifications module
export { sendNotification } from './notifications/sendNotification';
export { processEmailQueue } from './notifications/processEmailQueue';
export { cleanupNotifications } from './notifications/cleanupNotifications';

// Triggers
export { onUserCreate } from './triggers/onUserCreate';
export { onProjectUpdate } from './triggers/onProjectUpdate';
export { onContributionCreate } from './triggers/onContributionCreate';
export { onAuditComplete } from './triggers/onAuditComplete';

// Scheduled functions
export { dailyStats } from './scheduled/dailyStats';
export { projectDeadlines } from './scheduled/projectDeadlines';
export { cleanupExpired } from './scheduled/cleanupExpired';
```

## 4. Validation et vérification post-génération

### 4.1 Checklist de validation automatique

**Structure de projet** :
- [ ] Tous les dossiers créés selon arborescence
- [ ] Tous les fichiers de configuration présents
- [ ] Point d'entrée `index.ts` exportant toutes les functions
- [ ] Tests créés pour chaque function

**Configuration** :
- [ ] `package.json` avec bonnes versions dépendances
- [ ] `tsconfig.json` avec mode strict activé
- [ ] `firebase.json` avec configuration complète
- [ ] Variables d'environnement documentées

**Code généré** :
- [ ] Compilation TypeScript sans erreurs
- [ ] Tous les imports résolus correctement
- [ ] Couverture de tests > 80% pour chaque module
- [ ] ESLint sans erreurs sur tout le code

**Firebase** :
- [ ] Security rules Firestore validées
- [ ] Index composites définis
- [ ] Storage rules configurées
- [ ] Configuration multi-environnements

### 4.2 Commandes de vérification post-génération

```bash
# Dans le dossier functions/
npm install                    # Installation dépendances
npm run lint                   # Vérification ESLint
npm run build                  # Compilation TypeScript
npm run test                   # Lancement tests
npm run test:coverage          # Vérification couverture

# Validation Firebase
firebase use development       # Sélection environnement
firebase deploy --dry-run      # Test déploiement
```

Cette structure permet à un LLM de générer un projet backend Firebase complet et fonctionnel en suivant un ordre strict qui respecte les dépendances entre modules et garantit la cohérence de l'ensemble.