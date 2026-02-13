# 🔴 PROBLÈME BACKEND CRITIQUE - Permissions Firestore Projects
**Date:** 11 janvier 2026  
**Agent:** Frontend AI  
**Destinataire:** Backend AI Agent  
**Priorité:** CRITIQUE

---

## 📋 RÉSUMÉ EXÉCUTIF

Lorsqu'un utilisateur se connecte en mode **Investor** (userType: 'contributor') et tente de consulter la liste des projets disponibles dans la page "Browse Projects", une erreur **PERMISSION_DENIED** est levée par Firestore, empêchant l'affichage complet des projets.

---

## 🔍 DESCRIPTION DÉTAILLÉE DU PROBLÈME

### Contexte
- **Utilisateur:** Connecté avec le rôle `contributor` (Investor)
- **Scénario:** Navigation vers `/browse` (Browse Projects Screen)
- **Action:** Chargement automatique de la liste des projets via query Firestore
- **Résultat:** Échec avec erreur `PERMISSION_DENIED`

### Logs d'erreur
```
W/Firestore( 9806): (25.1.4) [Firestore]: Listen for Query(target=Query(projects order by -createdAt, -__name__);limitType=LIMIT_TO_FIRST) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions., cause=null}

I/flutter ( 9806): ❌ AvailableProjects: Error loading projects: [cloud_firestore/permission-denied] The caller does not have permission to execute the specified operation.

I/flutter ( 9806): Stack trace: #0      EventChannelExtension.receiveGuardedBroadcastStream (package:_flutterfire_internals/src/exception.dart:67:43)
```

### Query Firestore problématique
```dart
// Dans le provider frontend
FirebaseFirestore.instance
  .collection('projects')
  .orderBy('createdAt', descending: true)
  .snapshots()
```

---

## 🐛 CAUSE RACINE IDENTIFIÉE

### Règles Firestore actuelles (`firestore.rules` lignes 143-151)

```javascript
match /projects/{projectId} {
  // Lecture :
  // - Public si statut validé (fundingActive, approved, implementation, fundingComplete)
  // - Créateur peut voir tous ses projets (incluant draft, submitted, underReview)
  // - Admin peut voir tous les projets
  allow read: if resource.data.status in ['fundingActive', 'approved', 'implementation', 'fundingComplete', 'completed'] ||
                 isOwner(resource.data.creator.uid) ||
                 (resource.data.keys().hasAny(['creatorId']) && isOwner(resource.data.creatorId)) ||
                 isAdmin();
  // ...
}
```

### Problème identifié

La règle `allow read` **accède à `resource.data.status`** pour vérifier si le document peut être lu. Cependant, lors d'une **query avec `.orderBy('createdAt')`**, Firestore évalue les permissions **AVANT** d'avoir accès au document complet. 

**Conséquence :** La condition `resource.data.status in [...]` est évaluée comme **FALSE** pour TOUS les documents lors d'une query, car `resource` est `null` dans le contexte d'une query de collection complète.

**Référence Firebase Documentation:**
> "When using queries, the `resource` variable is not available until after the query has been executed. This means conditions relying on `resource.data` will always fail for collection-wide queries."

---

## ✅ SOLUTIONS PROPOSÉES

### **Solution 1 : Autoriser la lecture de tous les projets pour les utilisateurs authentifiés (RECOMMANDÉE)**

Modifier les règles pour permettre à tous les utilisateurs authentifiés de lire les projets avec statuts publics, en utilisant une approche basée sur un champ booléen `isPublic` ou en restructurant la logique.

#### Modifications à apporter dans `firestore.rules`

**AVANT (lignes 143-151):**
```javascript
match /projects/{projectId} {
  allow read: if resource.data.status in ['fundingActive', 'approved', 'implementation', 'fundingComplete', 'completed'] ||
                 isOwner(resource.data.creator.uid) ||
                 (resource.data.keys().hasAny(['creatorId']) && isOwner(resource.data.creatorId)) ||
                 isAdmin();
```

**APRÈS (Solution recommandée):**
```javascript
match /projects/{projectId} {
  // Lecture collection-wide : Tous les utilisateurs authentifiés peuvent lire
  // La visibilité est gérée côté frontend en filtrant par statut
  allow list: if isAuthenticated();
  
  // Lecture document spécifique : Avec validation du statut
  allow get: if resource.data.status in ['fundingActive', 'approved', 'implementation', 'fundingComplete', 'completed'] ||
                isOwner(resource.data.creator.uid) ||
                (resource.data.keys().hasAny(['creatorId']) && isOwner(resource.data.creatorId)) ||
                isAdmin();
```

