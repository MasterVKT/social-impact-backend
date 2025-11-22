# Matrices de Priorités et Dépendances
## Social Finance Impact Platform - Gap Analysis
## Date : 18 Novembre 2025

---

## 📊 MATRICE DE PRIORITÉS GLOBALE

### Vue d'ensemble

| ID | Tâche | Priorité | Complexité | Temps (h) | Impact | Risque | Score |
|----|-------|----------|------------|-----------|---------|--------|-------|
| **P0.1** | firestore.rules | P0 | ÉLEVÉE | 8-10 | CRITIQUE | ÉLEVÉ | 100 |
| **P0.2** | firestore.indexes.json | P0 | MOYENNE | 3-4 | CRITIQUE | MOYEN | 95 |
| **P0.3** | storage.rules | P0 | MOYENNE | 2-3 | CRITIQUE | MOYEN | 90 |
| **P0.4** | submitProject.ts | P0 | MOYENNE | 3-4 | ÉLEVÉ | FAIBLE | 85 |
| **P0.5** | approveProject.ts | P0 | MOYENNE | 3-4 | ÉLEVÉ | FAIBLE | 80 |
| **P0.6** | getProjectAnalytics.ts | P0 | MOYENNE | 2-4 | MOYEN | FAIBLE | 75 |
| **P1.1** | Tests scheduled functions | P1 | MOYENNE | 8-10 | MOYEN | FAIBLE | 65 |
| **P1.2** | Tests triggers | P1 | MOYENNE | 4-6 | MOYEN | FAIBLE | 60 |
| **P1.3** | Tests intégrations | P1 | MOYENNE | 6-8 | MOYEN | FAIBLE | 55 |
| **P1.4** | Tests monitoring | P1 | FAIBLE | 3-4 | FAIBLE | FAIBLE | 50 |
| **P1.5** | Tests security | P1 | MOYENNE | 4-6 | MOYEN | FAIBLE | 45 |
| **P2.1** | README.md | P2 | FAIBLE | 2-3 | FAIBLE | FAIBLE | 35 |
| **P2.2** | OpenAPI docs | P2 | MOYENNE | 4-6 | FAIBLE | FAIBLE | 30 |
| **P2.3** | Guide déploiement | P2 | FAIBLE | 2-3 | FAIBLE | FAIBLE | 25 |
| **P2.4** | .env.example | P2 | FAIBLE | 1 | FAIBLE | FAIBLE | 20 |
| **P2.5** | Multi-devises | P2 | ÉLEVÉE | 12-16 | FAIBLE | MOYEN | 15 |
| **P2.6** | MFA (2FA) | P2 | MOYENNE | 8-10 | FAIBLE | FAIBLE | 10 |

**Légende Score** :
- 100-80 : BLOQUANT - À faire immédiatement
- 79-50 : HAUTE - Avant production
- 49-20 : MOYENNE - Nice to have
- <20 : BASSE - Post-MVP

---

## 🔗 GRAPHE DE DÉPENDANCES

### Représentation ASCII

