# Guide de Génération de Code Backend pour LLM
## Social Finance Impact Platform MVP

## 1. Instructions de génération pour modèle de langage

### 1.1 Méthode de développement LLM

**Principe fondamental** : Générer du code complet, fonctionnel et testé d'un seul bloc, sans itérations humaines.

**Ordre de génération obligatoire** :
1. **Structure complète du projet** avec tous les dossiers et fichiers
2. **Configuration Firebase** (firebase.json, .firebaserc, package.json)
3. **Types TypeScript** et interfaces globales
4. **Utilitaires de base** (auth, validation, logging, erreurs)
5. **Firebase Functions** dans l'ordre des dépendances
6. **Tests complets** pour chaque fonction
7. **Fichiers de configuration** (rules, environment)

### 1.2 Standards de code obligatoires pour LLM

**TypeScript strict mode obligatoire** :
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

**Patterns de validation obligatoires** :
- Chaque fonction doit avoir un schéma Joi de validation
- Chaque input doit être validé avant traitement
- Chaque erreur doit être typée et loggée

**Structure de fonction standardisée** :
```typescript
// Template obligatoire pour chaque fonction
import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';

// 1. Définir les types d'interface
interface FunctionRequestData {
  // Types précis obligatoires
}

interface FunctionResponseData {
  // Types précis obligatoires
}

// 2. Schéma de validation Joi obligatoire
const requestSchema = Joi.object({
  // Validation complète de tous les champs
}).required();

// 3. Logique métier séparée (testable)
async function executeBusinessLogic(
  data: FunctionRequestData,
  context: CallableContext
): Promise<FunctionResponseData> {
  // Implémentation complète ici
}

// 4. Function Firebase avec gestion d'erreurs
export const functionName = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<FunctionResponseData> => {
    // Validation d'authentification
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const { error, value } = requestSchema.validate(data);
    if (error) {
      throw new https.HttpsError('invalid-argument', error.details[0].message);
    }

    // Logging structuré
    logger.info('Function called', {
      functionName: 'functionName',
      uid: context.auth.uid,
      data: value
    });

    // Exécution métier
    const result = await executeBusinessLogic(value, context);

    // Logging du résultat
    logger.info('Function completed', {
      functionName: 'functionName',
      uid: context.auth.uid,
      success: true
    });

    return result;
  })
);
```

## 2. Modules obligatoires à générer

### 2.1 Module utils (à générer en premier)

**Fichiers obligatoires** :
- `src/utils/logger.ts` - Logging structuré avec corrélation IDs
- `src/utils/errors.ts` - Types d'erreurs et gestion
- `src/utils/validation.ts` - Validateurs réutilisables  
- `src/utils/auth.ts` - Helpers d'authentification
- `src/utils/firestore.ts` - Helpers base de données
- `src/utils/constants.ts` - Constantes globales

**Template logger.ts obligatoire** :
```typescript
import { logger as functionsLogger } from 'firebase-functions';

export interface LogContext {
  functionName?: string;
  uid?: string;
  correlationId?: string;
  [key: string]: any;
}

class StructuredLogger {
  private generateCorrelationId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  info(message: string, context: LogContext = {}) {
    const correlationId = context.correlationId || this.generateCorrelationId();
    functionsLogger.info(message, {
      ...context,
      correlationId,
      timestamp: new Date().toISOString()
    });
  }

  error(message: string, error: Error, context: LogContext = {}) {
    const correlationId = context.correlationId || this.generateCorrelationId();
    functionsLogger.error(message, {
      ...context,
      correlationId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      timestamp: new Date().toISOString()
    });
  }

  warn(message: string, context: LogContext = {}) {
    const correlationId = context.correlationId || this.generateCorrelationId();
    functionsLogger.warn(message, {
      ...context,
      correlationId,
      timestamp: new Date().toISOString()
    });
  }
}

export const logger = new StructuredLogger();
```

### 2.2 Module auth (authentification)

**Functions à générer** :
1. `completeProfile` - Complétion profil utilisateur
2. `initKYC` - Initialisation vérification KYC
3. `handleKYCWebhook` - Traitement callbacks Sumsub
4. `updateProfile` - Mise à jour profil

