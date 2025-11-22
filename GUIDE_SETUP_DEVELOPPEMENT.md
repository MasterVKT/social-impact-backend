# Guide Complet de Setup Développement
## Social Finance Impact Platform - Environnement de Développement
## Date : 18 Novembre 2025

---

## 🎯 OBJECTIF DE CE GUIDE

Ce guide vous permettra de :
1. ✅ Configurer votre environnement de développement local
2. ✅ Lancer les émulateurs Firebase pour tester sans toucher à la production
3. ✅ Créer des utilisateurs fictifs pour tester toutes les fonctionnalités
4. ✅ Tester les différents workflows (créateur, contributeur, auditeur, admin)
5. ✅ Déboguer et développer en toute sécurité

**Temps estimé de setup** : 30-60 minutes

---

## 📋 PRÉREQUIS

### Logiciels Requis

| Logiciel | Version Minimale | Installation | Vérification |
|----------|-----------------|--------------|--------------|
| **Node.js** | 18.x | https://nodejs.org/ | `node --version` |
| **npm** | 8.x | Inclus avec Node.js | `npm --version` |
| **Git** | 2.x | https://git-scm.com/ | `git --version` |
| **Firebase CLI** | 12.x | `npm install -g firebase-tools` | `firebase --version` |
| **Java JDK** | 11+ | https://adoptium.net/ | `java --version` |

### Comptes Requis

| Service | Nécessaire | Pourquoi | Lien |
|---------|------------|----------|------|
| **Firebase** | ✅ Oui | Backend et base de données | https://console.firebase.google.com/ |
| **Stripe** | ✅ Oui | Paiements (compte test) | https://dashboard.stripe.com/ |
| **Sumsub** | ⚠️ Recommandé | KYC (compte sandbox) | https://cockpit.sumsub.com/ |
| **SendGrid** | ⚠️ Recommandé | Emails (compte free) | https://sendgrid.com/ |

**Note** : Pour le développement initial, vous pouvez mocker Sumsub et SendGrid si vous n'avez pas accès immédiatement.

---

## 🔧 ÉTAPE 1 : CONFIGURATION INITIALE

### 1.1 Cloner le Projet

```bash
# Cloner le repository
git clone https://github.com/MasterVKT/social-impact-backend.git
cd social-impact-backend

# Vérifier la branche
git branch -a

# Checkout la branche de travail (ou créer la vôtre)
git checkout -b feature/dev-setup
```

### 1.2 Installer les Dépendances

```bash
# Installer les dépendances backend
cd backend/functions
npm install

# Vérifier l'installation
npm list --depth=0
```

**Résultat attendu** : Toutes les dépendances installées sans erreur

---

## 🔥 ÉTAPE 2 : CONFIGURATION FIREBASE

### 2.1 Créer un Projet Firebase (Dev)

1. Aller sur https://console.firebase.google.com/
2. Cliquer "Ajouter un projet"
3. Nom : `social-impact-dev` (ou votre choix)
4. Désactiver Google Analytics (pas nécessaire pour dev)
5. Cliquer "Créer le projet"

### 2.2 Activer les Services Firebase

Dans la console Firebase :

#### A. Authentication
```
Navigation : Authentication → Sign-in method
```
- ✅ Activer **Email/Password**
- ✅ (Optionnel) Activer **Google Sign-In**

#### B. Firestore Database
```
Navigation : Firestore Database → Create database
```
- **Mode** : Test mode (pour développement)
- **Region** : europe-west1 (Belgique)
- **Règles** : Remplacer par :
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true; // MODE DEV SEULEMENT !
    }
  }
}
```
⚠️ **ATTENTION** : Ces règles sont OUVERTES. OK pour dev local, PAS pour production !

#### C. Storage
```
Navigation : Storage → Get started
```
- **Mode** : Test mode
- **Region** : europe-west1
- **Règles** : Mode permissif pour dev

#### D. Functions
```
Navigation : Functions → Get started
```
- Juste activer, pas besoin de déployer maintenant

### 2.3 Récupérer les Credentials Firebase

#### A. Service Account (pour les Functions)

```
Navigation : Project Settings (⚙️) → Service accounts → Generate new private key
```

1. Cliquer "Generate new private key"
2. Télécharger le fichier JSON
3. **Renommer** : `serviceAccountKey.json`
4. **Placer** dans : `/backend/functions/serviceAccountKey.json`
5. ⚠️ **Ajouter au .gitignore** (déjà fait normalement)

#### B. Firebase Config (pour le frontend futur)

```
Navigation : Project Settings → General → Your apps → Web app
```

1. Cliquer l'icône `</>`
2. Nom : `social-impact-web`
3. Copier la config, on l'utilisera plus tard

### 2.4 Configurer Firebase CLI

```bash
# Login Firebase
firebase login

