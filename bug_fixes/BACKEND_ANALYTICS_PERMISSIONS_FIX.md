# 🔧 BACKEND FIX REQUIRED - Analytics Permissions Issue
**Date**: 29 Décembre 2025
**Priorité**: ⚠️ MOYENNE - Analytics Screen fonctionne mais sans données de contributions
**Type**: Configuration Backend - Firestore Security Rules

---

## 📋 RÉSUMÉ EXÉCUTIF

**Problème**: Query Firestore sur `investments` échoue avec `PERMISSION_DENIED`
**Cause**: Règles Firestore ne permettent pas la query `investments.where('projectId', ==, X)`
**Impact**: Analytics Screen ne peut pas compter les contributions par projet
**Solution temporaire**: ✅ Appliquée - Default à 0 contributions si erreur
**Solution définitive**: Mettre à jour les règles Firestore

---

## 🔴 ERREUR DÉTECTÉE

### Erreur dans les logs:
```
W/Firestore(8263): Listen for Query(target=Query(investments where projectId==XiNPK3MfSnBZAd2K7J7C order by __name__);limitType=LIMIT_TO_FIRST) failed:
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions., cause=null}
```

**Fichier source**: `lib/features/analytics/presentation/screens/organization_analytics_screen.dart:89-94`

**Query problématique**:
```dart
final contributionsSnapshot = await firestore
    .collection('investments')
    .where('projectId', isEqualTo: doc.id)
    .get();
```

**Utilisée par**: Organization Analytics Screen pour compter les contributions par projet

---

## 🎯 SOLUTION COMPLÈTE

### Étape 1: Vérifier les règles Firestore actuelles

**Commande**:
```bash
cat firestore.rules
```

**Rechercher la section `investments`**:
```javascript
match /investments/{investmentId} {
  // Règles actuelles...
}
```

### Étape 2: Mettre à jour les règles Firestore

**Fichier**: `firestore.rules`

**Ajouter/Modifier** la règle pour permettre aux organizations de lire les investissements de leurs projets:

```javascript
match /investments/{investmentId} {
  // Lecture existante (investisseurs peuvent voir leurs propres investissements)
  allow read: if request.auth != null &&
                 (request.auth.uid == resource.data.investorId ||
                  get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');

  // NOUVELLE RÈGLE: Organizations peuvent lire les investissements de leurs projets
  allow list: if request.auth != null &&
                 request.query.limit <= 100 &&
                 // Vérifier que l'organization est le créateur du projet
                 exists(/databases/$(database)/documents/projects/$(request.resource.data.projectId)) &&
                 get(/databases/$(database)/documents/projects/$(request.resource.data.projectId)).data.creatorId == request.auth.uid;

  // Création d'investissement
  allow create: if request.auth != null &&
                   request.auth.uid == request.resource.data.investorId;

  // Les autres opérations restent inchangées
}
```

**OU une approche plus simple** (si la règle ci-dessus est trop complexe):

```javascript
match /investments/{investmentId} {
  // Lecture: investisseurs, organizations des projets concernés, admins
  allow read: if request.auth != null && (
    request.auth.uid == resource.data.investorId ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'organization'
  );

  allow create: if request.auth != null &&
                   request.auth.uid == request.resource.data.investorId;
}
```

### Étape 3: Déployer les règles

**Commande**:
```bash
firebase deploy --only firestore:rules
```

**Sortie attendue**:
```
=== Deploying to 'social-impact-mvp-prod-b6805'...

i  deploying firestore
i  firestore: checking firestore.rules for compilation errors...
✔  firestore: rules file firestore.rules compiled successfully

✔  Deploy complete!
```

### Étape 4: Vérifier le déploiement

**Test dans l'application**:
1. Relancer l'app Flutter
2. Se connecter comme Organization
3. Aller sur Analytics Screen (`/analytics`)
4. Vérifier que les contributions par projet s'affichent correctement
5. Vérifier qu'il n'y a PLUS d'erreur `PERMISSION_DENIED` dans les logs

---

## 🔍 RÈGLES ALTERNATIVES

### Option 1: Permettre lecture pour organizations seulement
```javascript
match /investments/{investmentId} {
  allow read: if request.auth != null && (
    request.auth.uid == resource.data.investorId ||
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'organization']
  );

  allow create: if request.auth != null &&
                   request.auth.uid == request.resource.data.investorId;
}
```

### Option 2: Ajouter champ creatorId dans investments
Si vous ajoutez le champ `creatorId` (organization) dans les documents `investments`:

```javascript
match /investments/{investmentId} {
  allow read: if request.auth != null && (
    request.auth.uid == resource.data.investorId ||
    request.auth.uid == resource.data.creatorId ||  // Organization du projet
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin'
  );

  allow create: if request.auth != null &&
                   request.auth.uid == request.resource.data.investorId;
}
```

**Attention**: Cette option nécessite de modifier le schéma des données (ajouter `creatorId` dans investments).

---

## 📊 IMPACT ACTUEL

### Avec la correction temporaire (code):
- ✅ Analytics Screen s'ouvre sans erreur
- ⚠️ Contributions par projet affichent "0" au lieu du vrai nombre
- ✅ Autres métriques (total raised, completion rate) fonctionnent correctement
- ⚠️ Logs montrent toujours `PERMISSION_DENIED` mais n'affectent pas l'UX

### Après correction des règles Firestore:
- ✅ Analytics Screen affiche les vraies données
- ✅ Contributions par projet affichent le nombre réel
- ✅ Average contribution calculé correctement
- ✅ Aucune erreur `PERMISSION_DENIED` dans les logs

---

## 🚨 POINTS D'ATTENTION

### 1. Sécurité des données
- ⚠️ Ne pas permettre aux organizations de voir les investissements d'autres organizations
- ✅ Vérifier que seuls les investissements des projets de l'organization sont accessibles
- ✅ Les investisseurs doivent toujours pouvoir voir leurs propres investissements

### 2. Performance
- ✅ Limiter les queries avec `.limit(100)` dans le code
- ✅ Utiliser des index composites si nécessaire
- ⚠️ Éviter les queries non optimisées qui scannent toute la collection

### 3. Rétrocompatibilité
- ✅ Les règles doivent rester compatibles avec les fonctionnalités existantes
- ✅ Les investisseurs doivent toujours pouvoir voir leurs investissements
- ✅ Les admins doivent garder accès complet

---

## ✅ CHECKLIST

### Phase 1: Préparation
- [ ] Backup des règles Firestore actuelles
- [ ] Vérifier les règles existantes: `cat firestore.rules`
- [ ] Identifier la section `investments`

### Phase 2: Modification
- [ ] Mettre à jour `firestore.rules` avec la nouvelle règle
- [ ] Vérifier la syntaxe des règles
- [ ] Tester localement si possible (émulateur Firestore)

### Phase 3: Déploiement
- [ ] Déployer: `firebase deploy --only firestore:rules`
- [ ] Vérifier qu'il n'y a pas d'erreurs de déploiement
- [ ] Attendre 1-2 minutes que les règles se propagent

### Phase 4: Tests
- [ ] Relancer l'application Flutter
- [ ] Se connecter comme Organization
- [ ] Aller sur Analytics Screen
- [ ] Vérifier que les contributions s'affichent
- [ ] Vérifier qu'il n'y a plus d'erreur `PERMISSION_DENIED` dans les logs
- [ ] Tester avec un compte Investor (doit toujours voir ses investissements)
- [ ] Tester avec un compte Admin (doit tout voir)

---

## 🎯 COMMANDES RÉSUMÉES

```bash
# 1. Backup des règles actuelles
firebase firestore:rules > firestore.rules.backup

# 2. Éditer firestore.rules
# (Utilise ton éditeur ou l'agent AI pour modifier le fichier)

# 3. Tester les règles (optionnel, si émulateur configuré)
firebase emulators:start --only firestore

# 4. Déployer les règles
firebase deploy --only firestore:rules

# 5. Vérifier le déploiement
firebase firestore:rules
```

---

## 📝 NOTES ADDITIONNELLES

### Pourquoi ce problème existe?
Les règles Firestore par défaut n'anticipent pas que les organizations auront besoin de lire les investissements de leurs projets pour calculer des analytics.

### Impact sur les coûts Firebase
- **Aucun impact négatif**: Les organizations lisent déjà leurs propres projets
- **Légère augmentation**: Queries supplémentaires sur `investments` (déjà incluses dans le quota)
- **Optimisation**: Les données sont déjà en cache lors du calcul des analytics

### Alternative sans modifier les règles
Si vous ne voulez pas modifier les règles Firestore, vous pouvez:
1. Ajouter un champ `contributionsCount` dans les documents `projects`
2. Mettre à jour ce champ via Cloud Function quand un investissement est créé
3. Lire simplement `project.contributionsCount` au lieu de compter manuellement

**Avantage**: Pas besoin de modifier les règles
**Inconvénient**: Nécessite une Cloud Function supplémentaire et modification du schéma

---

**Créé le**: 29 Décembre 2025
**Auteur**: Claude Code
**Type**: Documentation Backend - Firestore Security Rules
**Priorité**: ⚠️ MOYENNE
**Temps estimé**: 5-10 minutes
