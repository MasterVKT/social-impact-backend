# 🔐 ANALYSE DES VARIABLES D'ENVIRONNEMENT CRITIQUES
## Backend Firebase Functions - Tests d'Utilisation

---

## 📋 RÉSUMÉ EXÉCUTIF

**Total de variables identifiées :** 100+
**Variables critiques pour tests :** 25
**Services tiers intégrés :** 5 (Stripe, Sumsub, SendGrid, Firebase, Cloudinary)

---

## ⚠️ VARIABLES OBLIGATOIRES - TESTS BASIQUES

Ces variables **DOIVENT** être définies pour que l'application démarre et fonctionne en mode développement avec émulateurs.

### 1. Firebase Core (3 variables)
```bash
FIREBASE_PROJECT_ID=social-impact-platform-dev
FIREBASE_REGION=europe-west1
FIREBASE_STORAGE_BUCKET=social-impact-platform-dev.appspot.com
```

**Impact si manquantes :**
- ❌ L'application ne peut pas se connecter à Firebase
- ❌ Impossible d'initialiser Firestore et Storage
- ❌ Toutes les fonctions échoueront au démarrage

**Configuration pour tests :**
```bash
# Mode développement avec émulateurs (pas besoin de clés réelles)
USE_EMULATORS=true
FIRESTORE_EMULATOR_HOST=localhost:8080
STORAGE_EMULATOR_HOST=localhost:9199
AUTH_EMULATOR_HOST=localhost:9099
FUNCTIONS_EMULATOR_HOST=localhost:5001
```

---

## 🔴 VARIABLES CRITIQUES - TESTS COMPLETS

### 2. Stripe (4 variables OBLIGATOIRES)

```bash
STRIPE_SECRET_KEY=sk_test_51234567890abcdef...
STRIPE_PUBLISHABLE_KEY=pk_test_51234567890abcdef...
STRIPE_WEBHOOK_SECRET=whsec_1234567890abcdef...
STRIPE_CONNECT_CLIENT_ID=ca_1234567890abcdef...  # Pour payouts créateurs
```

**Impact si manquantes :**
- ❌ **Impossible de tester les contributions/paiements**
- ❌ Échec de toutes les fonctions de contribution
- ❌ Webhooks Stripe ne fonctionneront pas
- ❌ Impossible de tester le workflow complet de financement

**Fonctionnalités bloquées :**
- ✗ Création de contributions
- ✗ Confirmation de paiements
- ✗ Remboursements
- ✗ Libération des fonds aux créateurs
- ✗ Audit des transactions

**Solution pour tests :**
```bash
# Utiliser les clés de test Stripe (gratuites)
# 1. Créer un compte Stripe gratuit: https://dashboard.stripe.com/register
# 2. Récupérer les clés de test dans Developers > API Keys
# 3. Créer un webhook endpoint pour obtenir le webhook secret
```

**Cartes de test disponibles :**
- `4242 4242 4242 4242` - Succès
- `4000 0000 0000 9995` - Échec (fonds insuffisants)
- `4000 0025 0000 3155` - Requiert authentification 3D Secure

---

### 3. Sumsub KYC (4 variables OBLIGATOIRES)

```bash
SUMSUB_APP_TOKEN=sbx:1234567890abcdef...
SUMSUB_SECRET_KEY=1234567890abcdefghijklmnop...
SUMSUB_LEVEL_BASIC=basic-kyc-level
SUMSUB_LEVEL_FULL=full-kyc-level
```

**Impact si manquantes :**
- ❌ **Impossible de tester la vérification KYC**
- ❌ Les créateurs ne peuvent pas créer de projets
- ❌ Échec de la fonctionnalité d'onboarding
- ❌ Webhooks KYC ne fonctionneront pas

**Fonctionnalités bloquées :**
- ✗ Vérification d'identité (KYC)
- ✗ Création de projets (nécessite KYC approuvé)
- ✗ Workflow complet créateur
- ✗ Tests de conformité réglementaire