# Lister vos projets
firebase projects:list

# Associer le projet local au projet Firebase
cd /path/to/social-impact-backend
firebase use --add

# Sélectionner votre projet dev
# Alias suggéré : "dev"
```

Résultat : Fichier `.firebaserc` créé avec :
```json
{
  "projects": {
    "dev": "social-impact-dev"
  }
}
```

---

## 🔐 ÉTAPE 3 : VARIABLES D'ENVIRONNEMENT

### 3.1 Créer le Fichier .env

```bash
cd backend/functions

# Créer .env depuis le template
cp .env.example .env

# Si .env.example n'existe pas, créer .env manuellement
touch .env
```

### 3.2 Configurer les Variables

Éditer `backend/functions/.env` :

```bash
# ===========================================
# FIREBASE CONFIGURATION
# ===========================================
FIREBASE_PROJECT_ID=social-impact-dev
FIREBASE_REGION=europe-west1

# ===========================================
# STRIPE CONFIGURATION (Test Mode)
# ===========================================
# Récupérer sur https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_TEST
STRIPE_PUBLISHABLE_KEY=pk_test_VOTRE_CLE_PUBLIQUE_TEST
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_SECRET_WEBHOOK

# ===========================================
# SUMSUB CONFIGURATION (Sandbox)
# ===========================================
# Récupérer sur https://cockpit.sumsub.com/
SUMSUB_APP_TOKEN=sbx:VOTRE_APP_TOKEN
SUMSUB_SECRET_KEY=VOTRE_SECRET_KEY
SUMSUB_WEBHOOK_SECRET=VOTRE_WEBHOOK_SECRET

# ===========================================
# SENDGRID CONFIGURATION
# ===========================================
# Récupérer sur https://app.sendgrid.com/settings/api_keys
SENDGRID_API_KEY=SG.VOTRE_API_KEY
SENDGRID_FROM_EMAIL=noreply@votredomaine.com
SENDGRID_FROM_NAME=Social Impact Platform

# ===========================================
# APPLICATION CONFIGURATION
# ===========================================
NODE_ENV=development
API_BASE_URL=http://localhost:5001/social-impact-dev/europe-west1
FRONTEND_URL=http://localhost:3000

# ===========================================
# FEATURE FLAGS (Dev)
# ===========================================
ENABLE_EMAIL_NOTIFICATIONS=false  # Désactiver pour éviter spam en dev
ENABLE_KYC_VERIFICATION=false     # Mocker KYC en dev
ENABLE_REAL_PAYMENTS=false        # Utiliser Stripe test mode

# ===========================================
# LOGGING
# ===========================================
LOG_LEVEL=debug
```

### 3.3 Obtenir les Clés API

#### A. Stripe (OBLIGATOIRE)

1. Créer compte : https://dashboard.stripe.com/register
2. Mode "Test" dans le dashboard
3. Développeurs → Clés API
4. Copier :
   - **Secret key** (sk_test_...)
   - **Publishable key** (pk_test_...)

Pour le webhook secret :
```bash
# Installer Stripe CLI
brew install stripe/stripe-cli/stripe  # macOS
# ou télécharger : https://stripe.com/docs/stripe-cli

# Login
stripe login

# Écouter les webhooks localement
stripe listen --forward-to http://localhost:5001/social-impact-dev/europe-west1/handleStripeWebhook

# Copier le webhook secret affiché (whsec_...)
```

#### B. Sumsub (OPTIONNEL pour démarrage)

1. Créer compte sandbox : https://cockpit.sumsub.com/
2. Settings → App tokens
3. Copier App Token + Secret Key

**OU** mocker Sumsub pour dev :
```typescript
// Dans .env
SUMSUB_APP_TOKEN=mock_token
SUMSUB_SECRET_KEY=mock_secret
ENABLE_KYC_VERIFICATION=false
```

#### C. SendGrid (OPTIONNEL pour démarrage)

1. Créer compte free : https://signup.sendgrid.com/
2. Settings → API Keys → Create API Key
3. Full Access
4. Copier la clé

**OU** désactiver emails en dev :
```bash
ENABLE_EMAIL_NOTIFICATIONS=false
```

---

## 🚀 ÉTAPE 4 : LANCER LES ÉMULATEURS FIREBASE

Les émulateurs permettent de tester localement **sans toucher à Firebase production**.

### 4.1 Configurer les Émulateurs

Fichier `firebase.json` devrait déjà contenir :

```json
{
  "emulators": {
    "auth": {
      "port": 9099
    },
    "functions": {
      "port": 5001
    },
    "firestore": {
      "port": 8080
    },
    "storage": {
      "port": 9199
    },
    "ui": {
      "enabled": true,
      "port": 4000
    },
    "singleProjectMode": true
  }
}
```

### 4.2 Démarrer les Émulateurs

```bash
# Depuis la racine du projet
cd /path/to/social-impact-backend