```
PHASE 0 (Prérequis - Déjà complétés)
├─ Types & Schemas ✅
├─ Utils & Helpers ✅
├─ Integrations ✅
└─ Core Functions ✅

PHASE 1 (P0 - Bloquants Production)
│
├─ [P0.1] firestore.rules ◄── Dépend: Types, Schemas
│   │
│   ├─► Bloque: P0.2, P0.3
│   │
│   ├─ [P0.2] firestore.indexes.json ◄── Dépend: P0.1, Requêtes code
│   │
│   └─ [P0.3] storage.rules ◄── Dépend: P0.1, Types
│
├─ [P0.4] submitProject.ts ◄── Dépend: createProject ✅, Types ✅
│   │
│   ├─► Bloque: P0.5
│   │
│   └─ [P0.5] approveProject.ts ◄── Dépend: P0.4, Admin auth
│
└─ [P0.6] getProjectAnalytics.ts ◄── Dépend: All project functions
    │
    └─► Débloque: Production Deployment ✅


PHASE 2 (P1 - Tests & Qualité)
│
├─ [P1.1] Tests scheduled functions ◄── Dépend: P0 complète
│
├─ [P1.2] Tests triggers ◄── Dépend: P0 complète
│
├─ [P1.3] Tests intégrations ◄── Dépend: P0 complète
│
├─ [P1.4] Tests monitoring ◄── Dépend: P0 complète
│
└─ [P1.5] Tests security ◄── Dépend: P0.1, P0.3
    │
    └─► Débloque: CI/CD, Production Confidence ✅


PHASE 3 (P2 - Documentation & Features)
│
├─ [P2.1] README.md ◄── Dépend: P0, P1
│
├─ [P2.2] OpenAPI docs ◄── Dépend: P0, P1
│
├─ [P2.3] Guide déploiement ◄── Dépend: P0, P1
│
├─ [P2.4] .env.example ◄── Indépendant
│
├─ [P2.5] Multi-devises ◄── Dépend: Payments complets
│
└─ [P2.6] MFA (2FA) ◄── Dépend: Auth complets
    │
    └─► Débloque: MVP Complet Enterprise-Grade ✅
```

---

## 🎯 MATRICE DE DÉPENDANCES DÉTAILLÉE

### Tâches P0 (Bloquants Production)

#### P0.1 : firestore.rules

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - `src/types/firestore.ts` (✅)<br>- `Docs MVP/firestore_data_model.md` (✅)<br>- `backend_security_integrations.md` (✅) |
| **Bloque** | - P0.2 (indexes dépendent des rules)<br>- P0.3 (storage rules utilisent mêmes patterns)<br>- Production deployment |
| **Pré-requis techniques** | - Connaissance Firebase Security Rules<br>- Compréhension RBAC<br>- Expertise GDPR/compliance |
| **Risques** | - Règles trop permissives → faille sécurité<br>- Règles trop strictes → features cassées<br>- Oubli de cas edge → bugs production |
| **Mitigation** | - Tests exhaustifs avec émulateur<br>- Review par security expert<br>- Validation avec cas réels |

---

#### P0.2 : firestore.indexes.json

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - P0.1 (firestore.rules) ✅ requis<br>- Toutes les requêtes Firestore dans le code<br>- `searchProjects.ts`, `getNotifications.ts`, etc. |
| **Bloque** | - Performance des requêtes complexes<br>- Scaling au-delà de petits datasets |
| **Pré-requis techniques** | - Analyse des queries dans le code<br>- Compréhension index composites Firestore<br>- Connaissance limitations Firestore |
| **Risques** | - Index manquants → queries lentes/échouent<br>- Index inutiles → coûts stockage<br>- Index incomplets → erreurs runtime |
| **Mitigation** | - Scanner tout le code pour .where() .orderBy()<br>- Tester avec émulateur<br>- Monitorer logs déploiement |

---

#### P0.3 : storage.rules

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - P0.1 (firestore.rules pour patterns similaires)<br>- `src/types/firestore.ts` (✅)<br>- Compréhension des paths Storage |
| **Bloque** | - Upload fichiers (KYC, images, preuves)<br>- Sécurité données sensibles<br>- Production deployment |
| **Pré-requis techniques** | - Firebase Storage Rules syntax<br>- Validation taille/MIME types<br>- Firestore lookups dans Storage rules |
| **Risques** | - Documents KYC accessibles publiquement<br>- Upload fichiers malicieux<br>- Dépassement quotas stockage |
| **Mitigation** | - Validation stricte MIME types<br>- Limites de taille<br>- Tests upload avec différents types |

---

