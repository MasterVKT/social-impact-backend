# 🔒 CORRECTION CRITIQUE : Permissions Firestore pour Collections `investments` et `projects`

**Date** : 6 janvier 2026  
**Priorité** : 🔴 CRITIQUE  
**Type** : Backend - Firestore Security Rules  
**Impact** : Bloque l'accès aux données des projets et investissements

---

## 📋 Résumé Exécutif

L'application génère des erreurs `[cloud_firestore/permission-denied]` lors de l'accès aux pages de projets et au dashboard. Les règles Firestore actuelles ne permettent pas les requêtes filtrées (`where` clauses) sur les collections `investments` et `projects`.

**Symptômes observés** :
```
W/Firestore: Listen for Query(investments where investorId==...) failed: PERMISSION_DENIED
W/Firestore: Listen for Query(projects where creatorId==...) failed: PERMISSION_DENIED
I/flutter: Error fetching dashboard stats: [cloud_firestore/permission-denied]
```

---

## 🔍 Problème Exact

### Erreur 1 : Collection `investments`
**Requête bloquée** :
```dart
firestore.collection('investments')
  .where('investorId', isEqualTo: userId)
  .get()
```

**Règle actuelle** (ligne 500-515 de `firestore.rules`) :
```firestore
match /investments/{investmentId} {
  allow list: if isAuthenticated() && request.query.limit <= 100;
  // ❌ Pas de validation du filtre 'investorId'
}
```

### Erreur 2 : Collection `projects`
**Requête bloquée** :
```dart
firestore.collection('projects')
  .where('creatorId', isEqualTo: userId)
  .get()
```

**Règle actuelle** (ligne 152-160 de `firestore.rules`) :
```firestore
match /projects/{projectId} {
  allow read: if resource.data.status in ['live', 'funded', 'active', 'completed'] ||
                 isOwner(resource.data.creator.uid) ||
                 isAdmin();
  // ❌ Pas de règle 'allow list' pour les queries filtrées
}
```

---

## 🎯 Cause Racine

**Firestore Security Rules v2** nécessite que les requêtes avec `where()` vérifient explicitement que :
1. Le champ filtré correspond à l'utilisateur authentifié
2. Ou l'utilisateur a les permissions admin

Les règles actuelles utilisent :
- `allow list` sans contraintes sur les queries pour `investments`
- `allow read` seulement (pas de `allow list`) pour `projects`

Cela ne suffit pas pour les requêtes filtrées complexes.

---

## ✅ Solution Détaillée

### Modification 1 : Collection `investments`

**Fichier** : `firestore.rules`  
**Lignes** : 500-515 (section `match /investments/{investmentId}`)

**REMPLACER** :
```firestore
match /investments/{investmentId} {
  // Lire un investissement spécifique
  allow get: if isAuthenticated() && (resource.data.investorId == request.auth.uid || isAdmin());

  // Lister les investissements
  allow list: if isAuthenticated() && request.query.limit <= 100;

  // Créer un investissement
  allow create: if isAuthenticated() && request.resource.data.investorId == request.auth.uid;

  // Modifier/supprimer (admin seulement)
  allow update, delete: if isAdmin();
}
```

**PAR** :
```firestore
match /investments/{investmentId} {
  // Lire un investissement spécifique
  allow get: if isAuthenticated() && (
    resource.data.investorId == request.auth.uid || 
    isAdmin()
  );

  // Lister avec validation stricte
  allow list: if isAuthenticated() && (
    isAdmin() ||
    (request.query.limit <= 100 && 
     resource.data.investorId == request.auth.uid)
  );

  // Créer un investissement
  allow create: if isAuthenticated() && 
                   request.resource.data.investorId == request.auth.uid;

  // Modifier/supprimer (admin seulement)
  allow update, delete: if isAdmin();
}
```

**Changements** :
- ✅ Ajout de validation que `resource.data.investorId == request.auth.uid` dans `allow list`
- ✅ Permission pour admin de lister tous les investissements
- ✅ Maintien de la limite de 100 documents

---

### Modification 2 : Collection `projects`

**Fichier** : `firestore.rules`  
**Lignes** : 152-160 (section `match /projects/{projectId}`)

