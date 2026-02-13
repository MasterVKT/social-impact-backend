# 🔴 PROBLÈMES RÈGLES FIRESTORE - CRÉATION DE PROJET

## Date: 2025-12-15

---

## PROBLÈME 1: KYC Level 2 Requis ⚠️ BLOQUANT

### Erreur dans les logs:
```
PERMISSION_DENIED: Missing or insufficient permissions
```

### Cause Racine:

**Fichier**: `/firestore.rules` (lignes 106-110)

```javascript
match /projects/{projectId} {
  allow create: if isOrganization()
    && isActiveUser()
    && hasKYCLevel(2)  // ← PROBLÈME ICI! Utilisateur n'a pas KYC Level 2
    && request.resource.data.creatorId == request.auth.uid
    && request.resource.data.status == 'draft';
}
```

**Explication**:
- L'utilisateur a le rôle `organization` ✅
- L'utilisateur est actif ✅
- **MAIS** l'utilisateur N'A PAS complété le KYC Level 2 ❌
- La création de projet est bloquée par les règles Firestore

---

## SOLUTION BACKEND REQUISE

### Option A: Modifier temporairement les règles Firestore (Développement)

Pour permettre la création de projets **SANS KYC** pendant le développement:

**Fichier**: `/firestore.rules` (ligne 108)

**AVANT**:
```javascript
allow create: if isOrganization()
  && isActiveUser()
  && hasKYCLevel(2)  // ← Enlever cette ligne pour dev
  && request.resource.data.creatorId == request.auth.uid
  && request.resource.data.status == 'draft';
```

**APRÈS (pour développement)**:
```javascript
allow create: if isOrganization()
  && isActiveUser()
  // Temporairement désactivé pour développement
  // && hasKYCLevel(2)
  && request.resource.data.creatorId == request.auth.uid
  && request.resource.data.status == 'draft';
```

⚠️ **IMPORTANT**: Cette modification est pour le **développement uniquement**. En production, le KYC Level 2 doit rester obligatoire pour des raisons de conformité réglementaire.

### Option B: Compléter le KYC pour l'utilisateur (Production)

Si vous voulez tester avec les vraies règles de sécurité:

1. **Aller dans Firebase Console**
   - Project: `social-impact-mvp-prod-b6805`
   - Firestore Database

2. **Modifier le document utilisateur**
   - Collection: `users`
   - Document: `5GqHzQJ4wrRawS6z2GY1opoSb543`

3. **Ajouter/Modifier le champ KYC**:
   ```json
   {
     "kyc": {
       "level": 2,
       "status": "approved",
       "completedAt": [Timestamp Now]
     },
     "accountStatus": "active"
   }
   ```

---

## PROBLÈME 2: Erreur Write sur collection `users`

### Erreur dans les logs:
```
Write failed at users/5GqHzQJ4wrRawS6z2GY1opoSb543:
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}
```

### Cause Probable:

Le code de création de projet essaie probablement de mettre à jour le profil utilisateur (ex: incrémenter le nombre de projets créés), mais les règles Firestore ligne 76-77 empêchent la modification de certains champs:

```javascript
allow update: if isOwner(userId)
  && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'accountStatus', 'uid']);
```

**Action requise**: Vérifier le code de création de projet pour voir s'il essaie de modifier le document `users`.

---

## COMMENT DÉPLOYER LES MODIFICATIONS

### Étape 1: Modifier le fichier firestore.rules

```bash
cd "D:\Projets\Social Impact\social_impact_mvp"
# Éditez firestore.rules avec les modifications ci-dessus
```

### Étape 2: Déployer les nouvelles règles

```bash
firebase deploy --only firestore:rules
```

### Étape 3: Vérifier que les règles sont bien déployées

```bash
firebase firestore:rules:get
```

---

## VALIDATION POST-DÉPLOIEMENT

### Checklist:

- [ ] Règles Firestore modifiées (KYC Level 2 commenté ou utilisateur avec KYC Level 2)
- [ ] Règles déployées avec `firebase deploy --only firestore:rules`
- [ ] Application Flutter testée avec création de projet
- [ ] Vérifier qu'aucune erreur `PERMISSION_DENIED` n'apparaît dans les logs
- [ ] Projet créé avec succès dans Firestore

---

## RÈGLES FIRESTORE RECOMMANDÉES POUR DÉVELOPPEMENT

Pour faciliter le développement, voici les règles recommandées:

**Fichier**: `/firestore.rules` (lignes 106-110)

```javascript
// DÉVELOPPEMENT - KYC optionnel
allow create: if isOrganization()
  && isActiveUser()
  // KYC Level 2 désactivé temporairement pour dev
  // En production: réactiver hasKYCLevel(2)
  && request.resource.data.creatorId == request.auth.uid
  && request.resource.data.status == 'draft';

// PRODUCTION - KYC obligatoire (RÉACTIVER EN PRODUCTION)
// allow create: if isOrganization()
//   && isActiveUser()
//   && hasKYCLevel(2)
//   && request.resource.data.creatorId == request.auth.uid
//   && request.resource.data.status == 'draft';
```

---

## AUTRES VÉRIFICATIONS NÉCESSAIRES

### 1. Vérifier l'accountStatus de l'utilisateur

Dans Firebase Console:
- Collection: `users`
- Document: `5GqHzQJ4wrRawS6z2GY1opoSb543`
- Champ: `accountStatus`
- Valeur attendue: `"active"`

Si le champ n'existe pas ou vaut autre chose, la règle `isActiveUser()` échouera.

### 2. Vérifier que le creatorId correspond

Le code de création de projet utilise actuellement:
```dart
const creatorId = 'current_user_id';  // ← PROBLÈME: hardcodé!
```

Cela devrait être:
```dart
final creatorId = ref.read(authStateProvider).maybeWhen(
  authenticated: (user) => user.uid,
  orElse: () => throw Exception('User not authenticated'),
);
```

---

## RÉSUMÉ DES ACTIONS BACKEND

| # | Action | Fichier | Ligne | Priorité |
|---|--------|---------|-------|----------|
| 1 | Commenter `hasKYCLevel(2)` pour dev | `/firestore.rules` | 108 | 🔴 CRITIQUE |
| 2 | Déployer règles Firestore | Terminal | - | 🔴 CRITIQUE |
| 3 | Vérifier `accountStatus = "active"` | Firebase Console | `users/{userId}` | 🟡 HAUTE |
| 4 | Ajouter champ KYC (si Option B) | Firebase Console | `users/{userId}` | 🟡 HAUTE |

---

**Document créé le**: 2025-12-15
**Dernière mise à jour**: 2025-12-15
