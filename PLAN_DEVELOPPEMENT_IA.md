# Plan de Développement Stratégique - Optimisé pour Exécution par IA
## Social Finance Impact Platform - Complétion du MVP
## Date : 18 Novembre 2025
## Planificateur : Claude AI (Sonnet 4.5)

---

## 🎯 OBJECTIF DU PLAN

Ce plan de développement a été spécifiquement conçu pour être exécuté par une IA (Claude Code) de manière optimale. Chaque tâche est détaillée avec :
- ✅ Prérequis et dépendances explicites
- ✅ Instructions pas-à-pas détaillées
- ✅ Templates et exemples de code
- ✅ Critères de validation clairs
- ✅ Ordre d'exécution optimal

**Philosophie du plan** : Chaque étape peut être exécutée de manière autonome par l'IA sans ambiguïté, avec des checkpoints de validation après chaque tâche.

---

## 📊 VUE D'ENSEMBLE

### Statut Actuel
- **Complétion** : 95% du MVP
- **Gaps critiques** : 3 fonctions + règles Firebase + tests
- **Temps estimé restant** : 46-63 heures pour MVP production-ready

### Organisation du Plan
Le plan est divisé en **3 Phases** basées sur les priorités P0/P1/P2 :

1. **Phase 1 : Bloquants Production (P0)** - 21-29h - OBLIGATOIRE
2. **Phase 2 : Qualité & Fiabilité (P1)** - 25-34h - FORTEMENT RECOMMANDÉ
3. **Phase 3 : Documentation & Expérience (P2)** - 29-39h - RECOMMANDÉ

### Principes d'Exécution pour l'IA

#### 1. Exécution Séquentielle Stricte
- ❌ NE JAMAIS sauter une étape
- ❌ NE JAMAIS exécuter en parallèle si des dépendances existent
- ✅ TOUJOURS valider avant de passer à l'étape suivante
- ✅ TOUJOURS committer après chaque tâche complétée

#### 2. Validation Continue
- Après chaque fichier créé : `npm run lint && npm run build`
- Après chaque test créé : `npm run test -- <test-file>`
- Après chaque module complété : Validation complète du module

#### 3. Gestion des Erreurs
- Si erreur de compilation : Corriger immédiatement avant de continuer
- Si test échoue : Déboguer et corriger avant de continuer
- Si dépendance manquante : Remonter et implémenter la dépendance d'abord

#### 4. Documentation du Progrès
- Mettre à jour le fichier PROGRESS.md après chaque tâche
- Committer avec des messages clairs et descriptifs
- Tagger les commits importants (ex: `P0-complete`, `MVP-ready`)

---

## 🚀 PHASE 1 : BLOQUANTS PRODUCTION (P0)
**Durée estimée** : 21-29 heures (3-4 jours)
**Objectif** : Rendre le backend déployable en production

### Sous-Phase 1.1 : Règles de Sécurité Firebase
**Durée** : 13-17 heures
**Pourquoi cette priorité** : Sans ces règles, la base de données est COMPLÈTEMENT OUVERTE

---

#### Tâche P0.1 : Création de firestore.rules
**Durée estimée** : 8-10 heures
**Priorité** : CRITIQUE - BLOQUANT #1
**Dépendances** :
- `src/types/firestore.ts` (✅ existe)
- `Docs MVP/firestore_data_model.md` (✅ existe)

**Prérequis à lire** :
1. `/home/user/social-impact-backend/Docs MVP/firestore_data_model.md`
2. `/home/user/social-impact-backend/Docs MVP/backend_security_integrations.md`
3. `/home/user/social-impact-backend/backend/functions/src/types/firestore.ts`

**Instructions détaillées** :

```
ÉTAPE 1 : Analyser le modèle de données
- Lire firestore_data_model.md en entier
- Identifier toutes les collections (users, projects, contributions, audits, notifications)
- Noter les champs sensibles (KYC, paiements, données personnelles)
- Identifier les relations entre collections

ÉTAPE 2 : Définir les règles par collection
Pour CHAQUE collection, définir :
- Règles de lecture (read) : Qui peut lire quoi ?
- Règles d'écriture (write) : Qui peut créer/modifier/supprimer ?
- Validation des données : Format, types, longueurs
- Règles GDPR : Accès aux données personnelles

ÉTAPE 3 : Implémenter les helper functions
Créer des fonctions réutilisables :
- isAuthenticated() : Vérifie que request.auth != null
- isOwner(userId) : Vérifie que request.auth.uid == userId
- hasRole(role) : Vérifie le rôle utilisateur
- isAdmin() : Vérifie si admin
- isKYCApproved() : Vérifie le statut KYC

ÉTAPE 4 : Écrire les règles par collection
Ordre recommandé :
1. users : Règles simples, lecture propre + modification propriétaire
2. projects : Règles complexes, visibility selon statut
3. contributions : Règles strictes, paiements sensibles
4. audits : Règles spécifiques auditors
5. notifications : Règles par utilisateur
6. metadata : Collections système

ÉTAPE 5 : Ajouter validation des données
Pour chaque champ critique :
- Type de données (string, number, boolean, timestamp)
- Longueur (min/max pour strings)
- Format (email, phone, URL)
- Valeurs autorisées (enums)
- Champs obligatoires vs optionnels

ÉTAPE 6 : Tester les règles
- Utiliser Firebase Emulator
- Tester scénarios positifs (accès autorisé)
- Tester scénarios négatifs (accès refusé)
- Vérifier règles GDPR (accès données personnelles)
```

