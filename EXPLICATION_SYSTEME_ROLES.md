# 🎭 EXPLICATION DU SYSTÈME DE RÔLES ET PERMISSIONS

**Date**: 2025-12-17
**Sujet**: Clarification du changement "role" → "userType" + système de permissions

---

## ❓ LA QUESTION

> "Tu dis que le champ 'role' ne doit plus exister et je ne comprends pas ni pourquoi, ni comment dorénavant les différents types d'utilisateurs seront gérés"

**Réponse courte**: Le champ `role` est l'ANCIEN modèle. Le NOUVEAU modèle utilise `userType` + `permissions` pour plus de flexibilité. C'est le backend qui impose ce changement.

---

## 🔍 LE PROBLÈME IDENTIFIÉ

### Situation Actuelle dans Votre Firestore

```json
// Document utilisateur actuel (ANCIEN MODÈLE)
{
  "uid": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "email": "ericvekout2022@gmail.com",
  "firstName": "Eric",
  "lastName": "Vekout",
  "role": "investor"  // ← ANCIEN CHAMP (incompatible avec le backend)
}
```

### Ce Que Le Backend Attend (NOUVEAU MODÈLE)

**Fichier**: `backend/functions/src/types/global.ts` (ligne 5)
```typescript
export type UserType = 'contributor' | 'creator' | 'auditor' | 'admin';
```

**Fichier**: `backend/functions/src/types/firestore.ts` (lignes 59-60)
```typescript
export interface UserDocument extends BaseDocument {
  userType: UserType;        // ← NOUVEAU CHAMP (requis par le backend)
  permissions: string[];     // ← NOUVEAU SYSTÈME de permissions granulaires
  // ...
}
```

### Où Le Backend Utilise "userType" ?

**1. Règles Firestore** (`firestore.rules` ligne 24):
```javascript
function hasRole(role) {
  return isAuthenticated() && getUserData().userType == role;
  //                                           ^^^^^^^^ Cherche "userType", pas "role"
}
```

**2. Cloud Functions** (`createProject.ts`, `updateProject.ts`, etc.):
```typescript
// Vérification du type d'utilisateur
if (user.userType !== 'creator') {
  //      ^^^^^^^^ Utilise "userType"
  throw new Error('User must be a creator');
}
```

**3. Règles Storage** (`storage.rules` ligne 24):
```javascript
function hasRole(role) {
  return isAuthenticated() && getUserData().userType == role;
  //                                           ^^^^^^^^
}
```

---

## 🎯 POURQUOI CE CHANGEMENT ?

### Ancien Système (avec "role")

**Limitations**:
- ❌ Un seul rôle par utilisateur
- ❌ Permissions "tout ou rien" basées uniquement sur le rôle
- ❌ Difficile d'ajouter des permissions spécifiques
- ❌ Noms de rôles ambigus ("investor" vs "contributor", "organization" vs "creator")

**Exemple de problème**:
```
Utilisateur: role = "investor"
Voudrait aussi: créer des projets (normalement réservé à "organization")
→ IMPOSSIBLE sans changer complètement son rôle
```

### Nouveau Système (avec "userType" + "permissions")

**Avantages**:
- ✅ Type d'utilisateur clair et standardisé
- ✅ Permissions granulaires et flexibles
- ✅ Peut combiner type + permissions spécifiques
- ✅ Évolutif et maintenable
- ✅ Conforme aux meilleures pratiques de sécurité

**Exemple de flexibilité**:
```json
{
  "userType": "creator",
  "permissions": [
    "CREATE_PROJECT",
    "CONTRIBUTE",      // Peut AUSSI contribuer à d'autres projets
    "COMMENT",
    "AUDIT"            // Peut AUSSI auditer (si qualifié)
  ]
}
```

---

## 🗺️ MAPPING: ANCIEN → NOUVEAU MODÈLE

### Correspondance des Rôles

| Ancien "role" | Nouveau "userType" | Permissions par défaut | Description |
|---------------|-------------------|----------------------|-------------|
| `"investor"` | `"contributor"` | `["CONTRIBUTE", "COMMENT"]` | Contributeur financier |
| `"organization"` | `"creator"` | `["CREATE_PROJECT", "CONTRIBUTE", "COMMENT"]` | Créateur de projets |
| `"auditor"` | `"auditor"` | `["AUDIT", "COMMENT"]` | Auditeur de projets |
| `"admin"` | `"admin"` | `["CREATE_PROJECT", "CONTRIBUTE", "AUDIT", "MODERATE", "COMMENT"]` | Administrateur plateforme |

### Pourquoi Ces Changements de Nom ?

