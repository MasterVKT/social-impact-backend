# 🔧 BACKEND FIX REQUIRED - Firestore Composite Indexes
**Date**: 28 Décembre 2025
**Priorité**: 🔴 CRITIQUE - Bloque fonctionnalités Impact et Activities
**Type**: Configuration Backend - Firestore Indexes

---

## 📋 RÉSUMÉ EXÉCUTIF

**Problème**: Queries Firestore échouent avec erreur `FAILED_PRECONDITION`
**Cause**: Index composites manquants pour queries combinant `where` + `orderBy`
**Impact**: 2 pages ne peuvent pas charger de données (Impact Screen, Activities Screen)
**Solution**: Créer 2 index composites dans Firestore

---

## 🔴 ERREURS DÉTECTÉES

### Erreur 1: Collection `activities`
```
Listen for Query(target=Query(activities where userId==5GqHzQJ4wrRawS6z2GY1opoSb543 order by -timestamp, -__name__);limitType=LIMIT_TO_FIRST) failed:
Status{code=FAILED_PRECONDITION, description=The query requires an index.
```

**Fichier source**: `lib/features/auth/presentation/providers/dashboard_providers.dart:166-171`
**Query problématique**:
```dart
final querySnapshot = await firestore
    .collection('activities')
    .where('userId', isEqualTo: user.uid)
    .orderBy('timestamp', descending: true)
    .limit(10)
    .get();
```

**Aussi utilisée dans**: `lib/features/activities/presentation/screens/activities_screen.dart:24-38`

---

### Erreur 2: Collection `projects`
```
Listen for Query(target=Query(projects where creatorId==5GqHzQJ4wrRawS6z2GY1opoSb543 order by -createdAt, -__name__);limitType=LIMIT_TO_FIRST) failed:
Status{code=FAILED_PRECONDITION, description=The query requires an index.
```

**Fichier source**: `lib/features/impact/presentation/screens/impact_screen.dart:92-96`
**Query problématique**:
```dart
return firestore
    .collection('projects')
    .where('creatorId', isEqualTo: userId)
    .orderBy('createdAt', descending: true)
    .snapshots()
```

---

## 🎯 SOLUTION COMPLÈTE

### Option 1: Via Firebase Console (Méthode Manuelle)

#### Étape 1.1: Index pour `activities`
1. Ouvre le lien direct:
```
https://console.firebase.google.com/v1/r/project/social-impact-mvp-prod-b6805/firestore/indexes?create_composite=Cl9wcm9qZWN0cy9zb2NpYWwtaW1wYWN0LW12cC1wcm9kLWI2ODA1L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9hY3Rpdml0aWVzL2luZGV4ZXMvXxABGgoKBnVzZXJJZBABGg0KCXRpbWVzdGFtcBACGgwKCF9fbmFtZV9fEAI
```

2. Ou configure manuellement dans Firebase Console:
   - Va dans **Firestore Database** → **Indexes** → **Create Index**
   - Collection ID: `activities`
   - Fields to index:
     - Field: `userId` → Order: **Ascending**
     - Field: `timestamp` → Order: **Descending**
   - Query scope: **Collection**
   - Clique **Create**

#### Étape 1.2: Index pour `projects`
1. Ouvre le lien direct:
```
https://console.firebase.google.com/v1/r/project/social-impact-mvp-prod-b6805/firestore/indexes?create_composite=Cl1wcm9qZWN0cy9zb2NpYWwtaW1wYWN0LW12cC1wcm9kLWI2ODA1L2RhdGFiYXNlcy8oZGVmYXVsdCkvY29sbGVjdGlvbkdyb3Vwcy9wcm9qZWN0cy9pbmRleGVzL18QARoNCgljcmVhdG9ySWQQARoNCgljcmVhdGVkQXQQAhoMCghfX25hbWVfXxAC
```