**Template de base** :

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function hasRole(role) {
      return isAuthenticated() &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.userType == role;
    }

    function isAdmin() {
      return hasRole('admin');
    }

    function isKYCApproved() {
      return isAuthenticated() &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.kyc.status == 'approved';
    }

    // ============================================
    // COLLECTION: users
    // ============================================

    match /users/{userId} {
      // Lecture : Utilisateur peut lire son propre profil + admins
      allow read: if isOwner(userId) || isAdmin();

      // Création : Seulement lors de la création du compte (uid match)
      allow create: if isOwner(userId) &&
                       request.resource.data.uid == userId &&
                       request.resource.data.email == request.auth.token.email;

      // Mise à jour : Seulement propriétaire, avec validation
      allow update: if isOwner(userId) &&
                       validateUserUpdate(request.resource.data);

      // Suppression : Interdite (soft delete seulement)
      allow delete: if false;

      // Validation des mises à jour utilisateur
      function validateUserUpdate(data) {
        return data.uid == userId && // UID immuable
               data.email == resource.data.email && // Email immuable
               data.userType == resource.data.userType && // Type immuable
               // Autres validations...
               true;
      }
    }

    // ============================================
    // COLLECTION: projects
    // ============================================

    match /projects/{projectId} {
      // Lecture : Public si statut 'live', sinon créateur/admin
      allow read: if resource.data.status == 'live' ||
                     isOwner(resource.data.creatorId) ||
                     isAdmin();

      // Création : Seulement créateurs KYC approuvés
      allow create: if hasRole('creator') &&
                       isKYCApproved() &&
                       validateProjectCreate(request.resource.data);

      // Mise à jour : Créateur ou admin
      allow update: if (isOwner(resource.data.creatorId) || isAdmin()) &&
                       validateProjectUpdate(request.resource.data);

      // Suppression : Seulement admin
      allow delete: if isAdmin();

      function validateProjectCreate(data) {
        return data.creatorId == request.auth.uid &&
               data.status == 'draft' && // Nouveau projet = draft
               data.fundingGoal >= 1000 && // Min 1000 EUR
               data.fundingGoal <= 50000 && // Max 50000 EUR
               // Autres validations...
               true;
      }

      function validateProjectUpdate(data) {
        return data.creatorId == resource.data.creatorId && // Créateur immuable
               // Validation transitions de statut
               validateStatusTransition(resource.data.status, data.status) &&
               true;
      }

      function validateStatusTransition(oldStatus, newStatus) {
        // Implémentez la logique de transitions autorisées
        return true; // Placeholder
      }
    }

    // ============================================
    // COLLECTION: contributions
    // ============================================

    match /contributions/{contributionId} {
      // Lecture : Contributeur, créateur du projet, ou admin
      allow read: if isOwner(resource.data.contributorId) ||
                     isOwner(resource.data.projectCreatorId) ||
                     isAdmin();

      // Création : Via Cloud Function seulement (pour Stripe)
      allow create: if false; // Géré par createContribution function

      // Mise à jour : Cloud Function seulement
      allow update: if false; // Géré par confirmPayment function

      // Suppression : Interdite
      allow delete: if false;
    }

    // ============================================
    // COLLECTION: audits
    // ============================================

    match /audits/{auditId} {
      // Lecture : Auditeur assigné, créateur du projet, ou admin
      allow read: if isOwner(resource.data.auditorId) ||
                     isOwner(resource.data.projectCreatorId) ||
                     isAdmin();

      // Création : Cloud Function seulement
      allow create: if false;

      // Mise à jour : Auditeur assigné ou admin
      allow update: if isOwner(resource.data.auditorId) || isAdmin();

      // Suppression : Admin seulement
      allow delete: if isAdmin();
    }

    // ============================================
    // COLLECTION: notifications
    // ============================================

    match /notifications/{notificationId} {
      // Lecture : Destinataire seulement
      allow read: if isOwner(resource.data.userId);

      // Création : Cloud Function seulement
      allow create: if false;

      // Mise à jour : Destinataire seulement (pour marquer comme lu)
      allow update: if isOwner(resource.data.userId) &&
                       // Seulement champs 'read' et 'readAt' modifiables
                       request.resource.data.diff(resource.data).affectedKeys()
                         .hasOnly(['read', 'readAt']);

      // Suppression : Destinataire ou admin
      allow delete: if isOwner(resource.data.userId) || isAdmin();
    }

    // ============================================
    // COLLECTIONS SYSTÈME (metadata, platform_stats, etc.)
    // ============================================

    match /platform_stats/{document=**} {
      allow read: if isAdmin();
      allow write: if false; // Cloud Functions seulement
    }

    match /system_config/{document=**} {
      allow read: if isAdmin();
      allow write: if isAdmin();
    }
  }
}
```

**Validation** :
```bash
# Dans le terminal
cd /home/user/social-impact-backend/backend/functions
firebase emulators:start --only firestore
# Tester les règles avec Firebase Emulator UI
```

**Critères de succès** :
- [ ] Fichier firestore.rules créé à la racine du projet
- [ ] Toutes les collections ont des règles définies
- [ ] Helper functions implémentées et réutilisées
- [ ] Validation des données pour champs critiques
- [ ] Tests des règles passent dans l'émulateur
- [ ] Aucune collection n'est en lecture/écriture publique

**Commit** :
```bash
git add firestore.rules
git commit -m "feat(security): Add comprehensive Firestore security rules

