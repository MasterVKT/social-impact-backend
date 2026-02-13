# Guide de Configuration du Webhook Stripe
## Social Finance Impact Platform

**Date**: 8 février 2026  
**Problème résolu**: Webhook Stripe non déclenché - contributions non créées  
**Statut**: Logs de débogage ajoutés ✅

---

## 📋 Résumé de la Situation

### Problème Identifié
- ✅ **Code webhook existe** et est bien structuré dans `handleStripeWebhook.ts`
- ✅ **Fonction exportée** dans `index.ts`
- ❌ **Webhook pas configuré** dans Stripe Dashboard (probable)
- ❌ **Aucun événement reçu** (pas de logs dans Cloud Functions)
- ❌ **Collection contributions vide** après paiements réussis

### Solution Implémentée
✅ **Logs de débogage détaillés ajoutés** dans `handleStripeWebhook.ts` pour faciliter le diagnostic

---

## 🚀 Étapes de Configuration (À FAIRE)

### Étape 1: Déployer les Logs Améliorés

```bash
# Depuis le dossier du projet
cd backend/functions

# Installer les dépendances
npm install

# Compiler TypeScript
npm run build

# Déployer uniquement le webhook (plus rapide)
firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805

# OU déployer toutes les fonctions
firebase deploy --only functions --project social-impact-mvp-prod-b6805
```

**Résultat attendu**:
```
✔  functions[handleStripeWebhook(us-central1)]: Successful update operation.
```

---

### Étape 2: Obtenir l'URL du Webhook

Après le déploiement, l'URL sera:
```
https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/handleStripeWebhook
```

**Vérifier que la fonction existe**:
```bash
firebase functions:list --project social-impact-mvp-prod-b6805
```

Devrait afficher:
```
✔ functions(handleStripeWebhook): [HTTP Function]
```

**Tester manuellement** (devrait retourner erreur 401 car pas de signature):
```bash
curl -X POST https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/handleStripeWebhook
```

Réponse attendue:
```json
{"error": "Unauthorized"}
```

Si vous voyez cette erreur, c'est BON SIGNE ✅ - la fonction est accessible !

---

### Étape 3: Configurer le Webhook dans Stripe Dashboard

#### 3.1 Se Connecter à Stripe
1. Aller sur: https://dashboard.stripe.com
2. Se connecter avec les identifiants du compte production
3. **Important**: Vérifier que vous êtes en mode **LIVE** (pas Test mode)

#### 3.2 Créer l'Endpoint Webhook
1. Navigation: **Developers** → **Webhooks**
2. Cliquer sur: **Add endpoint**
3. Remplir:
   - **Endpoint URL**: 
     ```
     https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/handleStripeWebhook
     ```
   - **Description**: `Production Contributions Webhook`
   - **Version**: Latest API version

#### 3.3 Sélectionner les Événements
Cocher ces événements (CRITIQUES):
- ✅ `payment_intent.succeeded` ← **LE PLUS IMPORTANT**
- ✅ `payment_intent.payment_failed`
- ✅ `payment_intent.canceled`
- ✅ `payment_intent.requires_action`
- ✅ `charge.succeeded`
- ✅ `charge.failed`
- ✅ `charge.refunded`
- ✅ `charge.dispute.created`

#### 3.4 Copier le Signing Secret
Après création, Stripe affiche:
```
Signing secret: whsec_xxxxxxxxxxxxxxxxxxxx
```

**⚠️ COPIER CE SECRET - IL NE SERA PLUS AFFICHÉ !**

---

### Étape 4: Configurer le Secret dans Firebase

```bash
# Configurer le secret webhook
firebase functions:config:set stripe.webhook_secret="whsec_VOTRE_SECRET_ICI" --project social-impact-mvp-prod-b6805

# OU via variable d'environnement (recommandé)
# Créer/éditer le fichier .env.production
echo "STRIPE_WEBHOOK_SECRET=whsec_VOTRE_SECRET_ICI" >> backend/functions/.env.production

# Redéployer avec la nouvelle config
firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805
```

---

### Étape 5: Tester le Webhook

#### 5.1 Test depuis Stripe Dashboard
1. Stripe Dashboard → Webhooks → Cliquer sur votre endpoint
2. Onglet **"Send test webhook"**
3. Sélectionner événement: `payment_intent.succeeded`
4. Cliquer **"Send test webhook"**