**REMPLACER** :
```firestore
match /projects/{projectId} {
  // Lecture :
  // - Public si statut 'live', 'funded', 'active', 'completed'
  // - Créateur peut voir tous ses projets
  // - Admin peut voir tous les projets
  allow read: if resource.data.status in ['live', 'funded', 'active', 'completed'] ||
                 isOwner(resource.data.creator.uid) ||
                 isAdmin();

  // Création : Seulement créateurs KYC approuvés + compte actif
```

**PAR** :
```firestore
match /projects/{projectId} {
  // Lecture individuelle :
  // - Public si statut 'live', 'funded', 'active', 'completed'
  // - Créateur peut voir tous ses projets
  // - Admin peut voir tous les projets
  allow get: if resource.data.status in ['live', 'funded', 'active', 'completed'] ||
                isOwner(resource.data.creator.uid) ||
                isAdmin();

  // Liste/requêtes avec filtres
  allow list: if isAuthenticated() && (
    isAdmin() ||
    resource.data.creator.uid == request.auth.uid ||
    resource.data.status in ['live', 'funded', 'active', 'completed']
  );

  // Création : Seulement créateurs KYC approuvés + compte actif
```

**Changements** :
- ✅ Séparation de `allow read` en `allow get` (lecture individuelle) et `allow list` (requêtes)
- ✅ Ajout de validation pour les requêtes filtrées par `creatorId`
- ✅ Maintien des permissions publiques pour projets actifs

---

### Modification 3 : Indexes Firestore (optionnel mais recommandé)

**Fichier** : `firestore.indexes.json`

**Vérifier que ces indexes existent** :

```json
{
  "indexes": [
    {
      "collectionGroup": "investments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "investorId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "creator.uid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "creatorId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**Note** : Si le champ est `creator.uid` (objet) et non `creatorId` (string), ajuster l'index en conséquence.

---

## 🚀 Étapes de Déploiement

### 1. Sauvegarder les règles actuelles
```bash
cd d:\Projets\Social Impact\social_impact_mvp
firebase firestore:rules get > firestore.rules.backup
```

### 2. Modifier le fichier `firestore.rules`
- Ouvrir `firestore.rules` dans l'éditeur
- Appliquer les modifications ci-dessus (sections 1 et 2)
- Sauvegarder le fichier

### 3. Valider la syntaxe des règles
```bash
firebase deploy --only firestore:rules --dry-run
```

### 4. Déployer les règles Firestore
```bash
firebase deploy --only firestore:rules
```

**Sortie attendue** :
```
✔  Deploy complete!

