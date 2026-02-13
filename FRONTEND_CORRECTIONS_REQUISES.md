# 🎯 CORRECTIONS FRONTEND REQUISES

**Date de création**: 2025-12-16
**Statut**: CRITIQUE - Actions requises pour débloquer la création de projets

---

## 📋 RÉSUMÉ EXÉCUTIF

Trois problèmes critiques ont été identifiés qui nécessitent des corrections côté frontend pour permettre la création de projets:

1. **Incohérence de rôle** entre frontend ("organization") et backend ("creator")
2. **Validation KYC manquante** dans l'UI utilisateur
3. **Champs utilisateur manquants** (accountStatus, permissions, kyc)

---

## 🔴 PROBLÈME 1: Incohérence de Rôle (CRITIQUE)

### Description du problème

Le frontend affiche le bouton "Create Project" uniquement pour les utilisateurs avec le rôle **"organization"**, mais le backend vérifie le rôle **"creator"**.

**Localisation probable du code frontend**:
```dart
// Quelque part dans le Dashboard ou le FloatingActionButton
if (userRole == 'organization') {
  // Afficher le bouton Create Project
}
```

**Backend attendu** (Firestore Rules ligne 137 + createProject.ts ligne 127):
- `userType == 'creator'`
- `permissions.includes(USER_PERMISSIONS.CREATE_PROJECT)`

### Impact

✅ **APRÈS modification du rôle dans Firebase Console** (`organization` → `creator`):
- L'utilisateur pourra voir le bouton
- Mais la création échouera toujours à cause des problèmes 2 et 3

❌ **SANS modification**:
- Le bouton ne s'affiche pas
- Impossible de créer des projets même si tous les autres critères sont remplis

### ✅ SOLUTION FRONTEND REQUISE

**Fichier à modifier**: Probablement `/lib/features/dashboard/presentation/pages/dashboard_page.dart` ou similaire

**Changement 1 - Vérification du rôle**:

```dart
// ❌ AVANT (CODE ACTUEL PROBLÉMATIQUE)
final canCreateProject = user.role == 'organization';

// ✅ APRÈS (CODE CORRIGÉ)
final canCreateProject = user.userType == 'creator' &&
                         user.permissions?.contains('CREATE_PROJECT') == true;
```

**Changement 2 - Ajout de validation KYC dans l'UI**:

```dart
// Vérifier aussi le statut KYC avant d'afficher le bouton
final canCreateProject = user.userType == 'creator' &&
                         user.permissions?.contains('CREATE_PROJECT') == true &&
                         user.kyc?.status == 'approved' &&
                         user.accountStatus == 'active';

// Si KYC non approuvé, afficher un message explicatif
if (user.userType == 'creator' && user.kyc?.status != 'approved') {
  return ElevatedButton(
    onPressed: () => _showKYCRequiredDialog(),
    child: Text('Complete KYC to Create Projects'),
  );
}
```

**Changement 3 - Gestion gracieuse des erreurs**:

```dart
Future<void> _handleCreateProject() async {
  try {
    // Appeler la Cloud Function createProject
    final result = await _projectService.createProject(projectData);

    // Succès
    Navigator.pushNamed(context, '/projects/${result.projectId}');

  } on FirebaseException catch (e) {
    // Gérer les erreurs spécifiques
    String errorMessage;

    switch (e.code) {
      case 'failed-precondition':
        if (e.message?.contains('KYC') == true) {
          errorMessage = 'You must complete KYC verification (Level 2) before creating projects.\n\n'
                        'Go to Settings → Verification to start the process.';
          _showKYCDialog();
        } else if (e.message?.contains('Profile') == true) {
          errorMessage = 'Please complete your profile first.';
        } else if (e.message?.contains('active') == true) {
          errorMessage = 'Your account is not active. Please contact support.';
        } else {
          errorMessage = e.message ?? 'Prerequisites not met';
        }
        break;

      case 'permission-denied':
        errorMessage = 'You do not have permission to create projects.\n\n'
                      'Please ensure you have a Creator account.';
        break;

      case 'resource-exhausted':
        errorMessage = 'You have reached the maximum number of active projects.\n\n'
                      'Complete or cancel existing projects first.';
        break;

      default:
        errorMessage = 'Failed to create project: ${e.message}';
    }

    // Afficher l'erreur à l'utilisateur
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(errorMessage),
        duration: Duration(seconds: 5),
        action: e.code == 'failed-precondition' && e.message?.contains('KYC') == true
          ? SnackBarAction(
              label: 'Start KYC',
              onPressed: () => Navigator.pushNamed(context, '/settings/verification'),
            )
          : null,
      ),
    );
  }
}

void _showKYCDialog() {
  showDialog(
    context: context,
    builder: (context) => AlertDialog(
      title: Text('KYC Verification Required'),
      content: Text(
        'To create projects and receive funding, you must complete identity verification (KYC Level 2).\n\n'
        'This process typically takes 5-10 minutes and includes:\n'
        '• Identity document upload\n'
        '• Selfie verification\n'
        '• Address verification\n\n'
        'Your information is securely encrypted and handled by our certified partner.'
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('Later'),
        ),
        ElevatedButton(
          onPressed: () {
            Navigator.pop(context);
            Navigator.pushNamed(context, '/settings/verification');
          },
          child: Text('Start Verification'),
        ),
      ],
    ),
  );
}
```