#### 5.2 Vérifier les Logs Firebase
```bash
# Voir les logs en temps réel
firebase functions:log --project social-impact-mvp-prod-b6805

# Filtrer uniquement le webhook
firebase functions:log --only handleStripeWebhook --project social-impact-mvp-prod-b6805
```

**Logs attendus** (après amélioration):
```
✅ Stripe webhook HTTP request received
✅ Webhook request received
✅ Verifying webhook signature
✅ Stripe webhook signature validated
✅ Processing PaymentIntent event
✅ Handling payment success
✅ Updating contribution document
✅ Payment confirmed via webhook
✅ Stripe webhook processed successfully
```

#### 5.3 Test avec Vrai Paiement (Carte Test)
1. Ouvrir l'app Flutter
2. Naviguer vers un projet
3. Cliquer "Invest"
4. Utiliser la carte test Stripe:
   - **Numéro**: `4242 4242 4242 4242`
   - **Date**: N'importe quelle date future
   - **CVC**: N'importe quel 3 chiffres
   - **ZIP**: N'importe quel code postal
5. Confirmer le paiement

**Vérifications après paiement**:

```bash
# 1. Vérifier les logs
firebase functions:log --only handleStripeWebhook --project social-impact-mvp-prod-b6805

# 2. Vérifier dans Firestore Console
# Firebase Console → Firestore Database → projects/{projectId}/contributions
# Devrait avoir un nouveau document
```

---

## 🔍 Diagnostic avec les Nouveaux Logs

### Scénario 1: Aucun Log "Stripe webhook HTTP request received"
**Diagnostic**: Stripe n'envoie PAS de requêtes au webhook  
**Cause probable**: URL webhook mal configurée dans Stripe Dashboard  
**Solution**: Vérifier l'URL dans Stripe (Étape 3)

---

### Scénario 2: Log "Missing stripe-signature header"
**Diagnostic**: Requête reçue mais sans signature Stripe  
**Cause probable**: Test manuel avec curl ou requête non-Stripe  
**Solution**: Normal pour les tests manuels. Tester depuis Stripe Dashboard.

---

### Scénario 3: Log "Invalid Stripe webhook signature"
**Diagnostic**: Signature invalide  
**Causes probables**:
- Secret webhook incorrect dans Firebase config
- Mode test/live mismatch (test key vs live key)
- Ancien secret (régénéré dans Stripe)

**Solution**:
```bash
# Vérifier la config actuelle
firebase functions:config:get stripe --project social-impact-mvp-prod-b6805

# Reconfigurer avec le bon secret
firebase functions:config:set stripe.webhook_secret="whsec_CORRECT_SECRET" --project social-impact-mvp-prod-b6805

# Redéployer
firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805
```

---

### Scénario 4: Log "PaymentIntent missing required metadata"
**Diagnostic**: PaymentIntent créé sans métadonnées  
**Cause probable**: Bug dans `stripeCreatePaymentIntent`  
**Solution**: Vérifier le code de création du PaymentIntent

**Vérifier dans le code**:
```typescript
// backend/functions/src/payments/stripeCreatePaymentIntent.ts
// Les métadonnées DOIVENT inclure:
metadata: {
  contributionId: string,
  projectId: string,
  contributorUid: string,
  originalAmount: number,
}
```

---

### Scénario 5: Log "Contribution already confirmed"
**Diagnostic**: Webhook reçu plusieurs fois pour le même paiement  
**Cause**: Normal - Stripe peut réessayer les webhooks  
**Solution**: Rien à faire, la logique d'idempotence fonctionne ✅

---

### Scénario 6: Log "Failed to handle payment success" avec erreur Firestore
**Diagnostic**: Problème lors de l'écriture dans Firestore  
**Causes probables**:
- Permissions Firestore Rules incorrectes
- Document contribution n'existe pas
- Transaction timeout

**Solution**: Vérifier les Firestore Rules
```javascript
// firestore.rules
match /projects/{projectId}/contributions/{contributionId} {
  // Les Cloud Functions doivent pouvoir écrire
  allow write: if true; // ⚠️ Vérifier cette règle
}
```

---

## 📊 Checklist de Vérification Finale

Avant de considérer le problème résolu, vérifier:

### ✅ Configuration Stripe
- [ ] Webhook endpoint créé dans Stripe Dashboard (mode LIVE)
- [ ] URL correcte: `https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/handleStripeWebhook`
- [ ] Événements sélectionnés: `payment_intent.succeeded` minimum
- [ ] Webhook actif (toggle ON dans Stripe)
- [ ] Secret webhook copié

### ✅ Configuration Firebase
- [ ] Secret webhook configuré dans Firebase Functions config
- [ ] Fonction `handleStripeWebhook` déployée
- [ ] Fonction accessible (test curl retourne 401)
- [ ] Variable d'environnement `STRIPE_WEBHOOK_SECRET` correcte

### ✅ Tests Fonctionnels
- [ ] Test webhook depuis Stripe Dashboard passe
- [ ] Logs Firebase montrent "webhook signature validated"
- [ ] Paiement test crée un document dans Firestore
- [ ] Page Investments dans l'app affiche la contribution
- [ ] Aucune erreur dans les logs Firebase

### ✅ Monitoring
- [ ] Activer les alertes Stripe pour webhooks échoués
- [ ] Configurer Firebase Monitoring pour la fonction webhook
- [ ] Dashboard Stripe montre des événements "Successfully sent"

---

## 🔧 Commandes Utiles

### Logs et Debugging
```bash
# Logs en temps réel
firebase functions:log --project social-impact-mvp-prod-b6805

# Logs du webhook uniquement
firebase functions:log --only handleStripeWebhook --project social-impact-mvp-prod-b6805

# Dernières 50 lignes
firebase functions:log --limit 50 --project social-impact-mvp-prod-b6805

# Logs des 2 dernières heures
firebase functions:log --since 2h --project social-impact-mvp-prod-b6805
```

### Déploiement
```bash
# Déployer webhook uniquement (rapide)
firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805

# Déployer toutes les fonctions paiement
firebase deploy --only functions:stripeCreatePaymentIntent,handleStripeWebhook --project social-impact-mvp-prod-b6805

# Voir les fonctions déployées
firebase functions:list --project social-impact-mvp-prod-b6805
```

### Configuration
```bash
# Voir toute la config
firebase functions:config:get --project social-impact-mvp-prod-b6805

# Config Stripe uniquement
firebase functions:config:get stripe --project social-impact-mvp-prod-b6805

# Définir le secret webhook
firebase functions:config:set stripe.webhook_secret="whsec_..." --project social-impact-mvp-prod-b6805

# Supprimer une config (pour reset)
firebase functions:config:unset stripe.webhook_secret --project social-impact-mvp-prod-b6805
```

---

## 📞 Support & Ressources

### Documentation Stripe
- Webhooks: https://stripe.com/docs/webhooks
- Signatures: https://stripe.com/docs/webhooks/signatures
- Testing: https://stripe.com/docs/webhooks/test

### Documentation Firebase
- Cloud Functions: https://firebase.google.com/docs/functions
- Environment Config: https://firebase.google.com/docs/functions/config-env

### Logs & Monitoring
- Firebase Console Logs: https://console.firebase.google.com/project/social-impact-mvp-prod-b6805/functions/logs
- Stripe Webhook Logs: https://dashboard.stripe.com/webhooks

---

## ✅ Prochaines Étapes

1. **IMMÉDIAT**: Déployer les nouveaux logs
   ```bash
   cd backend/functions
   npm run build
   firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805
   ```

2. **URGENT**: Configurer le webhook dans Stripe Dashboard
   - Créer l'endpoint avec l'URL correcte
   - Copier le signing secret
   - Activer les événements payment_intent.*

3. **CRITIQUE**: Configurer le secret dans Firebase
   ```bash
   firebase functions:config:set stripe.webhook_secret="whsec_..." --project social-impact-mvp-prod-b6805
   firebase deploy --only functions:handleStripeWebhook --project social-impact-mvp-prod-b6805
   ```

4. **VALIDATION**: Tester end-to-end
   - Test depuis Stripe Dashboard
   - Test avec carte test dans l'app
   - Vérifier les logs Firebase
   - Confirmer la création dans Firestore

5. **MONITORING**: Configurer les alertes
   - Alertes Stripe pour webhooks échoués
   - Alertes Firebase pour erreurs fonction
   - Dashboard pour suivre le taux de succès

---

**Dernière mise à jour**: 8 février 2026  
**Auteur**: GitHub Copilot  
**Statut**: Logs améliorés ✅ | Configuration manuelle requise ⚠️