**Template completeProfile obligatoire** :
```typescript
import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import { getFirestore } from 'firebase-admin/firestore';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';

interface CompleteProfileRequest {
  userType: 'contributor' | 'creator';
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  dateOfBirth: string;
  address: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  preferences: {
    language: 'fr' | 'en';
    currency: 'EUR';
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
    };
  };
}

const requestSchema = Joi.object({
  userType: Joi.string().valid('contributor', 'creator').required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).optional(),
  dateOfBirth: Joi.string().isoDate().required(),
  address: Joi.object({
    street: Joi.string().min(5).max(200).required(),
    city: Joi.string().min(2).max(100).required(),
    postalCode: Joi.string().min(3).max(10).required(),
    country: Joi.string().length(2).required()
  }).required(),
  preferences: Joi.object({
    language: Joi.string().valid('fr', 'en').required(),
    currency: Joi.string().valid('EUR').required(),
    notifications: Joi.object({
      email: Joi.boolean().required(),
      push: Joi.boolean().required(),
      inApp: Joi.boolean().required()
    }).required()
  }).required()
}).required();

async function executeCompleteProfile(
  data: CompleteProfileRequest,
  context: CallableContext
) {
  const db = getFirestore();
  const uid = context.auth!.uid;

  // Vérifier si le profil n'est pas déjà complet
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists && userDoc.data()?.profileComplete === true) {
    throw new https.HttpsError('already-exists', 'Profile already completed');
  }

  // Créer le document utilisateur complet
  const userData = {
    uid,
    email: context.auth!.token.email,
    ...data,
    profileComplete: true,
    kycStatus: 'pending',
    kycLevel: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    stats: {
      projectsCreated: 0,
      totalContributed: 0,
      totalRaised: 0,
      successfulProjects: 0
    }
  };

  await db.collection('users').doc(uid).set(userData);

  // Définir les custom claims
  await admin.auth().setCustomUserClaims(uid, {
    role: data.userType,
    kycStatus: 'pending',
    kycLevel: 0
  });

  return {
    success: true,
    profileComplete: true,
    kycRequired: true,
    nextStep: 'kyc_verification'
  };
}

export const completeProfile = https.onCall(
  withErrorHandling(executeCompleteProfile)
);
```

### 2.3 Structure de génération des tests

**Tests obligatoires pour chaque fonction** :
```typescript
// Template test obligatoire
import { completeProfile } from '../auth/completeProfile';
import { testUtils } from '../../test/utils';

describe('completeProfile', () => {
  let testEnv: any;

  beforeAll(async () => {
    testEnv = await testUtils.initializeTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearAuth();
  });

  describe('Success cases', () => {
    test('should complete profile with valid data', async () => {
      // Test complet avec assertions précises
    });
  });

  describe('Error cases', () => {
    test('should reject unauthenticated requests', async () => {
      // Test d'erreur avec assertions précises
    });

    test('should reject invalid data', async () => {
      // Test validation avec assertions précises
    });
  });
});
```

## 3. Séquence de génération obligatoire

### Phase 1: Structure et configuration
1. Structure complète des dossiers
2. package.json avec dépendances exactes
3. firebase.json avec configuration complète
4. tsconfig.json avec options strictes
5. .eslintrc.js avec règles strictes

### Phase 2: Utilitaires de base
1. Types et interfaces globaux
2. Utilitaires (logger, errors, validation, auth, firestore)
3. Constants et configuration

### Phase 3: Firebase Functions par domaine
1. Module auth (4 functions)
2. Module projects (6 functions) 
3. Module payments (5 functions)
4. Module audits (4 functions)
5. Module notifications (3 functions)
6. Triggers et scheduled functions

### Phase 4: Tests et configuration
1. Tests unitaires pour chaque function
2. Tests d'intégration
3. Firestore security rules
4. Storage security rules

## 4. Validation et vérification automatique

### 4.1 Checklist de validation LLM

**Pour chaque fonction générée, vérifier** :
- [ ] Types TypeScript complets et stricts
- [ ] Schéma Joi de validation présent
- [ ] Gestion d'erreurs avec withErrorHandling
- [ ] Logging structuré présent
- [ ] Test unitaire avec > 80% coverage
- [ ] Documentation TSDoc complète
- [ ] Respect des patterns de sécurité

**Pour le projet complet, vérifier** :
- [ ] Compilation TypeScript sans erreurs
- [ ] Tous les imports résolus
- [ ] Configuration Firebase complète
- [ ] Security rules Firestore validées
- [ ] Toutes les fonctions testées
- [ ] Package.json avec bonnes versions

Cette approche permet à un LLM de générer un backend complet, fonctionnel et maintenir une cohérence parfaite dans tout le code généré.