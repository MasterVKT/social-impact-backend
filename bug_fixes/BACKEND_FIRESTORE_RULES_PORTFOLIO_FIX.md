# 🔐 FIRESTORE RULES FIX - Portfolio & Achievements Collections

**Date**: 2026-01-09 (Mis à jour)  
**Statut**: ✅ Modifications locales appliquées → 🔴 DÉPLOIEMENT REQUIS URGENT  
**Priorité**: 🔴 CRITIQUE - Bloque accès au portfolio et achievements utilisateur

---

## 📊 Problèmes Identifiés

### Erreurs Firestore Actuelles
```
W/Firestore: Listen for Query(target=Query(investments where projectId==... failed: 
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.

W/Firestore: Listen for Query(target=Query(user_portfolio/5GqHzQJ4wrRawS6z2GY1opoSb543 ... failed: 
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.

W/Firestore: Listen for Query(target=Query(user_activities/5GqHzQJ4wrRawS6z2GY1opoSb543/items ... failed: 
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.

W/Firestore: Listen for Query(target=Query(user_achievements/5GqHzQJ4wrRawS6z2GY1opoSb543 ... failed: 
Status{code=PERMISSION_DENIED, description=Missing or insufficient permissions.
```

### Collections Manquantes
Trois collections utilisées par l'application **n'étaient PAS définies** dans `firestore.rules` :
1. ❌ `user_portfolio/{userId}` - Statistiques du portfolio
2. ❌ `user_activities/{userId}/items` - Historique des activités
3. ❌ `user_achievements/{userId}` - Succès et badges

---

## ✅ Modifications Appliquées

### Fichier Modifié
📁 **`firestore.rules`** (lignes 520-600)

### Nouvelles Règles Ajoutées

#### 1. Collection `user_portfolio`
```javascript
// ============================================
// COLLECTION: user_portfolio
// ============================================
// Portfolio des utilisateurs avec leurs statistiques d'investissement

match /user_portfolio/{userId} {
  // Lire son propre portfolio
  allow read: if isAuthenticated() && (
    userId == request.auth.uid ||
    isAdmin()
  );

  // Créer/mettre à jour son portfolio
  allow create, update: if isAuthenticated() && userId == request.auth.uid;

  // Supprimer (admin seulement)
  allow delete: if isAdmin();
}
```

#### 2. Collection `user_activities` (sous-collection)
```javascript
// ============================================
// COLLECTION: user_activities
// ============================================
// Activités des utilisateurs (historique des actions)

match /user_activities/{userId}/items/{itemId} {
  // Lire ses propres activités
  allow read: if isAuthenticated() && (
    userId == request.auth.uid ||
    isAdmin()
  );

  // Créer une activité
  allow create: if isAuthenticated() && userId == request.auth.uid;

  // Modifier/supprimer (admin seulement)
  allow update, delete: if isAdmin();
}
```

#### 3. Collection `user_achievements`
```javascript
// ============================================
// COLLECTION: user_achievements
// ============================================
// Succès et badges des utilisateurs

match /user_achievements/{userId} {
  // Lire ses propres achievements
  allow read: if isAuthenticated() && (
    userId == request.auth.uid ||
    isAdmin()
  );

  // Créer/mettre à jour ses achievements
  allow create, update: if isAuthenticated() && userId == request.auth.uid;

  // Supprimer (admin seulement)
  allow delete: if isAdmin();
}
```

#### 4. Collection `investments` (règle existante conservée)
```javascript
match /investments/{investmentId} {
  // Lire un investissement spécifique OU les investissements d'un projet
  allow read: if isAuthenticated() && (
    resource.data.investorId == request.auth.uid || 
    isAdmin()
  );

  // Créer un investissement
  allow create: if isAuthenticated() && 
                   request.resource.data.investorId == request.auth.uid;

  // Modifier/supprimer (admin seulement)
  allow update, delete: if isAdmin();
}
```

### Permissions Accordées (Toutes Collections)

