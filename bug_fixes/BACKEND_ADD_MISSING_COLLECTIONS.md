# Backend - Ajouter Collections Manquantes

**Priorité** : 🔴 CRITIQUE - Application bloquée
**Fichier** : `firestore.rules` (backend, 467 lignes)
**Action** : Ajouter les règles pour 3 collections manquantes

---

## 🚨 PROBLÈME

Le code Flutter essaie d'accéder à ces collections :
- `activities` (logs activités utilisateur)
- `kyc_data` (données KYC)
- `investments` (investissements)

**Mais ces collections n'ont PAS de règles dans le firestore.rules backend (467 lignes)**

**Résultat** : PERMISSION_DENIED → Application bloquée

---

## ✅ SOLUTION

Ajouter les règles pour ces 3 collections dans le fichier backend `firestore.rules`.

### Emplacement

Ajouter **AVANT** la règle finale de blocage :
```firestore
// ============================================
// RÈGLE PAR DÉFAUT : TOUT BLOQUER
// ============================================

// Toute collection non explicitement autorisée est bloquée
match /{document=**} {
  allow read, write: if false;
}
```

### Code à Ajouter

**Insérer ces règles AVANT la ligne `match /{document=**}`** :

```firestore
// ============================================
// COLLECTION: activities
// ============================================

match /activities/{activityId} {
  // Lire une activité spécifique
  allow get: if isAuthenticated() && resource.data.userId == request.auth.uid;

  // Lister les activités (queries)
  allow list: if isAuthenticated() && request.query.limit <= 100;

  // Créer une activité
  allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;

  // Modifier/supprimer une activité
  allow update, delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
}

// ============================================
// COLLECTION: kyc_data
// ============================================

match /kyc_data/{kycId} {
  // Lire un document KYC spécifique
  allow get: if isAuthenticated() && resource.data.userId == request.auth.uid;

  // Lister les documents KYC
  allow list: if isAuthenticated() && request.query.limit <= 10;

  // Créer un document KYC
  allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid;

  // Modifier/supprimer un document KYC
  allow update, delete: if isAuthenticated() && resource.data.userId == request.auth.uid;
}

// ============================================
// COLLECTION: investments
// ============================================

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

---

## 📝 INSTRUCTIONS

### 1. Ouvrir le fichier backend

Fichier : `firestore.rules` (467 lignes actuellement)

### 2. Trouver la section finale

Chercher cette section (devrait être vers la fin du fichier) :
```firestore
// ============================================
// RÈGLE PAR DÉFAUT : TOUT BLOQUER
// ============================================

match /{document=**} {
  allow read, write: if false;
}
```

### 3. Insérer le code

**Coller le code des 3 collections AVANT** la section `match /{document=**}`

Le fichier devrait maintenant avoir environ **520 lignes** (467 + 53 nouvelles lignes)

### 4. Déployer

```bash
firebase deploy --only firestore:rules
```

**Résultat attendu** :
```
✅ firestore: deployed rules firestore.rules successfully
```

---

## 🔐 SÉCURITÉ

Ces règles sont sécurisées car :

1. ✅ **Authentification requise** (`isAuthenticated()`)
2. ✅ **Ownership vérifié** pour `get` (utilisateur ne peut lire que ses propres données)
3. ✅ **Limite de queries** (max 100 docs pour activities/investments, 10 pour kyc)
4. ✅ **Création contrôlée** (userId/investorId doit correspondre à l'utilisateur connecté)
5. ✅ **Modification sécurisée** (utilisateur ne peut modifier que ses propres données)

---

## ✅ VALIDATION

Après déploiement, vérifier que l'application fonctionne :

### Tests à effectuer

1. ✅ **Dashboard**
   - Recent Activities card doit charger
   - Pas d'erreur dans les logs

2. ✅ **Activities Page**
   - Onglet "All" doit fonctionner
   - Tous les filtres (Investment, Contribution, etc.) doivent fonctionner

3. ✅ **KYC Flow**
   - Status KYC doit être lisible
   - Pas d'erreur PERMISSION_DENIED

4. ✅ **Investments**
   - Liste des investissements doit charger

### Logs à vérifier

**Avant** (erreurs) :
```
W/Firestore: Query(activities...) failed: PERMISSION_DENIED
W/Firestore: Query(kyc_data...) failed: PERMISSION_DENIED
W/Firestore: Query(investments...) failed: PERMISSION_DENIED
```

**Après** (succès) :
```
✅ Plus d'erreurs PERMISSION_DENIED
✅ Queries réussies
✅ Données chargées
```

---

## 📊 IMPACT

### Collections Ajoutées

| Collection | Utilisation | Impact |
|------------|-------------|--------|
| `activities` | Historique des actions utilisateur | Dashboard + Activities page |
| `kyc_data` | Données KYC utilisateur | KYC flow + vérifications |
| `investments` | Investissements utilisateur | Page investments + stats |

### Fichiers Modifiés

- ✅ `firestore.rules` : ~467 lignes → ~520 lignes
- ✅ Ajout de 3 nouvelles collections
- ✅ Pas de modification des collections existantes

### Temps de Résolution

- Modification : 5 minutes
- Déploiement : 1 minute
- Tests : 5 minutes
- **Total** : ~10 minutes

---

## ❓ FAQ

### Q : Ces collections sont-elles cohérentes avec l'architecture backend ?

**R** : OUI. Le code Flutter les utilise déjà, et il y a même des index Firestore configurés pour `activities` (voir `firestore.indexes.json`). Ces collections font partie du système.

### Q : Pourquoi ces collections n'étaient pas dans le backend ?

**R** : Il semble que le backend et le frontend aient été développés séparément avec des versions différentes de firestore.rules. Le frontend utilise ces collections mais le backend n'avait pas encore les règles correspondantes.

### Q : Y a-t-il un risque de conflit avec les collections existantes ?

**R** : NON. Ces 3 collections sont indépendantes :
- `activities` : Nouvelle collection
- `kyc_data` : Différente de `kyc_documents` (peut coexister)
- `investments` : Nouvelle collection (différente des contributions dans sous-collections)

### Q : Peut-on utiliser une approche différente ?

**R** : OUI, mais ce serait beaucoup plus long :
- Modifier tout le code Flutter pour utiliser les collections backend existantes
- Refactoriser la structure de données
- Re-tester toute l'application
- Temps estimé : plusieurs jours

Vs. ajouter ces règles : 10 minutes.

---

## 🎯 RÉSUMÉ

**Problème** : Code Flutter essaie d'accéder à des collections sans règles → PERMISSION_DENIED

**Solution** : Ajouter les règles pour `activities`, `kyc_data`, `investments`

**Action** :
1. Ouvrir firestore.rules (backend)
2. Ajouter le code ci-dessus AVANT `match /{document=**}`
3. Déployer avec `firebase deploy --only firestore:rules`
4. Tester l'application

**Temps** : 10 minutes

**Priorité** : 🔴 CRITIQUE - Application bloquée sans ce fix

---

**Date** : 29 Décembre 2025
**Status** : ⏳ EN ATTENTE - Modifications backend requises
**Type** : Ajout de collections manquantes
