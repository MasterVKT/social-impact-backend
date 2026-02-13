# 🔧 Corrections Backend Requises

**Date**: 2025-12-17
**Statut**: ✅ Projet créé avec succès dans Firestore | ❌ Erreurs Storage & Stripe

---

## ✅ CE QUI FONCTIONNE

Le projet **a été créé avec succès** dans Firestore:
```
✅ Project created with ID: JfKCqBpSYJCMnOLvP2sT
✅ Image compressed: 96KB → 17KB (82% reduction)
✅ Sérialisation des milestones fonctionne parfaitement
```

---

## ❌ PROBLÈMES BACKEND À CORRIGER

### 1. Firebase Storage - Permissions Manquantes (CRITIQUE)

**Erreur**:
```
StorageException: Code: -13000 HttpResult: 412
"A required service account is missing necessary permissions"
```

**Cause**: Le service account Firebase n'a pas les permissions pour uploader des fichiers dans Storage.

**Solution**:

#### Étape 1: Ouvrir Firebase Console
https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/storage

#### Étape 2: Re-linker le Storage bucket

1. Cliquez sur l'onglet **"Files"** ou **"Règles"**
2. Si vous voyez un message d'erreur, cliquez sur **"Re-link bucket"**
3. OU: Suivez les étapes du FAQ officiel Firebase:
   https://firebase.google.com/support/faq#storage-accounts

#### Étape 3: Vérifier les permissions IAM

1. Aller sur Google Cloud Console:
   https://console.cloud.google.com/iam-admin/iam?project=social-impact-mvp-prod-b6805

2. Chercher le service account:
   `social-impact-mvp-prod-b6805@appspot.gserviceaccount.com`

3. Vérifier qu'il a les rôles:
   - ✅ `Firebase Admin`
   - ✅ `Storage Admin` ou `Storage Object Admin`

4. Si manquant, cliquer sur **"Edit"** et ajouter:
   - Role: `Storage Admin`

#### Étape 4: Attendre propagation (5-10 minutes)

Après modification, attendez quelques minutes pour que les changements se propagent.

#### Étape 5: Tester à nouveau

Essayez de créer un projet avec une image.

---

### 2. Stripe - Theme Error (NON CRITIQUE)

**Erreur**:
```
flutter_stripe initialization failed
Your theme isn't set to use Theme.AppCompat or Theme.MaterialComponents
```

**Impact**: Stripe ne s'initialise pas, mais n'empêche PAS la création de projets.

**Solution** (si vous voulez utiliser Stripe):

#### Fichier: `android/app/src/main/res/values/styles.xml`

Créer ou modifier ce fichier:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Base application theme. -->
    <style name="LaunchTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
        <!-- Customize your theme here. -->
    </style>

    <!-- Theme applied to the Android Window while the process is starting -->
    <style name="NormalTheme" parent="Theme.MaterialComponents.Light.NoActionBar">
        <item name="android:windowBackground">?android:colorBackground</item>
    </style>
</resources>
```

Changement clé: `Theme.AppCompat` → `Theme.MaterialComponents`

---

## 🧪 TESTS APRÈS CORRECTIONS

### Test 1: Création projet SANS image

1. Cliquer sur "Create Project"
2. Remplir le formulaire (SANS ajouter d'image)
3. Cliquer "Create Project"

**Résultat Attendu**: ✅ Projet créé et navigation vers détail

### Test 2: Création projet AVEC image (après fix Storage)

1. Cliquer sur "Create Project"
2. Remplir le formulaire
3. **Ajouter une image de couverture**
4. Cliquer "Create Project"

**Résultat Attendu**:
- ✅ Projet créé
- ✅ Image uploadée dans Storage
- ✅ Navigation vers détail

---

## 📊 Résumé des Corrections Code

| Problème | Statut | Fichier |
|----------|--------|---------|
| Sérialisation milestones | ✅ | project_model.dart |
| MainActivity Stripe | ✅ | MainActivity.kt |
| Null check error | ✅ | create_project_screen.dart |
| Riverpod Future completed | ✅ | projects_providers.dart |
| **Storage permissions** | ❌ | **Firebase Console** |
| **Stripe theme** | ⚠️ | **styles.xml** |

---

## 🆘 Support

**Firebase Storage FAQ**:
https://firebase.google.com/support/faq#storage-accounts

**Stripe Flutter Setup**:
https://github.com/flutter-stripe/flutter_stripe#android

---

**Dernière mise à jour**: 2025-12-17
**Créé par**: Claude Code
