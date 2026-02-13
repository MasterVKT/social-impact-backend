# 🔧 GUIDE DE CONFIGURATION MANUELLE - ÉTAPE PAR ÉTAPE

**Date de création**: 2025-12-17
**Projet**: Social Impact MVP Production
**Statut**: Actions requises pour résoudre les erreurs Storage et Stripe

---

## 📋 VUE D'ENSEMBLE

Ce guide vous accompagne pas à pas pour effectuer toutes les configurations manuelles nécessaires pour résoudre les problèmes identifiés.

**Durée estimée**: 30-45 minutes
**Prérequis**:
- Accès administrateur au projet Firebase
- Accès au projet Google Cloud Console
- Accès au code source de l'application Flutter

---

## 🎯 CONFIGURATION 1: PERMISSIONS IAM FIREBASE STORAGE (CRITIQUE)

**Problème**: `StorageException: Code: -13000 HttpResult: 412 - A required service account is missing necessary permissions`
**Impact**: Impossible d'uploader des images de projets
**Priorité**: 🔴 CRITIQUE - Bloque la création de projets avec images

### Étape 1.1: Accéder à Google Cloud Console IAM

1. **Ouvrir Google Cloud Console IAM**
   - URL directe: https://console.cloud.google.com/iam-admin/iam?project=social-impact-mvp-prod-b6805
   - OU:
     - Aller sur https://console.cloud.google.com/
     - En haut, sélectionner le projet: **"social-impact-mvp-prod-b6805"**
     - Menu hamburger (☰) en haut à gauche
     - Cliquer sur **"IAM & Admin"** → **"IAM"**

2. **Vérifier que vous êtes sur le bon projet**
   - En haut de la page, vous devriez voir: **"social-impact-mvp-prod-b6805"**
   - Si ce n'est pas le cas, cliquez sur le nom du projet et sélectionnez le bon

### Étape 1.2: Localiser le Service Account

1. **Trouver le service account Firebase**
   - Sur la page IAM, vous verrez une liste de comptes (principals)
   - Cherchez la ligne avec l'email: **`social-impact-mvp-prod-b6805@appspot.gserviceaccount.com`**
   - Type: "Service Account"
   - Nom affiché: "App Engine default service account"

2. **Identifier visuellement le service account**
   ```
   Principal                                                      | Role
   ================================================================
   social-impact-mvp-prod-b6805@appspot.gserviceaccount.com      | Editor
   (App Engine default service account)                          | Firebase Admin
   ```

   **⚠️ Si vous ne trouvez pas ce service account:**
   - Utilisez la barre de recherche en haut: cherchez "appspot"
   - Vérifiez que le filtre "View by Principals" est sélectionné (pas "View by Roles")

### Étape 1.3: Ajouter le Rôle Storage Admin

1. **Ouvrir le panneau d'édition**
   - À droite du service account `social-impact-mvp-prod-b6805@appspot.gserviceaccount.com`
   - Cliquez sur l'icône **crayon (✏️)** ou le bouton **"Edit principal"**
   - Un panneau latéral s'ouvre à droite

2. **Vérifier les rôles actuels**
   - Dans le panneau, vous verrez une section "Assign roles"
   - Normalement, vous devriez voir au minimum:
     - ✅ `Editor`
     - ✅ `Firebase Admin` (ou similar)

3. **Ajouter le nouveau rôle**
   - Cliquez sur **"+ ADD ANOTHER ROLE"** en bas de la liste
   - Un nouveau champ apparaît avec un menu déroulant

4. **Sélectionner Storage Admin**
   - Dans le nouveau champ, commencez à taper: **"Storage Admin"**
   - Sélectionnez: **"Storage Admin"** (roles/storage.admin)

   **OU si vous voulez des permissions plus restreintes:**
   - Tapez: **"Storage Object Admin"**
   - Sélectionnez: **"Storage Object Admin"** (roles/storage.objectAdmin)

   **Différence**:
   - `Storage Admin`: Permissions complètes sur buckets et objets (RECOMMANDÉ)
   - `Storage Object Admin`: Permissions sur objets seulement, pas sur buckets

5. **Sauvegarder les modifications**
   - Cliquez sur le bouton **"SAVE"** en bas du panneau
   - Attendez la confirmation (bandeau vert en haut)