**Explication:**
- `allow list` : Autorise les queries de collection pour tous les utilisateurs authentifiés
- `allow get` : Maintient les restrictions pour l'accès à un document spécifique
- Le frontend filtre les projets par statut après réception des données

---

### **Solution 2 : Ajouter un champ `isPublic` dans les projets (Alternative)**

Si vous souhaitez une sécurité plus stricte au niveau des règles Firestore, ajoutez un champ `isPublic: boolean` dans chaque document projet.

#### A. Modification de la structure des documents `projects`

**Ajout du champ `isPublic` lors de la création/mise à jour:**
```typescript
// Dans Cloud Functions - Lors de la création de projet
const projectData = {
  // ... autres champs ...
  isPublic: false, // Par défaut privé
  status: 'draft',
  // ...
};

// Lors du changement de statut vers fundingActive/approved
if (newStatus === 'fundingActive' || newStatus === 'approved') {
  await projectRef.update({
    isPublic: true,
    status: newStatus,
  });
}
```

#### B. Modification des règles Firestore

```javascript
match /projects/{projectId} {
  // Lecture : Basée sur le champ isPublic (utilisable dans les queries)
  allow read: if resource.data.isPublic == true ||
                 isOwner(resource.data.creator.uid) ||
                 (resource.data.keys().hasAny(['creatorId']) && isOwner(resource.data.creatorId)) ||
                 isAdmin();
```

**Avantages:**
- Sécurité au niveau Firestore (les projets privés ne sont jamais transmis au frontend)
- Fonctionne avec les queries de collection

**Inconvénients:**
- Nécessite une migration de données pour ajouter `isPublic` à tous les projets existants
- Logique de synchronisation entre `status` et `isPublic`

---

### **Solution 3 : Utiliser une collection séparée pour les projets publics (Non recommandée)**

Créer deux collections:
- `projects` : Tous les projets (accès restreint aux créateurs/admins)
- `projects_public` : Copie des projets publics (accès en lecture pour tous)

**Non recommandée car:**
- Complexité accrue
- Duplication de données
- Risques de désynchronisation

---

## 🔧 INSTRUCTIONS D'IMPLÉMENTATION

### Étape 1 : Déployer la nouvelle règle Firestore

**Fichier:** `firestore.rules` (lignes 143-151)

**Modification:**
```javascript
match /projects/{projectId} {
  // ✅ SOLUTION 1 - Lecture collection-wide autorisée
  allow list: if isAuthenticated();
  
  // ✅ Lecture document spécifique - Avec validation statut
  allow get: if resource.data.status in ['fundingActive', 'approved', 'implementation', 'fundingComplete', 'completed'] ||
                isOwner(resource.data.creator.uid) ||
                (resource.data.keys().hasAny(['creatorId']) && isOwner(resource.data.creatorId)) ||
                isAdmin();

  // Création, Update, Delete : Inchangées
  allow create: if isCreator() &&
                   isAccountActive() &&
                   validateProjectCreate(request.resource.data);

  allow update: if (isOwner(resource.data.creator.uid) || isAdmin()) &&
                   validateProjectUpdate(resource.data, request.resource.data);

  allow delete: if isAdmin();

  // ... (fonctions de validation inchangées)
}
```

### Étape 2 : Tester les règles

```bash
# Déployer les nouvelles règles
firebase deploy --only firestore:rules

# Tester avec un utilisateur 'contributor'
# Vérifier que la query fonctionne:
# - Se connecter en mode Investor
# - Naviguer vers /browse
# - Vérifier le chargement des projets
```

### Étape 3 : Validation frontend (optionnel)

Si nécessaire, ajouter un filtre supplémentaire côté frontend pour garantir que seuls les projets avec statuts publics sont affichés:

```dart
// Dans investment_providers.dart ou le provider concerné
final projects = await FirebaseFirestore.instance
  .collection('projects')
  .orderBy('createdAt', descending: true)
  .get();

// Filtrer les projets publics
final publicProjects = projects.docs
  .map((doc) => Project.fromFirestore(doc))
  .where((project) => [
    ProjectStatus.fundingActive,
    ProjectStatus.approved,
    ProjectStatus.implementation,
    ProjectStatus.fundingComplete,
    ProjectStatus.completed,
  ].contains(project.status))
  .toList();

return publicProjects;
```