2. Ou configure manuellement dans Firebase Console:
   - Va dans **Firestore Database** → **Indexes** → **Create Index**
   - Collection ID: `projects`
   - Fields to index:
     - Field: `creatorId` → Order: **Ascending**
     - Field: `createdAt` → Order: **Descending**
   - Query scope: **Collection**
   - Clique **Create**

#### Étape 1.3: Attendre la construction des index
- Temps estimé: 2-10 minutes selon la taille des collections
- Statut visible dans **Firestore Database** → **Indexes**
- État final attendu: **Enabled** (vert)

---

### Option 2: Via Firebase CLI (Méthode Automatisée - RECOMMANDÉE)

#### Étape 2.1: Créer le fichier `firestore.indexes.json`

**Chemin**: `firestore.indexes.json` (à la racine du projet backend)

**Contenu exact**:
```json
{
  "indexes": [
    {
      "collectionGroup": "activities",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "userId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "timestamp",
          "order": "DESCENDING"
        }
      ]
    },
    {
      "collectionGroup": "projects",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "creatorId",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "createdAt",
          "order": "DESCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

#### Étape 2.2: Vérifier firebase.json

**Fichier**: `firebase.json`

Assure-toi que la section `firestore` contient:
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
}
```

#### Étape 2.3: Déployer les index

**Commande**:
```bash
cd functions
firebase deploy --only firestore:indexes
```

**OU si tu es déjà dans le dossier racine du projet backend**:
```bash
firebase deploy --only firestore:indexes
```

**Sortie attendue**:
```
=== Deploying to 'social-impact-mvp-prod-b6805'...

i  deploying firestore
i  firestore: reading indexes from firestore.indexes.json...
✔  firestore: deployed indexes successfully

✔  Deploy complete!
```

#### Étape 2.4: Vérifier le déploiement

**Commande**:
```bash
firebase firestore:indexes
```

**Sortie attendue**:
```
activities
  - userId (ASC), timestamp (DESC) [BUILDING or ENABLED]

projects
  - creatorId (ASC), createdAt (DESC) [BUILDING or ENABLED]
```

---

## 🔍 VÉRIFICATION POST-DÉPLOIEMENT

### Test 1: Vérifier dans Firebase Console
1. Ouvre https://console.firebase.google.com
2. Sélectionne projet: `social-impact-mvp-prod-b6805`
3. Va dans **Firestore Database** → **Indexes**
4. Vérifie que 2 nouveaux index apparaissent:
   - `activities` (userId ASC, timestamp DESC) - Status: **Enabled**
   - `projects` (creatorId ASC, createdAt DESC) - Status: **Enabled**

### Test 2: Vérifier les logs Flutter
1. Relance l'application Flutter
2. Vérifie qu'il n'y a PLUS d'erreurs:
   ```
   Error fetching recent activities: [cloud_firestore/failed-precondition]
   ```
3. Les logs devraient maintenant être propres sans erreurs FAILED_PRECONDITION