### Étape 1.4: Vérifier les Permissions

1. **Confirmer l'ajout du rôle**
   - Retournez à la liste IAM
   - Trouvez à nouveau le service account `social-impact-mvp-prod-b6805@appspot.gserviceaccount.com`
   - Dans la colonne "Role", vous devriez maintenant voir:
     ```
     Editor
     Firebase Admin
     Storage Admin    ← NOUVEAU
     ```

2. **Capture d'écran recommandée**
   - Prenez une capture d'écran de cette ligne pour vos dossiers
   - Utile pour l'audit et le troubleshooting futur

### Étape 1.5: Attendre la Propagation des Permissions

⏰ **IMPORTANT**: Les changements de permissions IAM prennent du temps à se propager.

1. **Durée de propagation**
   - Minimum: 2-3 minutes
   - Recommandé d'attendre: **5-10 minutes**
   - Maximum observé: 15 minutes

2. **Pendant l'attente**
   - ☕ Prenez un café
   - 📝 Continuez avec les autres configurations de ce guide
   - ❌ NE PAS retester immédiatement

3. **Indicateurs que la propagation est terminée**
   - Aucun indicateur visuel dans la console
   - Le seul moyen de savoir est de tester l'upload

### Étape 1.6: Tester les Permissions Storage

**Après avoir attendu 5-10 minutes**, testez l'upload:

1. **Dans l'application Flutter**
   - Lancez l'application: `flutter run`
   - Connectez-vous avec le compte: `ericvekout2022@gmail.com`
   - Cliquez sur le bouton "Create Project"

2. **Tester l'upload d'image**
   - Remplissez le formulaire de création de projet
   - **Ajoutez une image de couverture** (important!)
   - Cliquez sur "Create Project"

3. **Résultats attendus**

   **✅ SUCCÈS - Permissions correctes**:
   ```
   [log] 🔧 Compressing image: 96KB
   [log] ✅ Image compressed: 96KB → 17KB (82% reduction)
   [log] 📤 Uploading to Storage: temp/5GqHzQJ4wrRawS6z2GY1opoSb543/...
   [log] ✅ Image uploaded successfully
   [log] 🎉 Project created with ID: JfKCqBpSYJCMnOLvP2sT
   ```

   **❌ ÉCHEC - Permissions toujours manquantes**:
   ```
   [ERROR] StorageException: Code: -13000 HttpResult: 412
   [ERROR] A required service account is missing necessary permissions
   ```

4. **Si l'erreur persiste après 10 minutes**
   - Vérifiez que vous avez bien ajouté le rôle au BON service account
   - Vérifiez que le rôle est bien `Storage Admin` (pas autre chose)
   - Essayez de supprimer et ré-ajouter le rôle
   - Contactez le support Firebase si le problème persiste

---

## 🎨 CONFIGURATION 2: THÈME ANDROID POUR STRIPE (NON CRITIQUE)

**Problème**: `flutter_stripe initialization failed - Your theme isn't set to use Theme.MaterialComponents`
**Impact**: Stripe ne s'initialise pas (mais n'empêche pas la création de projets)
**Priorité**: 🟡 MOYENNE - Requis seulement si vous utilisez Stripe pour les paiements

### Étape 2.1: Localiser le Fichier styles.xml

1. **Structure du projet**
   ```
   votre-projet/
   └── android/
       └── app/
           └── src/
               └── main/
                   └── res/
                       └── values/
                           └── styles.xml    ← FICHIER À MODIFIER
   ```

2. **Chemin absolu probable**
   - Basé sur votre configuration:
   - `D:\Projets\Social Impact\social_impact_mvp\android\app\src\main\res\values\styles.xml`

3. **Vérifier si le fichier existe**
   - Ouvrez votre IDE (VS Code, Android Studio, etc.)
   - Naviguez vers le dossier `android/app/src/main/res/values/`
   - Cherchez le fichier `styles.xml`

4. **Si le fichier N'EXISTE PAS**
   - Créez-le dans le dossier `values/`
   - Passez directement à l'Étape 2.3

### Étape 2.2: Lire le Contenu Actuel (si fichier existe)

