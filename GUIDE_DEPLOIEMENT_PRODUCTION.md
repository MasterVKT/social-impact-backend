# Guide Complet de Déploiement Production
## Social Finance Impact Platform - Mise en Production
## Date : 18 Novembre 2025

---

## 🎯 OBJECTIF DE CE GUIDE

Ce guide vous permettra de :
1. ✅ Préparer votre projet pour la production
2. ✅ Configurer un projet Firebase production sécurisé
3. ✅ Déployer toutes les composantes (Functions, Rules, Indexes)
4. ✅ Configurer les services externes (Stripe, Sumsub, SendGrid)
5. ✅ Valider le déploiement et effectuer les tests finaux
6. ✅ Mettre en place le monitoring production

**⚠️ ATTENTION** : Ce guide déploie en production RÉELLE. Suivez chaque étape avec précaution.

**Temps estimé** : 2-4 heures

---

## 📋 PRÉ-REQUIS

### Checklist Avant Déploiement

- [ ] **Phase 1 (P0) complétée à 100%**
  - [ ] firestore.rules créé et testé
  - [ ] firestore.indexes.json créé et testé
  - [ ] storage.rules créé et testé
  - [ ] submitProject.ts implémenté
  - [ ] approveProject.ts implémenté
  - [ ] getProjectAnalytics.ts implémenté

- [ ] **Tests passent**
  - [ ] `npm run lint` → 0 erreur
  - [ ] `npm run build` → succès
  - [ ] `npm run test` → tous les tests passent
  - [ ] Tests manuels effectués en dev

- [ ] **Configuration prête**
  - [ ] Variables d'environnement production définies
  - [ ] Clés API production obtenues (Stripe, Sumsub, SendGrid)
  - [ ] Domaine personnalisé configuré (optionnel)

- [ ] **Validation sécurité**
  - [ ] Firestore rules testées avec émulateur
  - [ ] Storage rules testées avec émulateur
  - [ ] Pas de secrets hardcodés dans le code
  - [ ] .gitignore à jour

---

## 🔥 ÉTAPE 1 : CRÉER LE PROJET FIREBASE PRODUCTION

### 1.1 Créer le Projet

1. Aller sur https://console.firebase.google.com/
2. Cliquer **"Ajouter un projet"**
3. **Nom du projet** : `social-impact-prod` (ou votre choix)
4. **Google Analytics** :
   - ✅ Activer
   - Sélectionner/créer compte Analytics
5. Cliquer **"Créer le projet"**

### 1.2 Upgrade to Blaze Plan (Pay-as-you-go)

⚠️ **OBLIGATOIRE** pour Firebase Functions

```
Navigation : Settings (⚙️) → Usage and billing → Details & settings
```

1. Cliquer **"Modify plan"**
2. Sélectionner **"Blaze (Pay as you go)"**
3. Configurer budget alert (recommandé : 100€/mois pour démarrer)
4. Ajouter méthode de paiement

**Coûts estimés** (démarrage) :
- Functions : ~5-20€/mois
- Firestore : ~5-10€/mois
- Storage : ~2-5€/mois
- **Total** : ~15-40€/mois pour 100-500 utilisateurs

### 1.3 Activer les Services

#### A. Firebase Authentication

```
Navigation : Authentication → Get started
```

**Méthodes de connexion à activer** :
- ✅ Email/Password
- ✅ (Optionnel) Google
- ⚠️ Configurer domaine autorisé si custom domain

**Paramètres** :
```
Settings → Authorized domains → Add domain
Ajouter : votredomaine.com
```

#### B. Cloud Firestore

```
Navigation : Firestore Database → Create database
```

**⚠️ IMPORTANT** : Mode Production

- **Mode** : **Production mode** (PAS test mode !)
- **Region** : `europe-west1` (Belgique) ou votre région
- **Règles** : Mode locked (on déploiera les vraies règles après)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Tout bloqué par défaut
    }
  }
}
```

#### C. Cloud Storage

```
Navigation : Storage → Get started
```

- **Mode** : Production mode
- **Region** : `europe-west1` (même région que Firestore)
- **Règles** : Mode locked (on déploiera après)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false; // Tout bloqué par défaut
    }
  }
}
```

