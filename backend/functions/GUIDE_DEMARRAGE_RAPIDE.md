# 🚀 Guide de Démarrage Rapide - Test Local avec Émulateur

## Étape 1: Démarrer l'Émulateur

### Option A: Via npm (recommandé)

Ouvre un terminal dans `backend/functions` et exécute :

```bash
npm run emulator
```

### Option B: Via script Windows

Double-clique sur `start-emulator.bat` dans le dossier `backend/functions`

### Option C: Via ligne de commande

```bash
cd backend/functions
npm run build
firebase emulators:start --only functions,firestore,auth
```

**⚠️ Important**: Garde ce terminal ouvert. L'émulateur doit rester actif pendant les tests.

## Étape 2: Tester la Migration

Dans un **nouveau terminal** (toujours dans `backend/functions`) :

### Test rapide (mode dry-run)

```bash
npm run test:migrate
```

### Test avec application réelle

```bash
npm run test:migrate:apply
```

### Test personnalisé

```bash
npm run test:migrate single mon-user-id true
```

Arguments :
- `single` : tester un seul utilisateur
- `mon-user-id` : ID de l'utilisateur
- `true` : dry-run (ne modifie pas) ou `false` (applique la migration)

## Étape 3: Vérifier les Résultats

### Via l'Interface Web

1. Ouvre ton navigateur : **http://localhost:4001**
2. Va dans l'onglet **Firestore**
3. Vérifie la collection `users`

### Via le Terminal

Le script affiche automatiquement :
- ✅ Données avant migration
- ✅ Données après migration
- ✅ Résultat détaillé

## 🎯 Exemple Complet

```bash
# Terminal 1: Démarrer l'émulateur
cd backend/functions
npm run emulator

# Terminal 2: Tester la migration
cd backend/functions
npm run test:migrate
```

## 📋 Checklist

- [ ] L'émulateur est démarré (terminal 1 ouvert)
- [ ] Le build est réussi (`npm run build` fonctionne)
- [ ] Le script de test s'exécute sans erreur
- [ ] Les données apparaissent dans l'Emulator UI (http://localhost:4000)

## ❓ Problèmes Courants

**L'émulateur ne démarre pas**
→ Vérifie que les ports 8080, 9099, 5001, 4000 ne sont pas utilisés

**Erreur "Cannot find module"**
→ Exécute `npm install` dans `backend/functions`

**Les données ne changent pas**
→ Vérifie que tu n'es pas en mode dry-run (dernier argument = `false`)

## 📚 Documentation Complète

Voir `README_EMULATOR.md` pour plus de détails.

