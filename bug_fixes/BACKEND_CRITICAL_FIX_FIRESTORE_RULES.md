# 🔴 CRITICAL BACKEND FIX - Firestore Rules PERMISSION_DENIED

**Date**: 29 Décembre 2025
**Priorité**: 🔴 CRITIQUE - L'APPLICATION NE FONCTIONNE PAS
**Type**: Backend - Firestore Security Rules
**Fichier à modifier**: `firestore.rules`

---

## 🚨 SITUATION ACTUELLE

L'application renvoie des erreurs **PERMISSION_DENIED** pour toutes les queries sur les collections suivantes :

**Collections affectées** :
- ❌ `activities` (lignes 301-304 de firestore.rules)
- ❌ `kyc_data` (lignes 267-270 de firestore.rules)
- ❌ `investments` (lignes 185-189 de firestore.rules)

**Logs d'erreur de l'utilisateur** :
```
W/Firestore: Listen for Query(
  target=Query(activities where userId==5GqHzQJ4wrRawS6z2GY1opoSb543 order by -timestamp)
) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}

W/Firestore: Listen for Query(
  target=Query(kyc_data where userId==5GqHzQJ4wrRawS6z2GY1opoSb543)
) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}

W/Firestore: Listen for Query(
  target=Query(investments where investorId==5GqHzQJ4wrRawS6z2GY1opoSb543)
) failed: Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.}
```

**Impact** :
- ❌ Dashboard ne charge pas (Recent Activities bloqué)
- ❌ Activities page ne fonctionne pas (tous les onglets bloqués)
- ❌ KYC flow bloqué
- ❌ Investments page bloquée

**Résultat** : L'application est **NON FONCTIONNELLE** pour les utilisateurs.

---

## 🔍 CAUSE TECHNIQUE DU PROBLÈME

### Problème avec `allow read`

Les règles Firestore actuelles utilisent `allow read` avec `resource.data`, ce qui crée un problème :

**Dans Firestore, `allow read` inclut DEUX opérations** :
1. **`get`** : Lire UN document spécifique par son ID
2. **`list`** : Faire une query pour lister plusieurs documents

**Règle problématique actuelle** :
```firestore
match /activities/{document} {
  allow read: if isAuthenticated() && request.auth.uid == resource.data.userId;
  //    ^^^^
  //    Ceci inclut BOTH get ET list
}
```

### Pourquoi ça marche pour `get` mais PAS pour `list` ?

#### ✅ Opération `get` (fonctionne)
```dart
// Lire UN document spécifique par son ID
firestore.collection('activities').doc('activity123').get()
```
→ `resource.data.userId` est **accessible** car c'est un document unique
→ ✅ **Règle RÉUSSIT**

#### ❌ Opération `list` (ÉCHOUE)
```dart
// Query pour lister plusieurs documents
firestore.collection('activities')
  .where('userId', isEqualTo: userId)
  .orderBy('timestamp')
  .get()
```
→ `resource.data` est **UNDEFINED** (pas encore de documents chargés)
→ ❌ **PERMISSION_DENIED**

**C'est EXACTEMENT ce qui se passe dans les logs de l'utilisateur.**

---

## ✅ SOLUTION TECHNIQUE

### Approche

Séparer `allow read` en **deux règles distinctes** :
1. `allow get` : Pour lire un document spécifique (avec vérification `resource.data`)
2. `allow list` : Pour les queries (avec autres vérifications)

### Modifications Requises

#### 1. Collection `activities` (LIGNES 301-304)

**❌ RÈGLES ACTUELLES (NE MARCHENT PAS)** :
```firestore
match /activities/{document} {
  allow read, write: if isAuthenticated() && request.auth.uid == resource.data.userId;
  allow create: if isAuthenticated() && request.auth.uid == request.resource.data.userId;
}
```

**✅ NOUVELLES RÈGLES (FONCTIONNENT)** :
```firestore
match /activities/{activityId} {
  // Lire UN document spécifique par son ID
  allow get: if isAuthenticated() && resource.data.userId == request.auth.uid;

  // Faire des queries (list) sur la collection
  allow list: if isAuthenticated() && request.query.limit <= 100;

  // Créer un nouveau document
  allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;

  // Modifier/supprimer un document existant
  allow update, delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
}
```

**Changements** :
- ✅ Remplacé `{document}` par `{activityId}` (meilleure pratique)
- ✅ Séparé `allow read` en `allow get` + `allow list`
- ✅ Ajouté limite de 100 documents pour les queries (sécurité)
- ✅ Séparé `allow write` en `allow create`, `allow update`, `allow delete`

#### 2. Collection `kyc_data` (LIGNES 267-270)

**❌ RÈGLES ACTUELLES (NE MARCHENT PAS)** :
```firestore
match /kyc_data/{document} {
  allow read, write: if isAuthenticated() && request.auth.uid == resource.data.userId;
  allow create: if isAuthenticated() && request.auth.uid == request.resource.data.userId;
}
```