# Lancer tous les émulateurs
firebase emulators:start

# OU avec import de données
firebase emulators:start --import=./emulator-data --export-on-exit
```

**Résultat attendu** :
```
┌─────────────────────────────────────────────────────────────┐
│ ✔  All emulators ready! It is now safe to connect.         │
├─────────────────────────────────────────────────────────────┤
│ Emulator       │ Host:Port      │ View in Emulator UI       │
├────────────────┼────────────────┼──────────────────────────┤
│ Authentication │ localhost:9099 │ http://localhost:4000/auth│
│ Firestore      │ localhost:8080 │ http://localhost:4000/firestore│
│ Functions      │ localhost:5001 │ http://localhost:4000/functions│
│ Storage        │ localhost:9199 │ http://localhost:4000/storage│
└─────────────────────────────────────────────────────────────┘
  Emulator UI running on http://localhost:4000
```

### 4.3 Accéder à l'Interface Émulateur

Ouvrir dans votre navigateur : **http://localhost:4000**

Vous verrez :
- **Authentication** : Gérer utilisateurs test
- **Firestore** : Voir et éditer les données
- **Functions** : Voir les logs des functions
- **Storage** : Voir les fichiers uploadés

---

## 👥 ÉTAPE 5 : CRÉER DES UTILISATEURS FICTIFS

### 5.1 Via l'Interface Émulateur (Recommandé)

1. Ouvrir http://localhost:4000
2. Aller dans **Authentication**
3. Cliquer **"Add user"**
4. Créer plusieurs utilisateurs :

#### Utilisateur 1 : Admin
```
Email: admin@test.com
Password: Test123456!
UID: (généré auto)
```

#### Utilisateur 2 : Créateur de Projet
```
Email: creator@test.com
Password: Test123456!
UID: (généré auto)
```

#### Utilisateur 3 : Contributeur
```
Email: contributor@test.com
Password: Test123456!
UID: (généré auto)
```

#### Utilisateur 4 : Auditeur
```
Email: auditor@test.com
Password: Test123456!
UID: (généré auto)
```

### 5.2 Compléter les Profils via API

Une fois les utilisateurs créés dans Auth, utiliser l'API pour compléter leurs profils.

#### A. Installer un Client REST (Postman/Insomnia/curl)

Je recommande **Postman** : https://www.postman.com/downloads/

#### B. Importer la Collection Postman

Créer un fichier `postman_collection.json` :

```json
{
  "info": {
    "name": "Social Impact Platform - Dev",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "1. Complete Profile - Admin",
      "request": {
        "method": "POST",
        "header": [
          {
            "key": "Content-Type",
            "value": "application/json"
          },
          {
            "key": "Authorization",
            "value": "Bearer {{admin_token}}"
          }
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"firstName\": \"Admin\",\n  \"lastName\": \"User\",\n  \"userType\": \"admin\",\n  \"phoneNumber\": \"+33612345678\",\n  \"dateOfBirth\": \"1990-01-01\",\n  \"address\": {\n    \"street\": \"123 Rue de la Paix\",\n    \"city\": \"Paris\",\n    \"postalCode\": \"75001\",\n    \"country\": \"FR\"\n  }\n}"
        },
        "url": {
          "raw": "http://localhost:5001/social-impact-dev/europe-west1/completeProfile",
          "protocol": "http",
          "host": ["localhost"],
          "port": "5001",
          "path": ["social-impact-dev", "europe-west1", "completeProfile"]
        }
      }
    }
  ]
}
```

#### C. Obtenir le Token Firebase

Pour tester les functions authentifiées :

**Option 1 : Via Firebase CLI**
```bash
# Obtenir un token pour un utilisateur
firebase auth:export users.json --project social-impact-dev