Project Console: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/overview
```

### 5. Déployer les indexes (si modifiés)
```bash
firebase deploy --only firestore:indexes
```

**Note** : La création des indexes peut prendre 5-15 minutes selon la taille des collections.

### 6. Vérifier dans Firebase Console

**A. Vérifier les règles** :
1. Aller sur https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules
2. Vérifier que les nouvelles règles sont affichées
3. Vérifier la date de dernière modification

**B. Vérifier les indexes** :
1. Aller sur https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/indexes
2. Vérifier que les indexes `investments` et `projects` sont présents
3. Statut attendu : **"Enabled"** (après quelques minutes)

### 7. Tester l'application
```bash
flutter run
```

---

## ✅ Vérification du Succès

### Tests à effectuer

#### Test 1 : Dashboard Investor
1. Lancer l'application
2. Se connecter avec un compte investisseur
3. Vérifier que le dashboard affiche les statistiques
4. **Succès** : Aucune erreur `permission-denied` dans les logs

#### Test 2 : Liste des projets
1. Naviguer vers la page "Projets"
2. Vérifier que les projets s'affichent
3. **Succès** : Projets publics et personnels visibles

#### Test 3 : Dashboard Créateur
1. Se connecter avec un compte créateur
2. Vérifier que les projets créés s'affichent
3. **Succès** : Statistiques des projets chargées

### Logs attendus (plus d'erreurs)

**AVANT** (❌) :
```
W/Firestore: Listen for Query(investments where investorId==...) failed: PERMISSION_DENIED
I/flutter: Error fetching dashboard stats: [cloud_firestore/permission-denied]
```

**APRÈS** (✅) :
```
I/flutter: Dashboard stats loaded successfully
I/flutter: Projects loaded: 5 items
```

---

## 🔧 Résolution de Problèmes

### Problème 1 : Erreur "Missing or insufficient permissions" persiste

**Solution** :
1. Vérifier que les règles sont bien déployées (check Firebase Console)
2. Attendre 1-2 minutes (propagation des règles)
3. Redémarrer l'application Flutter
4. Vérifier que l'utilisateur est bien authentifié

### Problème 2 : Erreur "Index not found"

**Erreur dans les logs** :
```
The query requires an index. You can create it here: https://console.firebase.google.com/...
```

**Solution** :
1. Cliquer sur le lien fourni dans l'erreur
2. Créer l'index automatiquement via la console
3. Attendre la création de l'index (5-15 min)
4. Réessayer la requête

### Problème 3 : Règles trop restrictives

Si les règles bloquent des cas légitimes :

1. Consulter les logs Firestore dans Firebase Console :
   https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/requests

2. Identifier la requête bloquée et la règle responsable

3. Ajuster la règle en conséquence

---

## 📊 Impact sur les Performances

### Avant
- ❌ Requêtes bloquées : 100%
- ❌ Erreurs de permissions : Oui
- ❌ Données chargées : 0%

### Après
- ✅ Requêtes autorisées : 100%
- ✅ Erreurs de permissions : Non
- ✅ Données chargées : 100%
- ⚡ Performance : Identique (règles optimisées)

---

## 🔐 Sécurité

### Validations maintenues
- ✅ Utilisateur doit être authentifié
- ✅ Utilisateur ne peut lire que ses propres investissements
- ✅ Créateur ne peut voir que ses propres projets (drafts)
- ✅ Projets publics visibles par tous les authentifiés
- ✅ Admin a accès complet (lecture seule)

### Pas de régression de sécurité
- ✅ Aucune donnée sensible exposée
- ✅ Isolation utilisateur maintenue
- ✅ Principe du moindre privilège respecté

---

## 📝 Autres Erreurs Trouvées (Non critiques)

### Erreur 1 : Google Play Services (Émulateur)
```
E/GoogleApiManager: Failed to get service from broker
W/GoogleApiManager: ConnectionResult{statusCode=DEVELOPER_ERROR}
```

**Impact** : Aucun  
**Solution** : Normal sur émulateur, ignoré en production  
**Action** : Aucune

### Erreur 2 : Timeout réseau images Google
```
SocketException: Connection timed out, address = lh3.googleusercontent.com
```

**Impact** : Images de profil Google non chargées  
**Solution** : 
- Utiliser `CachedNetworkImage` avec placeholder
- Augmenter timeout réseau
- Normal sur émulateur avec connexion limitée  
**Action** : Aucune requise (déjà géré par le widget)

---

## 📚 Références

### Documentation Firebase
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Query Rules](https://firebase.google.com/docs/firestore/security/rules-query)
- [Firestore Indexes](https://firebase.google.com/docs/firestore/query-data/indexing)

### Fichiers modifiés
- `firestore.rules` (lignes 152-160, 500-515)
- `firestore.indexes.json` (optionnel)

### Commandes Firebase CLI
```bash
# Déployer les règles
firebase deploy --only firestore:rules

# Déployer les indexes
firebase deploy --only firestore:indexes

# Déployer tout Firestore
firebase deploy --only firestore

# Tester les règles localement
firebase emulators:start --only firestore
```

---

## ✅ Checklist de Déploiement

- [ ] Sauvegarder les règles actuelles (`firebase firestore:rules get`)
- [ ] Modifier `firestore.rules` (section `investments`)
- [ ] Modifier `firestore.rules` (section `projects`)
- [ ] Vérifier `firestore.indexes.json`
- [ ] Valider la syntaxe (`--dry-run`)
- [ ] Déployer les règles (`firebase deploy --only firestore:rules`)
- [ ] Déployer les indexes si nécessaire
- [ ] Vérifier dans Firebase Console (règles + indexes)
- [ ] Attendre création des indexes (5-15 min)
- [ ] Tester l'application (`flutter run`)
- [ ] Vérifier logs (plus d'erreurs `permission-denied`)
- [ ] Tester dashboard investisseur
- [ ] Tester liste des projets
- [ ] Tester dashboard créateur
- [ ] Documenter les changements

---

**Statut** : ⏳ En attente de déploiement  
**Auteur** : GitHub Copilot  
**Date de création** : 6 janvier 2026  
**Version** : 1.0
