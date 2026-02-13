# 🔴 PROBLÈME BACKEND CRITIQUE - Cloud Functions Non Déployées
**Date:** 11 janvier 2026  
**Agent:** Frontend AI  
**Destinataire:** Backend AI Agent  
**Priorité:** BLOQUANTE

---

## 📋 RÉSUMÉ EXÉCUTIF

Lorsqu'un utilisateur tente de faire une **contribution à un projet** via l'écran "Make a Contribution", une erreur `[firebase_functions/not-found] NOT_FOUND` est retournée. L'analyse révèle que la Cloud Function `stripeCreatePaymentIntent` **existe dans le code source** mais **n'est pas déployée sur Firebase**.

---

## 🔍 DESCRIPTION DÉTAILLÉE DU PROBLÈME

### Contexte
- **Utilisateur:** Connecté en mode Investor
- **Scénario:** 
  1. Utilisateur clique sur "Invest Now" ou "Contribute Now"
  2. Sélectionne un montant prédéfini (25€, 50€, 100€, etc.)
  3. Clique sur "Confirm Payment"
- **Résultat:** Erreur affichée à l'utilisateur

### Erreur affichée
```
Failed to create contribution:
[firebase_functions/not-found] NOT_FOUND
```

### Stack trace complète
```
#0    CloudFunctionsHostApi.call
      (package:cloud_functions_platform_interface/src/pigeon/messages.pigeon.dart:84:7)
      <asynchronous suspension>
#1    MethodChannelHttpsCallable.call
      (package:cloud_functions_platform_interface/src/method_channel/method_channel_https_callable.dart:33:24)
      <asynchronous suspension>
#2    HttpsCallable.call
      (package:cloud_functions/src/https_callable.dart:49:37)
      <asynchronous suspension>
#3    InvestmentsRepositoryImpl.createContribution
      (package:social_impact_mvp/features/investments/data/repositories/investments_repository_impl.dart:64:22)
      <asynchronous suspension>
#4    _ContributeScreenState._handleContribution
      (package:social_impact_mvp/features/projects/presentation/screens/contribute_screen.dart:381:22)
      <asynchronous suspension>
```

---

## 🐛 CAUSE RACINE IDENTIFIÉE

### 1. Code Frontend (Appel Cloud Function)

**Fichier:** `lib/features/investments/data/repositories/investments_repository_impl.dart` (lignes 56-78)

```dart
Future<({String clientSecret, String contributionId})> createContribution({
  required String uid,
  required String projectId,
  required int amountCents,
  bool anonymous = false,
  String? message,
}) async {
  try {
    // Call Firebase Cloud Function to create Stripe PaymentIntent
    final callable = FirebaseFunctions.instance.httpsCallable(
      'stripeCreatePaymentIntent', // ← Fonction appelée
    );

    final result = await callable.call<Map<String, dynamic>>({
      'amount': amountCents,
      'currency': 'eur',
      'projectId': projectId,
      'contributorId': uid,
    });

    final data = result.data;
    if (data['clientSecret'] == null || data['paymentIntentId'] == null) {
      throw Exception('Invalid response from payment intent creation');
    }

    return (
      clientSecret: data['clientSecret'] as String,
      contributionId: data['paymentIntentId'] as String,
    );
  } catch (e) {
    debugPrint('❌ Error creating contribution: $e');
    rethrow;
  }
}
```

### 2. Code Backend (Cloud Function Existante)

**Fichier:** `functions/src/payments/create-payment-intent.ts` (lignes 22-108)