**"investor" → "contributor"**:
- Plus précis: l'utilisateur CONTRIBUE financièrement
- Moins ambigu: "investor" implique un retour sur investissement (pas le cas ici)

**"organization" → "creator"**:
- Plus clair: l'utilisateur CRÉE des projets
- Universel: peut être une organisation, association, ou individu

---

## 📊 COMMENT FONCTIONNE LE NOUVEAU SYSTÈME ?

### 1. Le Champ "userType" (Type Principal)

**Définit le rôle principal de l'utilisateur**:

```typescript
userType: 'contributor' | 'creator' | 'auditor' | 'admin'
```

**Utilisé pour**:
- Règles de sécurité Firestore/Storage
- Logique métier dans les Cloud Functions
- Affichage de l'interface utilisateur (dashboard différent selon le type)

**Exemple dans les règles Firestore**:
```javascript
// Seuls les "creator" peuvent créer des projets
allow create: if getUserData().userType == 'creator';
```

### 2. Le Champ "permissions" (Permissions Granulaires)

**Tableau de permissions spécifiques**:

```typescript
permissions: string[]  // Exemple: ["CREATE_PROJECT", "CONTRIBUTE", "COMMENT"]
```

**Permissions Disponibles** (définies dans `backend/functions/src/utils/constants.ts`):

```typescript
export const USER_PERMISSIONS = {
  // Projets
  CREATE_PROJECT: 'CREATE_PROJECT',
  EDIT_PROJECT: 'EDIT_PROJECT',
  DELETE_PROJECT: 'DELETE_PROJECT',
  PUBLISH_PROJECT: 'PUBLISH_PROJECT',

  // Contributions
  CONTRIBUTE: 'CONTRIBUTE',
  REFUND: 'REFUND',

  // Audits
  AUDIT: 'AUDIT',
  ASSIGN_AUDITOR: 'ASSIGN_AUDITOR',

  // Modération
  MODERATE: 'MODERATE',
  BAN_USER: 'BAN_USER',

  // Communication
  COMMENT: 'COMMENT',
  MESSAGE: 'MESSAGE',

  // Analytics
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  EXPORT_DATA: 'EXPORT_DATA'
};
```

**Exemple d'utilisation dans le code**:
```typescript
// Vérifier une permission spécifique
if (!user.permissions.includes('CREATE_PROJECT')) {
  throw new Error('User does not have permission to create projects');
}
```

### 3. Combinaison "userType" + "permissions"

**Flexibilité maximale**:

```json
// Utilisateur "creator" avec permissions étendues
{
  "userType": "creator",
  "permissions": [
    "CREATE_PROJECT",    // Permission par défaut pour creator
    "EDIT_PROJECT",      // Permission par défaut pour creator
    "CONTRIBUTE",        // Permission ADDITIONNELLE (peut contribuer aux projets des autres)
    "AUDIT"              // Permission SPÉCIALE (peut aussi auditer)
  ]
}
```

**Cas d'usage**:
- Un créateur de projet qui veut AUSSI contribuer à d'autres projets ✅
- Un auditeur qui a aussi les droits de modération (admin partiel) ✅
- Un contributeur temporairement promu pour créer un projet spécifique ✅

---

## 🔧 MIGRATION: COMMENT PASSER DE L'ANCIEN AU NOUVEAU ?

### Option 1: Migration Manuelle (RECOMMANDÉ pour 1 utilisateur)

**Ce que vous devez faire dans Firebase Console**:

1. **Supprimer l'ancien champ**:
   ```
   Collection: users
   Document: 5GqHzQJ4wrRawS6z2GY1opoSb543
   ❌ Supprimer: "role"
   ```

2. **Ajouter les nouveaux champs**:
   ```
   ✅ Ajouter: "userType" (string) = "creator"
   ✅ Ajouter: "permissions" (array) = ["CREATE_PROJECT", "CONTRIBUTE", "COMMENT"]
   ```

**Correspondance selon votre ancien "role"**:
- Si `role = "investor"` → `userType = "contributor"` + permissions de base
- Si `role = "organization"` → `userType = "creator"` + permissions de création

### Option 2: Migration Automatique (pour PLUSIEURS utilisateurs)

**Cloud Function de migration** (code fourni dans `FRONTEND_CORRECTIONS_REQUISES.md`):