- Implement RBAC with role-based access control
- Add data validation for all collections
- Protect sensitive data (KYC, payments, personal info)
- Ensure GDPR compliance with proper access controls
- Add helper functions for reusable security logic

Closes P0.1 - Critical security requirement for production"
```

---

#### Tâche P0.2 : Création de firestore.indexes.json
**Durée estimée** : 3-4 heures
**Priorité** : CRITIQUE - BLOQUANT #2
**Dépendances** :
- Tâche P0.1 (firestore.rules) - ✅ doit être complétée
- Analyse des requêtes dans le code

**Prérequis** :
1. Analyser tous les fichiers `*.ts` pour identifier les requêtes Firestore complexes
2. Identifier les `where()` multiples, `orderBy()`, et combinaisons

**Instructions détaillées** :

```
ÉTAPE 1 : Identifier les requêtes complexes
Parcourir tous les fichiers et chercher :
- Requêtes avec plusieurs .where()
- Requêtes avec .where() + .orderBy()
- Requêtes avec range queries (<, >, <=, >=)
- Requêtes avec array-contains + autres filtres

Fichiers prioritaires à analyser :
- src/projects/searchProjects.ts
- src/projects/getProjectsByCreator.ts
- src/notifications/getNotifications.ts
- src/audits/getAuditorDashboard.ts
- src/scheduled/*.ts

ÉTAPE 2 : Documenter chaque requête complexe
Pour chaque requête trouvée, noter :
- Collection
- Champs utilisés dans where()
- Champs utilisés dans orderBy()
- Type de requête (equality, range, array-contains)

ÉTAPE 3 : Créer les index composites
Pour chaque requête complexe, créer un index :
{
  "collectionGroup": "nom_collection",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "champ1", "order": "ASCENDING" },
    { "fieldPath": "champ2", "order": "DESCENDING" }
  ]
}

ÉTAPE 4 : Tester dans l'émulateur
- Lancer l'émulateur Firestore
- Exécuter les requêtes
- Vérifier que les index sont utilisés
```

**Template de base** :

```json
{
  "indexes": [
    // ============================================
    // COLLECTION: projects
    // ============================================

    // Index pour searchProjects : Recherche par catégorie + tri par date
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "category", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // Index pour searchProjects : Recherche par statut + funding progress
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "fundingProgress", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // Index pour searchProjects : Projets par localisation
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "location.country", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "fundingProgress", "order": "DESCENDING" }
      ]
    },

    // Index pour getProjectsByCreator : Projets d'un créateur triés
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "creatorId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },

    // Index pour trending projects
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "trending.score", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // ============================================
    // COLLECTION: contributions
    // ============================================

    // Index pour contributions par projet + statut
    {
      "collectionGroup": "contributions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // Index pour contributions par utilisateur
    {
      "collectionGroup": "contributions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "contributorId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // ============================================
    // COLLECTION: audits
    // ============================================

    // Index pour audits par auditeur
    {
      "collectionGroup": "audits",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "auditorId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "deadline", "order": "ASCENDING" }
      ]
    },

    // Index pour audits par projet
    {
      "collectionGroup": "audits",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "milestoneId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // ============================================
    // COLLECTION: notifications
    // ============================================

    // Index pour notifications par utilisateur non lues
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "read", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // Index pour notifications par type et priorité
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "DESCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },

    // ============================================
    // COLLECTION: users
    // ============================================

    // Index pour utilisateurs par type et KYC
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userType", "order": "ASCENDING" },
        { "fieldPath": "kyc.status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**Validation** :
```bash
# Valider la syntaxe JSON
cat firestore.indexes.json | python -m json.tool

# Déployer les index (dry-run)
firebase deploy --only firestore:indexes --dry-run
```

**Critères de succès** :
- [ ] Fichier firestore.indexes.json créé
- [ ] Tous les index pour requêtes complexes définis
- [ ] Syntaxe JSON valide
- [ ] Déploiement dry-run réussi

**Commit** :
```bash
git add firestore.indexes.json
git commit -m "feat(database): Add Firestore composite indexes

- Define indexes for all complex queries
- Optimize searchProjects performance
- Index contributions and audits queries
- Enable efficient filtering and sorting

Closes P0.2 - Required for production query performance"
```

---

#### Tâche P0.3 : Création de storage.rules
**Durée estimée** : 2-3 heures
**Priorité** : CRITIQUE - BLOQUANT #3
**Dépendances** : firestore.rules (✅ doit être complété)

**Instructions détaillées** :

```
ÉTAPE 1 : Identifier les cas d'usage Storage
- Photos de profil utilisateurs
- Documents KYC (pièces d'identité)
- Images de projets (cover, gallery)
- Documents d'audit (preuves, evidence)
- Rapports générés (PDF)

ÉTAPE 2 : Définir la structure des chemins
/users/{userId}/profile/{fileName} - Photos de profil
/users/{userId}/kyc/{fileName} - Documents KYC
/projects/{projectId}/images/{fileName} - Images projet
/audits/{auditId}/evidence/{fileName} - Preuves audit
/reports/{year}/{month}/{fileName} - Rapports système

ÉTAPE 3 : Créer les règles par chemin
Pour chaque chemin :
- Qui peut lire (read/get/list) ?
- Qui peut écrire (write/create/update/delete) ?
- Quelles validations (taille, type MIME) ?

ÉTAPE 4 : Ajouter validations de sécurité
- Taille maximale des fichiers
- Types MIME autorisés
- Limites de quota par utilisateur
```

**Template complet** :

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isImageFile() {
      return request.resource.contentType.matches('image/.*');
    }

    function isPDFFile() {
      return request.resource.contentType == 'application/pdf';
    }

    function isValidSize(maxSizeMB) {
      return request.resource.size < maxSizeMB * 1024 * 1024;
    }

    // ============================================
    // USER PROFILE PICTURES
    // Path: /users/{userId}/profile/{fileName}
    // ============================================

    match /users/{userId}/profile/{fileName} {
      // Lecture : Public (pour affichage profil)
      allow read: if true;

      // Écriture : Propriétaire seulement
      allow write: if isOwner(userId) &&
                      isImageFile() &&
                      isValidSize(5); // Max 5MB
    }

    // ============================================
    // KYC DOCUMENTS (HIGHLY SENSITIVE)
    // Path: /users/{userId}/kyc/{fileName}
    // ============================================

    match /users/{userId}/kyc/{fileName} {
      // Lecture : Propriétaire + Admins seulement
      allow read: if isOwner(userId) ||
                     hasAdminRole(); // Implémenter via Firestore lookup

      // Écriture : Propriétaire seulement, types restreints
      allow write: if isOwner(userId) &&
                      (isImageFile() || isPDFFile()) &&
                      isValidSize(10); // Max 10MB pour documents

      // Suppression : Interdite (audit trail)
      allow delete: if false;
    }

    // ============================================
    // PROJECT IMAGES
    // Path: /projects/{projectId}/images/{fileName}
    // ============================================

    match /projects/{projectId}/images/{fileName} {
      // Lecture : Public (pour affichage projet)
      allow read: if true;

      // Écriture : Créateur du projet seulement
      allow write: if isAuthenticated() &&
                      isProjectCreator(projectId) &&
                      isImageFile() &&
                      isValidSize(10); // Max 10MB
    }

    // ============================================
    // AUDIT EVIDENCE
    // Path: /audits/{auditId}/evidence/{fileName}
    // ============================================

    match /audits/{auditId}/evidence/{fileName} {
      // Lecture : Auditeur, créateur projet, admin
      allow read: if isAuthenticated() &&
                     (isAuditor(auditId) ||
                      isProjectCreatorForAudit(auditId) ||
                      hasAdminRole());

      // Écriture : Auditeur seulement
      allow write: if isAuthenticated() &&
                      isAuditor(auditId) &&
                      (isImageFile() || isPDFFile()) &&
                      isValidSize(20); // Max 20MB pour preuves
    }

    // ============================================
    // SYSTEM REPORTS
    // Path: /reports/{year}/{month}/{fileName}
    // ============================================

    match /reports/{year}/{month}/{fileName} {
      // Lecture : Admin seulement
      allow read: if hasAdminRole();

      // Écriture : Cloud Functions seulement
      allow write: if false;
    }

    // ============================================
    // HELPER FUNCTIONS WITH FIRESTORE LOOKUP
    // ============================================

    function hasAdminRole() {
      return isAuthenticated() &&
             firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data.userType == 'admin';
    }

    function isProjectCreator(projectId) {
      return isAuthenticated() &&
             firestore.get(/databases/(default)/documents/projects/$(projectId)).data.creatorId == request.auth.uid;
    }

    function isAuditor(auditId) {
      return isAuthenticated() &&
             firestore.get(/databases/(default)/documents/audits/$(auditId)).data.auditorId == request.auth.uid;
    }

    function isProjectCreatorForAudit(auditId) {
      let audit = firestore.get(/databases/(default)/documents/audits/$(auditId)).data;
      return isAuthenticated() &&
             firestore.get(/databases/(default)/documents/projects/$(audit.projectId)).data.creatorId == request.auth.uid;
    }
  }
}
```

**Validation** :
```bash
# Déployer les règles (dry-run)
firebase deploy --only storage --dry-run
```

**Critères de succès** :
- [ ] Fichier storage.rules créé
- [ ] Toutes les paths Storage ont des règles
- [ ] Validation taille et type MIME
- [ ] Documents KYC protégés
- [ ] Déploiement dry-run réussi

**Commit** :
```bash
git add storage.rules
git commit -m "feat(security): Add Firebase Storage security rules

- Protect user profile pictures and KYC documents
- Restrict project images to creators
- Secure audit evidence files
- Validate file types and sizes
- Implement GDPR-compliant access controls

Closes P0.3 - Storage security required for production"
```

---

### Sous-Phase 1.2 : Fonctions Projet Manquantes
**Durée** : 8-12 heures
**Ordre d'exécution** : submitProject → approveProject → getProjectAnalytics

---

#### Tâche P0.4 : Implémentation de submitProject.ts
**Durée estimée** : 3-4 heures
**Priorité** : CRITIQUE - BLOQUANT #4
**Dépendances** :
- `src/projects/createProject.ts` (✅ existe)
- `src/types/firestore.ts` (✅ existe)
- `src/utils/validation.ts` (✅ existe)

**Fichier à créer** : `/home/user/social-impact-backend/backend/functions/src/projects/submitProject.ts`

**Fonctionnalité** :
Permet au créateur de soumettre un projet (statut draft) pour review par les admins.
Vérifie que le projet est complet avant soumission.

**Instructions détaillées** :

```typescript
/**
 * submitProject.ts - Soumet un projet pour review admin
 *
 * WORKFLOW :
 * 1. Vérifier que l'utilisateur est le créateur du projet
 * 2. Vérifier que le projet est en statut 'draft'
 * 3. Valider que tous les champs requis sont remplis
 * 4. Vérifier que le créateur a KYC approuvé
 * 5. Changer le statut à 'under_review'
 * 6. Créer notification pour les admins
 * 7. Envoyer email au créateur (confirmation soumission)
 */