# Utiliser le token dans Postman
```

**Option 2 : Via Script Node.js**

Créer `backend/functions/scripts/getAuthToken.js` :

```javascript
const admin = require('firebase-admin');

admin.initializeApp();

async function getCustomToken(email) {
  try {
    const user = await admin.auth().getUserByEmail(email);
    const token = await admin.auth().createCustomToken(user.uid);
    console.log(`Custom token for ${email}:`);
    console.log(token);
    return token;
  } catch (error) {
    console.error('Error:', error);
  }
}

// Usage
getCustomToken('admin@test.com');
```

Exécuter :
```bash
cd backend/functions
node scripts/getAuthToken.js
```

### 5.3 Script de Seed Automatique

Pour accélérer, créer un script de seed :

`backend/functions/scripts/seedDevData.js` :

```javascript
#!/usr/bin/env node

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

// Init Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});

const db = admin.firestore();
const auth = admin.auth();

async function seedData() {
  console.log('🌱 Starting data seeding...\n');

  // 1. Créer utilisateurs
  const users = [
    {
      email: 'admin@test.com',
      password: 'Test123456!',
      profile: {
        firstName: 'Admin',
        lastName: 'User',
        userType: 'admin',
        phoneNumber: '+33612345678',
        kyc: {
          status: 'approved',
          level: 2,
          provider: 'sumsub',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }
    },
    {
      email: 'creator@test.com',
      password: 'Test123456!',
      profile: {
        firstName: 'Creator',
        lastName: 'Test',
        userType: 'creator',
        phoneNumber: '+33612345679',
        kyc: {
          status: 'approved',
          level: 1,
          provider: 'sumsub',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }
    },
    {
      email: 'contributor@test.com',
      password: 'Test123456!',
      profile: {
        firstName: 'Contributor',
        lastName: 'Test',
        userType: 'contributor',
        phoneNumber: '+33612345680',
        kyc: {
          status: 'approved',
          level: 1,
          provider: 'sumsub',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }
    },
    {
      email: 'auditor@test.com',
      password: 'Test123456!',
      profile: {
        firstName: 'Auditor',
        lastName: 'Test',
        userType: 'auditor',
        phoneNumber: '+33612345681',
        kyc: {
          status: 'approved',
          level: 2,
          provider: 'sumsub',
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      }
    }
  ];

  for (const userData of users) {
    try {
      // Créer dans Auth
      const userRecord = await auth.createUser({
        email: userData.email,
        password: userData.password,
        emailVerified: true
      });

      console.log(`✅ Created user: ${userData.email} (${userRecord.uid})`);

      // Créer dans Firestore
      await db.collection('users').doc(userRecord.uid).set({
        uid: userRecord.uid,
        email: userData.email,
        ...userData.profile,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        version: 1
      });

      console.log(`✅ Created Firestore profile for ${userData.email}\n`);
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        console.log(`⚠️  User ${userData.email} already exists, skipping...\n`);
      } else {
        console.error(`❌ Error creating ${userData.email}:`, error.message);
      }
    }
  }

  // 2. Créer un projet de test
  const creatorUser = await auth.getUserByEmail('creator@test.com');

  const projectData = {
    creatorId: creatorUser.uid,
    title: 'Projet Test - Eau Potable Village',
    description: 'Un projet de test pour installer un système d\'eau potable dans un village rural. Ce projet permettra de tester toutes les fonctionnalités de la plateforme.',
    category: 'water_access',
    status: 'draft',
    fundingGoal: 5000,
    fundingRaised: 0,
    fundingProgress: 0,
    coverImage: 'https://source.unsplash.com/800x600/?water,village',
    images: [
      'https://source.unsplash.com/800x600/?water,well',
      'https://source.unsplash.com/800x600/?africa,village'
    ],
    location: {
      country: 'SN',
      city: 'Dakar',
      coordinates: {
        latitude: 14.6928,
        longitude: -17.4467
      }
    },
    milestones: [
      {
        id: 'milestone-1',
        title: 'Phase 1 : Étude et Forage',
        description: 'Étude de faisabilité et forage du puits',
        amount: 2000,
        status: 'pending',
        order: 1
      },
      {
        id: 'milestone-2',
        title: 'Phase 2 : Installation Pompe',
        description: 'Installation de la pompe et du système de distribution',
        amount: 2000,
        status: 'pending',
        order: 2
      },
      {
        id: 'milestone-3',
        title: 'Phase 3 : Formation et Maintenance',
        description: 'Formation des utilisateurs et mise en place maintenance',
        amount: 1000,
        status: 'pending',
        order: 3
      }
    ],
    team: [
      {
        role: 'Chef de Projet',
        name: 'Creator Test',
        userId: creatorUser.uid
      }
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    version: 1
  };

  const projectRef = await db.collection('projects').add(projectData);
  console.log(`✅ Created test project: ${projectRef.id}\n`);

  console.log('🎉 Seeding complete!\n');
  console.log('📋 Summary:');
  console.log('- 4 users created (admin, creator, contributor, auditor)');
  console.log('- 1 test project created');
  console.log('\n🔑 Login credentials:');
  users.forEach(u => console.log(`   ${u.email} / ${u.password}`));

  process.exit(0);
}

seedData().catch(error => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});
```

**Exécuter le seed** :
```bash
cd backend/functions
node scripts/seedDevData.js
```

---

## 🧪 ÉTAPE 6 : TESTER LES FONCTIONNALITÉS

### 6.1 Tester via Postman

Créer une collection Postman complète avec toutes les functions.

**Variables d'environnement Postman** :
```
base_url: http://localhost:5001/social-impact-dev/europe-west1
admin_token: (token Firebase de admin@test.com)
creator_token: (token Firebase de creator@test.com)
contributor_token: (token Firebase de contributor@test.com)
```

**Requêtes de test** :

1. **Complete Profile**
```
POST {{base_url}}/completeProfile
Headers:
  Authorization: Bearer {{creator_token}}
Body:
{
  "firstName": "John",
  "lastName": "Doe",
  "userType": "creator",
  ...
}
```

2. **Create Project**
```
POST {{base_url}}/createProject
Headers:
  Authorization: Bearer {{creator_token}}
Body:
{
  "title": "Mon projet",
  "description": "Description...",
  ...
}
```

3. **Search Projects**
```
POST {{base_url}}/searchProjects
Body:
{
  "filters": {
    "category": "water_access"
  },
  "pagination": {
    "limit": 10
  }
}
```

### 6.2 Tester via l'UI Émulateur

1. Ouvrir http://localhost:4000
2. **Authentication** : Voir les utilisateurs créés
3. **Firestore** : Explorer les collections (users, projects, contributions, etc.)
4. **Functions** : Voir les logs en temps réel

### 6.3 Tester les Workflows Complets

#### Workflow A : Création et Publication de Projet

```bash
# 1. Login en tant que créateur
# 2. Compléter le profil (completeProfile)
# 3. Initialiser KYC (initKYC)
# 4. Créer un projet (createProject)
# 5. Soumettre pour review (submitProject) <- À implémenter
# 6. Login en tant qu'admin
# 7. Approuver le projet (approveProject) <- À implémenter
```

#### Workflow B : Contribution à un Projet

```bash
# 1. Login en tant que contributeur
# 2. Compléter le profil
# 3. Initialiser KYC
# 4. Rechercher des projets (searchProjects)
# 5. Voir détails projet (getProjectDetails)
# 6. Créer une contribution (createContribution)
# 7. Confirmer le paiement (confirmPayment)
```

#### Workflow C : Audit de Milestone

```bash
# 1. Login en tant qu'auditeur
# 2. Voir dashboard auditeur (getAuditorDashboard)
# 3. Accepter un audit (acceptAudit)
# 4. Soumettre rapport audit (submitAuditReport)
# 5. Admin libère l'escrow (releaseEscrow)
```

---

## 🐛 ÉTAPE 7 : DEBUGGING

### 7.1 Voir les Logs

**Logs Functions (en temps réel)** :
```bash
# Terminal où tournent les émulateurs
# Les logs s'affichent automatiquement
```

**OU dans l'UI Émulateur** :
```
http://localhost:4000 → Functions → Logs
```

### 7.2 Debugger avec VSCode

Créer `.vscode/launch.json` :

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to Emulator",
      "port": 9229,
      "restart": true,
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/backend/functions/lib/**/*.js"]
    }
  ]
}
```

Lancer émulateurs en mode debug :
```bash
firebase emulators:start --inspect-functions
```

Puis dans VSCode : Run → Start Debugging (F5)

### 7.3 Problèmes Courants

#### Problème 1 : Port déjà utilisé
```bash
Error: Port 5001 is already in use

Solution :
lsof -ti:5001 | xargs kill -9
```

#### Problème 2 : Java non trouvé
```bash
Error: Java is not installed

Solution (macOS) :
brew install openjdk@11
```

#### Problème 3 : Émulateurs ne démarrent pas
```bash
Solution :
firebase emulators:start --debug
# Voir les erreurs détaillées
```

#### Problème 4 : Functions timeout
```bash
Solution :
# Augmenter timeout dans firebase.json
"functions": {
  "timeout": "60s"  // Au lieu de 30s par défaut
}
```

---

## 📊 ÉTAPE 8 : MONITORING EN DEV

### 8.1 Logs Structurés

Les logs utilisent Winston et sont visibles dans :
- Terminal des émulateurs
- UI Émulateur (http://localhost:4000/functions)

Format :
```json
{
  "level": "info",
  "message": "User created successfully",
  "userId": "abc123",
  "timestamp": "2025-11-18T10:30:00.000Z"
}
```

### 8.2 Performance Monitoring

Ajouter des timers dans le code :
```typescript
const startTime = Date.now();
// ... code
logger.info('Operation completed', {
  duration: Date.now() - startTime
});
```

### 8.3 Firestore Queries Monitor

Dans l'UI Émulateur :
```
Firestore → Requests
```
Voir toutes les requêtes Firestore en temps réel.

---

## 🔄 ÉTAPE 9 : WORKFLOW DE DÉVELOPPEMENT

### 9.1 Cycle de Développement Standard

```bash
# 1. Créer une branche feature
git checkout -b feature/ma-nouvelle-feature

# 2. Coder
# Éditer les fichiers dans backend/functions/src/

# 3. Compiler
cd backend/functions
npm run build

# 4. Linter
npm run lint

# 5. Tester
npm run test

# 6. Tester avec émulateurs
firebase emulators:start

# 7. Tester manuellement via Postman

# 8. Commit
git add .
git commit -m "feat: description de la feature"

# 9. Push
git push origin feature/ma-nouvelle-feature
```

### 9.2 Hot Reload

Les émulateurs rechargent automatiquement quand vous modifiez le code.

**Pour forcer un reload** :
```bash
# CTRL+C pour arrêter
# Relancer :
firebase emulators:start
```

### 9.3 Sauvegarder les Données de Test

Pour sauvegarder l'état des émulateurs :
```bash
# Export automatique au shutdown
firebase emulators:start --export-on-exit=./emulator-data

# Import au démarrage
firebase emulators:start --import=./emulator-data
```

Créer `.gitignore` pour emulator-data :
```
emulator-data/
```

---

## ✅ CHECKLIST DE VALIDATION

Avant de considérer votre environnement dev prêt :

- [ ] Node.js 18+ installé
- [ ] Firebase CLI installé et configuré
- [ ] Projet Firebase créé (dev)
- [ ] Services Firebase activés (Auth, Firestore, Storage, Functions)
- [ ] `.env` configuré avec toutes les clés API
- [ ] Dépendances npm installées
- [ ] Émulateurs démarrent sans erreur
- [ ] UI Émulateur accessible (http://localhost:4000)
- [ ] 4 utilisateurs de test créés
- [ ] Au moins 1 projet de test créé
- [ ] Postman configuré avec collection de test
- [ ] Requête de test fonctionne (ex: searchProjects)
- [ ] Logs visibles dans l'UI Émulateur
- [ ] Build TypeScript fonctionne (`npm run build`)
- [ ] Tests unitaires passent (`npm run test`)
- [ ] Linter passe (`npm run lint`)

---

## 🎓 PROCHAINES ÉTAPES

Une fois votre environnement dev configuré :

1. ✅ Implémenter les tâches P0 manquantes (voir PLAN_DEVELOPPEMENT_IA.md)
2. ✅ Tester chaque nouvelle feature avec utilisateurs fictifs
3. ✅ Augmenter la couverture de tests (Phase 2)
4. ✅ Préparer le déploiement production (voir GUIDE_DEPLOIEMENT_PRODUCTION.md)

---

## 🆘 SUPPORT

### Documentation Utile

- [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite)
- [Firebase Functions](https://firebase.google.com/docs/functions)
- [Firestore](https://firebase.google.com/docs/firestore)
- [Stripe Test Mode](https://stripe.com/docs/testing)

### Erreurs Courantes

Consulter `TROUBLESHOOTING.md` (à créer si besoin)

### Contact

Pour questions sur le projet : [Créer une issue GitHub]

---

**Guide créé le 18 Novembre 2025**
**Version : 1.0**
**Maintenu par : Équipe Dev**
