# 🚀 Guide Rapide - Déploiement Index Firestore

## ✅ Ce qui a été fait automatiquement

1. ✅ **Fichier firestore.indexes.json mis à jour**
   - Localisation: `backend/functions/firestore.indexes.json`
   - 2 index critiques ajoutés (activities + projects)
   - Taille: 18 KB

2. ✅ **Configuration vérifiée**
   - firebase.json pointe vers le bon fichier
   - Projet Firebase confirmé: `social-impact-mvp-prod-b6805`

---

## ⚠️ ACTION REQUISE: Déploiement Manuel

Le déploiement automatique a échoué à cause de permissions insuffisantes:
```
Error: The caller does not have permission
```

### 🎯 Solution Rapide (5 minutes)

**Ouvre ce lien** dans ton navigateur:
```
https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/firestore/indexes
```

#### Index 1: `activities`
1. Clique **"Create Index"**
2. Remplis:
   - Collection ID: `activities`
   - Field 1: `userId` → **Ascending**
   - Field 2: `timestamp` → **Descending**
   - Query scope: **Collection**
3. Clique **Create**

#### Index 2: `projects`
1. Clique **"Create Index"** (nouveau)
2. Remplis:
   - Collection ID: `projects`
   - Field 1: `creatorId` → **Ascending**
   - Field 2: `createdAt` → **Descending**
   - Query scope: **Collection**
3. Clique **Create**

#### Attendre
- Les 2 index passeront de **"Building"** (orange) à **"Enabled"** (vert)
- Temps: 2-5 minutes normalement

---

## ✅ Vérification

Une fois les index en status "Enabled":

1. **Relance l'application Flutter**
2. **Teste**:
   - Dashboard → "Recent Activities" doit charger
   - Impact Screen (`/impact`) → Liste des projets doit charger
   - Activities Screen → Timeline doit s'afficher

3. **Vérifie les logs**:
   - ❌ AVANT: `Error: [cloud_firestore/failed-precondition]`
   - ✅ APRÈS: Pas d'erreur

---

## 📚 Documentation Complète

Pour plus de détails, voir:
- **[FIRESTORE_INDEXES_DEPLOYED.md](FIRESTORE_INDEXES_DEPLOYED.md)** - Documentation complète
- **[BACKEND_FIRESTORE_INDEXES_FIX.md](bug_fixes/BACKEND_FIRESTORE_INDEXES_FIX.md)** - Analyse du problème

---

**Besoin d'aide?** Tous les détails sont dans FIRESTORE_INDEXES_DEPLOYED.md