---

## 🟡 PROBLÈME 2: Modèle de Données Utilisateur Incomplet

### Description du problème

Le modèle de données utilisateur dans le frontend ne contient probablement pas tous les champs nécessaires pour les validations backend.

**Champs requis par le backend** (`createProject.ts` + `firestore.rules`):
- `userType` (string): 'contributor', 'creator', 'auditor', 'admin'
- `accountStatus` (string): 'active', 'suspended', 'pending'
- `permissions` (array): ['CREATE_PROJECT', 'CONTRIBUTE', etc.]
- `kyc.status` (string): 'pending', 'approved', 'rejected'
- `kyc.level` (number): 1, 2, 3
- `profileComplete` (boolean)

### ✅ SOLUTION FRONTEND REQUISE

**Fichier à créer/modifier**: `/lib/models/user_model.dart` ou équivalent

```dart
class UserModel {
  final String uid;
  final String email;
  final String firstName;
  final String lastName;
  final String displayName;

  // Champs critiques à ajouter
  final String userType;        // ← NOUVEAU
  final String accountStatus;   // ← NOUVEAU
  final List<String> permissions; // ← NOUVEAU
  final KYCInfo? kyc;           // ← NOUVEAU
  final bool profileComplete;   // ← NOUVEAU

  final String? profilePicture;
  final String? bio;
  final String? phoneNumber;

  final DateTime createdAt;
  final DateTime updatedAt;

  UserModel({
    required this.uid,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.displayName,
    required this.userType,
    required this.accountStatus,
    this.permissions = const [],
    this.kyc,
    this.profileComplete = false,
    this.profilePicture,
    this.bio,
    this.phoneNumber,
    required this.createdAt,
    required this.updatedAt,
  });

  factory UserModel.fromFirestore(Map<String, dynamic> data) {
    return UserModel(
      uid: data['uid'] as String,
      email: data['email'] as String,
      firstName: data['firstName'] as String,
      lastName: data['lastName'] as String,
      displayName: data['displayName'] as String? ??
                   '${data['firstName']} ${data['lastName']}',

      // Nouveaux champs avec valeurs par défaut sécurisées
      userType: data['userType'] as String? ?? 'contributor',
      accountStatus: data['accountStatus'] as String? ?? 'pending',
      permissions: (data['permissions'] as List<dynamic>?)
                      ?.map((e) => e.toString())
                      .toList() ?? [],
      kyc: data['kyc'] != null
          ? KYCInfo.fromMap(data['kyc'] as Map<String, dynamic>)
          : null,
      profileComplete: data['profileComplete'] as bool? ?? false,

      profilePicture: data['profilePicture'] as String?,
      bio: data['bio'] as String?,
      phoneNumber: data['phoneNumber'] as String?,

      createdAt: (data['createdAt'] as Timestamp).toDate(),
      updatedAt: (data['updatedAt'] as Timestamp).toDate(),
    );
  }

  // Méthodes utilitaires
  bool get canCreateProjects =>
      userType == 'creator' &&
      permissions.contains('CREATE_PROJECT') &&
      accountStatus == 'active';

  bool get hasApprovedKYC =>
      kyc?.status == 'approved';

  bool get canCreateProjectsWithKYC =>
      canCreateProjects && hasApprovedKYC;
}

class KYCInfo {
  final String status;  // 'pending', 'approved', 'rejected', 'in_review'
  final int level;      // 1, 2, 3
  final DateTime? completedAt;
  final DateTime? expiresAt;
  final String? provider; // 'sumsub'
  final String? applicantId;

  KYCInfo({
    required this.status,
    required this.level,
    this.completedAt,
    this.expiresAt,
    this.provider,
    this.applicantId,
  });

  factory KYCInfo.fromMap(Map<String, dynamic> data) {
    return KYCInfo(
      status: data['status'] as String,
      level: data['level'] as int? ?? 0,
      completedAt: data['completedAt'] != null
          ? (data['completedAt'] as Timestamp).toDate()
          : null,
      expiresAt: data['expiresAt'] != null
          ? (data['expiresAt'] as Timestamp).toDate()
          : null,
      provider: data['provider'] as String?,
      applicantId: data['applicantId'] as String?,
    );
  }
}
```