1. **Ouvrir styles.xml**
   - Double-cliquez sur le fichier dans votre IDE

2. **Contenu typique actuel** (AVANT modification):
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <resources>
       <!-- Base application theme. -->
       <style name="LaunchTheme" parent="Theme.AppCompat.Light.NoActionBar">
           <!-- Customize your theme here. -->
       </style>

       <!-- Theme applied to the Android Window while the process is starting -->
       <style name="NormalTheme" parent="Theme.AppCompat.Light.NoActionBar">
           <item name="android:windowBackground">?android:colorBackground</item>
       </style>
   </resources>
   ```

   **⚠️ PROBLÈME**:
   - `parent="Theme.AppCompat.Light.NoActionBar"`
   - Stripe nécessite `Theme.MaterialComponents`

### Étape 2.3: Modifier le Fichier styles.xml

1. **Remplacer le contenu complet** par:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <resources>
       <!-- Base application theme. -->
       <!-- MODIFIÉ: Theme.AppCompat → Theme.MaterialComponents pour Stripe -->
       <style name="LaunchTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
           <!-- Customize your theme here. -->
           <item name="colorPrimary">#2196F3</item>
           <item name="colorPrimaryDark">#1976D2</item>
           <item name="colorAccent">#FF4081</item>
       </style>

       <!-- Theme applied to the Android Window while the process is starting -->
       <!-- MODIFIÉ: Theme.AppCompat → Theme.MaterialComponents pour Stripe -->
       <style name="NormalTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
           <item name="android:windowBackground">?android:colorBackground</item>
       </style>
   </resources>
   ```

2. **Changements effectués**:
   - ❌ **AVANT**: `parent="Theme.AppCompat.Light.NoActionBar"`
   - ✅ **APRÈS**: `parent="Theme.MaterialComponents.Light.NoActionBar"`
   - ➕ **AJOUTÉ**: Items de couleur pour Material Components

### Étape 2.4: Vérifier les Dépendances Gradle

**Important**: Material Components nécessite une dépendance Gradle.

1. **Ouvrir le fichier build.gradle**
   - Chemin: `android/app/build.gradle`

2. **Chercher la section dependencies**
   - Scroll jusqu'à la section `dependencies { ... }`

3. **Vérifier la présence de Material Components**
   ```gradle
   dependencies {
       // ... autres dépendances ...
       implementation 'com.google.android.material:material:1.9.0'
       // ... autres dépendances ...
   }
   ```

4. **Si la ligne N'EXISTE PAS, l'ajouter**:
   ```gradle
   dependencies {
       implementation "org.jetbrains.kotlin:kotlin-stdlib-jdk7:$kotlin_version"
       implementation 'com.google.android.material:material:1.9.0'  // ← AJOUTER CETTE LIGNE
       // ... autres dépendances ...
   }
   ```

### Étape 2.5: Nettoyer et Rebuilder l'Application

1. **Nettoyer le build Android**
   ```bash
   # Dans le terminal, à la racine du projet Flutter
   cd android
   ./gradlew clean
   cd ..
   ```

2. **Supprimer les caches Flutter**
   ```bash
   flutter clean
   ```

3. **Récupérer les dépendances**
   ```bash
   flutter pub get
   ```

4. **Rebuilder l'application**
   ```bash
   flutter run
   ```

### Étape 2.6: Vérifier l'Initialisation Stripe

1. **Chercher dans les logs au démarrage**
   ```
   [log] Initializing Stripe...
   ✅ [log] Stripe initialized successfully
   ```

2. **Si erreur persiste**:
   ```
   ❌ [ERROR] flutter_stripe initialization failed
   ❌ [ERROR] Your theme isn't set to use Theme.MaterialComponents
   ```

   **Actions de dépannage**:
   - Vérifiez que vous avez bien modifié LES DEUX styles (LaunchTheme ET NormalTheme)
   - Vérifiez que la dépendance Material est bien ajoutée dans build.gradle
   - Faites un `flutter clean` puis `flutter run` complet
   - Redémarrez Android Studio / VS Code

---

## 👤 CONFIGURATION 3: DOCUMENT UTILISATEUR FIREBASE