**Solution pour tests :**
```bash
# Sumsub propose un compte sandbox gratuit
# 1. S'inscrire sur: https://sumsub.com
# 2. Obtenir les credentials sandbox
# 3. Configurer les niveaux KYC dans le dashboard
# Note: Sandbox limité à 100 vérifications/mois (suffisant pour tests)
```

**Alternative pour tests rapides :**
```bash
# Désactiver temporairement KYC pour tests locaux
ENABLE_KYC_VERIFICATION=false

# ⚠️ Attention: Ne JAMAIS désactiver en production!
```

---

### 4. SendGrid Email (2 variables OBLIGATOIRES)

```bash
SENDGRID_API_KEY=SG.1234567890abcdef...
SENDGRID_FROM_EMAIL=noreply@socialimpact.finance
```

**Impact si manquantes :**
- ⚠️ Notifications par email ne fonctionneront pas
- ⚠️ Emails de confirmation non envoyés
- ⚠️ Rapports mensuels non générés
- ⚠️ Alertes admin non envoyées

**Fonctionnalités affectées :**
- ⚠️ Email de bienvenue
- ⚠️ Confirmation de contribution
- ⚠️ Notifications de projets
- ⚠️ Rapports et digests
- ⚠️ Récupération de mot de passe

**Criticité :** MOYENNE (l'app fonctionne sans emails mais expérience dégradée)

**Solution pour tests :**
```bash
# SendGrid offre 100 emails/jour gratuits
# 1. S'inscrire sur: https://signup.sendgrid.com
# 2. Créer une API Key dans Settings > API Keys
# 3. Vérifier l'email expéditeur dans Sender Authentication

# Alternative pour tests locaux: Logger les emails au lieu de les envoyer
ENABLE_EMAIL_NOTIFICATIONS=false  # Les emails seront loggés seulement
```

---

### 5. Templates SendGrid (9 variables RECOMMANDÉES)

```bash
SENDGRID_TEMPLATE_WELCOME=d-1234567890abcdef
SENDGRID_TEMPLATE_KYC_APPROVED=d-2234567890abcdef
SENDGRID_TEMPLATE_KYC_REJECTED=d-3234567890abcdef
SENDGRID_TEMPLATE_PROJECT_APPROVED=d-4234567890abcdef
SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED=d-5234567890abcdef
SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT=d-6234567890abcdef
SENDGRID_TEMPLATE_MONTHLY_REPORT=d-7234567890abcdef
SENDGRID_TEMPLATE_DIGEST_DAILY=d-8234567890abcdef
SENDGRID_TEMPLATE_REFUND_PROCESSED=d-9234567890abcdef
```

**Impact si manquantes :**
- ⚠️ Emails envoyés en format texte basique (pas de design)
- ⚠️ Expérience utilisateur dégradée

**Criticité :** BASSE (optionnel pour tests fonctionnels)

---

## 🟡 VARIABLES RECOMMANDÉES - TESTS AVANCÉS

### 6. URLs Frontend (3 variables)

```bash
FRONTEND_URL=http://localhost:3000
ADMIN_DASHBOARD_URL=http://localhost:3001
API_BASE_URL=http://localhost:5001
```

**Impact si manquantes :**
- ⚠️ Liens dans emails cassés
- ⚠️ Redirections après paiement non fonctionnelles
- ⚠️ Deep links vers l'app non disponibles

**Solution pour tests :**
```bash
# Utiliser localhost pour développement
FRONTEND_URL=http://localhost:3000
ADMIN_DASHBOARD_URL=http://localhost:3001
API_BASE_URL=http://localhost:5001
```

---

### 7. Sécurité (3 variables)

```bash
JWT_SECRET=super_secret_jwt_key_change_this_in_production
ENCRYPTION_KEY=32_character_encryption_key_here
WEBHOOK_SIGNATURE_SECRET=webhook_signature_verification_key
```

**Impact si manquantes :**
- ⚠️ Utilisation de valeurs par défaut (OK en dev, dangereux en prod)
- ⚠️ Webhooks non vérifiés (risque de sécurité)

**Solution pour tests :**
```bash
# Générer des clés aléatoires pour tests
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
WEBHOOK_SIGNATURE_SECRET=$(openssl rand -base64 32)
```

---

## 🟢 VARIABLES OPTIONNELLES - FONCTIONNALITÉS AVANCÉES

### 8. Analytics & Monitoring (2 variables)

```bash
GOOGLE_ANALYTICS_ID=G-1234567890
SENTRY_DSN=https://1234567890abcdef@sentry.io/1234567
```

**Impact si manquantes :**
- ℹ️ Pas de tracking analytics (OK pour tests)
- ℹ️ Erreurs non envoyées à Sentry (loggées localement)

**Criticité :** TRÈS BASSE (optionnel même en prod)

---

### 9. Cloudinary CDN (3 variables)

```bash
CLOUDINARY_CLOUD_NAME=social-impact-platform
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefghijklmnop
```

**Impact si manquantes :**
- ℹ️ Images/fichiers stockés dans Firebase Storage (pas de CDN)
- ℹ️ Optimisation d'images non disponible

**Criticité :** BASSE (Firebase Storage suffit pour tests)

---

### 10. Notifications Slack/Discord (2 variables)

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

**Impact si manquantes :**
- ℹ️ Pas d'alertes dans Slack/Discord (loggées seulement)

**Criticité :** TRÈS BASSE (optionnel)

---

## 📊 TABLEAU RÉCAPITULATIF - PRIORITÉS

| Service | Variables | Criticité | Impact si manquantes | Solution Tests |
|---------|-----------|-----------|---------------------|----------------|
| **Firebase** | 3 | 🔴 BLOQUANT | App ne démarre pas | Émulateurs gratuits |
| **Stripe** | 4 | 🔴 CRITIQUE | Paiements impossibles | Clés test gratuites |
| **Sumsub** | 4 | 🔴 CRITIQUE | KYC impossible | Sandbox gratuit (100/mois) |
| **SendGrid** | 2 | 🟡 HAUTE | Emails non envoyés | 100 emails/jour gratuits |
| **URLs Frontend** | 3 | 🟡 MOYENNE | Redirections cassées | localhost |
| **Sécurité** | 3 | 🟡 MOYENNE | Valeurs par défaut | Générer aléatoirement |
| **Templates Email** | 9 | 🟢 BASSE | Format texte basique | Optionnel |
| **Analytics** | 2 | 🟢 TRÈS BASSE | Pas de tracking | Optionnel |
| **Cloudinary** | 3 | 🟢 BASSE | Pas de CDN | Firebase Storage suffit |
| **Slack/Discord** | 2 | 🟢 TRÈS BASSE | Pas d'alertes externes | Optionnel |

---

## ✅ CONFIGURATION MINIMALE POUR TESTS COMPLETS

Pour effectuer des **tests d'utilisation profonds** de l'application, voici la configuration **minimale obligatoire** :

### Fichier `.env` minimal

```bash
# ========================================
# CONFIGURATION MINIMALE POUR TESTS
# ========================================

# === FIREBASE (OBLIGATOIRE) ===
FIREBASE_PROJECT_ID=social-impact-platform-dev
FIREBASE_REGION=europe-west1
FIREBASE_STORAGE_BUCKET=social-impact-platform-dev.appspot.com

# Mode émulateurs (développement)
USE_EMULATORS=true
FIRESTORE_EMULATOR_HOST=localhost:8080
STORAGE_EMULATOR_HOST=localhost:9199
AUTH_EMULATOR_HOST=localhost:9099
FUNCTIONS_EMULATOR_HOST=localhost:5001

# === STRIPE (OBLIGATOIRE POUR PAIEMENTS) ===
STRIPE_SECRET_KEY=sk_test_VOTRE_CLE_TEST_ICI
STRIPE_PUBLISHABLE_KEY=pk_test_VOTRE_CLE_TEST_ICI
STRIPE_WEBHOOK_SECRET=whsec_VOTRE_SECRET_ICI
STRIPE_CONNECT_CLIENT_ID=ca_VOTRE_CLIENT_ID_ICI

# === SUMSUB (OBLIGATOIRE POUR KYC) ===
SUMSUB_APP_TOKEN=sbx:VOTRE_TOKEN_SANDBOX_ICI
SUMSUB_SECRET_KEY=VOTRE_SECRET_KEY_ICI
SUMSUB_BASE_URL=https://api.sumsub.com
SUMSUB_LEVEL_BASIC=basic-kyc-level
SUMSUB_LEVEL_FULL=full-kyc-level

# === SENDGRID (RECOMMANDÉ POUR EMAILS) ===
SENDGRID_API_KEY=SG.VOTRE_API_KEY_ICI
SENDGRID_FROM_EMAIL=test@votre-domaine.com
SENDGRID_FROM_NAME=Social Impact Platform

# === URLS (POUR TESTS LOCAUX) ===
FRONTEND_URL=http://localhost:3000
ADMIN_DASHBOARD_URL=http://localhost:3001
API_BASE_URL=http://localhost:5001

# === SÉCURITÉ (GÉNÉRER ALÉATOIREMENT) ===
JWT_SECRET=your_random_jwt_secret_here
ENCRYPTION_KEY=your_32_character_encryption_key
WEBHOOK_SIGNATURE_SECRET=your_webhook_secret_here

# === ENVIRONNEMENT ===
NODE_ENV=development
LOG_LEVEL=debug

# === FEATURE FLAGS (POUR TESTS) ===
ENABLE_KYC_VERIFICATION=true
ENABLE_AUDIT_SYSTEM=true
ENABLE_EMAIL_NOTIFICATIONS=true
```

---

## 🎯 SCÉNARIOS DE TEST PAR NIVEAU

### Niveau 1 : Tests Basiques (Firebase uniquement)
**Variables requises :** 3 (Firebase core)
- ✅ Lecture/écriture Firestore
- ✅ Upload/download fichiers
- ✅ Authentification utilisateurs
- ✅ Exécution des Cloud Functions

### Niveau 2 : Tests Fonctionnels (+ Stripe + Sumsub)
**Variables requises :** 11 (Firebase + Stripe + Sumsub)
- ✅ Workflow complet créateur (KYC → Projet)
- ✅ Workflow complet contributeur (Paiement)
- ✅ Processus d'audit
- ✅ Libération des fonds

### Niveau 3 : Tests Complets (+ SendGrid + URLs)
**Variables requises :** 16 (Tout ci-dessus + emails + URLs)
- ✅ Notifications par email
- ✅ Redirections post-paiement
- ✅ Expérience utilisateur complète
- ✅ Tests end-to-end complets

---

## 🚀 GUIDE DE DÉMARRAGE RAPIDE

### Étape 1 : Obtenir les clés nécessaires (30 min)

```bash
# 1. Stripe (gratuit - 5 min)
# → https://dashboard.stripe.com/register
# → Récupérer: Secret Key, Publishable Key, Webhook Secret

# 2. Sumsub (gratuit - 10 min)
# → https://sumsub.com/signup
# → Créer projet sandbox
# → Récupérer: App Token, Secret Key
# → Configurer niveaux KYC

# 3. SendGrid (gratuit - 5 min)
# → https://signup.sendgrid.com
# → Créer API Key
# → Vérifier email expéditeur

# 4. Firebase (gratuit - 10 min)
# → https://console.firebase.google.com
# → Créer projet
# → Activer Firestore, Storage, Authentication
```

### Étape 2 : Configurer `.env`

```bash
# Copier le template
cp backend/functions/.env.example backend/functions/.env

# Éditer avec vos clés
nano backend/functions/.env
```

### Étape 3 : Démarrer les émulateurs

```bash
cd backend/functions
npm install
npm run serve  # Lance les émulateurs Firebase
```

### Étape 4 : Créer utilisateurs de test

```bash
# Utiliser le script de seeding fourni dans GUIDE_SETUP_DEVELOPPEMENT.md
npm run seed:test-users
```

---

## ⚠️ AVERTISSEMENTS IMPORTANTS

### 🔒 Sécurité

1. **JAMAIS** committer `.env` dans Git
2. **Utiliser uniquement** les clés de test/sandbox en développement
3. **Générer** de nouvelles clés pour production
4. **Activer** l'authentification même en test
5. **Limiter** les permissions des clés API

### 💰 Coûts

| Service | Plan gratuit | Limites | Coût au-delà |
|---------|-------------|---------|-------------|
| **Stripe Test** | ✅ Illimité | Mode test uniquement | 0€ |
| **Sumsub Sandbox** | ✅ 100/mois | 100 vérifications KYC | 0.50€/vérif |
| **SendGrid Free** | ✅ 100/jour | 100 emails/jour | 0.0001€/email |
| **Firebase Spark** | ✅ Généreux | 1GB storage, 10GB transfer | Voir tarifs |

**Total pour tests :** 0€ si rester dans les limites gratuites

### 🔄 Webhooks en Local

Pour tester les webhooks Stripe/Sumsub en local :

```bash
# Installer Stripe CLI
brew install stripe/stripe-cli/stripe

# Écouter les webhooks
stripe listen --forward-to http://localhost:5001/your-project/europe-west1/handleStripeWebhook

# Pour Sumsub, utiliser ngrok
ngrok http 5001
# Puis configurer l'URL ngrok dans Sumsub dashboard
```

---

## 📝 CHECKLIST AVANT TESTS

- [ ] Firebase projet créé et configuré
- [ ] Stripe clés de test récupérées
- [ ] Sumsub compte sandbox créé
- [ ] SendGrid API key créée (optionnel)
- [ ] Fichier `.env` créé avec toutes les variables obligatoires
- [ ] Émulateurs Firebase lancés (`npm run serve`)
- [ ] Utilisateurs de test créés
- [ ] Webhooks configurés (pour tests paiements)
- [ ] Frontend connecté au backend (si applicable)

---

## 🆘 PROBLÈMES COURANTS

### "STRIPE_SECRET_KEY is required"
→ Vérifier que `.env` est dans `backend/functions/` et contient `STRIPE_SECRET_KEY=sk_test_...`

### "SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY are required"
→ Créer un compte sandbox Sumsub et copier les credentials

### "SendGrid API error 401"
→ Vérifier que l'API key est valide et a les permissions d'envoi

### Webhooks ne fonctionnent pas
→ Utiliser Stripe CLI ou ngrok pour tunneling en local

### "Firebase app has not been initialized"
→ Vérifier `FIREBASE_PROJECT_ID` et lancer les émulateurs

---

## 📚 RESSOURCES

- [Guide Setup Développement](./GUIDE_SETUP_DEVELOPPEMENT.md)
- [Guide Déploiement Production](./GUIDE_DEPLOIEMENT_PRODUCTION.md)
- [Stripe Test Cards](https://stripe.com/docs/testing)
- [Sumsub Sandbox](https://developers.sumsub.com/api-reference/)
- [SendGrid Getting Started](https://docs.sendgrid.com/for-developers/sending-email/api-getting-started)
- [Firebase Emulators](https://firebase.google.com/docs/emulator-suite)

---

**Document mis à jour :** 2025-01-18
**Version :** 1.0
**Auteur :** Analyse automatique des variables d'environnement