#### P0.4 : submitProject.ts

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - `createProject.ts` (✅ existe)<br>- `updateProfile.ts` (✅ pour KYC check)<br>- `sendNotification.ts` (✅ pour notifs) |
| **Bloque** | - P0.5 (approveProject dépend du workflow submit)<br>- Workflow complet gestion projets |
| **Pré-requis techniques** | - Validation complétude projet<br>- Logique transitions de statut<br>- Notifications multi-destinataires |
| **Risques** | - Validation incomplète → projets invalides en review<br>- Notifications échouent → admins pas au courant<br>- Race conditions statut |
| **Mitigation** | - Validation exhaustive (cf. template plan)<br>- Transactions Firestore<br>- Tests unitaires complets |

---

#### P0.5 : approveProject.ts

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - P0.4 (submitProject) ✅ REQUIS<br>- Auth admin (✅ middleware existe)<br>- sendNotification (✅) |
| **Bloque** | - Publication projets en production<br>- Monétisation plateforme<br>- Workflow complet |
| **Pré-requis techniques** | - Vérification permissions admin<br>- Logique approve/reject avec commentaires<br>- Notifications créateurs |
| **Risques** | - Non-admins peuvent approuver → faille sécurité<br>- Commentaires rejet pas sauvegardés<br>- Notifications pas envoyées |
| **Mitigation** | - Double check role admin<br>- Validation requête stricte<br>- Tests avec différents rôles |

---

#### P0.6 : getProjectAnalytics.ts

| Aspect | Détail |
|--------|--------|
| **Dépend de** | - Tous modules projets (✅ existent)<br>- Contributions (✅ existent)<br>- Vues/métriques (si trackées) |
| **Bloque** | - Dashboard créateur<br>- Insights business |
| **Pré-requis techniques** | - Agrégation données Firestore<br>- Calculs métriques (taux conversion, etc.)<br>- Performance requêtes |
| **Risques** | - Requêtes trop lentes (multiple reads)<br>- Données incohérentes<br>- Fuites données (voir analytics autres projets) |
| **Mitigation** | - Caching résultats<br>- Scheduled function pré-calcul<br>- Validation ownership stricte |

---

### Tâches P1 (Tests & Qualité)

#### Matrice Dépendances Tests

| Tâche | Dépend de | Bloque | Difficulté | Priorité |
|-------|-----------|--------|------------|----------|
| **P1.1 Tests scheduled** | P0 complète | CI/CD | MOYENNE | 1 |
| **P1.2 Tests triggers** | P0 complète | CI/CD | MOYENNE | 2 |
| **P1.3 Tests intégrations** | P0 complète, Comptes test Stripe/Sumsub | CI/CD | ÉLEVÉE | 3 |
| **P1.4 Tests monitoring** | P0 complète | CI/CD | FAIBLE | 4 |
| **P1.5 Tests security** | P0.1, P0.3 | Production confidence | MOYENNE | 5 |

**Note importante** : Les tests P1 peuvent être faits en parallèle une fois P0 complète.

---

### Tâches P2 (Documentation & Features)

#### Matrice Dépendances Documentation

| Tâche | Dépend de | Bloque | Temps | Impact |
|-------|-----------|--------|-------|--------|
| **P2.1 README** | P0, P1 | Onboarding devs | 2-3h | Moyen |
| **P2.2 OpenAPI** | P0, API complète | Frontend integration | 4-6h | Moyen |
| **P2.3 Guide déploiement** | P0, P1, Déploiement réussi | Ops | 2-3h | Moyen |
| **P2.4 .env.example** | Aucune | Configuration | 1h | Faible |
| **P2.5 Multi-devises** | Payments complets | International | 12-16h | Faible |
| **P2.6 MFA** | Auth complets | Security enhanced | 8-10h | Faible |

---

## ⏱️ TIMELINE OPTIMALE

### Scénario 1 : Exécution Séquentielle Stricte (Développeur Solo)