---

## 🧪 TESTS DE VALIDATION

### Test 1 : Utilisateur Investor
1. Se connecter avec un compte `userType: 'contributor'`
2. Naviguer vers `/browse`
3. **Résultat attendu:** Liste des projets publics affichée sans erreur PERMISSION_DENIED

### Test 2 : Utilisateur Creator
1. Se connecter avec un compte `userType: 'creator'`
2. Naviguer vers `/projects` (My Projects)
3. **Résultat attendu:** Voir TOUS ses projets (draft, submitted, etc.)

### Test 3 : Utilisateur Admin
1. Se connecter avec un compte `userType: 'admin'`
2. Naviguer vers `/admin/projects`
3. **Résultat attendu:** Voir TOUS les projets de tous les utilisateurs

### Test 4 : Lecture document spécifique
1. En tant qu'Investor, tenter d'accéder à `/browse/projects/{projectId}` d'un projet draft
2. **Résultat attendu:** Erreur PERMISSION_DENIED (règle `allow get` bloque l'accès)

---

## 📊 IMPACT ET RISQUES

### Impact de la Solution 1
- **Sécurité:** Moyenne - Les projets privés peuvent être récupérés par les utilisateurs authentifiés, mais le frontend les filtre
- **Performance:** Bonne - Pas de changement significatif
- **Complexité:** Faible - Modification minimale des règles

### Risques
- **Risque faible:** Un utilisateur malveillant pourrait théoriquement voir les données de projets en draft via des outils d'inspection réseau
- **Mitigation:** 
  - Le filtrage frontend empêche l'affichage
  - Les données sensibles (paiements, audits) sont dans des sous-collections protégées
  - Pour une sécurité maximale, utiliser la Solution 2 (champ `isPublic`)

---

## 🔗 RÉFÉRENCES

- **Fichiers concernés:**
  - `firestore.rules` (lignes 143-151)
  - `lib/features/investments/presentation/providers/investment_providers.dart`
  - `lib/features/investments/presentation/screens/browse_projects_screen.dart`

- **Documentation Firebase:**
  - [Firestore Security Rules - Queries](https://firebase.google.com/docs/firestore/security/rules-query)
  - [Understanding resource vs request](https://firebase.google.com/docs/firestore/security/rules-conditions#access_other_documents)

- **Logs complets:** Voir message utilisateur du 11 janvier 2026

---

## ✅ CHECKLIST DE VALIDATION

Avant de clore ce ticket:

- [ ] Règles Firestore modifiées et déployées
- [ ] Tests avec compte Investor réussis (Browse Projects fonctionne)
- [ ] Tests avec compte Creator réussis (My Projects affiche tous les projets)
- [ ] Tests avec compte Admin réussis (accès complet)
- [ ] Test de sécurité : Accès direct à un projet draft bloqué pour Investor
- [ ] Documentation mise à jour si nécessaire
- [ ] Frontend vérifie et filtre les statuts publics (optionnel mais recommandé)

---

## 📝 NOTES SUPPLÉMENTAIRES

### Alternative pour Production (Recommandation Sécurité)

Si vous souhaitez maximiser la sécurité en production, envisagez d'implémenter la **Solution 2** avec le champ `isPublic`. Cela garantit qu'aucune donnée de projet privé n'est transmise au client, même si un utilisateur malveillant inspecte le réseau.

### Migration de Données (Si Solution 2 choisie)

Script de migration à exécuter dans Cloud Functions ou via script Node.js:

```typescript
// scripts/add_isPublic_to_projects.ts
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

async function addIsPublicField() {
  const projectsSnapshot = await db.collection('projects').get();
  
  const batch = db.batch();
  let count = 0;
  
  projectsSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const isPublic = ['fundingActive', 'approved', 'implementation', 'fundingComplete', 'completed'].includes(data.status);
    
    batch.update(doc.ref, { isPublic });
    count++;
    
    if (count === 500) {
      // Firestore batch limit
      console.log('Committing batch of 500...');
      await batch.commit();
      count = 0;
    }
  });
  
  if (count > 0) {
    await batch.commit();
  }
  
  console.log('✅ Migration completed successfully');
}

addIsPublicField().catch(console.error);
```

---

**Fin du rapport**  
*Agent Frontend AI - 11 janvier 2026*
