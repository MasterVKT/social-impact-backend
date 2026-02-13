# 🤖 GUIDE DE MIGRATION AUTOMATIQUE - DOCUMENT UTILISATEUR

**Date**: 2025-12-17
**Script**: Cloud Function `migrateUserDocument`

---

## 🎯 CE QUE CE SCRIPT FAIT

Migre automatiquement votre document utilisateur de l'ancien modèle vers le nouveau :

**Supprime**:
- ❌ `role` (ancien champ)

**Ajoute/Met à jour**:
- ✅ `userType` (remplace "role")
- ✅ `permissions` (nouveau système de permissions)
- ✅ `accountStatus` (si manquant)
- ✅ `profileComplete` (si manquant)
- ✅ `displayName` (si manquant)
- ✅ `uid` (si manquant)

---

## 📦 ÉTAPE 1: DÉPLOYER LA FONCTION

### Option A: Déployer SEULEMENT cette fonction (RAPIDE)

```bash
# Depuis la racine du projet
cd "D:\Projets\Social Impact\senv\SocialImpact"

# Déployer uniquement la fonction de migration
firebase deploy --only functions:migrateUserDocument
```

**Durée**: ~2 minutes

### Option B: Déployer toutes les fonctions

```bash
firebase deploy --only functions
```

**Durée**: ~5-10 minutes (si toutes les fonctions doivent être déployées)

### Résultat attendu

```
✔  functions[migrateUserDocument(us-central1)] Successful create operation.
Function URL (migrateUserDocument): https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/migrateUserDocument
✔  Deploy complete!
```

---

## 🚀 ÉTAPE 2: EXÉCUTER LA MIGRATION

### Méthode 1: Depuis Firebase CLI (RECOMMANDÉ)

**Migrer votre propre utilisateur**:

```bash
firebase functions:call migrateUserDocument \
  --data '{}'
```

**Simulation (ne modifie rien) - pour tester**:

```bash
firebase functions:call migrateUserDocument \
  --data '{"dryRun": true}'
```

**Migrer un utilisateur spécifique (admin only)**:

```bash
firebase functions:call migrateUserDocument \
  --data '{"userId": "5GqHzQJ4wrRawS6z2GY1opoSb543"}'
```

**Migrer TOUS les utilisateurs (admin only)**:

```bash
firebase functions:call migrateUserDocument \
  --data '{"migrateAll": true}'
```

### Méthode 2: Depuis un Script Node.js

Créez un fichier `migrate.js`:

```javascript
const admin = require('firebase-admin');

// Initialiser Firebase Admin
const serviceAccount = require('./path/to/serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const functions = admin.functions();

// Appeler la fonction
functions.httpsCallable('migrateUserDocument')({
  // userId: '5GqHzQJ4wrRawS6z2GY1opoSb543',  // Optionnel
  dryRun: false
})
.then((result) => {
  console.log('Migration result:', JSON.stringify(result.data, null, 2));
  process.exit(0);
})
.catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
```

**Exécuter**:
```bash
node migrate.js
```

### Méthode 3: Depuis Flutter/Dart

```dart
import 'package:cloud_functions/cloud_functions.dart';

Future<void> migrateMyUserDocument() async {
  try {
    final functions = FirebaseFunctions.instance;

    // Mode simulation d'abord (pour tester)
    final testResult = await functions.httpsCallable('migrateUserDocument').call({
      'dryRun': true,
    });

    print('Simulation result: ${testResult.data}');

    // Si OK, migration réelle
    final result = await functions.httpsCallable('migrateUserDocument').call({
      'dryRun': false,
    });

    print('Migration completed: ${result.data}');

    if (result.data['success']) {
      print('✅ Migration successful!');
      print('Changes: ${result.data['changes']}');
    } else {
      print('❌ Migration failed: ${result.data['error']}');
    }

  } catch (e) {
    print('Error calling migration function: $e');
  }
}
```