import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../utils/firestore';
import {logger} from '../utils/logger';
import {withErrorHandling} from '../utils/errors';
import {ProjectDocument, UserDocument} from '../types/firestore';
import {sendNotification} from '../notifications/sendNotification';

interface SubmitProjectRequest {
  projectId: string;
}

interface SubmitProjectResponse {
  success: boolean;
  projectId: string;
  status: string;
  submittedAt: string;
}

export const submitProject = onCall<SubmitProjectRequest, Promise<SubmitProjectResponse>>(
  {
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  withErrorHandling(async (request) => {
    // ÉTAPE 1 : Vérifier authentification
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = request.auth.uid;
    const {projectId} = request.data;

    logger.info('Submitting project for review', {userId, projectId});

    // ÉTAPE 2 : Vérifier que projectId est fourni
    if (!projectId) {
      throw new HttpsError('invalid-argument', 'projectId is required');
    }

    // ÉTAPE 3 : Récupérer le projet
    const projectRef = db.collection('projects').doc(projectId);
    const projectSnap = await projectRef.get();

    if (!projectSnap.exists) {
      throw new HttpsError('not-found', `Project ${projectId} not found`);
    }

    const project = projectSnap.data() as ProjectDocument;

    // ÉTAPE 4 : Vérifier que l'utilisateur est le créateur
    if (project.creatorId !== userId) {
      throw new HttpsError(
        'permission-denied',
        'Only the project creator can submit the project'
      );
    }

    // ÉTAPE 5 : Vérifier le statut actuel
    if (project.status !== 'draft') {
      throw new HttpsError(
        'failed-precondition',
        `Project must be in draft status to be submitted. Current status: ${project.status}`
      );
    }

    // ÉTAPE 6 : Récupérer l'utilisateur pour vérifier KYC
    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const user = userSnap.data() as UserDocument;

    // ÉTAPE 7 : Vérifier que le créateur a KYC approuvé
    if (user.kyc.status !== 'approved') {
      throw new HttpsError(
        'failed-precondition',
        `KYC verification must be approved before submitting a project. Current KYC status: ${user.kyc.status}`
      );
    }

    // ÉTAPE 8 : Valider que le projet est complet
    validateProjectCompleteness(project);

    // ÉTAPE 9 : Mettre à jour le statut du projet
    const submittedAt = FieldValue.serverTimestamp();

    await projectRef.update({
      status: 'under_review',
      submittedAt: submittedAt,
      reviewStatus: {
        status: 'pending',
        submittedAt: submittedAt,
        reviewedAt: null,
        reviewedBy: null,
        comments: null,
      },
      updatedAt: FieldValue.serverTimestamp(),
      version: FieldValue.increment(1),
    });

    // ÉTAPE 10 : Créer notification pour les admins
    await notifyAdmins(projectId, project.title, userId);

    // ÉTAPE 11 : Envoyer notification au créateur
    await sendNotification.call({
      data: {
        userId: userId,
        type: 'project_submitted',
        title: 'Projet soumis pour review',
        message: `Votre projet "${project.title}" a été soumis avec succès et est en attente de review.`,
        data: {projectId},
        channels: {email: true, inApp: true},
      },
      auth: request.auth,
    } as any);

    logger.info('Project submitted successfully', {
      projectId,
      userId,
      status: 'under_review',
    });

    return {
      success: true,
      projectId,
      status: 'under_review',
      submittedAt: new Date().toISOString(),
    };
  })
);

/**
 * Valide que le projet contient tous les champs requis
 */
function validateProjectCompleteness(project: ProjectDocument): void {
  const errors: string[] = [];

  // Champs obligatoires de base
  if (!project.title || project.title.length < 10) {
    errors.push('Title must be at least 10 characters');
  }

  if (!project.description || project.description.length < 100) {
    errors.push('Description must be at least 100 characters');
  }

  if (!project.category) {
    errors.push('Category is required');
  }

  // Financement
  if (!project.fundingGoal || project.fundingGoal < 1000) {
    errors.push('Funding goal must be at least €1,000');
  }

  if (!project.fundingDeadline) {
    errors.push('Funding deadline is required');
  }

  // Milestones
  if (!project.milestones || project.milestones.length === 0) {
    errors.push('At least one milestone is required');
  } else {
    // Vérifier que les milestones sont valides
    project.milestones.forEach((milestone, index) => {
      if (!milestone.title) {
        errors.push(`Milestone ${index + 1}: Title is required`);
      }
      if (!milestone.description) {
        errors.push(`Milestone ${index + 1}: Description is required`);
      }
      if (!milestone.amount || milestone.amount <= 0) {
        errors.push(`Milestone ${index + 1}: Amount must be greater than 0`);
      }
    });

    // Vérifier que la somme des milestones = funding goal
    const totalMilestones = project.milestones.reduce(
      (sum, m) => sum + m.amount,
      0
    );
    if (Math.abs(totalMilestones - project.fundingGoal) > 0.01) {
      errors.push(
        `Sum of milestone amounts (€${totalMilestones}) must equal funding goal (€${project.fundingGoal})`
      );
    }
  }

  // Images
  if (!project.coverImage) {
    errors.push('Cover image is required');
  }

  // Localisation
  if (!project.location || !project.location.country) {
    errors.push('Project location is required');
  }

  // Si erreurs, rejeter
  if (errors.length > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Project validation failed: ${errors.join('; ')}`
    );
  }
}

/**
 * Notifie tous les admins qu'un nouveau projet est en attente de review
 */
async function notifyAdmins(
  projectId: string,
  projectTitle: string,
  creatorId: string
): Promise<void> {
  try {
    // Récupérer tous les admins
    const adminsSnap = await db
      .collection('users')
      .where('userType', '==', 'admin')
      .get();

    // Créer notification pour chaque admin
    const notificationPromises = adminsSnap.docs.map((adminDoc) => {
      return sendNotification.call({
        data: {
          userId: adminDoc.id,
          type: 'project_pending_review',
          title: 'Nouveau projet à reviewer',
          message: `Le projet "${projectTitle}" a été soumis et attend votre review.`,
          data: {projectId, creatorId},
          priority: 'high',
          channels: {email: true, inApp: true},
        },
        auth: {uid: adminDoc.id} as any,
      } as any);
    });

    await Promise.all(notificationPromises);

    logger.info('Admins notified of new project submission', {
      projectId,
      adminCount: adminsSnap.size,
    });
  } catch (error) {
    // Log mais ne pas faire échouer la soumission
    logger.error('Error notifying admins', {
      error,
      projectId,
    });
  }
}
```

**Test à créer** : `/home/user/social-impact-backend/backend/functions/src/projects/__tests__/submitProject.test.ts`

```typescript
import {submitProject} from '../submitProject';
// Implémenter tests unitaires complets
```

**Validation** :
```bash
cd /home/user/social-impact-backend/backend/functions
npm run lint
npm run build
npm run test -- src/projects/__tests__/submitProject.test.ts
```

**Critères de succès** :
- [ ] Fichier submitProject.ts créé et fonctionne
- [ ] Validation complétude projet implémentée
- [ ] Notifications admins fonctionnelles
- [ ] Tests unitaires passent
- [ ] Compilation sans erreur

**Commit** :
```bash
git add src/projects/submitProject.ts src/projects/__tests__/submitProject.test.ts
git commit -m "feat(projects): Implement submitProject function

- Allow creators to submit draft projects for review
- Validate project completeness before submission
- Check KYC approval requirement
- Notify admins of pending review
- Send confirmation to project creator

Closes P0.4 - Required for project approval workflow"
```

---

#### Tâche P0.5 : Implémentation de approveProject.ts
**Durée estimée** : 3-4 heures
**Priorité** : CRITIQUE - BLOQUANT #5
**Dépendances** : P0.4 (submitProject) ✅ doit être complété

**Fichier à créer** : `/home/user/social-impact-backend/backend/functions/src/projects/approveProject.ts`

**Fonctionnalité** :
Permet aux admins d'approuver ou rejeter un projet en review.
Change le statut de 'under_review' vers 'live' (approuvé) ou 'draft' (rejeté).

**Template** : Similaire à submitProject.ts mais avec logique admin

```typescript
/**
 * approveProject.ts - Approuve ou rejette un projet
 *
 * WORKFLOW APPROBATION :
 * 1. Vérifier que l'utilisateur est admin
 * 2. Vérifier que le projet est en 'under_review'
 * 3. Si approuvé : statut → 'live', activer funding
 * 4. Si rejeté : statut → 'draft', ajouter commentaires
 * 5. Notifier le créateur du résultat
 *
 * NOTE : Voir submitProject.ts pour structure similaire
 */

import {onCall, HttpsError} from 'firebase-functions/v2/https';
import {FieldValue} from 'firebase-admin/firestore';
import {db} from '../utils/firestore';
import {logger} from '../utils/logger';
import {withErrorHandling} from '../utils/errors';
import {ProjectDocument, UserDocument} from '../types/firestore';
import {sendNotification} from '../notifications/sendNotification';

interface ApproveProjectRequest {
  projectId: string;
  action: 'approve' | 'reject';
  comments?: string;
}

interface ApproveProjectResponse {
  success: boolean;
  projectId: string;
  action: string;
  newStatus: string;
}

export const approveProject = onCall<ApproveProjectRequest, Promise<ApproveProjectResponse>>(
  {
    region: 'europe-west1',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  withErrorHandling(async (request) => {
    // Implémenter la logique d'approbation/rejet
    // Suivre le pattern de submitProject.ts

    // ÉTAPE 1 : Vérifier que l'utilisateur est admin
    // ÉTAPE 2 : Valider les paramètres
    // ÉTAPE 3 : Récupérer le projet
    // ÉTAPE 4 : Vérifier statut 'under_review'
    // ÉTAPE 5 : Appliquer action (approve/reject)
    // ÉTAPE 6 : Notifier le créateur
    // ÉTAPE 7 : Logger l'action admin

    // TODO : Implémenter
    throw new Error('Not implemented yet');
  })
);
```

**Critères de succès** : Similaires à P0.4

---

#### Tâche P0.6 : Implémentation de getProjectAnalytics.ts
**Durée estimée** : 2-4 heures
**Priorité** : CRITIQUE - BLOQUANT #6

**Fonctionnalité** : Retourne les analytics détaillées d'un projet (vues, contributions, progression, etc.)

**Critères de succès** : Similaires aux tâches précédentes

---

## 🏁 FIN DE PHASE 1

### Checkpoint Phase 1
Après avoir complété TOUTES les tâches P0.1 à P0.6, exécuter :

```bash
cd /home/user/social-impact-backend/backend/functions

# Validation complète
npm run lint
npm run build
npm run test

# Déploiement test (dry-run)
firebase deploy --only functions,firestore:rules,firestore:indexes,storage:rules --dry-run

# Vérifier que TOUT passe
```

**Critères Phase 1 Complète** :
- [ ] firestore.rules créé et testé
- [ ] firestore.indexes.json créé et testé
- [ ] storage.rules créé et testé
- [ ] submitProject.ts implémenté et testé
- [ ] approveProject.ts implémenté et testé
- [ ] getProjectAnalytics.ts implémenté et testé
- [ ] Tous les tests passent
- [ ] Aucune erreur de compilation
- [ ] Déploiement dry-run réussi

**🎉 SI PHASE 1 COMPLÈTE : Backend est maintenant DÉPLOYABLE EN PRODUCTION**

---

## 🧪 PHASE 2 : QUALITÉ & FIABILITÉ (P1)
**Durée estimée** : 25-34 heures (4-5 jours)
**Objectif** : Atteindre >85% test coverage

### Vue d'ensemble Phase 2
Cette phase se concentre sur la création de tests complets pour tous les modules qui n'en ont pas encore.

**Modules à tester** :
1. Scheduled functions (9 fichiers) - ~8-10h
2. Triggers (4 fichiers) - ~4-6h
3. Intégrations (6 fichiers) - ~6-8h
4. Monitoring (4 fichiers) - ~3-4h
5. Security (amélioration) - ~4-6h

### Template de Test Standard

Pour CHAQUE fichier de test, suivre ce template :

```typescript
/**
 * Tests pour <nom-function>.ts
 *
 * COUVERTURE :
 * - Cas nominal (success)
 * - Cas d'erreur (authentication, validation, etc.)
 * - Edge cases (limites, valeurs nulles, etc.)
 * - Mocks des services externes
 */

import {<functionName>} from '../<functionName>';
import * as admin from 'firebase-admin';

// Mock Firebase Admin
jest.mock('firebase-admin', () => ({
  // Mocks appropriés
}));

describe('<functionName>', () => {
  beforeEach(() => {
    // Setup
    jest.clearAllMocks();
  });

  describe('Success cases', () => {
    it('should <action> when <condition>', async () => {
      // Arrange
      const mockRequest = {
        auth: {uid: 'test-user-id'},
        data: {/* test data */},
      };

      // Act
      const result = await <functionName>(mockRequest);

      // Assert
      expect(result).toEqual({/* expected result */});
    });
  });

  describe('Error cases', () => {
    it('should throw unauthenticated error when user not logged in', async () => {
      // Test unauthenticated
    });

    it('should throw invalid-argument when required field missing', async () => {
      // Test validation
    });
  });

  describe('Edge cases', () => {
    it('should handle <edge case>', async () => {
      // Test edge case
    });
  });
});
```

### Instructions Détaillées pour Chaque Module

#### P1.1 : Tests Scheduled Functions (8-10h)

Pour CHAQUE fichier scheduled :
1. Lire le fichier d'implémentation
2. Identifier les cas de test nécessaires
3. Mocker Firestore, les services externes
4. Tester les cron schedules
5. Valider les résultats attendus

**Fichiers à tester** :
- calculateInterest.test.ts
- cleanupExpiredData.test.ts
- generateMonthlyReports.test.ts
- processAuditQueue.test.ts
- processScheduledRefunds.test.ts
- sendDigestEmails.test.ts
- syncPlatformMetrics.test.ts
- updateRecommendations.test.ts
- updateTrendingProjects.test.ts

#### P1.2 : Tests Triggers (4-6h)

**Fichiers à tester** :
- onUserCreate.test.ts
- onProjectUpdate.test.ts
- onPaymentSuccess.test.ts
- onAuditComplete.test.ts

#### P1.3 : Tests Intégrations (6-8h)

**Fichiers à tester** :
- stripe/stripeService.test.ts
- stripe/webhookHandlers.test.ts
- sendgrid/emailService.test.ts
- sendgrid/templates.test.ts
- sumsub/sumsubService.test.ts
- sumsub/webhookHandlers.test.ts

---

## 📚 PHASE 3 : DOCUMENTATION & EXPÉRIENCE (P2)
**Durée estimée** : 29-39 heures (4-5 jours)
**Objectif** : Documentation complète et features optionnelles

### P2.1 : Documentation (8-12h)

#### Tâche P2.1 : README.md complet
- Installation
- Configuration
- Déploiement
- Architecture
- Tests

#### Tâche P2.2 : Documentation API (OpenAPI)
- Générer spec OpenAPI complète
- Swagger UI
- Exemples de requêtes

#### Tâche P2.3 : Guide déploiement
- Step-by-step production deployment
- Environment setup
- Troubleshooting

#### Tâche P2.4 : .env.example
- Toutes les variables nécessaires
- Descriptions claires
- Valeurs par défaut

---

## 🎯 MÉTRIQUES DE SUCCÈS GLOBALES

### Après Phase 1 (P0) - MVP Production-Ready
- ✅ Backend déployable en production
- ✅ Sécurité Firebase complète
- ✅ Workflow projet complet
- ⚠️ Test coverage ~40%

### Après Phase 2 (P0 + P1) - MVP Robuste
- ✅ Test coverage >85%
- ✅ CI/CD possible
- ✅ Qualité production-grade

### Après Phase 3 (P0 + P1 + P2) - MVP Complet
- ✅ Documentation exhaustive
- ✅ API documentée (OpenAPI)
- ✅ Guide déploiement
- ✅ Onboarding facile

---

## 📋 FICHIER DE SUIVI : PROGRESS.md

Créer ce fichier pour tracker le progrès :

```markdown
# Progrès Développement MVP

## Phase 1 : Bloquants Production (P0)
- [ ] P0.1 - firestore.rules
- [ ] P0.2 - firestore.indexes.json
- [ ] P0.3 - storage.rules
- [ ] P0.4 - submitProject.ts
- [ ] P0.5 - approveProject.ts
- [ ] P0.6 - getProjectAnalytics.ts

## Phase 2 : Qualité (P1)
- [ ] P1.1 - Tests scheduled functions
- [ ] P1.2 - Tests triggers
- [ ] P1.3 - Tests intégrations
- [ ] P1.4 - Tests monitoring
- [ ] P1.5 - Tests security

## Phase 3 : Documentation (P2)
- [ ] P2.1 - README.md
- [ ] P2.2 - OpenAPI docs
- [ ] P2.3 - Guide déploiement
- [ ] P2.4 - .env.example
```

---

## 🎓 CONCLUSION

Ce plan de développement a été optimisé pour permettre à une IA de combler efficacement les gaps restants (5% du projet).

**Points clés** :
1. **Exécution séquentielle** : Chaque tâche a des dépendances claires
2. **Validation continue** : Tests après chaque modification
3. **Commits fréquents** : Sauvegarder le progrès régulièrement
4. **Templates détaillés** : Code prêt à adapter
5. **Critères clairs** : Pas d'ambiguïté sur "terminé"

**Timeline réaliste** :
- Phase 1 (P0) : 3-4 jours → **Backend production-ready**
- Phase 2 (P1) : 4-5 jours → **Backend robuste**
- Phase 3 (P2) : 4-5 jours → **Backend documenté**

**Total** : **11-14 jours de développement effectif** pour un MVP complet enterprise-grade.

---

**Prêt à commencer ?** Exécuter la première tâche : **P0.1 - Création de firestore.rules**