```
Jour 1
├─ Matin : P0.1 firestore.rules (4h)
└─ Après-midi : P0.1 firestore.rules (4h) + tests

Jour 2
├─ Matin : P0.2 firestore.indexes.json (3h)
├─ Après-midi : P0.3 storage.rules (2h)
└─ Soir : P0.4 submitProject.ts (début, 2h)

Jour 3
├─ Matin : P0.4 submitProject.ts (fin + tests, 3h)
├─ Après-midi : P0.5 approveProject.ts (4h)

Jour 4
├─ Matin : P0.5 approveProject.ts (tests, 2h)
├─ Après-midi : P0.6 getProjectAnalytics.ts (4h)
└─ ✅ PHASE 1 COMPLÈTE - Backend déployable

Jour 5
└─ Tests scheduled functions (P1.1) - 8h

Jour 6
├─ Matin : Tests triggers (P1.2) - 4h
└─ Après-midi : Tests intégrations début (P1.3) - 4h

Jour 7
├─ Matin : Tests intégrations suite (P1.3) - 4h
├─ Après-midi : Tests monitoring (P1.4) - 3h
└─ Soir : Tests security début (P1.5) - 1h

Jour 8
├─ Matin : Tests security fin (P1.5) - 3h
├─ Après-midi : Validation complète Phase 2 - 2h
└─ ✅ PHASE 2 COMPLÈTE - Backend robuste

Jours 9-10
├─ README.md (P2.1) - 3h
├─ OpenAPI docs (P2.2) - 6h
├─ Guide déploiement (P2.3) - 3h
├─ .env.example (P2.4) - 1h
└─ ✅ PHASE 3 COMPLÈTE - Backend documenté

Jours 11-14 (Optionnel)
├─ Multi-devises (P2.5) - 14h
└─ MFA (P2.6) - 10h
```

**Total : 10-14 jours** pour MVP complet

---

### Scénario 2 : Exécution Parallèle (Équipe de 3)

```
Semaine 1 (Jours 1-5)
│
├─ Dev 1 (Backend Senior)
│  ├─ Jour 1-2: P0.1 firestore.rules (10h)
│  ├─ Jour 3: P0.2 indexes + P0.3 storage (6h)
│  └─ Jour 4-5: Review & validation Phase 1
│
├─ Dev 2 (Backend)
│  ├─ Jour 1-3: P0.4 submitProject (8h parallèle à P0.1)
│  ├─ Jour 4: P0.5 approveProject (8h)
│  └─ Jour 5: P0.6 getProjectAnalytics (4h)
│
└─ Dev 3 (QA/Tests)
   ├─ Jour 1-3: Préparation tests P1 (mocks, fixtures)
   ├─ Jour 4: Tests P0.4, P0.5
   └─ Jour 5: Tests P0.6
   └─ ✅ PHASE 1 COMPLÈTE en 5 jours

Semaine 2 (Jours 6-10)
│
├─ Dev 1: Tests intégrations (P1.3) + monitoring (P1.4)
├─ Dev 2: Tests scheduled (P1.1) + triggers (P1.2)
└─ Dev 3: Tests security (P1.5) + validation
   └─ ✅ PHASE 2 COMPLÈTE en 5 jours

Semaine 3 (Jours 11-15)
│
├─ Dev 1: OpenAPI docs (P2.2)
├─ Dev 2: README + Guide (P2.1 + P2.3)
└─ Dev 3: .env.example + validation
   └─ ✅ PHASE 3 COMPLÈTE en 3 jours

Jours 16-20 (Optionnel)
├─ Dev 1+2: Multi-devises (P2.5)
└─ Dev 3: MFA (P2.6)
```

**Total avec équipe : 15-20 jours** pour MVP complet + features optionnelles

---

## 🚦 MATRICE DE RISQUES

### Risques par Tâche