### Test 3: Test fonctionnel dans l'app
1. **Dashboard**: La carte "Recent Activities" doit afficher des activités (pas d'erreur)
2. **Impact Screen** (`/impact`): Doit charger la liste des projets sans erreur
3. **Activities Screen** (`/activities`): Doit afficher la timeline complète des activités

---

## 📁 STRUCTURE FICHIERS BACKEND

**Avant (structure minimale attendue)**:
```
/
├── firebase.json
├── firestore.rules
└── functions/
    └── ...
```

**Après (structure complète)**:
```
/
├── firebase.json              ← Doit pointer vers firestore.indexes.json
├── firestore.rules            ← Règles de sécurité existantes
├── firestore.indexes.json     ← NOUVEAU FICHIER À CRÉER
└── functions/
    └── ...
```

---

## 🚨 POINTS D'ATTENTION

### 1. Vérifier le projet Firebase
- **Nom exact**: `social-impact-mvp-prod-b6805`
- **Region**: Vérifie que tu es bien connecté au bon projet
- **Commande**: `firebase projects:list` pour lister tous les projets

### 2. Permissions requises
- **Rôle Firebase**: Editor ou Owner
- **Commande**: `firebase login` si non authentifié

### 3. Temps de construction
- Les index peuvent prendre **2-10 minutes** à se construire
- Status pendant construction: **Building** (orange)
- Status final: **Enabled** (vert)
- Ne pas redéployer pendant la construction

### 4. Impact sur les données existantes
- ✅ **Aucun impact**: La création d'index ne modifie pas les données
- ✅ **Aucun downtime**: Les queries sans index continuent de fonctionner (mais échouent)
- ✅ **Rétroactif**: Une fois l'index créé, toutes les queries fonctionnent immédiatement

---

## 🐛 DÉPANNAGE

### Problème 1: "Index already exists"
**Symptôme**: Erreur lors du déploiement
```
Error: Index already exists
```

**Solution**:
1. Supprime l'index existant dans Firebase Console
2. OU ignore l'erreur (l'index est déjà créé)

### Problème 2: "Permission denied"
**Symptôme**:
```
Error: HTTP Error: 403, The caller does not have permission
```

**Solution**:
1. Vérifie tes permissions Firebase: `firebase projects:list`
2. Authentifie-toi à nouveau: `firebase login --reauth`
3. Sélectionne le bon projet: `firebase use social-impact-mvp-prod-b6805`

### Problème 3: Index reste en "Building" longtemps
**Symptôme**: Index en status "Building" pendant plus de 30 minutes