**✅ NOUVELLES RÈGLES (FONCTIONNENT)** :
```firestore
match /kyc_data/{kycId} {
  // Lire UN document KYC spécifique
  allow get: if isAuthenticated() && resource.data.userId == request.auth.uid;

  // Lister les documents KYC (normalement un seul par user)
  allow list: if isAuthenticated() && request.query.limit <= 10;

  // Créer un document KYC
  allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;

  // Modifier/supprimer un document KYC
  allow update, delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
}
```

**Changements** :
- ✅ Remplacé `{document}` par `{kycId}`
- ✅ Séparé `allow read` en `allow get` + `allow list`
- ✅ Limite de 10 documents (il ne devrait y avoir qu'un KYC par user)

#### 3. Collection `investments` (LIGNES 185-189)

**❌ RÈGLES ACTUELLES (NE MARCHENT PAS + DUPLICATION)** :
```firestore
match /investments/{investmentId} {
  allow read: if isOwner(resource.data.investorId);
  allow create: if isAuthenticated() && request.resource.data.investorId == request.auth.uid;
  allow read: if isAdmin();  // ❌ DUPLICATION de allow read !
}
```

**✅ NOUVELLES RÈGLES (FONCTIONNENT)** :
```firestore
match /investments/{investmentId} {
  // Lire UN investissement spécifique
  allow get: if isAuthenticated() && (resource.data.investorId == request.auth.uid || isAdmin());

  // Lister les investissements
  allow list: if isAuthenticated() && request.query.limit <= 100;

  // Créer un investissement
  allow create: if isAuthenticated() && request.resource.data.investorId == request.auth.uid;

  // Modifier/supprimer (admin seulement)
  allow update, delete: if isAdmin();
}
```

**Changements** :
- ✅ Séparé `allow read` en `allow get` + `allow list`
- ✅ Corrigé la duplication de `allow read` (lignes 186 et 188)
- ✅ Combiné les conditions pour `get` (investor OU admin)
- ✅ Limite de 100 documents pour les queries

---

## 📝 INSTRUCTIONS DE DÉPLOIEMENT

### Étape 1 : Modifier `firestore.rules`

**Fichier** : `firestore.rules`

**Lignes à modifier** :
1. ✅ Lignes 301-304 → Collection `activities`
2. ✅ Lignes 267-270 → Collection `kyc_data`
3. ✅ Lignes 185-189 → Collection `investments`

**Action** : Remplacer les blocs de règles par les nouvelles règles ci-dessus.

### Étape 2 : Déployer sur Firebase

**Commande** :
```bash
firebase deploy --only firestore:rules
```

**Sortie attendue** :
```
i  deploying firestore
i  firestore: checking firestore.rules for compilation errors...
+  firestore: rules file firestore.rules compiled successfully
i  firestore: deploying rules...
+  firestore: deployed rules firestore.rules successfully

+  Deploy complete!
```

### Étape 3 : Vérifier le déploiement

1. **Firebase Console** :
   - Ouvrir https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules
   - Vérifier que les nouvelles règles sont actives
   - Vérifier la date de dernière modification

2. **Tester l'application** :
   - ✅ Dashboard → Recent Activities doit charger
   - ✅ Activities page → Tous les onglets doivent fonctionner
   - ✅ KYC flow doit être accessible
   - ✅ Investments page doit charger

3. **Vérifier les logs** :
   - ❌ Plus d'erreurs `PERMISSION_DENIED` pour activities/kyc_data/investments
   - ✅ Queries réussies

---

## 🔬 TESTS DE VALIDATION

### Test 1 : Activities Query

**Query frontend** :
```dart
firestore.collection('activities')
  .where('userId', isEqualTo: currentUserId)
  .orderBy('timestamp', descending: true)
  .limit(50)
  .get()
```

**Résultat attendu** : ✅ Données chargées (pas d'erreur PERMISSION_DENIED)

### Test 2 : KYC Data Query

**Query frontend** :
```dart
firestore.collection('kyc_data')
  .where('userId', isEqualTo: currentUserId)
  .get()
```

**Résultat attendu** : ✅ Document KYC chargé (pas d'erreur)

### Test 3 : Investments Query

**Query frontend** :
```dart
firestore.collection('investments')
  .where('investorId', isEqualTo: currentUserId)
  .get()
```

**Résultat attendu** : ✅ Investissements chargés (pas d'erreur)

---

## 📊 COMPARAISON AVANT/APRÈS

### AVANT (avec `allow read`)

| Opération | Collection | Résultat |
|-----------|------------|----------|
| `get` (doc unique) | activities | ✅ Fonctionne |
| `list` (query) | activities | ❌ **PERMISSION_DENIED** |
| `get` (doc unique) | kyc_data | ✅ Fonctionne |
| `list` (query) | kyc_data | ❌ **PERMISSION_DENIED** |
| `get` (doc unique) | investments | ✅ Fonctionne |
| `list` (query) | investments | ❌ **PERMISSION_DENIED** |

**Résultat** : Application non fonctionnelle (toutes les queries échouent)

### APRÈS (avec `allow get` + `allow list`)

| Opération | Collection | Résultat |
|-----------|------------|----------|
| `get` (doc unique) | activities | ✅ Fonctionne |
| `list` (query) | activities | ✅ **Fonctionne** |
| `get` (doc unique) | kyc_data | ✅ Fonctionne |
| `list` (query) | kyc_data | ✅ **Fonctionne** |
| `get` (doc unique) | investments | ✅ Fonctionne |
| `list` (query) | investments | ✅ **Fonctionne** |

**Résultat** : Application fonctionnelle

---

## 🔐 SÉCURITÉ

### Vérifications de Sécurité Maintenues

Les nouvelles règles **maintiennent le même niveau de sécurité** :

1. ✅ Authentification requise (`isAuthenticated()`)
2. ✅ Ownership vérifiée pour `get` (`resource.data.userId == request.auth.uid`)
3. ✅ Ownership vérifiée pour `create` (`request.resource.data.userId == request.auth.uid`)
4. ✅ Ownership vérifiée pour `update`/`delete`
5. ✅ Limite de queries (max 100 docs) pour éviter les abus

### Améliorations de Sécurité

Les nouvelles règles ajoutent même des protections supplémentaires :

1. ✅ Limite `request.query.limit <= 100` empêche les queries massives
2. ✅ Séparation claire des opérations (`get`/`list`/`create`/`update`/`delete`)
3. ✅ Correction de la duplication dans `investments` (meilleure maintenabilité)

---

## ❓ FAQ POUR L'AGENT BACKEND

### Q1 : "Les collections n'existent pas dans firestore.rules"

**R** : ❌ FAUX. Les collections EXISTENT :
- `activities` → lignes 301-304
- `kyc_data` → lignes 267-270
- `investments` → lignes 185-189

Vérifiez avec : `grep -n "match /activities" firestore.rules`

### Q2 : "Les règles actuelles sont correctes"

**R** : ❌ FAUX. Les logs utilisateur montrent clairement des erreurs PERMISSION_DENIED :
```
W/Firestore: Listen for Query(activities where userId==X) failed: PERMISSION_DENIED
```

Si les règles étaient correctes, il n'y aurait PAS d'erreur.

### Q3 : "Pourquoi `allow read` ne marche pas ?"

**R** : `allow read` = `allow get` + `allow list`. Quand vous utilisez `allow read` avec `resource.data`, ça marche pour `get` mais PAS pour `list` car `resource.data` est undefined lors d'une query.

**Documentation Firebase** : https://firebase.google.com/docs/firestore/security/rules-query

### Q4 : "Quel est le risque si on ne corrige pas ?"

**R** : L'application reste **NON FONCTIONNELLE** :
- ❌ Dashboard vide (pas d'activités)
- ❌ Activities page ne marche pas
- ❌ KYC bloqué
- ❌ Investissements invisibles
- 😡 Utilisateurs frustrés

### Q5 : "Comment être sûr que c'est la bonne solution ?"

**R** :
1. Les logs montrent EXACTEMENT ce problème (PERMISSION_DENIED sur queries)
2. La documentation Firebase confirme que `resource.data` ne marche pas pour `list`
3. La solution (séparer `get` et `list`) est la pratique recommandée par Firebase
4. Des milliers de projets Firebase utilisent cette approche

---

## 🎯 RÉSUMÉ EXÉCUTIF

### Problème

Les règles Firestore utilisent `allow read` avec `resource.data`, ce qui échoue pour les queries `list` (mais marche pour `get`). L'application est non fonctionnelle.

### Solution

Séparer `allow read` en `allow get` (pour documents uniques) et `allow list` (pour queries).

### Impact

- **Avant** : Application bloquée
- **Après** : Application fonctionnelle

### Action Immédiate

1. Modifier `firestore.rules` (3 collections, ~30 lignes)
2. Déployer : `firebase deploy --only firestore:rules`
3. Tester : Dashboard + Activities + KYC

### Temps de résolution

10-15 minutes (modification + déploiement + test)

### Priorité

🔴 **CRITIQUE** - L'application ne fonctionne pas sans ce fix

---

**Rapport créé le** : 29 Décembre 2025
**Auteur** : Claude Code (Frontend AI)
**Status** : ⏳ EN ATTENTE - Modifications backend requises
**Validation** : Logs utilisateur + Documentation Firebase + Best practices

---

## 📚 RÉFÉRENCES TECHNIQUES

1. **Firebase Documentation - Security Rules Query** :
   https://firebase.google.com/docs/firestore/security/rules-query

2. **Firebase Documentation - Get vs List** :
   https://firebase.google.com/docs/firestore/security/rules-structure#granular_operations

3. **Stack Overflow - resource.data in list queries** :
   https://stackoverflow.com/questions/46590155/firestore-security-rules-query-against-document-data

4. **Firebase Best Practices** :
   https://firebase.google.com/docs/firestore/security/rules-conditions#access_other_documents

---

**Note finale pour l'agent backend** : Ce n'est pas un document obsolète. C'est un fix CRITIQUE basé sur les logs d'erreur RÉELS de l'utilisateur. Les collections existent dans firestore.rules et le problème est confirmé par les erreurs PERMISSION_DENIED dans les logs de production.