**Problème**: Champs utilisateur manquants pour création de projets
**Impact**: Vérifications backend échouent
**Priorité**: 🔴 CRITIQUE - Bloque la création de projets

### Étape 3.1: Accéder à Firestore Database

1. **Ouvrir Firebase Console Firestore**
   - URL directe: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore
   - OU:
     - Aller sur https://console.firebase.google.com/
     - Sélectionner le projet: **"social-impact-mvp-prod-b6805"**
     - Menu latéral gauche: **"Firestore Database"**

2. **Vérifier le mode de la base de données**
   - Vous devriez voir l'onglet **"Data"** sélectionné
   - Si vous voyez "Get started", la base n'est pas encore créée (contactez l'admin)

### Étape 3.2: Naviguer vers le Document Utilisateur

1. **Trouver la collection users**
   - Dans le panneau de gauche, vous verrez la liste des collections
   - Cliquez sur la collection: **`users`**

2. **Trouver le document spécifique**
   - Dans la liste des documents, cherchez:
   - **Document ID**: `5GqHzQJ4wrRawS6z2GY1opoSb543`
   - **Email**: `ericvekout2022@gmail.com`

3. **Structure actuelle visible**:
   ```
   Collection: users
   └── Document: 5GqHzQJ4wrRawS6z2GY1opoSb543
       ├── email: "ericvekout2022@gmail.com"
       ├── firstName: "Eric"
       ├── lastName: "Vekout"
       ├── role: "investor"              ← ANCIEN MODÈLE
       ├── createdAt: Timestamp(...)
       └── updatedAt: Timestamp(...)
   ```

### Étape 3.3: Supprimer le Champ Obsolète "role"

**⚠️ IMPORTANT**: L'ancien champ `role` doit être supprimé.

1. **Localiser le champ "role"**
   - Dans le document, cherchez la ligne avec le champ: `role`
   - Valeur actuelle: probablement `"investor"` ou autre

2. **Supprimer le champ**
   - Passez la souris sur la ligne du champ `role`
   - Cliquez sur l'icône **poubelle (🗑️)** à droite
   - Confirmez la suppression dans la popup

3. **Vérifier la suppression**
   - Le champ `role` ne doit plus apparaître dans le document

### Étape 3.4: Ajouter les Nouveaux Champs Obligatoires

**Format**: Tous les champs doivent être ajoutés exactement comme spécifié.

#### Champ 1: userType

1. **Cliquer sur "Add field"** en bas du document
2. **Remplir**:
   - **Field**: `userType`
   - **Type**: Sélectionner **"string"** dans le menu déroulant
   - **Value**: `creator`
3. **Cliquer sur "Add"**

#### Champ 2: accountStatus

1. **Cliquer sur "Add field"**
2. **Remplir**:
   - **Field**: `accountStatus`
   - **Type**: **"string"**
   - **Value**: `active`
3. **Cliquer sur "Add"**

#### Champ 3: permissions

1. **Cliquer sur "Add field"**
2. **Remplir**:
   - **Field**: `permissions`
   - **Type**: **"array"** dans le menu déroulant
   - **Value**: Cliquez sur "Add item"
     - Type de l'item: **"string"**
     - Valeur: `CREATE_PROJECT`
     - Cliquez sur "Add"
3. **Cliquer sur "Add"**

#### Champ 4: profileComplete

1. **Cliquer sur "Add field"**
2. **Remplir**:
   - **Field**: `profileComplete`
   - **Type**: **"boolean"**
   - **Value**: Cochez la case pour `true`
3. **Cliquer sur "Add"**

#### Champ 5: displayName