#### D. Cloud Functions

```
Navigation : Functions → Get started
```

- Juste cliquer "Get started"
- Pas besoin de configuration supplémentaire

---

## 🔐 ÉTAPE 2 : CONFIGURATION SÉCURITÉ

### 2.1 Récupérer Service Account

```
Navigation : Project Settings (⚙️) → Service accounts → Generate new private key
```

1. Cliquer **"Generate new private key"**
2. ⚠️ **DANGER** : Ce fichier donne accès total à votre projet
3. Télécharger → **Ne JAMAIS committer sur Git**
4. Renommer : `serviceAccountKey-prod.json`
5. Stocker de manière SÉCURISÉE (coffre-fort, manager de secrets)

### 2.2 Configurer App Check (Recommandé)

Protège votre backend contre les abus.

```
Navigation : App Check → Get started
```

Pour chaque app (Web, iOS, Android) :
- Web : Utiliser reCAPTCHA v3
- iOS : Utiliser App Attest
- Android : Utiliser Play Integrity

**Configuration reCAPTCHA** :
1. Aller sur https://www.google.com/recaptcha/admin
2. Créer un site reCAPTCHA v3
3. Copier les clés
4. Dans Firebase App Check → Web apps → Add app
5. Coller les clés reCAPTCHA

### 2.3 Configurer les Règles CORS

Pour autoriser votre frontend :

```bash
# Créer cors.json
cat > cors.json <<EOF
[
  {
    "origin": ["https://votredomaine.com", "https://www.votredomaine.com"],
    "method": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "maxAgeSeconds": 3600,
    "responseHeader": ["Content-Type", "Authorization"]
  }
]
EOF

# Appliquer aux buckets Storage
gsutil cors set cors.json gs://social-impact-prod.appspot.com
```

---

## 🔧 ÉTAPE 3 : CONFIGURATION VARIABLES D'ENVIRONNEMENT

### 3.1 Variables Firebase Functions

Firebase Functions utilise des "secrets" pour les variables sensibles.

**Option A : Via Firebase CLI (Recommandé)**

```bash
# Se connecter
firebase login

# Sélectionner projet prod
firebase use social-impact-prod

# Définir les secrets
firebase functions:secrets:set STRIPE_SECRET_KEY
# Prompt : Entrer votre clé Stripe LIVE (sk_live_...)

firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# Prompt : Entrer le webhook secret

firebase functions:secrets:set SUMSUB_APP_TOKEN
firebase functions:secrets:set SUMSUB_SECRET_KEY
firebase functions:secrets:set SUMSUB_WEBHOOK_SECRET

firebase functions:secrets:set SENDGRID_API_KEY

# Pour les non-secrets (config publique)
firebase functions:config:set app.base_url="https://europe-west1-social-impact-prod.cloudfunctions.net"
firebase functions:config:set app.frontend_url="https://votredomaine.com"
firebase functions:config:set app.env="production"
```

**Option B : Via Console Firebase**

```
Navigation : Functions → Dashboard → Secrets
```

Ajouter manuellement chaque secret.

### 3.2 Liste Complète des Variables

#### Variables OBLIGATOIRES :

| Variable | Type | Exemple | Où l'obtenir |
|----------|------|---------|--------------|
| `STRIPE_SECRET_KEY` | Secret | `sk_live_...` | Stripe Dashboard → API Keys |
| `STRIPE_PUBLISHABLE_KEY` | Config | `pk_live_...` | Stripe Dashboard → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Secret | `whsec_...` | Stripe Dashboard → Webhooks |
| `SUMSUB_APP_TOKEN` | Secret | `prd:...` | Sumsub Cockpit → App Tokens |
| `SUMSUB_SECRET_KEY` | Secret | `...` | Sumsub Cockpit → App Tokens |
| `SUMSUB_WEBHOOK_SECRET` | Secret | `...` | Sumsub Cockpit → Webhooks |
| `SENDGRID_API_KEY` | Secret | `SG....` | SendGrid → API Keys |