**Solution**:
1. Patiente (peut prendre jusqu'à 1h pour grandes collections)
2. Vérifie qu'il n'y a pas d'erreurs dans Firebase Console
3. Si bloqué > 1h, supprime et recrée l'index

### Problème 4: Queries échouent toujours après index créé
**Symptôme**: Même erreur `FAILED_PRECONDITION` après déploiement

**Vérifications**:
1. Index status = **Enabled** (pas Building)
2. Champs correspondent exactement (sensible à la casse)
3. Order correct (ASCENDING vs DESCENDING)
4. Redémarre l'application Flutter (hot restart ne suffit pas)

---

## 📊 INDEX DÉTAILLÉS

### Index 1: activities

**Configuration**:
```json
{
  "collectionGroup": "activities",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "userId",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "timestamp",
      "order": "DESCENDING"
    }
  ]
}
```

**Raison d'être**:
- Query: `activities.where('userId', '==', X).orderBy('timestamp', 'desc')`
- Utilisé par: Dashboard (Recent Activities), Activities Screen
- Fréquence: À chaque ouverture du dashboard ou de la page activities

**Exemples de documents indexés**:
```json
{
  "id": "act_001",
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "timestamp": Timestamp(2025-12-28 10:30:00),
  "type": "investment",
  "title": "New Investment",
  "description": "Invested €500 in Solar Project"
}
```

---

### Index 2: projects

**Configuration**:
```json
{
  "collectionGroup": "projects",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "creatorId",
      "order": "ASCENDING"
    },
    {
      "fieldPath": "createdAt",
      "order": "DESCENDING"
    }
  ]
}
```

**Raison d'être**:
- Query: `projects.where('creatorId', '==', X).orderBy('createdAt', 'desc')`
- Utilisé par: Impact Screen (liste des projets d'une organization)
- Fréquence: À chaque ouverture de la page Impact pour Organizations

**Exemples de documents indexés**:
```json
{
  "id": "proj_001",
  "creatorId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "createdAt": Timestamp(2025-12-01 08:00:00),
  "name": "Solar Energy Project",
  "fundingGoal": 10000.0,
  "status": "active"
}
```

---

## ✅ CHECKLIST COMPLÈTE

### Phase 1: Préparation
- [ ] Avoir accès au projet Firebase `social-impact-mvp-prod-b6805`
- [ ] Firebase CLI installé (`npm install -g firebase-tools`)
- [ ] Authentifié Firebase (`firebase login`)
- [ ] Sélectionné le bon projet (`firebase use social-impact-mvp-prod-b6805`)

### Phase 2: Création des index
- [ ] Créé fichier `firestore.indexes.json` avec le contenu exact fourni
- [ ] Vérifié que `firebase.json` pointe vers `firestore.indexes.json`
- [ ] Déployé les index: `firebase deploy --only firestore:indexes`
- [ ] Vérifié le déploiement: `firebase firestore:indexes`

### Phase 3: Vérification
- [ ] Index `activities` visible dans Firebase Console
- [ ] Index `projects` visible dans Firebase Console
- [ ] Status des 2 index = **Enabled** (vert)
- [ ] Aucune erreur dans la console Firebase

### Phase 4: Tests fonctionnels
- [ ] Relancé l'application Flutter
- [ ] Dashboard affiche Recent Activities sans erreur
- [ ] Impact Screen (`/impact`) charge les projets sans erreur
- [ ] Activities Screen (`/activities`) affiche la timeline sans erreur
- [ ] Aucune erreur `FAILED_PRECONDITION` dans les logs Flutter

---

## 🎯 COMMANDES RÉSUMÉES

```bash
# 1. Vérifier le projet actuel
firebase projects:list

# 2. Sélectionner le bon projet
firebase use social-impact-mvp-prod-b6805

# 3. Créer le fichier firestore.indexes.json (copier le contenu fourni ci-dessus)
# (Utilise ton éditeur ou l'agent AI pour créer le fichier)

# 4. Déployer les index
firebase deploy --only firestore:indexes

# 5. Vérifier le déploiement
firebase firestore:indexes

# 6. (Optionnel) Voir tous les index
firebase firestore:indexes --project social-impact-mvp-prod-b6805
```

---

## 📝 NOTES ADDITIONNELLES

### Pourquoi ces index sont nécessaires?
Firestore nécessite un **index composite** pour toute query qui combine:
1. Un filtre `where` sur un champ
2. Un tri `orderBy` sur un autre champ

**Exemple**:
```dart
// ❌ SANS INDEX: FAILED_PRECONDITION
collection.where('userId', isEqualTo: X).orderBy('timestamp', descending: true)

// ✅ AVEC INDEX: Fonctionne
// Index: userId (ASC) + timestamp (DESC)
```

### Impact sur les coûts Firebase
- **Stockage index**: Négligeable (quelques KB)
- **Reads supplémentaires**: Aucun (les index optimisent les reads)
- **Coût**: Gratuit dans le plan Blaze (actuel)

### Compatibilité avec les règles de sécurité
- Les index n'affectent PAS les règles de sécurité
- Les règles dans `firestore.rules` restent inchangées
- Aucune modification requise dans `firestore.rules`

---

## 🚀 PROCHAINES ÉTAPES APRÈS RÉSOLUTION

Une fois les index créés et vérifiés:

1. **Tester l'application complète**:
   - Se connecter comme Organization
   - Cliquer sur "Update Impact" → Doit charger sans erreur
   - Cliquer sur "View All Activities" → Doit afficher la timeline

2. **Vérifier les autres rôles**:
   - Investor, Auditor, Admin → Vérifier que Recent Activities fonctionne

3. **Déployer en production**:
   - Les index sont déjà en production (projet prod utilisé)
   - Aucun déploiement supplémentaire requis

4. **Monitoring**:
   - Surveiller les logs Firestore pour d'autres index manquants
   - Firebase Console → Firestore → Usage → Index

---

**Créé le**: 28 Décembre 2025
**Auteur**: Claude Code
**Type**: Documentation Backend - Firestore Indexes
**Priorité**: 🔴 CRITIQUE
**Temps estimé**: 10-15 minutes (+ temps de construction des index)
