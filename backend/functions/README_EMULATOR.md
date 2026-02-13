# Guide de Test avec l'Émulateur Firebase Local

Ce guide explique comment tester la fonction `migrateUserDocument` localement sans avoir besoin de facturation Firebase.

## Prérequis

- Node.js 18+ installé
- Firebase CLI installé (`npm install -g firebase-tools`)
- Toutes les dépendances installées (`npm install` dans `backend/functions`)

## Étape 1: Démarrer l'Émulateur Firebase

Ouvre un terminal dans le dossier `backend/functions` et exécute :

```bash
npm run emulator
```

Cela va démarrer :
- **Firestore Emulator** sur `localhost:8081`
- **Auth Emulator** sur `localhost:9100`
- **Functions Emulator** sur `localhost:5002`
- **Emulator UI** sur `http://localhost:4001` (interface web pour visualiser les données)

⚠️ **Important**: Garde ce terminal ouvert pendant les tests.

## Étape 2: Tester la Migration

Dans un **nouveau terminal** (toujours dans `backend/functions`), tu peux exécuter les tests :

### Test avec un utilisateur spécifique (mode dry-run par défaut)

```bash
npm run test:migrate
```

Cela va :
1. Créer un utilisateur de test avec l'ancien format (`role: 'organization'`)
2. Afficher les données avant migration
3. Simuler la migration (sans modifier les données en mode dry-run)
4. Afficher les données après migration

### Test avec un utilisateur spécifique (appliquer réellement la migration)

```bash
npm run test:migrate:apply
```

Cela applique réellement la migration (pas de dry-run).

### Test avec un utilisateur personnalisé

```bash
npm run test:migrate single mon-user-id true
```

Arguments :
- `single` : mode test d'un seul utilisateur
- `mon-user-id` : ID de l'utilisateur à tester
- `true` : dry-run (true) ou `false` pour appliquer

### Migration de tous les utilisateurs

```bash
npm run test:migrate:all
```

Cela migre tous les utilisateurs qui ont l'ancien format (`role`) mais pas le nouveau format (`userType`).

## Étape 3: Vérifier les Résultats

### Via l'Emulator UI

1. Ouvre ton navigateur sur `http://localhost:4001`
2. Va dans l'onglet **Firestore**
3. Vérifie la collection `users`
4. Tu devrais voir les utilisateurs avec le nouveau format :
   - `userType` au lieu de `role`
   - `permissions` (array)
   - `accountStatus`
   - `profileComplete`
   - `displayName`

### Via le Terminal

Le script affiche :
- Les données **avant** migration
- Les données **après** migration
- Le résultat de la migration (champs ajoutés/supprimés)

## Exemple de Sortie

```
🚀 Script de test pour migrateUserDocument
──────────────────────────────────────────────────
Mode: single
Dry Run: true
Émulateur Firestore: localhost:8080

🧪 Test de migration pour un utilisateur spécifique
User ID: test-user-001
Dry Run: true
──────────────────────────────────────────────────
✅ Utilisateur de test créé avec l'ancien format (role)

📋 Données AVANT migration:
{
  "email": "test-test-user-001@example.com",
  "firstName": "Test",
  "lastName": "User",
  "role": "organization",
  "accountStatus": "active"
}

🔄 Exécution de la migration...

📋 Données APRÈS migration:
{
  "email": "test-test-user-001@example.com",
  "firstName": "Test",
  "lastName": "User",
  "userType": "creator",
  "permissions": ["CREATE_PROJECT", "EDIT_PROJECT", "DELETE_PROJECT", "CONTRIBUTE", "COMMENT"],
  "accountStatus": "active",
  "profileComplete": true,
  "displayName": "Test User",
  "uid": "test-user-001"
}

📊 Résultat de la migration:
{
  "success": true,
  "userId": "test-user-001",
  "changes": {
    "oldRole": "organization",
    "newUserType": "creator",
    "permissions": ["CREATE_PROJECT", "EDIT_PROJECT", "DELETE_PROJECT", "CONTRIBUTE", "COMMENT"],
    "fieldsAdded": ["userType", "permissions", "profileComplete", "displayName", "uid"],
    "fieldsRemoved": ["role"]
  },
  "dryRun": true
}

✅ Test terminé avec succès!
```

## Mapping des Rôles

| Ancien `role` | Nouveau `userType` | Permissions par défaut |
|--------------|-------------------|------------------------|
| `organization` | `creator` | CREATE_PROJECT, EDIT_PROJECT, DELETE_PROJECT, CONTRIBUTE, COMMENT |
| `investor` | `contributor` | CONTRIBUTE, COMMENT |
| `contributor` | `contributor` | CONTRIBUTE, COMMENT |
| `auditor` | `auditor` | AUDIT, COMMENT |
| `admin` | `admin` | Toutes les permissions |
| Autre | `contributor` | CONTRIBUTE, COMMENT |

## Dépannage

### Erreur: "FIRESTORE_EMULATOR_HOST not set"

Assure-toi que l'émulateur est démarré avant d'exécuter les tests.

### Erreur: "Cannot find module"

Exécute `npm install` dans `backend/functions`.

### Les données ne changent pas

Vérifie que tu n'es pas en mode dry-run. Utilise `false` comme dernier argument pour appliquer la migration.

### L'émulateur ne démarre pas

Vérifie que les ports 8080, 9099, 5001, et 4000 ne sont pas déjà utilisés par d'autres applications.

## Prochaines Étapes

Une fois que tu as testé localement et que tout fonctionne :

1. Active la facturation Firebase sur ton projet
2. Déploie la fonction : `firebase deploy --only functions:migrateUserDocument`
3. Appelle la fonction depuis le frontend ou via Firebase CLI

