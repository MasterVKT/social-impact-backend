# 🚀 Guide de Démarrage Rapide - Émulateur Firebase

## ⚠️ Problème Résolu : Ports Occupés

Les ports par défaut (8080, 9099, 4000) étaient déjà utilisés. **Les ports ont été changés** pour éviter les conflits :

| Service | Ancien Port | Nouveau Port |
|---------|------------|--------------|
| Firestore | 8080 | **8081** |
| Auth | 9099 | **9100** |
| Functions | 5001 | **5002** |
| UI | 4000 | **4001** |

## 📋 Instructions de Démarrage

### Étape 1 : Démarrer l'Émulateur

**Terminal 1** (Invite de commandes) :

```bash
cd "D:\Projets\Social Impact\senv\SocialImpact\backend\functions"
npm run emulator
```

Tu devrais voir :
```
✔  firestore: Firestore Emulator initialized
✔  auth: Authentication Emulator initialized  
✔  functions: Functions Emulator initialized
✔  ui: Emulator UI initialized
```

**⚠️ Important** : Garde ce terminal ouvert pendant les tests.

### Étape 2 : Tester la Migration

**Terminal 2** (nouveau terminal, Invite de commandes) :

```bash
cd "D:\Projets\Social Impact\senv\SocialImpact\backend\functions"
npm run test:migrate
```

### Étape 3 : Vérifier les Résultats

Ouvre ton navigateur sur : **http://localhost:4001**

Va dans l'onglet **Firestore** et vérifie la collection `users`.

## 🎯 Commandes Disponibles

| Commande | Description |
|----------|-------------|
| `npm run emulator` | Démarrer l'émulateur (ports: 8081, 9100, 5002, 4001) |
| `npm run test:migrate` | Test rapide (dry-run) |
| `npm run test:migrate:apply` | Appliquer réellement la migration |
| `npm run test:migrate:all` | Migrer tous les utilisateurs |

## 🔍 Vérification des Ports

Si tu as encore des problèmes de ports, vérifie quels processus les utilisent :

```bash
netstat -ano | findstr ":8081 :9100 :4001"
```

Si les ports sont toujours occupés, tu peux les changer dans `backend/functions/firebase.json`.

## ✅ Checklist

- [ ] L'émulateur démarre sans erreur (Terminal 1)
- [ ] Les ports 8081, 9100, 5002, 4001 sont libres
- [ ] Le script de test s'exécute (Terminal 2)
- [ ] L'interface web est accessible sur http://localhost:4001

