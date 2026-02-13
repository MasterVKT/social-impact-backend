# 🔄 Guide de Synchronisation Firestore Rules

## 📋 Vue d'Ensemble

Ce document explique le système de synchronisation automatique des fichiers `firestore.rules` dans le projet Social Impact Platform.

---

## 🎯 Pourquoi la Synchronisation est Importante

Le fichier `firestore.rules` définit les règles de sécurité Firestore et existe en **plusieurs copies** dans le projet :

1. **`backend/functions/firestore.rules`** - 🔴 **SOURCE DE VÉRITÉ** (utilisé pour le déploiement)
2. **`firestore.rules`** - Copie au niveau racine (pour référence)

**Problème :** Si ces fichiers sont désynchronisés, les règles déployées ne correspondent pas à la documentation, causant confusion et erreurs.

**Solution :** Un script de synchronisation automatique garantit que toutes les copies sont identiques.

---

## 🚀 Utilisation

### Commande Rapide

```bash
npm run sync:firestore-rules
```

### Commande Détaillée

```bash
node scripts/sync-firestore-rules.js
```

---

## 📝 Workflow Recommandé

### 1. Modifier les Règles Firestore

**Toujours modifier le fichier source :**
```
backend/functions/firestore.rules
```

### 2. Synchroniser Automatiquement

**Après chaque modification, exécutez :**
```bash
npm run sync:firestore-rules
```

### 3. Vérifier la Synchronisation

Le script affichera :
```
✅ Tous les fichiers sont synchronisés avec succès !
```

### 4. Déployer sur Firebase

```bash
cd backend
firebase deploy --only firestore:rules
```

---

## 🤖 Intégration GitHub Copilot

GitHub Copilot est configuré pour **automatiquement synchroniser** après chaque modification de `firestore.rules`.

**Règle ajoutée dans `.github/copilot-instructions.md` :**
> "AFTER EVERY MODIFICATION of firestore.rules, AUTOMATICALLY execute: npm run sync:firestore-rules"

---

## 🔍 Fonctionnalités du Script

### Détection des Différences
- Calcule un hash MD5 de chaque fichier
- Compare les hashes pour détecter les différences
- Affiche le statut de synchronisation

### Sauvegarde Automatique
- Avant toute synchronisation, crée un backup : `*.backup-YYYY-MM-DDTHH-MM-SS`
- Permet de restaurer en cas de problème
- Les backups sont ignorés par Git

### Validation
- Vérifie que la synchronisation a réussi
- Compare les hashes après copie
- Affiche des messages clairs de succès/échec

---

## 📊 Exemple de Sortie

```
🔄 SYNCHRONISATION DES FICHIERS FIRESTORE.RULES
================================================

📋 Fichier source: D:\...\backend\functions\firestore.rules
   Hash: c7c5b4361903335b4490d97bad5707bb
   Taille: 27254 octets

[1/1] D:\...\firestore.rules
🔄 Synchronisation de: D:\...\firestore.rules
💾 Backup créé: D:\...\firestore.rules.backup-2026-01-11T02-33-30
✅ Synchronisation réussie

================================================
📊 RÉSUMÉ DE LA SYNCHRONISATION
================================================
✅ Succès: 1
❌ Échecs: 0
📁 Total: 1

✅ Tous les fichiers sont synchronisés avec succès !
```

---

## 🛠️ Configuration

### Ajouter de Nouveaux Fichiers à Synchroniser

Éditer `scripts/sync-firestore-rules.js` :

```javascript
const CONFIG = {
  sourceFile: path.join(__dirname, '..', 'backend', 'functions', 'firestore.rules'),
  
  targetFiles: [
    path.join(__dirname, '..', 'firestore.rules'),
    // Ajouter ici d'autres chemins si nécessaire
    // path.join(__dirname, '..', 'frontend', 'firestore.rules'),
  ],
  
  createBackup: true,
  verbose: true,
};
```

### Désactiver les Backups (Non Recommandé)

```javascript
const CONFIG = {
  // ...
  createBackup: false, // ⚠️ Risqué
  // ...
};
```

---

## 🐛 Dépannage

### Erreur : "Fichier source introuvable"

**Cause :** Le chemin vers `backend/functions/firestore.rules` est incorrect.

**Solution :**
1. Vérifier que le fichier existe
2. Exécuter le script depuis la **racine du projet**

### Erreur : "Module Not Found"

**Cause :** Script exécuté depuis le mauvais répertoire.

**Solution :**
```bash
cd D:\Projets\Social Impact\senv\SocialImpact
npm run sync:firestore-rules
```

### Synchronisation Échoue

**Cause :** Permissions insuffisantes ou fichier verrouillé.

**Solution :**
1. Fermer tous les éditeurs avec le fichier ouvert
2. Vérifier les permissions du dossier
3. Exécuter en tant qu'administrateur si nécessaire

---

## 📚 Fichiers Concernés

```
SocialImpact/
├── backend/
│   └── functions/
│       └── firestore.rules          ← SOURCE (621 lignes)
├── firestore.rules                  ← COPIE SYNCHRONISÉE (621 lignes)
├── scripts/
│   └── sync-firestore-rules.js      ← SCRIPT DE SYNCHRONISATION
├── package.json                      ← Scripts npm
└── .github/
    └── copilot-instructions.md      ← Règle d'automatisation
```

---

## ✅ Checklist de Modification

Avant de committer des changements à `firestore.rules` :

- [ ] Modifier **uniquement** `backend/functions/firestore.rules`
- [ ] Exécuter `npm run sync:firestore-rules`
- [ ] Vérifier le message de succès ✅
- [ ] Tester les règles localement avec l'émulateur
- [ ] Déployer sur Firebase : `firebase deploy --only firestore:rules`
- [ ] Committer **tous les fichiers synchronisés**

---

## 🔗 Références

- **Script de synchronisation :** `scripts/sync-firestore-rules.js`
- **Instructions Copilot :** `.github/copilot-instructions.md` (Section 6)
- **Documentation Firebase :** https://firebase.google.com/docs/firestore/security/get-started

---

**Dernière mise à jour :** 11 janvier 2026  
**Auteur :** Backend AI Agent  
**Version :** 1.0.0