---

## 🟡 PROBLÈME 3: Configuration Firebase Console Manquante

### Description du problème

Le document utilisateur dans Firestore Production ne contient pas les champs requis pour créer des projets.

**Document utilisateur actuel** (Firestore):
```json
{
  "email": "ericvekout2022@gmail.com",
  "firstName": "Eric",
  "lastName": "Vekout",
  "role": "investor",  // ← Devrait être "userType": "creator"
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

**Document utilisateur requis**:
```json
{
  "uid": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "email": "ericvekout2022@gmail.com",
  "firstName": "Eric",
  "lastName": "Vekout",
  "displayName": "Eric Vekout",
  "userType": "creator",  // ← CHANGEMENT
  "accountStatus": "active",  // ← AJOUT
  "permissions": ["CREATE_PROJECT", "CONTRIBUTE"],  // ← AJOUT
  "kyc": {  // ← AJOUT (pour production)
    "status": "approved",
    "level": 2,
    "completedAt": Timestamp,
    "provider": "sumsub"
  },
  "profileComplete": true,  // ← AJOUT
  "profilePicture": null,
  "bio": null,
  "phoneNumber": null,
  "createdAt": Timestamp,
  "updatedAt": Timestamp
}
```

### ✅ SOLUTION: Modification Manuelle dans Firebase Console

**Étapes à suivre** (À FAIRE PAR L'UTILISATEUR):

1. **Accéder à Firebase Console**
   - URL: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore

2. **Localiser le document**
   - Collection: `users`
   - Document: `5GqHzQJ4wrRawS6z2GY1opoSb543`

3. **Modifier les champs**:
   - ❌ **Supprimer** le champ: `role`
   - ✅ **Ajouter** le champ: `userType` (string) = `"creator"`
   - ✅ **Ajouter** le champ: `accountStatus` (string) = `"active"`
   - ✅ **Ajouter** le champ: `permissions` (array) avec un élément (string): `"CREATE_PROJECT"`
   - ✅ **Ajouter** le champ: `profileComplete` (boolean) = `true`
   - ✅ **Ajouter** le champ: `displayName` (string) = `"Eric Vekout"`

4. **Pour activer KYC (Optionnel pour dev, requis en prod)**:
   - ✅ **Ajouter** le champ: `kyc` (map) avec:
     - `status` (string): `"approved"`
     - `level` (number): `2`
     - `completedAt` (timestamp): [Timestamp actuel]

5. **Sauvegarder** et vérifier que les modifications sont enregistrées

### ✅ SOLUTION FRONTEND ALTERNATIVE: Cloud Function de Migration

**Créer une Cloud Function temporaire** pour migrer automatiquement les anciens utilisateurs:

```typescript
// backend/functions/src/migrations/migrateUserRoles.ts

import { https } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export const migrateUserRoles = https.onCall(async (data, context) => {
  // Authentification admin requise
  if (!context.auth?.token?.admin) {
    throw new https.HttpsError('permission-denied', 'Admin access required');
  }

  const db = getFirestore();
  const usersRef = db.collection('users');

  // Récupérer tous les utilisateurs avec l'ancien champ "role"
  const snapshot = await usersRef.where('role', '!=', null).get();

  const batch = db.batch();
  let migratedCount = 0;

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const oldRole = data.role;

    // Mapper ancien rôle → nouveau userType
    const userType = mapRoleToUserType(oldRole);

    // Déterminer les permissions
    const permissions = determinePermissions(userType);

    // Mise à jour du document
    batch.update(doc.ref, {
      userType,
      permissions,
      accountStatus: data.accountStatus || 'active',
      profileComplete: data.profileComplete || false,
      displayName: data.displayName || `${data.firstName} ${data.lastName}`,
      // Supprimer l'ancien champ "role" (Firebase ne permet pas de delete dans batch)
      // Il faudra le faire manuellement ou via une deuxième passe
    });

    migratedCount++;
  });

  await batch.commit();

  logger.info(`Migrated ${migratedCount} users`);

  return {
    success: true,
    migratedCount,
    message: `Successfully migrated ${migratedCount} users`
  };
});

function mapRoleToUserType(oldRole: string): string {
  const mapping: Record<string, string> = {
    'organization': 'creator',
    'investor': 'contributor',
    'auditor': 'auditor',
    'admin': 'admin'
  };

  return mapping[oldRole] || 'contributor';
}