1. **Cliquer sur "Add field"**
2. **Remplir**:
   - **Field**: `displayName`
   - **Type**: **"string"**
   - **Value**: `Eric Vekout` (ou prénom + nom de l'utilisateur)
3. **Cliquer sur "Add"**

### Étape 3.5: (OPTIONNEL) Ajouter le Champ KYC

**⚠️ Note**: Ce champ est OPTIONNEL pour le développement (la vérification KYC a été temporairement désactivée).
**Production**: Ce champ sera OBLIGATOIRE.

#### Ajouter le champ kyc (map)

1. **Cliquer sur "Add field"**
2. **Remplir**:
   - **Field**: `kyc`
   - **Type**: **"map"** dans le menu déroulant
3. **Ne pas encore cliquer sur "Add"**

#### Ajouter les sous-champs du map kyc

1. **Cliquer sur "Add field" dans le map kyc** (avant de fermer)
2. **Sous-champ 1: status**
   - **Field**: `status`
   - **Type**: **"string"**
   - **Value**: `approved`

3. **Sous-champ 2: level**
   - **Field**: `level`
   - **Type**: **"number"**
   - **Value**: `2`

4. **Sous-champ 3: completedAt**
   - **Field**: `completedAt`
   - **Type**: **"timestamp"**
   - **Value**: Cliquez sur "Set to current time"

5. **Maintenant cliquer sur "Add"** pour le map kyc complet

### Étape 3.6: Vérifier la Structure Finale

**Document final attendu**:

```
Collection: users
└── Document: 5GqHzQJ4wrRawS6z2GY1opoSb543
    ├── uid: "5GqHzQJ4wrRawS6z2GY1opoSb543"
    ├── email: "ericvekout2022@gmail.com"
    ├── firstName: "Eric"
    ├── lastName: "Vekout"
    ├── displayName: "Eric Vekout"                    ← NOUVEAU
    ├── userType: "creator"                           ← NOUVEAU (remplace "role")
    ├── accountStatus: "active"                       ← NOUVEAU
    ├── permissions: ["CREATE_PROJECT"]               ← NOUVEAU
    ├── profileComplete: true                         ← NOUVEAU
    ├── kyc: {                                        ← OPTIONNEL
    │   ├── status: "approved"
    │   ├── level: 2
    │   └── completedAt: Timestamp(2025-12-17...)
    │   }
    ├── createdAt: Timestamp(...)
    └── updatedAt: Timestamp(...)
```

**Checklist de vérification**:
- [ ] Champ `role` supprimé
- [ ] Champ `userType` = "creator" (string)
- [ ] Champ `accountStatus` = "active" (string)
- [ ] Champ `permissions` = ["CREATE_PROJECT"] (array de strings)
- [ ] Champ `profileComplete` = true (boolean)
- [ ] Champ `displayName` = "Eric Vekout" (string)
- [ ] (Optionnel) Champ `kyc` avec status, level, completedAt

---

## 🔥 CONFIGURATION 4: DÉPLOYER LES RÈGLES FIRESTORE MODIFIÉES

**Problème**: Règles Firestore locales modifiées (KYC désactivé pour dev) mais pas déployées
**Impact**: Les modifications ne sont pas actives en production
**Priorité**: 🔴 CRITIQUE - Nécessaire pour permettre la création de projets

### Étape 4.1: Vérifier les Modifications Locales

1. **Ouvrir le fichier firestore.rules**
   - Chemin: `/firestore.rules` (à la racine du projet)

2. **Vérifier la modification à la ligne 137-140**:
   ```javascript
   // DÉVELOPPEMENT: KYC temporairement désactivé pour faciliter les tests
   // PRODUCTION: Réactiver isKYCApproved() avant le déploiement en production
   allow create: if isCreator() &&
                    // isKYCApproved() &&  // ← Temporairement commenté pour dev
                    isAccountActive() &&
                    validateProjectCreate(request.resource.data);
   ```

3. **Confirmer que la ligne est bien commentée**:
   - Ligne 138: `// isKYCApproved() &&` doit avoir `//` au début

### Étape 4.2: Installer Firebase CLI (si pas déjà fait)

**Vérifier si Firebase CLI est installé**:
```bash
firebase --version
```

**Si la commande échoue**, installer Firebase CLI:

**Windows**:
```bash
npm install -g firebase-tools
```

**macOS / Linux**:
```bash
npm install -g firebase-tools
```

**Vérifier l'installation**:
```bash
firebase --version
# Devrait afficher: 13.x.x ou supérieur
```

### Étape 4.3: Se Connecter à Firebase

1. **Login Firebase**:
   ```bash
   firebase login
   ```

2. **Processus de login**:
   - Une fenêtre de navigateur s'ouvre automatiquement
   - Connectez-vous avec votre compte Google (celui qui a accès au projet)
   - Autorisez Firebase CLI à accéder à votre compte
   - Revenez au terminal

3. **Vérifier la connexion**:
   ```bash
   firebase projects:list
   ```

   **Résultat attendu**:
   ```
   ✔ Projects:

   Project ID                         Project Name
   ═══════════════════════════════════════════════
   social-impact-mvp-prod-b6805      Social Impact MVP Production
   ```

### Étape 4.4: Naviguer vers le Répertoire du Projet

1. **Aller à la racine du projet**:
   ```bash
   cd "D:\Projets\Social Impact\senv\SocialImpact"
   ```

2. **Vérifier que vous êtes au bon endroit**:
   ```bash
   ls firestore.rules
   # Devrait afficher: firestore.rules
   ```

   **OU sous Windows PowerShell**:
   ```powershell
   dir firestore.rules
   # Devrait afficher le fichier
   ```

### Étape 4.5: Déployer les Règles Firestore

1. **Commande de déploiement**:
   ```bash
   firebase deploy --only firestore:rules
   ```

2. **Processus de déploiement**:
   ```
   === Deploying to 'social-impact-mvp-prod-b6805'...

   i  deploying firestore
   i  firestore: checking firestore.rules for compilation errors...
   ✔  firestore: rules file firestore.rules compiled successfully
   i  firestore: uploading rules firestore.rules...
   ✔  firestore: released rules firestore.rules to cloud.firestore

   ✔  Deploy complete!

   Project Console: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/overview
   ```

3. **Si erreur de compilation**:
   ```
   ✖  firestore: error compiling firestore.rules
   Error: ...
   ```

   **Actions**:
   - Lisez attentivement le message d'erreur
   - Vérifiez la syntaxe dans firestore.rules
   - Corrigez l'erreur et réessayez

### Étape 4.6: Vérifier le Déploiement

1. **Vérifier via la commande**:
   ```bash
   firebase firestore:rules:get
   ```

2. **Résultat attendu**:
   - Affiche les règles actuellement déployées
   - Vous devriez voir le commentaire `// isKYCApproved() &&` à la ligne 138

3. **Vérifier via Firebase Console**:
   - Aller sur: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/rules
   - Cliquez sur l'onglet **"Rules"**
   - Vérifiez que les règles affichées correspondent au fichier local

---

## ✅ VALIDATION COMPLÈTE POST-CONFIGURATION

Une fois TOUTES les configurations effectuées, testez complètement.

### Test 1: Création de Projet SANS Image

**Objectif**: Vérifier que les règles Firestore et le document utilisateur sont corrects.

1. **Lancer l'application**:
   ```bash
   flutter run
   ```

2. **Se connecter**:
   - Email: `ericvekout2022@gmail.com`
   - Mot de passe: [votre mot de passe]

3. **Vérifier que le bouton "Create Project" est visible**:
   - Sur la page Dashboard
   - En bas à droite (FloatingActionButton)
   - Si le bouton N'EST PAS visible → Problème avec le champ `userType` ou `permissions`

4. **Cliquer sur "Create Project"**:
   - Devrait naviguer vers la page de création de projet

5. **Remplir le formulaire** (SANS ajouter d'image):
   - Title: "Mon Projet Test"
   - Description: "Ceci est un projet de test pour vérifier la configuration"
   - Catégorie: Sélectionnez une catégorie
   - **NE PAS ajouter d'image de couverture**
   - Remplissez les autres champs obligatoires

6. **Soumettre le formulaire**:
   - Cliquez sur "Create Project"

7. **Résultat attendu**:
   ```
   ✅ [log] Creating project...
   ✅ [log] Project created with ID: JfKCqBpSYJCMnOLvP2sT
   ✅ [log] Navigating to project details...
   ```

8. **Vérifier dans Firestore**:
   - Aller sur: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore
   - Collection: `projects`
   - Devrait voir un nouveau document avec le projet créé

**Si échec**: Vérifier les champs utilisateur dans Firestore (Configuration 3).

### Test 2: Création de Projet AVEC Image

**Objectif**: Vérifier que les permissions Storage sont correctes.

**⏰ Attendre 10 minutes après Configuration 1 (Storage IAM)**.

1. **Créer un nouveau projet avec une image**:
   - Cliquez sur "Create Project"
   - Remplissez le formulaire
   - **IMPORTANT**: Ajoutez une image de couverture
   - Soumettez

2. **Résultat attendu**:
   ```
   ✅ [log] Creating project...
   ✅ [log] Compressing image: 96KB
   ✅ [log] Image compressed: 96KB → 17KB (82% reduction)
   ✅ [log] Uploading to Storage: temp/5GqHzQJ4wrRawS6z2GY1opoSb543/...
   ✅ [log] Image uploaded successfully
   ✅ [log] Project created with ID: abc123def456
   ✅ [log] Navigating to project details...
   ```

3. **Vérifier dans Storage**:
   - Aller sur: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/storage
   - Naviguez dans les dossiers: `temp/` → `[userId]/`
   - Devrait voir l'image uploadée

**Si échec**: Revérifier Configuration 1 (Storage IAM).

### Test 3: Vérifier l'Initialisation Stripe (si configuré)

1. **Redémarrer l'application**:
   ```bash
   flutter run
   ```

2. **Chercher dans les logs au démarrage**:
   ```
   ✅ [log] Initializing Stripe...
   ✅ [log] Stripe initialized successfully
   ```

3. **Si erreur**:
   ```
   ❌ [ERROR] flutter_stripe initialization failed
   ```
   - Revérifier Configuration 2 (Thème Android Stripe)

---

## 📊 RÉCAPITULATIF DES ACTIONS

| # | Configuration | Fichier/Endroit | Statut | Temps Estimé |
|---|---------------|----------------|--------|--------------|
| 1 | **Storage IAM Permissions** | Google Cloud Console IAM | ⏳ À FAIRE | 10 min + 10 min d'attente |
| 2 | **Thème Android Stripe** | `android/app/src/main/res/values/styles.xml` | ⏳ À FAIRE | 15 min |
| 3 | **Document Utilisateur** | Firebase Console Firestore | ⏳ À FAIRE | 10 min |
| 4 | **Déployer Règles Firestore** | Terminal (firebase deploy) | ⏳ À FAIRE | 5 min |

**Durée totale estimée**: 30-50 minutes (incluant temps d'attente)

---

## 🆘 DÉPANNAGE

### Problème: Permissions Storage toujours refusées après 15 minutes

**Solutions**:
1. Vérifiez que vous avez modifié le BON service account (`@appspot.gserviceaccount.com`)
2. Essayez de supprimer le rôle et le ré-ajouter
3. Essayez `Storage Object Admin` au lieu de `Storage Admin`
4. Vérifiez les logs détaillés dans Cloud Console → Logging

### Problème: Thème Stripe toujours en erreur

**Solutions**:
1. Vérifiez TOUS les styles dans styles.xml (LaunchTheme ET NormalTheme)
2. Vérifiez la dépendance Material dans build.gradle
3. Faites un `flutter clean` complet puis `flutter pub get`
4. Redémarrez l'IDE et l'émulateur

### Problème: Bouton "Create Project" toujours invisible

**Solutions**:
1. Vérifiez le champ `userType` = "creator" (pas "organization")
2. Vérifiez le champ `permissions` contient "CREATE_PROJECT"
3. Vérifiez le champ `accountStatus` = "active"
4. Redémarrez l'app Flutter après modification Firestore

### Problème: Erreur au déploiement des règles Firestore

**Solutions**:
1. Vérifiez que Firebase CLI est à jour: `npm update -g firebase-tools`
2. Vérifiez que vous êtes dans le bon répertoire (là où se trouve firestore.rules)
3. Vérifiez la syntaxe du fichier firestore.rules
4. Essayez de vous déconnecter puis reconnecter: `firebase logout` puis `firebase login`

---

## 📞 SUPPORT

**Documentation Firebase**:
- Storage IAM: https://firebase.google.com/support/faq#storage-accounts
- Firestore Rules: https://firebase.google.com/docs/firestore/security/get-started

**Documentation Stripe**:
- Flutter Setup: https://github.com/flutter-stripe/flutter_stripe#android

**Support Projet**:
- GitHub Issues: [URL de votre repo]
- Email: [votre email support]

---

**Dernière mise à jour**: 2025-12-17
**Auteur**: Claude Code
**Version**: 1.0