| Collection | Lecture | Création | Modification | Suppression |
|------------|---------|----------|--------------|-------------|
| **user_portfolio** | ✅ Propriétaire ou Admin | ✅ Propriétaire | ✅ Propriétaire | ❌ Admin uniquement |
| **user_activities** | ✅ Propriétaire ou Admin | ✅ Propriétaire | ❌ Admin uniquement | ❌ Admin uniquement |
| **user_achievements** | ✅ Propriétaire ou Admin | ✅ Propriétaire | ✅ Propriétaire | ❌ Admin uniquement |
| **investments** | ✅ Propriétaire ou Admin | ✅ Propriétaire | ❌ Admin uniquement | ❌ Admin uniquement |

---

## 🚀 DÉPLOIEMENT REQUIS (CRITIQUE)

⚠️ **Les règles modifiées localement DOIVENT être déployées sur Firebase.**

Le terminal PowerShell semble ne pas afficher les sorties de `firebase deploy`. Utilisez **la console web Firebase** (méthode la plus fiable) :

### ✅ Option Recommandée: Console Web Firebase

1. **Accéder à la console Firestore Rules:**
   ```
   https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules
   ```

2. **Copier le fichier local:**
   - Ouvrir : `d:\Projets\Social Impact\social_impact_mvp\firestore.rules`
   - Sélectionner **TOUT** le contenu (Ctrl+A)
   - Copier (Ctrl+C)

3. **Coller dans la console:**
   - Dans l'éditeur web Firebase, **sélectionner tout** (Ctrl+A)
   - **Coller** le nouveau contenu (Ctrl+V)
   - **Vérifier** que les nouvelles règles apparaissent (chercher "user_achievements")

4. **Publier:**
   - Cliquer sur le bouton **"Publish"** (Publier) en haut à droite
   - Confirmer le déploiement
   - Attendre le message de succès

### Alternative: Firebase CLI (Si terminal fonctionne)

Si vous avez accès à un terminal qui affiche les sorties :
```bash
firebase deploy --only firestore:rules --project social-impact-mvp-prod-b6805
```

**Sortie attendue:**
```
=== Deploying to 'social-impact-mvp-prod-b6805'...

i  deploying firestore
i  firestore: checking firestore.rules for compilation errors...
✔  firestore: rules file firestore.rules compiled successfully
i  firestore: uploading rules firestore.rules...
✔  firestore: released rules firestore.rules to cloud.firestore

✔  Deploy complete!
```

---

## ✅ Vérification Après Déploiement

### 1. Vérifier dans la Console
- Ouvrir : https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules
- **Chercher** (Ctrl+F) : `user_achievements`
- **Vérifier** que la section existe avec les bonnes règles
- **Vérifier** la date de dernière publication (doit être récente)

### 2. Tester dans l'Application

**Hot Restart** l'application (pas hot reload) :
```
Appuyer sur "R" dans le terminal Flutter
OU
Ctrl+Shift+F5 dans VS Code
```

**Naviguer vers les onglets problématiques :**
1. **Profile → Portfolio**
   - Vérifier qu'aucune erreur n'apparaît
   - Les statistiques doivent s'afficher

2. **Profile → Achievements**
   - Vérifier qu'aucune erreur n'apparaît
   - Les badges/succès doivent s'afficher

### 3. Logs Attendus (Succès)

**Avant déploiement (ERREURS) :**
```
❌ W/Firestore: Listen for Query... PERMISSION_DENIED
❌ [cloud_firestore/permission-denied]
```

**Après déploiement (SUCCÈS) :**
```
✅ Portfolio data loaded
✅ Activities loaded: X items
✅ Achievements loaded: Y badges
```

**Aucune erreur** `PERMISSION_DENIED` ne doit apparaître.

---

## 🛠️ Autres Corrections Appliquées

### 1. Overflow UI Corrigé
**Fichier:** `lib/features/investments/presentation/widgets/overview/overview_summary_card.dart`

**Problème:**
```
A RenderFlex overflowed by 3.5 pixels on the right.
```

**Solution:**
Remplacé `Flexible(flex: 0, child: Container(...))` par `Container(...)` directement dans le Row.
Le `Expanded` suivant gère maintenant correctement l'espace restant.

### 2. Warnings Non-Critiques (Info)

Ces warnings sont **normaux** en développement :