function determinePermissions(userType: string): string[] {
  switch (userType) {
    case 'creator':
      return ['CREATE_PROJECT', 'CONTRIBUTE', 'COMMENT'];
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

**Appel depuis le frontend Flutter**:

```dart
// À exécuter une seule fois depuis un compte admin
Future<void> migrateUserRoles() async {
  try {
    final callable = FirebaseFunctions.instance.httpsCallable('migrateUserRoles');
    final result = await callable.call();

    print('Migration success: ${result.data['message']}');
  } catch (e) {
    print('Migration failed: $e');
  }
}
```

---

## 🔧 PROBLÈME 4: Déploiement des Règles Firestore Modifiées

### Description

Les règles Firestore ont été modifiées pour permettre la création de projets sans KYC en développement. Ces règles doivent être déployées.

### ✅ SOLUTION: Déploiement (À FAIRE PAR L'UTILISATEUR)

**Commande à exécuter**:

```bash
# Depuis le répertoire racine du projet
firebase deploy --only firestore:rules

# Vérifier que les règles sont bien déployées
firebase firestore:rules:get
```

**⚠️ IMPORTANT**: Les règles modifiées sont pour le **développement uniquement**. Avant le déploiement en production, réactiver la vérification KYC:

```javascript
// firestore.rules ligne 137-140
allow create: if isCreator() &&
                 isKYCApproved() &&  // ← RÉACTIVER CETTE LIGNE EN PRODUCTION
                 isAccountActive() &&
                 validateProjectCreate(request.resource.data);
```

---

## 📊 RÉSUMÉ DES ACTIONS FRONTEND

| # | Action | Fichier(s) à modifier | Priorité | Complexité |
|---|--------|----------------------|----------|-----------|
| 1 | Changer vérification rôle `organization` → `creator` + permissions | `dashboard_page.dart`, `user_provider.dart` | 🔴 CRITIQUE | Faible |
| 2 | Ajouter champs au modèle User (userType, accountStatus, permissions, kyc) | `user_model.dart` | 🔴 CRITIQUE | Moyenne |
| 3 | Implémenter gestion d'erreurs KYC avec dialog explicatif | `create_project_screen.dart` | 🟡 HAUTE | Moyenne |
| 4 | Ajouter méthodes utilitaires `canCreateProjects`, `hasApprovedKYC` | `user_model.dart` | 🟡 HAUTE | Faible |
| 5 | Créer écran/widget pour initier le processus KYC | `kyc_verification_screen.dart` | 🟢 MOYENNE | Élevée |
| 6 | Migration manuelle document utilisateur dans Firebase Console | Firebase Console | 🔴 CRITIQUE | Manuelle |
| 7 | (Optionnel) Créer Cloud Function de migration automatique | `migrateUserRoles.ts` | 🟢 BASSE | Élevée |

---

## 🎯 CHECKLIST DE VALIDATION POST-IMPLÉMENTATION

Une fois toutes les corrections appliquées:

### Backend
- [x] Règles Firestore modifiées (KYC commenté pour dev)
- [ ] Règles déployées avec `firebase deploy --only firestore:rules`

### Firebase Console
- [ ] Document utilisateur mis à jour:
  - [ ] `userType = "creator"`
  - [ ] `accountStatus = "active"`
  - [ ] `permissions = ["CREATE_PROJECT"]`
  - [ ] `profileComplete = true`
  - [ ] `displayName` ajouté
  - [ ] (Optionnel) `kyc.status = "approved"` et `kyc.level = 2`

### Frontend
- [ ] Modèle User étendu avec nouveaux champs
- [ ] Vérification de rôle mise à jour (`creator` + permissions)
- [ ] Gestion d'erreurs KYC implémentée
- [ ] Dialog explicatif KYC créé
- [ ] Tests manuels de création de projet réussis

### Tests de Validation
- [ ] Utilisateur avec `userType = "creator"` voit le bouton "Create Project"
- [ ] Clic sur "Create Project" navigue vers `/projects/create`
- [ ] Formulaire de création accessible
- [ ] Soumission du formulaire réussit (avec données valides)
- [ ] Projet créé visible dans Firestore (`projects` collection)
- [ ] Stats utilisateur mises à jour (`stats.projectsCreated` incrémenté)
- [ ] Aucune erreur PERMISSION_DENIED dans les logs

---

**Document créé le**: 2025-12-16
**Dernière mise à jour**: 2025-12-16
**Auteur**: Claude Code (Analyse automatique backend)
