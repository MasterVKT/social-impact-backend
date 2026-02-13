# 🔄 Système de Synchronisation Firestore Rules

## ⚡ Résumé Rapide

Ce dossier contient des scripts de maintenance automatisés pour garantir la cohérence des fichiers critiques du projet.

### Script Principal : `sync-firestore-rules.js`

**Fonction :** Synchronise automatiquement `backend/functions/firestore.rules` avec toutes les autres copies du projet.

**Utilisation :**
```bash
npm run sync:firestore-rules
```

---

## 📂 Scripts Disponibles

| Script | Commande | Description |
|--------|----------|-------------|
| **Sync Firestore Rules** | `npm run sync:firestore-rules` | Synchronise `firestore.rules` partout dans le projet |
| **Sync All** | `npm run sync:all` | Exécute tous les scripts de synchronisation |

---

## 🎯 Quand Utiliser Ces Scripts

### ✅ À Utiliser APRÈS :
- Modification de `backend/functions/firestore.rules`
- Ajout/suppression de règles de sécurité Firestore
- Mise à jour des permissions Firestore
- Avant de committer des changements aux règles

### ❌ Ne PAS Utiliser SI :
- Vous n'avez pas modifié `firestore.rules`
- Les fichiers sont déjà synchronisés (le script le détectera)

---

## 🛠️ Développement de Nouveaux Scripts

### Template de Base

```javascript
/**
 * Nom du script
 * Description
 */
const fs = require('fs');
const path = require('path');

function main() {
  console.log('🔄 SCRIPT EN COURS...');
  
  // Logique du script
  
  console.log('✅ Terminé avec succès !');
}

if (require.main === module) {
  main();
}

module.exports = { /* exports */ };
```

### Ajout au package.json

```json
{
  "scripts": {
    "votre-script": "node scripts/votre-script.js"
  }
}
```

---

## 📚 Documentation Complète

Pour plus de détails sur le système de synchronisation, consultez :
- **[FIRESTORE_RULES_SYNC_GUIDE.md](../FIRESTORE_RULES_SYNC_GUIDE.md)** - Guide complet d'utilisation
- **[.github/copilot-instructions.md](../.github/copilot-instructions.md)** - Règles d'automatisation GitHub Copilot

---

## 🔗 Liens Utiles

- **Script Source :** `scripts/sync-firestore-rules.js`
- **Documentation Firebase :** https://firebase.google.com/docs/firestore/security/get-started
- **Node.js Documentation :** https://nodejs.org/docs/

---

**Dernière mise à jour :** 11 janvier 2026  
**Mainteneur :** Backend AI Agent