```typescript
// Fonction qui migre automatiquement tous les utilisateurs
export const migrateUserRoles = https.onCall(async (data, context) => {
  // Récupérer tous les users avec ancien champ "role"
  const users = await db.collection('users').where('role', '!=', null).get();

  users.forEach(doc => {
    const oldRole = doc.data().role;

    // Mapper role → userType
    const userType = mapRoleToUserType(oldRole);

    // Définir permissions par défaut
    const permissions = getDefaultPermissions(userType);

    // Mettre à jour le document
    doc.ref.update({
      userType,
      permissions,
      // "role" sera supprimé manuellement ou dans une 2ème passe
    });
  });
});

function mapRoleToUserType(oldRole: string): string {
  const mapping = {
    'organization': 'creator',
    'investor': 'contributor',
    'auditor': 'auditor',
    'admin': 'admin'
  };
  return mapping[oldRole] || 'contributor';
}

function getDefaultPermissions(userType: string): string[] {
  switch (userType) {
    case 'creator':
      return ['CREATE_PROJECT', 'EDIT_PROJECT', 'CONTRIBUTE', 'COMMENT'];
    case 'contributor':
      return ['CONTRIBUTE', 'COMMENT'];
    case 'auditor':
      return ['AUDIT', 'COMMENT'];
    case 'admin':
      return ['CREATE_PROJECT', 'CONTRIBUTE', 'AUDIT', 'MODERATE', 'COMMENT'];
    default:
      return ['COMMENT'];
  }
}
```

---

## 🎨 IMPACT SUR LE FRONTEND

### Ce Qui Doit Changer dans le Code Flutter

**AVANT (code actuel problématique)**:
```dart
// ❌ ANCIEN CODE
if (user.role == 'organization') {
  // Afficher bouton "Create Project"
}
```

**APRÈS (code corrigé)**:
```dart
// ✅ NOUVEAU CODE
if (user.userType == 'creator' &&
    user.permissions.contains('CREATE_PROJECT')) {
  // Afficher bouton "Create Project"
}
```

### Modèle Dart à Mettre à Jour

**Fichier**: `lib/models/user_model.dart`

```dart
class UserModel {
  final String uid;
  final String email;

  // ❌ ANCIEN CHAMP (à supprimer si présent)
  // final String? role;

  // ✅ NOUVEAUX CHAMPS (à ajouter)
  final String userType;        // 'contributor', 'creator', 'auditor', 'admin'
  final List<String> permissions;  // ['CREATE_PROJECT', 'CONTRIBUTE', etc.]

  final bool profileComplete;
  final String accountStatus;

  // ... autres champs

  UserModel({
    required this.uid,
    required this.email,
    required this.userType,
    this.permissions = const [],
    this.profileComplete = false,
    required this.accountStatus,
    // ...
  });

  // Méthodes utilitaires
  bool get canCreateProjects =>
      userType == 'creator' && permissions.contains('CREATE_PROJECT');

  bool get canContribute =>
      permissions.contains('CONTRIBUTE');

  bool get isAdmin =>
      userType == 'admin';

  factory UserModel.fromFirestore(Map<String, dynamic> data) {
    return UserModel(
      uid: data['uid'] as String,
      email: data['email'] as String,
      userType: data['userType'] as String? ?? 'contributor',
      permissions: (data['permissions'] as List<dynamic>?)
                      ?.map((e) => e.toString())
                      .toList() ?? [],
      profileComplete: data['profileComplete'] as bool? ?? false,
      accountStatus: data['accountStatus'] as String? ?? 'pending',
      // ...
    );
  }
}
```

---

## 🔐 AVANTAGES DU NOUVEAU SYSTÈME

### 1. Sécurité Renforcée

**Principe du moindre privilège**:
```json
// Utilisateur obtient SEULEMENT les permissions dont il a besoin
{
  "userType": "contributor",
  "permissions": ["CONTRIBUTE", "COMMENT"]  // Pas de "CREATE_PROJECT"
}
```

### 2. Flexibilité

**Promotions temporaires**:
```json
// Contributeur promu temporairement pour créer UN projet
{
  "userType": "contributor",
  "permissions": [
    "CONTRIBUTE",
    "COMMENT",
    "CREATE_PROJECT"  // Permission additionnelle temporaire
  ]
}
```

### 3. Audit et Traçabilité

**Logs détaillés**:
```typescript
logger.info('User action', {
  userId: user.uid,
  userType: user.userType,
  permissions: user.permissions,
  action: 'CREATE_PROJECT',
  allowed: user.permissions.includes('CREATE_PROJECT')
});
```

### 4. Évolutivité

**Ajout de nouvelles permissions facile**:
```typescript
// Nouvelle fonctionnalité: Export de données
export const USER_PERMISSIONS = {
  // ... permissions existantes
  EXPORT_DATA: 'EXPORT_DATA',  // ← Nouvelle permission
};

// Assigner à certains utilisateurs sans changer leur userType
user.permissions.push('EXPORT_DATA');
```