- **Firebase duplicate-app** : L'app est déjà initialisée (hot restart)
- **App Check token** : App Check non configuré (optionnel en dev)
- **Google API DEVELOPER_ERROR** : Services Play sur émulateur (n'affecte pas Firestore)

---

## 📋 Structure des Collections

### `user_portfolio/{userId}`
```json
{
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "totalInvested": 50000,
  "totalProjects": 3,
  "activeInvestments": 2,
  "averageROI": 12.5,
  "updatedAt": "2026-01-09T10:30:00Z"
}
```

### `user_activities/{userId}/items/{itemId}`
```json
{
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "type": "investment",
  "projectId": "proj123",
  "amount": 10000,
  "timestamp": "2026-01-08T15:20:00Z",
  "description": "Investissement dans Eau Potable Village"
}
```

### `user_achievements/{userId}`
```json
{
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "badges": [
    {
      "id": "first_investment",
      "name": "Premier Investissement",
      "unlockedAt": "2026-01-05T10:00:00Z"
    }
  ],
  "totalBadges": 5,
  "level": 2
}
```

### `investments/{investmentId}`
```json
{
  "investmentId": "inv456",
  "investorId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "projectId": "proj123",
  "amount": 10000,
  "status": "active",
  "createdAt": "2026-01-08T15:20:00Z"
}
```

---

## 🎯 Résultat Attendu

Après déploiement des règles :

1. ✅ **Onglet Portfolio** accessible sans erreur
2. ✅ **Onglet Achievements** accessible sans erreur
3. ✅ **Statistiques d'investissement** affichées correctement
4. ✅ **Liste des investissements** chargée
5. ✅ **Historique des activités** visible
6. ✅ **Badges et succès** visibles
7. ✅ **Aucune erreur PERMISSION_DENIED** dans les logs
8. ✅ **Overflow UI** corrigé (plus de pixels débordants)

---

## 🔧 Dépannage

### Problème 1: Les règles ne se déploient pas via CLI
**Symptôme:** Terminal PowerShell ne montre aucune sortie

**Solutions:**
1. ✅ **Utiliser la console web** (recommandé, plus fiable)
2. Essayer `cmd.exe` : `cmd /c "firebase deploy --only firestore:rules"`
3. Vérifier Firebase CLI : `npm list -g firebase-tools`
4. Réinstaller si nécessaire : `npm install -g firebase-tools`

### Problème 2: Règles déployées mais erreurs persistent
**Symptôme:** Erreurs PERMISSION_DENIED après déploiement

**Solutions:**
1. **Hard restart** l'application (pas hot reload/restart)
2. Vérifier dans la console que les règles sont bien publiées
3. Attendre 1-2 minutes (propagation des règles)
4. Vider le cache de l'app : `flutter clean && flutter run`

### Problème 3: Overflow UI persiste
**Symptôme:** Erreur "RenderFlex overflowed by X pixels"

**Solutions:**
1. Hot reload (appuyer sur `r`)
2. Si persiste, hot restart (appuyer sur `R`)
3. Vérifier que [overview_summary_card.dart](lib/features/investments/presentation/widgets/overview/overview_summary_card.dart#L70) a bien la correction

---

## ✅ Checklist de Déploiement

- [x] Fichier `firestore.rules` modifié localement
- [x] Règles `user_portfolio` ajoutées
- [x] Règles `user_activities` ajoutées  
- [x] Règles `user_achievements` ajoutées
- [x] Overflow UI corrigé
- [ ] **🔴 DÉPLOIEMENT FIREBASE (EN ATTENTE - ACTION REQUISE)**
- [ ] Vérification dans Console Firebase
- [ ] Test dans l'application (Portfolio)
- [ ] Test dans l'application (Achievements)
- [ ] Vérification des logs (aucune erreur)

---

## 📚 Références

- **Fichiers modifiés:**
  - `firestore.rules` (lignes 520-600)
  - `lib/features/investments/presentation/widgets/overview/overview_summary_card.dart` (ligne 70)
- **Collections concernées:** `user_portfolio`, `user_activities`, `user_achievements`, `investments`
- **User ID de test:** `5GqHzQJ4wrRawS6z2GY1opoSb543` (ericvekout2022@gmail.com)
- **Console Firebase:** https://console.firebase.google.com/project/social-impact-mvp-prod-b6805

---

**Statut Final:** 🔴 **ACTION REQUISE : Déployer via Console Web Firebase**

**Prochaine étape:** Copier-coller [firestore.rules](firestore.rules) dans https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules et cliquer sur **Publish**.