**Appeler depuis un bouton**:
```dart
ElevatedButton(
  onPressed: () async {
    await migrateMyUserDocument();
    // Rafraîchir l'interface
    setState(() {});
  },
  child: Text('Migrer mon profil'),
)
```

---

## 📊 RÉSULTAT DE LA MIGRATION

### Résultat Réussi

```json
{
  "success": true,
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "changes": {
    "oldRole": "investor",
    "newUserType": "creator",
    "permissions": [
      "CREATE_PROJECT",
      "EDIT_PROJECT",
      "DELETE_PROJECT",
      "CONTRIBUTE",
      "COMMENT"
    ],
    "fieldsAdded": [
      "userType",
      "permissions",
      "accountStatus",
      "profileComplete",
      "displayName",
      "uid"
    ],
    "fieldsRemoved": [
      "role"
    ]
  }
}
```

### Résultat avec Erreur

```json
{
  "success": false,
  "userId": "5GqHzQJ4wrRawS6z2GY1opoSb543",
  "changes": {
    "newUserType": "",
    "permissions": [],
    "fieldsAdded": [],
    "fieldsRemoved": []
  },
  "error": "User document not found"
}
```

---

## 🔍 VÉRIFICATION POST-MIGRATION

### 1. Dans Firebase Console

1. Aller sur: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore
2. Collection: `users`
3. Document: `5GqHzQJ4wrRawS6z2GY1opoSb543`

**Vérifier que**:
- ❌ Le champ `role` n'existe plus
- ✅ Le champ `userType` = `"creator"`
- ✅ Le champ `permissions` = `["CREATE_PROJECT", ...]`
- ✅ Le champ `accountStatus` = `"active"`
- ✅ Le champ `profileComplete` = `true`
- ✅ Le champ `displayName` existe

### 2. Dans l'Application Flutter

**Redémarrer l'application**:
```bash
flutter run
```

**Vérifier que**:
- ✅ Le bouton "Create Project" apparaît
- ✅ Cliquer sur "Create Project" navigue vers le formulaire
- ✅ La création de projet fonctionne

---

## ⚙️ MAPPING AUTOMATIQUE

Le script mappe automatiquement les anciennes valeurs vers les nouvelles :

| Ancien "role" | Nouveau "userType" | Permissions par défaut |
|---------------|-------------------|----------------------|
| `"investor"` | `"contributor"` | `["CONTRIBUTE", "COMMENT"]` |
| `"organization"` | `"creator"` | `["CREATE_PROJECT", "EDIT_PROJECT", "DELETE_PROJECT", "CONTRIBUTE", "COMMENT"]` |
| `"auditor"` | `"auditor"` | `["AUDIT", "COMMENT"]` |
| `"admin"` | `"admin"` | Toutes les permissions |
| *Non défini* | `"contributor"` | `["COMMENT"]` |

---

## 🛡️ SÉCURITÉ

### Qui Peut Exécuter Cette Fonction ?

**Utilisateur authentifié**:
- ✅ Peut migrer SON PROPRE document utilisateur
- ❌ Ne peut PAS migrer les autres utilisateurs

**Admin**:
- ✅ Peut migrer N'IMPORTE QUEL utilisateur
- ✅ Peut migrer TOUS les utilisateurs en une fois (`migrateAll: true`)

### Mode Dry Run (Simulation)

**Testez TOUJOURS en mode dry run d'abord** :

```bash
firebase functions:call migrateUserDocument \
  --data '{"dryRun": true}'
```

**Avantages**:
- ✅ Ne modifie rien dans la base de données
- ✅ Retourne exactement ce qui SERAIT modifié
- ✅ Permet de vérifier le résultat avant d'exécuter

---

## 🚨 DÉPANNAGE

### Erreur: "Authentication required"

**Cause**: Vous n'êtes pas authentifié.

**Solution**:
```bash
firebase login
```

### Erreur: "Permission denied"

**Cause**: Vous essayez de migrer un autre utilisateur sans être admin.

