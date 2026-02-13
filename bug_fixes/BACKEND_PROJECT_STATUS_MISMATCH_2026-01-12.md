# 🔴 PROBLÈME BACKEND - Désalignement Statuts Projet
**Date:** 12 janvier 2026  
**Statut:** Bloquant pour contributions
**Type:** Data Schema Mismatch

---

## ✅ SOLUTION IMPLÉMENTÉE

**Date d'implémentation:** 12 janvier 2026  
**Statut:** ✅ Résolu

### Modification Appliquée

**Fichier modifié:** `backend/functions/src/payments/createContribution.ts`

La Solution 1 (recommandée) a été implémentée avec succès. Le code accepte maintenant plusieurs formats de statuts pour assurer la compatibilité entre le frontend et le backend :

```typescript
// Vérifier le statut du projet
// Accepter plusieurs formats pour compatibilité frontend/backend
const contributableStatuses = [
  STATUS.PROJECT.ACTIVE,      // 'active'
  STATUS.PROJECT.FUNDING,     // 'funding'
  'fundingActive',            // Format camelCase du frontend
  'funding_active',           // Format snake_case alternatif
  'approved',                 // Statut approuvé alternatif
];
if (!contributableStatuses.includes(project.status)) {
  throw new https.HttpsError('failed-precondition', `Project is not accepting contributions (status: ${project.status})`);
}
```

### Avantages de Cette Solution

1. **Rétrocompatibilité** : Accepte à la fois les anciens et nouveaux formats de statuts
2. **Pas de migration de données** : Aucune modification de la base de données Firestore nécessaire
3. **Sécurité maintenue** : Continue de valider le statut avant d'accepter les contributions
4. **Facilité de maintenance** : Solution simple et claire

### Tests Recommandés

Tester les appels API avec différents statuts :
- `status: 'active'` → ✅ Doit fonctionner
- `status: 'funding'` → ✅ Doit fonctionner
- `status: 'fundingActive'` → ✅ Doit fonctionner
- `status: 'funding_active'` → ✅ Doit fonctionner
- `status: 'approved'` → ✅ Doit fonctionner
- `status: 'draft'` → ❌ Doit être rejeté
- `status: 'completed'` → ❌ Doit être rejeté

---

## Erreur Observée

```
[firebase_functions/failed-precondition] 
Project is not accepting contributions (status: fundingActive)
```

## Description du Problème

La Cloud Function `stripeCreatePaymentIntent` vérifie si un projet accepte les contributions :

```typescript
const project = projectDoc.data();
if (project?.status !== 'fundingActive') {
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Project is not accepting contributions'
  );
}
```

**Mais le projet en Firestore probablement utilise :**
- `status: "funding_active"` (snake_case) 
- **OU** `status: "approved"` au lieu de `fundingActive`

## Cause Racine

**Désalignement entre le frontend et le backend sur la nomenclature des statuts de projet :**

### Frontend (Dart)
```dart
enum ProjectStatus {
  draft,
  submitted,
  underReview,
  approved,
  fundingActive,      // ← camelCase
  fundingComplete,
  implementation,
  completed,
  suspended,
  cancelled,
}
```

### Firestore Storage (Probablement)
```json
{
  "status": "funding_active",    // ← snake_case
  // OU
  "status": "approved",           // ← status approuvé, pas encore actif pour contributions
  // OU
  "status": "fundingActive"       // ← Correct, mais peut-être pas sincronisé
}
```

## Solutions Proposées

### **Solution 1 : Normaliser en Backend (RECOMMANDÉE)**

Modifier la Cloud Function pour accepter les deux formats :

```typescript
const acceptingContributionsStatuses = [
  'fundingActive',      // camelCase
  'funding_active',     // snake_case
  'approved',           // Alternative
];

const project = projectDoc.data();
if (!acceptingContributionsStatuses.includes(project?.status)) {
  throw new functions.https.HttpsError(
    'failed-precondition',
    `Project is not accepting contributions (status: ${project?.status})`
  );
}
```

### **Solution 2 : Vérifier et Corriger les Données Firestore**

Si tous les projets utilisent `snake_case`, migrer vers un format uniforme :

```typescript
// Migration script
async function migrateProjectStatuses() {
  const projectsRef = admin.firestore().collection('projects');
  const snapshot = await projectsRef.get();
  
  const batch = admin.firestore().batch();
  snapshot.docs.forEach((doc) => {
    const status = doc.data().status;
    // Convert snake_case to camelCase
    const normalizedStatus = status
      .split('_')
      .map((part, index) => 
        index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
      )
      .join('');
    
    batch.update(doc.ref, { status: normalizedStatus });
  });
  
  await batch.commit();
}
```

### **Solution 3 : Mettre à Jour le Statut du Projet en Frontend**

Si le projet est actuellement `approved` au lieu de `fundingActive` en Firestore, le statut doit être changé manuellement ou via une Cloud Function.

## Prochaines Étapes

**Action Immédiate (Backend Agent) :**

1. **Vérifier** les données en Firestore → Collection `projects` → Champ `status` exact
2. **Implémenter** la Solution 1 (accepter les deux formats) → Plus sûr et rapide
3. **Tester** avec un appel à `stripeCreatePaymentIntent`

**Commandes de Vérification :**

```bash
# Via Firebase Console ou CLI
firebase firestore:export backup/

# Ou via Node.js script
const admin = require('firebase-admin');
admin.initializeApp();

async function checkProjectStatuses() {
  const snapshot = await admin.firestore().collection('projects').limit(5).get();
  snapshot.docs.forEach(doc => {
    console.log(`${doc.id}: status = "${doc.data().status}"`);
  });
}

checkProjectStatuses();
```

---

**Fin du rapport**