---

## 📋 RÉSUMÉ POUR VOTRE CAS SPÉCIFIQUE

### Votre Utilisateur Actuel

```json
// AVANT (état actuel dans Firestore)
{
  "uid": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "email": "ericvekout2022@gmail.com",
  "firstName": "Eric",
  "lastName": "Vekout",
  "role": "investor"  // ← Ancien système
}
```

### Ce Qu'il Faut Mettre

```json
// APRÈS (état requis pour le backend)
{
  "uid": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "email": "ericvekout2022@gmail.com",
  "firstName": "Eric",
  "lastName": "Vekout",
  "displayName": "Eric Vekout",

  // ✅ NOUVEAU SYSTÈME
  "userType": "creator",  // Remplace "organization" ou "investor"
  "permissions": [
    "CREATE_PROJECT",     // Peut créer des projets
    "EDIT_PROJECT",       // Peut éditer ses projets
    "CONTRIBUTE",         // Peut aussi contribuer aux projets des autres
    "COMMENT"             // Peut commenter
  ],

  "accountStatus": "active",
  "profileComplete": true,

  // KYC (optionnel pour dev)
  "kyc": {
    "status": "approved",
    "level": 2
  }
}
```

### Pourquoi Ce Changement Pour Vous ?

**Avant**:
- Vous aviez `role: "investor"` → Ne pouvait PAS créer de projets
- Le frontend cherchait `role == "organization"` → Bouton invisible

**Après**:
- Vous aurez `userType: "creator"` → Peut créer des projets ✅
- Vous aurez `permissions: ["CREATE_PROJECT"]` → Autorisé explicitement ✅
- Le backend vérifie `userType == "creator"` → Règles Firestore passent ✅
- Le frontend vérifie `userType == "creator" && permissions.includes('CREATE_PROJECT')` → Bouton visible ✅

---

## ❓ FAQ

### Q1: Pourquoi ne pas garder "role" ET "userType" ?

**R**: Cela créerait de la confusion et des bugs difficiles à tracer. Le code ne saurait pas quel champ utiliser. Le principe **"Single Source of Truth"** (une seule source de vérité) est crucial en développement.

### Q2: Est-ce que je peux avoir plusieurs "userType" ?

**R**: Non, `userType` est un champ unique qui définit le rôle PRINCIPAL. Mais vous pouvez avoir PLUSIEURS permissions dans le tableau `permissions` pour des fonctionnalités additionnelles.

### Q3: Comment ajouter une nouvelle permission à un utilisateur ?

**R**:
```javascript
// Dans Firebase Console
permissions: ["CREATE_PROJECT", "CONTRIBUTE", "NOUVELLE_PERMISSION"]

// OU via Cloud Function
await admin.firestore().collection('users').doc(userId).update({
  permissions: admin.firestore.FieldValue.arrayUnion('NOUVELLE_PERMISSION')
});
```

### Q4: Que se passe-t-il si je laisse "role" et j'ajoute "userType" ?

**R**:
- Le backend ignorera complètement "role"
- L'ancien champ "role" occupera de l'espace inutile dans Firestore
- Risque de confusion pour les développeurs futurs
- **Recommandation**: Supprimez "role" pour éviter ces problèmes

### Q5: Comment gérer les utilisateurs avec des rôles multiples (ex: créateur ET auditeur) ?

**R**:
```json
{
  "userType": "creator",  // Rôle principal
  "permissions": [
    "CREATE_PROJECT",
    "EDIT_PROJECT",
    "CONTRIBUTE",
    "AUDIT",            // Permission d'auditeur ajoutée
    "COMMENT"
  ]
}
```

---

## 🎯 ACTION IMMÉDIATE POUR VOTRE PROJET

**Pour débloquer la création de projets**, suivez ces étapes:

1. ✅ Ouvrir Firebase Console Firestore
2. ✅ Aller au document `users/5GqHzQJ4wrRawS6z2GY1opoSb543`
3. ❌ **Supprimer** le champ `role`
4. ✅ **Ajouter** le champ `userType` = `"creator"`
5. ✅ **Ajouter** le champ `permissions` = `["CREATE_PROJECT", "CONTRIBUTE", "COMMENT"]`
6. ✅ **Ajouter** le champ `accountStatus` = `"active"`
7. ✅ **Ajouter** le champ `profileComplete` = `true`
8. ✅ **Ajouter** le champ `displayName` = `"Eric Vekout"`

**Résultat**: Vous pourrez créer des projets immédiatement! ✅

---

**Document créé le**: 2025-12-17
**Auteur**: Claude Code
**Version**: 1.0