```typescript
export const stripeCreatePaymentIntent = functions.https.onCall(
  async (data: PaymentIntentData, context) => {
    // Verify authentication
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated to create payment intent'
      );
    }

    const { amount, currency, projectId, contributorId, milestoneId } = data;

    // Validation
    if (!amount || amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid amount');
    }

    // Verify project exists and is accepting contributions
    const projectRef = admin.firestore().collection('projects').doc(projectId);
    const projectDoc = await projectRef.get();

    if (!projectDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Project not found');
    }

    const project = projectDoc.data();
    if (project?.status !== 'fundingActive') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Project is not accepting contributions'
      );
    }

    try {
      // Create payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: currency.toLowerCase(),
        metadata: {
          projectId,
          contributorId,
          ...(milestoneId && { milestoneId }),
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      // Log payment intent creation in Firestore
      await admin.firestore().collection('payment_intents').doc(paymentIntent.id).set({
        projectId,
        contributorId,
        milestoneId: milestoneId || null,
        amount,
        currency,
        status: paymentIntent.status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      functions.logger.error('Error creating payment intent:', error);
      throw new functions.https.HttpsError('internal', 'Failed to create payment intent');
    }
  }
);
```

**Fichier:** `functions/src/index.ts` (ligne 18)

```typescript
// Export function modules
export {stripeCreatePaymentIntent} from './payments/create-payment-intent'; // ✅ Exportée
export {stripeWebhook} from './payments/stripe-webhook';
```

### 3. Diagnostic

**✅ Le code de la fonction existe et est correct**  
**✅ La fonction est exportée dans index.ts**  
**❌ La fonction n'est PAS déployée sur Firebase**

**Vérification possible:**
```bash
# Lister les fonctions déployées
firebase functions:list

# Résultat attendu (mais probablement pas présent):
# - stripeCreatePaymentIntent (httpsCallable)
# - stripeWebhook (https)
# - assignAuditToAuditor
# - sendNotification
# - healthCheck
```

---

## ✅ SOLUTION RECOMMANDÉE

### Solution : Déployer les Cloud Functions sur Firebase

Les Cloud Functions doivent être **compilées et déployées** sur Firebase pour être accessibles depuis l'app Flutter.

---

## 🔧 INSTRUCTIONS D'IMPLÉMENTATION

### Étape 1 : Vérifier les prérequis

**A. Vérifier la configuration Stripe**

La fonction `stripeCreatePaymentIntent` nécessite une clé API Stripe. Vérifiez que la configuration Firebase contient cette clé.

```bash
# Vérifier la configuration Firebase actuelle
firebase functions:config:get

# Si STRIPE_SECRET_KEY n'existe pas, l'ajouter
firebase functions:config:set stripe.secret_key="sk_test_VOTRE_CLE_STRIPE"
```

**⚠️ IMPORTANT:** Utilisez une clé de **test** pour le développement (`sk_test_...`) et une clé de **production** (`sk_live_...`) pour la production.

**B. Vérifier les variables d'environnement locales**