#### Variables Recommandées :

| Variable | Type | Valeur Production |
|----------|------|-------------------|
| `NODE_ENV` | Config | `production` |
| `LOG_LEVEL` | Config | `info` (pas `debug`) |
| `ENABLE_EMAIL_NOTIFICATIONS` | Config | `true` |
| `ENABLE_KYC_VERIFICATION` | Config | `true` |
| `ENABLE_REAL_PAYMENTS` | Config | `true` |

### 3.3 Obtenir les Clés API Production

#### A. Stripe (Mode LIVE)

⚠️ **Passer en mode LIVE** (pas test)

1. Aller sur https://dashboard.stripe.com/
2. **Activer votre compte Stripe** :
   - Compléter les informations entreprise
   - Vérifier votre identité
   - Ajouter compte bancaire
3. **Toggle** : Test mode → **Live mode**
4. Developers → API Keys
5. Copier :
   - **Publishable key** (pk_live_...)
   - **Secret key** (sk_live_...) ⚠️ NE JAMAIS PARTAGER

**Configurer Webhook Production** :
```
Developers → Webhooks → Add endpoint
```

- **URL** : `https://europe-west1-social-impact-prod.cloudfunctions.net/handleStripeWebhook`
- **Events** : Sélectionner :
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
  - `customer.created`
  - `customer.updated`
- **Signing secret** : Copier le webhook secret (whsec_...)

#### B. Sumsub (Mode Production)

1. Aller sur https://cockpit.sumsub.com/
2. **Upgrade to Production** :
   - Contacter Sumsub support
   - Compléter KYB (Know Your Business)
   - Attendre approbation
3. Une fois approuvé :
   - Settings → App Tokens → **Production**
   - Créer App Token
   - Copier App Token + Secret Key

**Configurer Webhook** :
```
Settings → Webhooks → Add
```

- **URL** : `https://europe-west1-social-impact-prod.cloudfunctions.net/handleKYCWebhook`
- **Events** : Tous les events KYC
- **Secret** : Générer et copier

#### C. SendGrid

1. Aller sur https://app.sendgrid.com/
2. **Vérifier votre domaine** :
   - Settings → Sender Authentication → Domain Authentication
   - Suivre les instructions DNS
   - Attendre vérification (24-48h)
3. **Créer API Key** :
   - Settings → API Keys → Create API Key
   - **Nom** : `social-impact-prod`
   - **Permissions** : Full Access
   - Copier la clé (elle ne sera plus affichée)

4. **Configurer Email Sender** :
   - Settings → Sender Authentication → Single Sender Verification
   - Email : `noreply@votredomaine.com`
   - Vérifier l'email

---

## 📦 ÉTAPE 4 : PRÉPARER LE CODE POUR PRODUCTION

### 4.1 Vérifier le Code

```bash
cd backend/functions

# 1. Linter
npm run lint
# Résultat attendu : 0 erreur

# 2. Build
npm run build
# Résultat attendu : Compilation réussie

# 3. Tests
npm run test
# Résultat attendu : Tous les tests passent

# 4. Audit sécurité npm
npm audit
# Résoudre les vulnérabilités critiques/high
npm audit fix
```

### 4.2 Optimiser pour Production

#### A. Mettre à jour package.json

```json
{
  "engines": {
    "node": "18"
  },
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start --only functions",
    "shell": "npm run build && firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log",
    "lint": "eslint --ext .js,.ts .",
    "test": "jest",
    "test:coverage": "jest --coverage"
  }
}
```

#### B. Vérifier .gitignore