**Solution**:
- Migrez seulement votre propre utilisateur (sans `userId`)
- OU demandez à un admin de faire la migration

### Erreur: "User document not found"

**Cause**: L'ID utilisateur est incorrect ou le document n'existe pas.

**Solution**:
- Vérifiez l'ID utilisateur dans Firebase Console
- Vérifiez que le document existe dans la collection `users`

### La migration réussit mais rien ne change

**Causes possibles**:
1. Le document était déjà au bon format
2. Mode `dryRun: true` était activé

**Solution**:
- Vérifiez le résultat retourné par la fonction
- Si `fieldsAdded` et `fieldsRemoved` sont vides → Déjà migré

---

## 📋 CHECKLIST COMPLÈTE

### Avant la Migration

- [ ] Firebase CLI installé (`firebase --version`)
- [ ] Connecté à Firebase (`firebase login`)
- [ ] Dans le bon répertoire projet
- [ ] Fonction déployée (`firebase deploy --only functions:migrateUserDocument`)

### Pendant la Migration

- [ ] Test en mode dry run d'abord
- [ ] Vérification du résultat de simulation
- [ ] Exécution en mode réel
- [ ] Sauvegarde du résultat (copier le JSON retourné)

### Après la Migration

- [ ] Vérification dans Firebase Console
- [ ] Vérification dans l'application Flutter
- [ ] Test de création de projet
- [ ] Tout fonctionne ✅

---

## 🎯 EXEMPLE COMPLET - ÉTAPE PAR ÉTAPE

### Scénario: Migrer votre propre utilisateur

```bash
# 1. Aller dans le projet
cd "D:\Projets\Social Impact\senv\SocialImpact"

# 2. Se connecter à Firebase (si pas déjà fait)
firebase login

# 3. Déployer la fonction
firebase deploy --only functions:migrateUserDocument

# Attendre que le déploiement soit terminé...

# 4. TEST en mode simulation
firebase functions:call migrateUserDocument --data '{"dryRun": true}'

# Vérifier le résultat - devrait afficher les changements prévus

# 5. Migration RÉELLE
firebase functions:call migrateUserDocument --data '{}'

# 6. Vérifier le résultat
# success: true
# changes: { ... }

# 7. Ouvrir Firebase Console et vérifier le document utilisateur

# 8. Redémarrer l'app Flutter
flutter run

# 9. Tester la création de projet
# Cliquer sur "Create Project" → Devrait fonctionner ✅
```

---

## ⏱️ TEMPS ESTIMÉ

| Étape | Durée |
|-------|-------|
| Déploiement de la fonction | 2 min |
| Test dry run | 10 sec |
| Migration réelle | 10 sec |
| Vérification | 2 min |
| **TOTAL** | **~5 minutes** |

---

## 💡 CONSEILS

1. **Toujours tester en dry run d'abord** ✅
2. **Sauvegarder le résultat de la migration** (copier le JSON)
3. **Vérifier dans Firebase Console après migration**
4. **Redémarrer l'app Flutter** pour voir les changements
5. **Ne pas exécuter plusieurs fois** (la fonction est idempotente mais inutile)

---

## ❓ FAQ

**Q: Que se passe-t-il si j'exécute la migration plusieurs fois ?**
R: Aucun problème ! La fonction est idempotente - si les champs existent déjà, ils ne seront pas modifiés.

**Q: Puis-je annuler la migration ?**
R: Non, mais vous pouvez manuellement restaurer l'ancien champ `role` dans Firebase Console si nécessaire.

**Q: La migration affecte-t-elle les autres utilisateurs ?**
R: Non, sauf si vous utilisez `migrateAll: true` (admin only).

**Q: Combien de temps les changements prennent-ils effet ?**
R: Immédiat ! Mais redémarrez l'app Flutter pour voir les changements.

---

**Document créé le**: 2025-12-17
**Auteur**: Claude Code
**Version**: 1.0