**Fichier:** `functions/.env` (créer si n'existe pas)

```env
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_STRIPE_TEST
FIREBASE_PROJECT_ID=social-impact-mvp-prod-b6805
```

---

### Étape 2 : Compiler et déployer les fonctions

**A. Installer les dépendances**

```bash
cd functions
npm install
```

**B. Compiler le code TypeScript**

```bash
npm run build

# Ou si le script n'existe pas dans package.json:
npx tsc
```

**C. Déployer sur Firebase**

```bash
# Option 1: Déployer TOUTES les fonctions
firebase deploy --only functions

# Option 2: Déployer UNIQUEMENT stripeCreatePaymentIntent (plus rapide)
firebase deploy --only functions:stripeCreatePaymentIntent

# Option 3: Déployer plusieurs fonctions spécifiques
firebase deploy --only functions:stripeCreatePaymentIntent,functions:stripeWebhook
```

**Sortie attendue:**
```
✔  functions: Finished running predeploy script.
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
i  functions: ensuring required API cloudbuild.googleapis.com is enabled...
✔  functions: required API cloudfunctions.googleapis.com is enabled
✔  functions: required API cloudbuild.googleapis.com is enabled
i  functions: preparing functions directory for uploading...
i  functions: packaged functions (X.XX KB) for uploading
✔  functions: functions folder uploaded successfully
i  functions: creating Node.js 18 function stripeCreatePaymentIntent(us-central1)...
✔  functions[stripeCreatePaymentIntent(us-central1)]: Successful create operation.
Function URL (stripeCreatePaymentIntent): https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeCreatePaymentIntent

✔  Deploy complete!
```

---

### Étape 3 : Vérifier le déploiement

**A. Via Firebase Console**

1. Aller sur [Firebase Console](https://console.firebase.google.com/)
2. Sélectionner le projet `social-impact-mvp-prod-b6805`
3. Naviguer vers **Functions** dans le menu latéral
4. Vérifier que `stripeCreatePaymentIntent` apparaît dans la liste avec statut **Active**

**B. Via CLI**

```bash
# Lister toutes les fonctions déployées
firebase functions:list

# Résultat attendu:
# ┌──────────────────────────────┬────────────────┬────────┐
# │ Name                         │ Type           │ State  │
# ├──────────────────────────────┼────────────────┼────────┤
# │ stripeCreatePaymentIntent    │ httpsCallable  │ Active │
# │ stripeWebhook                │ https          │ Active │
# │ assignAuditToAuditor         │ httpsCallable  │ Active │
# │ sendNotification             │ httpsCallable  │ Active │
# │ healthCheck                  │ https          │ Active │
# └──────────────────────────────┴────────────────┴────────┘
```

**C. Tester la fonction via curl (optionnel)**

```bash
# Note: Les fonctions httpsCallable nécessitent un token d'authentification
# Ce test est principalement pour vérifier que la fonction existe

curl -X POST \
  https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeCreatePaymentIntent \
  -H "Content-Type: application/json" \
  -d '{"data":{}}'

# Résultat attendu (erreur d'authentification = fonction existe):
# {"error":{"message":"Unauthenticated","status":"UNAUTHENTICATED"}}

# Si fonction non déployée (erreur à corriger):
# {"error":{"code":404,"message":"Function not found"}}
```

---

### Étape 4 : Tester depuis l'app Flutter

**A. Redémarrer l'application Flutter**

```bash
# Hot restart pour recharger les configurations
# Dans la console Flutter, appuyer sur 'R'

# Ou relancer complètement l'app:
flutter run
```

**B. Tester le flow de contribution**

1. Se connecter en mode Investor
2. Naviguer vers "Browse Projects"
3. Sélectionner un projet avec statut `fundingActive`
4. Cliquer sur "Invest Now" ou "Contribute Now"
5. Sélectionner un montant (ex: 50€)
6. Cliquer sur "Confirm Payment"

**Résultat attendu:**
- ✅ Aucune erreur NOT_FOUND
- ✅ Interface de paiement Stripe s'affiche
- ✅ Possibilité d'entrer les informations de carte

**Résultat en cas d'erreur:**
- ❌ Si erreur `PERMISSION_DENIED` : Vérifier les règles Firestore (voir BACKEND_PROJECTS_PERMISSIONS_FIX_2026-01-11.md)
- ❌ Si erreur `invalid-argument` : Vérifier que les données envoyées sont correctes
- ❌ Si erreur `failed-precondition` : Vérifier que le projet a bien le statut `fundingActive`

---

## 🧪 TESTS DE VALIDATION

### Test 1 : Vérification du déploiement
```bash
cd functions
firebase functions:list | grep stripeCreatePaymentIntent
```
**Résultat attendu:** Ligne affichée avec statut "Active"

---

### Test 2 : Test unitaire de la fonction (optionnel)

**Fichier:** `functions/src/payments/create-payment-intent.test.ts` (créer si nécessaire)

```typescript
import * as admin from 'firebase-admin';
import * as functionsTest from 'firebase-functions-test';
import { stripeCreatePaymentIntent } from './create-payment-intent';

const test = functionsTest();

describe('stripeCreatePaymentIntent', () => {
  beforeAll(() => {
    admin.initializeApp();
  });

  afterAll(() => {
    test.cleanup();
  });

  it('should create payment intent successfully', async () => {
    const data = {
      amount: 5000,
      currency: 'eur',
      projectId: 'test-project-id',
      contributorId: 'test-user-id',
    };

    const context = {
      auth: {
        uid: 'test-user-id',
        token: {},
      },
    };

    const result = await stripeCreatePaymentIntent(data, context);

    expect(result).toHaveProperty('clientSecret');
    expect(result).toHaveProperty('paymentIntentId');
    expect(result.clientSecret).toMatch(/^pi_/);
  });

  it('should reject unauthenticated requests', async () => {
    const data = {
      amount: 5000,
      currency: 'eur',
      projectId: 'test-project-id',
      contributorId: 'test-user-id',
    };

    const context = {}; // No auth

    await expect(stripeCreatePaymentIntent(data, context)).rejects.toThrow(
      'User must be authenticated'
    );
  });
});
```

---

### Test 3 : Test d'intégration depuis Flutter

**A. Logs à surveiller**

Dans la console Flutter, après avoir cliqué sur "Confirm Payment", vérifier les logs:

```
✅ Payment intent created: pi_XXXXXXXXXXXXXXX
✅ Client secret received: pi_XXXXXXXX_secret_YYYYYYYY
```

**B. Vérification Firestore**

Après un test réussi, vérifier dans Firestore que le document a été créé:

```
Collection: payment_intents
Document ID: pi_XXXXXXXXXXXXXXX
Champs:
  - projectId: "..."
  - contributorId: "..."
  - amount: 5000
  - currency: "eur"
  - status: "requires_payment_method"
  - createdAt: Timestamp
```

---

## 📊 IMPACT ET RISQUES

### Impact de la solution
- **Fonctionnalité débloquée:** Les utilisateurs pourront enfin faire des contributions aux projets
- **Performance:** Les Cloud Functions sont optimisées et mises en cache par Firebase
- **Coût:** 
  - Environ 125,000 invocations gratuites/mois (plan Blaze)
  - Au-delà: $0.40 pour 1 million d'invocations
  - Pour une MVP avec ~1000 contributions/mois → coût négligeable (~$0.003/mois)

### Risques
- **Risque faible:** Déploiement incorrect si configuration Stripe manquante
  - **Mitigation:** Vérifier la configuration avant le déploiement
  
- **Risque moyen:** Timeout de fonction si Stripe API est lente
  - **Mitigation:** La fonction a un timeout par défaut de 60s (suffisant)
  - Si nécessaire, augmenter via `firebase.json`:
    ```json
    {
      "functions": {
        "timeout": "120s"
      }
    }
    ```

- **Risque faible:** Coûts inattendus en cas de spam
  - **Mitigation:** Implémenter rate limiting (future amélioration)

---

## 📦 DÉPENDANCES REQUISES

### Package.json (fonctions)

**Fichier:** `functions/package.json`

Vérifier que ces dépendances sont présentes:

```json
{
  "name": "functions",
  "engines": {
    "node": "18"
  },
  "main": "lib/index.js",
  "dependencies": {
    "firebase-admin": "^11.11.0",
    "firebase-functions": "^4.5.0",
    "stripe": "^14.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.2"
  },
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log"
  }
}
```

Si des dépendances manquent:
```bash
cd functions
npm install firebase-admin firebase-functions stripe --save
npm install @types/node typescript --save-dev
```

---

## 🔗 RÉFÉRENCES

### Fichiers concernés

**Backend (Cloud Functions):**
- `functions/src/payments/create-payment-intent.ts` (fonction principale)
- `functions/src/index.ts` (export de la fonction)
- `functions/package.json` (dépendances)
- `firebase.json` (configuration déploiement)

**Frontend (Flutter):**
- `lib/features/investments/data/repositories/investments_repository_impl.dart` (appel de la fonction)
- `lib/features/projects/presentation/screens/contribute_screen.dart` (UI et flow)

**Documentation:**
- `docs/backend/API_ENDPOINTS_REFERENCE.md` (lignes 835-1000)
- `docs/backend/QUICK_START_GUIDE.md` (section Contributions)

### Documentation Firebase
- [Cloud Functions for Firebase](https://firebase.google.com/docs/functions)
- [Callable Functions](https://firebase.google.com/docs/functions/callable)
- [Deploy Functions](https://firebase.google.com/docs/functions/manage-functions)
- [Environment Configuration](https://firebase.google.com/docs/functions/config-env)

### Documentation Stripe
- [Payment Intents API](https://stripe.com/docs/api/payment_intents)
- [Testing with Test Cards](https://stripe.com/docs/testing)

---

## 🚨 ACTIONS URGENTES

### Checklist pré-déploiement

- [ ] Configuration Stripe vérifiée (`firebase functions:config:get`)
- [ ] Dépendances npm installées (`cd functions && npm install`)
- [ ] Code compilé sans erreur (`npm run build`)
- [ ] Tests unitaires passés (si disponibles)

### Déploiement

```bash
# Commande UNIQUE à exécuter
cd functions && npm run build && firebase deploy --only functions:stripeCreatePaymentIntent
```

### Validation post-déploiement

- [ ] Fonction visible dans Firebase Console
- [ ] `firebase functions:list` affiche stripeCreatePaymentIntent
- [ ] Test depuis l'app Flutter réussi
- [ ] Document créé dans Firestore collection `payment_intents`

---

## 💡 AMÉLIORATIONS FUTURES (Non bloquantes)

### 1. Monitoring et logging
```typescript
// Ajouter dans create-payment-intent.ts
import * as Sentry from '@sentry/node';

try {
  const paymentIntent = await stripe.paymentIntents.create(...);
  functions.logger.info('Payment intent created', {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
    projectId: data.projectId,
  });
} catch (error) {
  functions.logger.error('Payment intent creation failed', {
    error: error.message,
    projectId: data.projectId,
  });
  Sentry.captureException(error);
  throw error;
}
```

### 2. Rate limiting
```typescript
import * as rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 contributions per 15 minutes
  message: 'Too many contribution attempts',
});

export const stripeCreatePaymentIntent = functions
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (data, context) => {
    // Apply rate limiting
    await limiter(context);
    // ... rest of the function
  });
```

### 3. Validation avancée
```typescript
// Vérifier KYC de l'utilisateur
const userDoc = await admin.firestore().collection('users').doc(contributorId).get();
const userData = userDoc.data();

if (!userData?.kyc?.verified) {
  throw new functions.https.HttpsError(
    'failed-precondition',
    'KYC verification required for contributions'
  );
}

// Vérifier limites de contribution
const maxAmount = userData.kyc.level === 'enhanced' ? 10000000 : 100000; // 100k or 1M cents
if (amount > maxAmount) {
  throw new functions.https.HttpsError(
    'failed-precondition',
    `Amount exceeds maximum allowed for your KYC level`
  );
}
```

---

## ✅ CHECKLIST DE VALIDATION

Avant de clore ce ticket:

- [ ] Configuration Stripe vérifiée et configurée
- [ ] Dépendances npm installées et à jour
- [ ] Code compilé sans erreurs TypeScript
- [ ] Fonctions déployées sur Firebase
- [ ] `stripeCreatePaymentIntent` visible dans Firebase Console
- [ ] Test manuel réussi depuis l'app Flutter
- [ ] Logs Firebase Functions vérifiés (aucune erreur)
- [ ] Document `payment_intents` créé dans Firestore après test
- [ ] Webhook Stripe configuré (si nécessaire pour payments)

---

**STATUT:** ⏳ EN ATTENTE DE DÉPLOIEMENT

**Fin du rapport**  
*Agent Frontend AI - 11 janvier 2026*