```
# Firebase
.firebase/
.firebaserc
firebase-debug.log
firestore-debug.log
ui-debug.log

# Functions
backend/functions/node_modules/
backend/functions/lib/
backend/functions/.env
backend/functions/serviceAccountKey*.json

# Emulators
emulator-data/

# Logs
*.log
npm-debug.log*

# OS
.DS_Store
Thumbs.db
```

#### C. Créer .env.production (pour référence)

⚠️ Ne PAS committer ce fichier

```bash
# backend/functions/.env.production
NODE_ENV=production
FIREBASE_PROJECT_ID=social-impact-prod
FIREBASE_REGION=europe-west1

# Ces valeurs seront injectées via Firebase Secrets
# Ce fichier sert de documentation

# STRIPE (via Firebase Secrets)
# STRIPE_SECRET_KEY=
# STRIPE_PUBLISHABLE_KEY=
# STRIPE_WEBHOOK_SECRET=

# SUMSUB (via Firebase Secrets)
# SUMSUB_APP_TOKEN=
# SUMSUB_SECRET_KEY=
# SUMSUB_WEBHOOK_SECRET=

# SENDGRID (via Firebase Secrets)
# SENDGRID_API_KEY=
# SENDGRID_FROM_EMAIL=noreply@votredomaine.com
# SENDGRID_FROM_NAME=Social Impact Platform
```

### 4.3 Configurer Firebase pour Production

#### Fichier firebase.json (production-ready)

```json
{
  "functions": [
    {
      "source": "backend/functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log"
      ],
      "predeploy": [
        "npm --prefix \"$RESOURCE_DIR\" run lint",
        "npm --prefix \"$RESOURCE_DIR\" run build"
      ],
      "runtime": "nodejs18",
      "memory": "1GB",
      "timeoutSeconds": 540,
      "maxInstances": 100,
      "minInstances": 1,
      "region": "europe-west1"
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ]
  }
}
```

**Points clés** :
- `minInstances: 1` → Évite cold starts (coût : ~5€/mois)
- `maxInstances: 100` → Limite coûts
- `memory: "1GB"` → Performances optimales
- `predeploy` → Lint + build automatique avant déploiement

---

## 🚀 ÉTAPE 5 : DÉPLOIEMENT

### 5.1 Déploiement Initial (Dry Run)

Toujours tester d'abord avec `--dry-run` :

```bash
# Se positionner à la racine du projet
cd /path/to/social-impact-backend

# Sélectionner projet production
firebase use social-impact-prod

# Dry run complet
firebase deploy --dry-run

# Vérifier la sortie :
# - Functions à déployer
# - Rules à déployer
# - Indexes à déployer
```

**Résultat attendu** :
```
=== Deploying to 'social-impact-prod'...

Preparing to deploy:
✔ functions: 22 functions
✔ firestore: rules
✔ firestore: indexes
✔ storage: rules

Dry run complete.
```

### 5.2 Déploiement par Étapes

#### Étape 1 : Déployer les Règles d'abord

```bash
# Déployer uniquement Firestore rules
firebase deploy --only firestore:rules

# Vérifier dans Console Firebase
# Firestore Database → Rules → Publié ?

# Déployer uniquement Firestore indexes
firebase deploy --only firestore:indexes

# Déployer uniquement Storage rules
firebase deploy --only storage:rules
```

#### Étape 2 : Déployer les Functions

```bash
# Déployer toutes les functions
firebase deploy --only functions

# OU déployer une seule function pour tester
firebase deploy --only functions:createProject

# Monitorer le déploiement
# Durée estimée : 5-10 minutes
```

**Résultat attendu** :
```
✔  functions: Finished running predeploy script.
i  functions: updating Node.js 18 function completeProfile(europe-west1)...
i  functions: updating Node.js 18 function createProject(europe-west1)...
... (22 functions)
✔  functions[completeProfile(europe-west1)]: Successful update operation.
✔  functions[createProject(europe-west1)]: Successful update operation.
...

✔  Deploy complete!

Function URL (handleStripeWebhook):
https://europe-west1-social-impact-prod.cloudfunctions.net/handleStripeWebhook
```