| Tâche | Risque Technique | Prob | Impact | Risque Business | Prob | Impact | Score Risque |
|-------|------------------|------|--------|-----------------|------|--------|--------------|
| **P0.1** | Règles trop permissives | 40% | CRITIQUE | Faille sécurité | 30% | CRITIQUE | 🔴 ÉLEVÉ |
| **P0.2** | Index manquants | 30% | ÉLEVÉ | Queries lentes | 50% | MOYEN | 🟡 MOYEN |
| **P0.3** | Storage non sécurisé | 25% | CRITIQUE | KYC leak | 20% | CRITIQUE | 🟡 MOYEN |
| **P0.4** | Validation incomplète | 35% | MOYEN | Projets invalides | 40% | MOYEN | 🟡 MOYEN |
| **P0.5** | Permissions admin | 20% | ÉLEVÉ | Approbations non auth | 15% | ÉLEVÉ | 🟡 MOYEN |
| **P0.6** | Performance analytics | 45% | MOYEN | Dashboard lent | 60% | FAIBLE | 🟢 FAIBLE |
| **P1.x** | Tests incomplets | 50% | MOYEN | Bugs production | 30% | MOYEN | 🟡 MOYEN |
| **P2.x** | Documentation manque | 60% | FAIBLE | Mauvais onboarding | 40% | FAIBLE | 🟢 FAIBLE |

**Légende** :
- 🔴 ÉLEVÉ : Mitigation obligatoire
- 🟡 MOYEN : Surveillance nécessaire
- 🟢 FAIBLE : Acceptable

---

## 🎯 STRATÉGIE D'EXÉCUTION RECOMMANDÉE

### Pour IA (Claude Code) - Exécution Solo

1. **Phase 1 : Focus absolu sur P0** (3-4 jours)
   - Exécuter P0.1 → P0.2 → P0.3 (règles Firebase)
   - Puis P0.4 → P0.5 → P0.6 (fonctions projet)
   - Valider après chaque tâche
   - NE PAS passer à P1 avant 100% P0

2. **Phase 2 : Tests systématiques** (4-5 jours)
   - P1.1 à P1.5 dans l'ordre
   - Possibilité de paralléliser si modules indépendants
   - Atteindre >85% coverage

3. **Phase 3 : Documentation** (3-4 jours)
   - P2.1 à P2.4 (documentation)
   - P2.5 et P2.6 optionnels (post-MVP)

### Pour Équipe Humaine - Parallélisation

1. **Semaine 1 : Sprint P0** (5 jours)
   - 2 devs backend en parallèle (rules vs functions)
   - 1 QA préparation tests
   - Daily sync

2. **Semaine 2 : Sprint P1** (5 jours)
   - 3 devs tests en parallèle
   - Code review croisé
   - CI/CD setup

3. **Semaine 3 : Sprint P2** (3-5 jours)
   - Documentation parallèle
   - Features optionnelles si temps
   - Production deployment prep

---

## 📊 DASHBOARD DE SUIVI

### KPIs à Tracker

| Métrique | Cible P0 | Cible P1 | Cible P2 | Actuel |
|----------|----------|----------|----------|--------|
| **Fichiers implémentés** | 116/120 | 120/120 | 124/124 | 110/120 |
| **Test coverage** | 40% | 85% | 90% | ~35% |
| **Règles Firebase** | 3/3 | 3/3 | 3/3 | 0/3 ⚠️ |
| **Functions projet** | 11/11 | 11/11 | 11/11 | 8/11 ⚠️ |
| **Documentation** | Minimale | Complète | Exhaustive | Partielle |
| **Production-ready** | ✅ | ✅ | ✅ | ❌ |

### Checkpoints Obligatoires

- [ ] **Checkpoint P0** : Déploiement dry-run réussit
- [ ] **Checkpoint P1** : Tous tests passent, coverage >85%
- [ ] **Checkpoint P2** : Documentation validée, API docs complètes
- [ ] **Checkpoint Final** : Production deployment réussit

---

## 🎓 CONCLUSION

Cette matrice de priorités et dépendances fournit :

✅ **Ordre d'exécution optimal** pour minimiser les blocages
✅ **Visibilité sur les dépendances** pour éviter les erreurs
✅ **Estimation réaliste** du temps nécessaire
✅ **Identification des risques** et stratégies de mitigation
✅ **Flexibilité** pour exécution solo ou équipe

**Prochaine étape** : Commencer l'exécution avec **P0.1 - firestore.rules**

---

**Document créé le 18 Novembre 2025**
**Prêt pour exécution immédiate**
