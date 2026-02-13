# 🔧 MODIFICATIONS BACKEND REQUISES

## Problème Identifié

**Date**: 2025-12-15
**Contexte**: L'utilisateur (ericvekout2022@gmail.com / ID: 5GqHzQJ4wrRawS6z2GY1opoSb543) ne peut pas voir le bouton "Create Project" car son rôle n'est pas "organization".

**État actuel**:
- ✅ L'utilisateur existe dans Firebase Production
- ❌ Les émulateurs Firebase locaux sont vides (pas de données)
- ❌ Le rôle utilisateur n'est pas "organization"
- ❌ Le bouton FloatingActionButton "Create Project" ne s'affiche que pour le rôle "organization"

---

## Solution Backend Requise

### ÉTAPE 1: Modifier le rôle utilisateur dans Firebase Console

#### Actions à effectuer:

1. **Accéder à la Firebase Console**
   - URL: https://console.firebase.google.com/
   - Sélectionner le projet: **social-impact-mvp-prod-b6805**

2. **Naviguer vers Firestore Database**
   - Menu latéral gauche → **Firestore Database**
   - Ou URL directe: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore

3. **Localiser le document utilisateur**
   - Collection: **users**
   - Document ID: **5GqHzQJ4wrRawS6z2GY1opoSb543**

   Chemin complet: `users/5GqHzQJ4wrRawS6z2GY1opoSb543`

4. **Modifier le champ "role"**
   - Trouver le champ: **role** (type: string)
   - Valeur actuelle: probablement "investor" ou "contributor"
   - **Nouvelle valeur: `organization`**

5. **Sauvegarder les modifications**
   - Cliquer sur le bouton "Update" ou "Save"
   - Vérifier que la modification est bien enregistrée

#### Capture d'écran de référence:

```
Collection: users
└── Document: 5GqHzQJ4wrRawS6z2GY1opoSb543
    ├── email: "ericvekout2022@gmail.com"
    ├── firstName: "Eric"
    ├── lastName: "Vekout"
    ├── role: "organization"  ← MODIFIER CE CHAMP
    ├── createdAt: Timestamp
    └── updatedAt: Timestamp
```

---

### ÉTAPE 2: Vérifier les règles de sécurité Firestore

#### Fichier: `/firestore.rules`

Vérifier que les règles permettent:
1. ✅ La lecture des documents utilisateur par l'utilisateur lui-même
2. ✅ La mise à jour du rôle (si nécessaire)

**Règles actuelles à vérifier**:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Règle pour les utilisateurs
    match /users/{userId} {
      // Permettre la lecture de son propre profil
      allow read: if request.auth != null && request.auth.uid == userId;

      // Permettre la mise à jour de certains champs (pas le rôle normalement)
      allow update: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

⚠️ **Note importante**: Le champ `role` ne devrait normalement PAS être modifiable par l'utilisateur lui-même pour des raisons de sécurité. La modification doit être faite:
- Via la Console Firebase (admin)
- Via une Cloud Function sécurisée
- Via le backend administrateur

---

### ÉTAPE 3: Redémarrer l'application Flutter

Une fois le rôle modifié dans Firestore:

1. Dans le terminal PowerShell où `flutter run` s'exécute
2. Taper **`R`** (majuscule) pour un hot restart complet
3. Vérifier les logs pour confirmer:
   ```
   🔧 Using Firebase Production services for development
   ```

4. Vérifier sur la page Dashboard que le **FloatingActionButton "Create Project"** apparaît en bas à droite

---

## Rôles Disponibles

| Rôle | Description | Bouton Create Project visible? |
|------|-------------|-------------------------------|
| `investor` | Investisseur/Contributeur | ❌ Non |
| `organization` | Créateur de projets | ✅ **OUI** |
| `auditor` | Auditeur | ❌ Non |
| `admin` | Administrateur | ❌ Non (pour l'instant) |

---

## Vérification Post-Modification

### Checklist:

- [ ] Rôle modifié dans Firestore: `users/5GqHzQJ4wrRawS6z2GY1opoSb543/role = "organization"`
- [ ] App Flutter redémarrée avec `R`
- [ ] Logs confirment: "Using Firebase Production"
- [ ] Bouton FloatingActionButton "Create Project" visible sur Dashboard
- [ ] Cliquer sur le bouton navigue vers `/projects/create`

---

## Configuration Frontend Associée

### Fichier: `/lib/main.dart` (ligne 43)

La configuration a été modifiée pour **désactiver les émulateurs** et utiliser Firebase Production:

```dart
if (kDebugMode && false) { // false = utilise Production
```

**Raison**: Les émulateurs locaux sont vides. Les données utilisateur existent uniquement dans Firebase Production.

---

## Alternative: Utiliser les Émulateurs (Avancé)

Si vous souhaitez utiliser les émulateurs Firebase locaux pour le développement:

### Actions requises:

1. **Créer l'utilisateur dans l'émulateur Auth**
   - URL: http://localhost:4000/auth
   - Cliquer "Add user"
   - Email: test@test.com (ou autre)
   - Password: password123
   - Copier l'UID généré

2. **Créer le document utilisateur dans l'émulateur Firestore**
   - URL: http://localhost:4000/firestore
   - Collection: `users`
   - Document ID: [UID de l'étape 1]
   - Champs:
     ```json
     {
       "email": "test@test.com",
       "firstName": "Test",
       "lastName": "User",
       "role": "organization",
       "createdAt": [Timestamp Now],
       "updatedAt": [Timestamp Now]
     }
     ```

3. **Réactiver les émulateurs dans main.dart**
   - Ligne 43: `&& false` → `&& true`

4. **Se reconnecter dans l'app**
   - Se déconnecter du compte Google
   - Se connecter avec test@test.com / password123

⚠️ **Complexité élevée** - Cette approche est plus complexe et recommandée uniquement pour le développement avancé.

---

## Support

Si le problème persiste après ces modifications:

1. Vérifier dans la Console Firebase que le rôle a bien été modifié
2. Vérifier dans les logs Flutter qu'il n'y a pas d'erreur Firestore
3. Vérifier que l'utilisateur est bien authentifié (vérifier authStateProvider)
4. Fournir les logs complets pour diagnostic

---

**Document créé le**: 2025-12-15
**Dernière mise à jour**: 2025-12-15