#### Étape 3 : Vérifier le Déploiement

```bash
# Lister les functions déployées
firebase functions:list

# Voir les logs en temps réel
firebase functions:log --only completeProfile

# Tester une function
curl -X POST https://europe-west1-social-impact-prod.cloudfunctions.net/searchProjects \
  -H "Content-Type: application/json" \
  -d '{"filters": {}, "pagination": {"limit": 10}}'
```

### 5.3 Déploiement Complet (Production)

Une fois validé :

```bash
# Déploiement COMPLET
firebase deploy

# Avec confirmation
firebase deploy --force

# Surveiller
watch -n 5 'firebase functions:list'
```

---

## ✅ ÉTAPE 6 : VALIDATION POST-DÉPLOIEMENT

### 6.1 Checklist de Validation

#### A. Firestore Rules

```bash
# Tester avec l'UI Firebase
# Console Firebase → Firestore Database → Rules Playground
```

**Tests à effectuer** :
- [ ] Utilisateur non authentifié ne peut PAS lire /users
- [ ] Utilisateur authentifié peut lire son propre profil
- [ ] Utilisateur NE PEUT PAS lire profil d'un autre user
- [ ] Projet 'live' est lisible par tous
- [ ] Projet 'draft' n'est lisible que par créateur + admin

#### B. Storage Rules

Créer un script de test :

```javascript
// testStorageRules.js
const admin = require('firebase-admin');
admin.initializeApp();

async function testStorageRules() {
  const bucket = admin.storage().bucket();

  // Test : Upload photo de profil
  try {
    await bucket.file('users/test-user/profile/avatar.jpg').save('test');
    console.log('✅ Upload profile picture works');
  } catch (error) {
    console.log('❌ Upload failed:', error.message);
  }
}

testStorageRules();
```

#### C. Functions

Tester chaque function critique :

```bash
# Via curl
curl -X POST https://europe-west1-social-impact-prod.cloudfunctions.net/searchProjects \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {"status": "live"},
    "pagination": {"limit": 10}
  }'

# Résultat attendu : 200 OK + liste projets (vide au début)
```

**Functions à tester en priorité** :
- [ ] searchProjects (public)
- [ ] completeProfile (authenticated)
- [ ] createProject (authenticated + creator)
- [ ] createContribution (authenticated)
- [ ] handleStripeWebhook (webhook)

#### D. Webhooks Externes

##### Stripe Webhook

1. Aller sur https://dashboard.stripe.com/
2. Developers → Webhooks
3. Votre endpoint → "Send test webhook"
4. Événement : `payment_intent.succeeded`
5. Vérifier logs Firebase :
```bash
firebase functions:log --only handleStripeWebhook
```

##### Sumsub Webhook

1. Aller sur https://cockpit.sumsub.com/
2. Settings → Webhooks
3. Test webhook
4. Vérifier logs :
```bash
firebase functions:log --only handleKYCWebhook
```

### 6.2 Tests Smoke (Fonctionnels)

Créer un utilisateur réel de test en production :

```bash
# Via Firebase Console
# Authentication → Add user
Email: test@votredomaine.com
Password: SecurePassword123!
```

Puis tester le workflow complet via Postman (URL production) :

1. [ ] Login (obtenir token Firebase)
2. [ ] Complete Profile
3. [ ] Init KYC
4. [ ] Create Project
5. [ ] Submit Project
6. [ ] (Admin) Approve Project
7. [ ] Search Projects → Voir le projet
8. [ ] Create Contribution
9. [ ] Confirm Payment

### 6.3 Performance & Monitoring

#### Activer Performance Monitoring

```
Console Firebase → Performance → Get started
```

Ajouter SDK performance au frontend (futur).

#### Vérifier Quotas

```
Console Firebase → Usage and billing → Usage
```

Monitorer :
- Functions invocations
- Firestore reads/writes
- Storage downloads/uploads

#### Configurer Alertes Budget

```
Usage and billing → Details & settings → Budget alerts
```

Alertes recommandées :
- 50€ (50% budget)
- 80€ (80% budget)
- 100€ (100% budget)

---

## 📊 ÉTAPE 7 : MONITORING PRODUCTION

### 7.1 Logs et Debugging

#### Voir tous les logs

```bash
# Logs toutes functions
firebase functions:log

# Logs une function spécifique
firebase functions:log --only createProject

# Logs erreurs seulement
firebase functions:log --severity ERROR

# Logs en temps réel
firebase functions:log --follow
```

#### Via Console Google Cloud

Plus puissant que Firebase Console :

```
https://console.cloud.google.com/logs
Projet : social-impact-prod
```

Filtres utiles :
```
resource.type="cloud_function"
severity="ERROR"
```

### 7.2 Alerting

#### Créer Alerte Erreur Rate

```
Google Cloud Console → Monitoring → Alerting → Create Policy
```

**Conditions** :
- Métrique : Functions → Error rate
- Threshold : > 5% sur 5 minutes
- Notification : Email à votre équipe

#### Créer Alerte Performance

- Métrique : Functions → Execution time
- Threshold : p95 > 3000ms

### 7.3 Dashboard Monitoring

Créer un dashboard custom :

```
Google Cloud Console → Monitoring → Dashboards → Create Dashboard
```

**Widgets recommandés** :
- Functions invocations (line chart)
- Error rate (gauge)
- Execution time p50/p95/p99 (line chart)
- Firestore reads/writes (stacked area)
- Active instances (gauge)
- Cost projection (number)

---

## 🔄 ÉTAPE 8 : CI/CD (OPTIONNEL)

### 8.1 GitHub Actions

Créer `.github/workflows/deploy-prod.yml` :

```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main  # Trigger sur push sur main

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: |
          cd backend/functions
          npm ci

      - name: Run tests
        run: |
          cd backend/functions
          npm run lint
          npm run test

      - name: Build
        run: |
          cd backend/functions
          npm run build

      - name: Deploy to Firebase
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: social-impact-prod
          channelId: live
```

**Configuration GitHub Secrets** :
```
Settings → Secrets and variables → Actions → New repository secret

FIREBASE_SERVICE_ACCOUNT: (contenu du serviceAccountKey-prod.json)
```

### 8.2 Déploiement Manuel avec Protection

Script `deploy-prod.sh` :

```bash
#!/bin/bash

set -e  # Exit on error

echo "🚀 Production Deployment Script"
echo "================================"
echo ""

# Confirmation
read -p "⚠️  Deploy to PRODUCTION? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Deployment cancelled"
  exit 1
fi

# Vérifications
echo "✓ Running pre-deployment checks..."

cd backend/functions

echo "  → Linting..."
npm run lint || { echo "❌ Lint failed"; exit 1; }

echo "  → Building..."
npm run build || { echo "❌ Build failed"; exit 1; }

echo "  → Testing..."
npm run test || { echo "❌ Tests failed"; exit 1; }

echo "✓ All checks passed!"
echo ""

# Git status
if [[ -n $(git status -s) ]]; then
  echo "⚠️  Warning: Uncommitted changes detected"
  git status -s
  read -p "Continue anyway? (yes/no): " CONTINUE
  if [ "$CONTINUE" != "yes" ]; then
    exit 1
  fi
fi

# Deploy
echo "🚀 Deploying to production..."
cd ../..
firebase use social-impact-prod
firebase deploy

echo ""
echo "✅ Deployment complete!"
echo "📊 Monitor: https://console.firebase.google.com/project/social-impact-prod"
```

Rendre exécutable :
```bash
chmod +x deploy-prod.sh
```

Utiliser :
```bash
./deploy-prod.sh
```

---

## 🆘 ÉTAPE 9 : ROLLBACK & TROUBLESHOOTING

### 9.1 Rollback Functions

Si le déploiement cause des problèmes :

```bash
# Voir l'historique des déploiements
firebase functions:list --detailed

# Rollback vers version précédente
# (Pas de commande directe, il faut redéployer l'ancien code)

# Solution :
git checkout <commit-précédent>
firebase deploy --only functions
git checkout main
```

### 9.2 Problèmes Courants

#### Problème 1 : Functions timeout

```
Error: Function execution took longer than 60s
```

**Solution** :
```json
// firebase.json
{
  "functions": {
    "timeoutSeconds": 300  // Augmenter à 5 minutes
  }
}
```

Redéployer :
```bash
firebase deploy --only functions:<functionName>
```

#### Problème 2 : Out of Memory

```
Error: memory limit exceeded
```

**Solution** :
```json
// firebase.json
{
  "functions": {
    "memory": "2GB"  // Augmenter à 2GB
  }
}
```

#### Problème 3 : Cold Starts

```
Première requête prend 5-10 secondes
```

**Solution** :
```json
// firebase.json
{
  "functions": {
    "minInstances": 1  // Garde une instance warm
  }
}
```

⚠️ Coût : ~5€/mois par function avec minInstances=1

#### Problème 4 : CORS Errors

```
Access-Control-Allow-Origin header missing
```

**Solution** : Vérifier dans le code :
```typescript
// src/index.ts
import * as cors from 'cors';

const corsHandler = cors({
  origin: true,  // OU liste spécifique
  credentials: true
});

export const myFunction = onRequest((req, res) => {
  corsHandler(req, res, () => {
    // Votre code
  });
});
```

### 9.3 Monitoring en Cas de Problème

```bash
# Logs erreurs en temps réel
firebase functions:log --only <functionName> --severity ERROR --follow

# Métriques dans Google Cloud
https://console.cloud.google.com/functions/list

# Status page Firebase
https://status.firebase.google.com/
```

---

## 📋 CHECKLIST FINALE PRODUCTION

### Avant Go-Live

- [ ] Projet Firebase production créé et configuré
- [ ] Blaze plan activé
- [ ] Tous les services Firebase activés (Auth, Firestore, Storage, Functions)
- [ ] App Check configuré
- [ ] Service Account téléchargé et sécurisé
- [ ] Toutes les variables d'environnement définies
- [ ] Clés API production obtenues (Stripe, Sumsub, SendGrid)
- [ ] Webhooks configurés (Stripe, Sumsub)
- [ ] Code testé et validé (lint, build, tests)
- [ ] firestore.rules, storage.rules, indexes déployés
- [ ] Functions déployées
- [ ] Tests smoke passés
- [ ] Monitoring configuré
- [ ] Alertes configurées
- [ ] Budget alerts configurées

### Après Go-Live

- [ ] Surveiller logs pendant 1-2 heures
- [ ] Vérifier métriques (invocations, erreurs, latence)
- [ ] Tester workflows critiques avec vrais utilisateurs
- [ ] Documenter toute issue rencontrée
- [ ] Planifier hotfix si nécessaire

---

## 🎓 PROCHAINES ÉTAPES

Une fois en production :

1. **Monitoring continu** : Vérifier quotidiennement pendant la première semaine
2. **Optimisations** : Identifier bottlenecks et optimiser
3. **Backups** : Configurer backups automatiques Firestore
4. **Scaling** : Ajuster maxInstances selon traffic
5. **Features** : Implémenter Phase 2 et 3 du plan

---

## 📚 RESSOURCES

- [Firebase Functions Production](https://firebase.google.com/docs/functions/production-deployment)
- [Firestore Security Best Practices](https://firebase.google.com/docs/firestore/security/best-practices)
- [Firebase Performance Monitoring](https://firebase.google.com/docs/perf-mon)
- [Google Cloud Operations](https://cloud.google.com/products/operations)

---

**Guide créé le 18 Novembre 2025**
**Version : 1.0 - Production Ready**
**⚠️ Suivre scrupuleusement pour déploiement sécurisé**
