# BACKEND FIX REQUIRED: Stripe Webhook Not Creating Contributions

## ✅ SOLUTION IMPLÉMENTÉE - 8 Février 2026

**Actions Complétées**:
- ✅ Logs de débogage détaillés ajoutés dans `handleStripeWebhook.ts`
- ✅ Traçage de toutes les requêtes webhook entrantes
- ✅ Logs de vérification de signature améliorés
- ✅ Logs de métadonnées et erreurs détaillés
- ✅ Guide de configuration complet créé: `STRIPE_WEBHOOK_CONFIGURATION_GUIDE.md`

**Actions Requises (Manuel)**:
- ⚠️ Configurer l'endpoint webhook dans Stripe Dashboard
- ⚠️ Copier et configurer le signing secret dans Firebase
- ⚠️ Déployer la fonction mise à jour
- ⚠️ Tester le webhook end-to-end

**Référence**: Voir `STRIPE_WEBHOOK_CONFIGURATION_GUIDE.md` pour les étapes détaillées

---

## 📋 Executive Summary

**Problem**: After successful Stripe payment, no contribution documents are created in Firestore. The `/contributions` collection does not exist in Firebase, confirming that the `stripeWebhook` Cloud Function is either not deployed, not configured, or not being triggered by Stripe.

**Impact**: CRITICAL - Users cannot see their contribution history even after successful payments. Investments page remains empty despite payment confirmation.

**Root Cause**: Stripe webhook integration is incomplete. Either:
1. Webhook endpoint URL not configured in Stripe Dashboard (MOST LIKELY)
2. Cloud Functions not deployed to production
3. Webhook secret key misconfiguration
4. Stripe not sending events to webhook endpoint

**Status**: CODE AMÉLIORÉ ✅ | CONFIGURATION MANUELLE REQUISE ⚠️

---

## 🔴 Exact Problem

### Symptoms
1. ✅ User completes payment successfully (UI shows success message)
2. ✅ Payment Intent created in Stripe (via `stripeCreatePaymentIntent`)
3. ❌ NO `contributions` collection exists in Firestore
4. ❌ NO webhook logs in Cloud Functions logs
5. ❌ Investments page remains empty with no data

### Evidence

#### 1. Firestore State
```
Firebase Console → social-impact-mvp-prod-b6805 → Firestore Database
Collections visible:
- users
- projects
- payment_intents
- scheduled_executions
- analytics

❌ Missing: contributions (should be created by webhook)
```

#### 2. Cloud Functions Logs (Last 50 entries)
```bash
firebase functions:log --project social-impact-mvp-prod-b6805
```

**Result**: NO stripeWebhook entries found
- Only logs: `syncPlatformMetrics`, `processAuditQueue`, `api`
- ❌ No `stripeWebhook` invocations
- ❌ No payment_intent.succeeded events handled
- ❌ No contribution creation logs

#### 3. User Journey
```
User ID: 5GqHzQJ4wrRawS6z2GY1opoSb543
1. Clicked "Invest" on project
2. Completed payment form with test card
3. Stripe payment confirmed (frontend shows success)
4. ❌ No contribution document created
5. ❌ Investments page empty
```

---

## 🔍 Root Cause Analysis

### Expected Webhook Flow (Current Code)

**File**: `functions/src/payments/stripe-webhook.ts`

```typescript
export const stripeWebhook = functions.https.onRequest(
  async (req: express.Request, res: express.Response) => {
    // 1. Verify Stripe signature
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);

    // 2. Handle event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      // ...
    }
  }
);

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const {projectId, contributorId, milestoneId} = paymentIntent.metadata;

  // Create contribution record in Firestore
  const contributionRef = db.collection('contributions').doc();
  batch.set(contributionRef, {
    projectId,
    contributorId,
    milestoneId: milestoneId || null,
    amount: paymentIntent.amount / 100,
    currency: paymentIntent.currency.toUpperCase(),
    paymentIntentId: paymentIntent.id,
    status: 'completed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update project funding
  const projectRef = db.collection('projects').doc(projectId);
  batch.update(projectRef, {
    currentFunding: admin.firestore.FieldValue.increment(amount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
}
```

### Why Webhook Is Not Triggered

#### Possibility 1: Webhook Endpoint Not Configured in Stripe (MOST LIKELY)
**Symptom**: Stripe has no URL to send events to
**Check**: Stripe Dashboard → Developers → Webhooks → Should have endpoint for production
**Expected URL**: `https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeWebhook`
**Current Status**: Unknown (needs verification in Stripe Dashboard)

#### Possibility 2: Cloud Functions Not Deployed
**Symptom**: Webhook function doesn't exist in production
**Check**: Firebase Console → Functions → Should list `stripeWebhook`
**Expected Functions**:
- ✅ `stripeCreatePaymentIntent` (working - creates payment intents)
- ❓ `stripeWebhook` (status unknown)

#### Possibility 3: Webhook Secret Misconfiguration
**File**: `functions/src/payments/stripe-webhook.ts` (lines 15-17)
```typescript
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET ||
  functions.config().stripe?.webhook_secret ||
  'whsec_dummy_secret_for_emulator';
```

**Issue**: If production webhook secret doesn't match Stripe Dashboard secret, signature verification fails silently

#### Possibility 4: Stripe Using Test Mode Keys
**Issue**: If Flutter app uses test mode publishable key but Stripe Dashboard sends live mode webhooks (or vice versa), events won't match

---

## ✅ Proposed Solutions (RANKED)

### Solution 1: Configure Stripe Webhook Endpoint (RECOMMENDED - Quick Fix)

**Why**: Most likely cause - webhook simply not configured in Stripe Dashboard

**Steps**:
1. **Open Stripe Dashboard**:
   - Navigate to: https://dashboard.stripe.com/webhooks
   - Check if webhook endpoint exists for production environment

2. **Create/Update Webhook Endpoint**:
   - Click "Add endpoint"
   - URL: `https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeWebhook`
   - Description: "Production Contributions Webhook"
   - Events to send:
     ```
     payment_intent.succeeded
     payment_intent.payment_failed
     charge.refunded
     ```
   - Click "Add endpoint"

3. **Copy Signing Secret**:
   - After creation, click on webhook endpoint
   - Copy "Signing secret" (format: `whsec_...`)

4. **Update Firebase Functions Config**:
   ```bash
   firebase use social-impact-mvp-prod-b6805
   firebase functions:config:set stripe.webhook_secret="whsec_YOUR_ACTUAL_SECRET"
   firebase deploy --only functions:stripeWebhook
   ```

5. **Verify Deployment**:
   ```bash
   firebase functions:list --project social-impact-mvp-prod-b6805
   # Should show: stripeWebhook (deployed)
   ```

6. **Test Webhook**:
   - Stripe Dashboard → Webhook endpoint → "Send test webhook"
   - Select event: `payment_intent.succeeded`
   - Click "Send test webhook"
   - Check Firebase Functions logs: `firebase functions:log --project social-impact-mvp-prod-b6805`
   - Should see: "Payment succeeded for project..."

**Expected Result**:
- ✅ Stripe sends events to Cloud Function
- ✅ `contributions` collection created in Firestore
- ✅ Investments page populated with user contributions

**Risk**: LOW - Non-destructive, reversible
**Complexity**: LOW - Configuration only
**Time**: 10-15 minutes

---

### Solution 2: Verify Cloud Functions Deployment

**Why**: Ensure webhook function actually exists in production

**Steps**:
1. **List Deployed Functions**:
   ```bash
   firebase functions:list --project social-impact-mvp-prod-b6805
   ```
   
   Expected output should include:
   ```
   ✔ functions(stripeCreatePaymentIntent): [OK]
   ✔ functions(stripeWebhook): [OK]
   ```

2. **If `stripeWebhook` Missing, Deploy It**:
   ```bash
   cd functions
   npm install
   npm run build
   firebase deploy --only functions:stripeWebhook --project social-impact-mvp-prod-b6805
   ```

3. **Verify Deployment**:
   ```bash
   curl -X POST https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeWebhook
   # Should return: "Missing stripe-signature header" (means function is live)
   ```

**Expected Result**:
- ✅ Webhook function deployed and accessible
- ✅ Ready to receive Stripe events

**Risk**: LOW - Deployment only
**Complexity**: MEDIUM - Requires build + deploy
**Time**: 5-10 minutes

---

### Solution 3: Add Debug Logging to Webhook

**Why**: If webhook is deployed but failing silently, need diagnostics

**File Location**: `functions/src/payments/stripe-webhook.ts`

**Changes** (add after line 21):
```typescript
export const stripeWebhook = functions.https.onRequest(
  async (req: express.Request, res: express.Response) => {
    // ⭐ ADD: Log all incoming webhook requests
    functions.logger.info('Webhook received', {
      headers: req.headers,
      hasSignature: !!req.headers['stripe-signature'],
      method: req.method,
      timestamp: new Date().toISOString(),
    });

    const sig = req.headers['stripe-signature'];

    if (!sig) {
      functions.logger.error('Missing stripe-signature header');
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    let event: Stripe.Event;

    try {
      const rawBody = (req as any).rawBody || req.body;
      
      // ⭐ ADD: Log signature verification attempt
      functions.logger.info('Verifying webhook signature', {
        endpointSecretConfigured: !!endpointSecret && endpointSecret !== 'whsec_dummy_secret_for_emulator',
        bodyType: typeof rawBody,
      });

      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
      
      // ⭐ ADD: Log successful verification
      functions.logger.info('Webhook signature verified', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (err) {
      functions.logger.error('Webhook signature verification failed:', {
        error: err,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      res.status(400).send(`Webhook Error: ${err}`);
      return;
    }

    // ⭐ ADD: Log event handling
    functions.logger.info('Processing webhook event', {
      eventType: event.type,
      eventId: event.id,
    });

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
        break;
      // ... rest of cases
    }

    res.json({ received: true });
  }
);
```

**In `handlePaymentSuccess` function** (after line 68):
```typescript
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const {projectId, contributorId, milestoneId} = paymentIntent.metadata;

  // ⭐ ADD: Log payment success handling start
  functions.logger.info('Handling payment success', {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount / 100,
    currency: paymentIntent.currency,
    projectId,
    contributorId,
    milestoneId,
  });

  try {
    const db = admin.firestore();
    const batch = db.batch();

    // Create contribution record
    const contributionRef = db.collection('contributions').doc();
    
    // ⭐ ADD: Log contribution creation
    functions.logger.info('Creating contribution document', {
      contributionId: contributionRef.id,
      projectId,
      contributorId,
      amount: paymentIntent.amount / 100,
    });

    batch.set(contributionRef, {
      projectId,
      contributorId,
      milestoneId: milestoneId || null,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      paymentIntentId: paymentIntent.id,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ... rest of function

    await batch.commit();

    // ⭐ ADD: Log success
    functions.logger.info('Payment success handled successfully', {
      paymentIntentId: paymentIntent.id,
      contributionId: contributionRef.id,
      projectId,
    });

    // Send notification to project owner
    await sendContributionNotification(projectId, contributorId, paymentIntent.amount / 100);
  } catch (error) {
    // ⭐ ENHANCE: Log detailed error
    functions.logger.error('Error handling payment success:', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      paymentIntentId: paymentIntent.id,
      projectId,
    });
  }
}
```

**Deploy Changes**:
```bash
cd functions
npm run build
firebase deploy --only functions:stripeWebhook --project social-impact-mvp-prod-b6805
```

**Expected Result**:
- ✅ Detailed logs show webhook invocation attempts
- ✅ Identify exact failure point (signature, event handling, Firestore write)
- ✅ Easier debugging for future issues

**Risk**: LOW - Logging only, no functional changes
**Complexity**: MEDIUM - Code changes + deployment
**Time**: 15-20 minutes

---

### Solution 4: Create Manual Test Contribution (TEMPORARY WORKAROUND)

**Why**: Unblock user while webhook is being fixed

**Method 1: Firebase Console (Recommended)**
1. Open Firebase Console → Firestore Database
2. Click "Start collection"
3. Collection ID: `contributions`
4. Document ID: Auto-generate
5. Fields:
   ```
   projectId: [select from projects collection]
   contributorId: 5GqHzQJ4wrRawS6z2GY1opoSb543
   amount: 10.00
   currency: EUR
   paymentIntentId: pi_test_manual_entry
   status: completed
   createdAt: [timestamp - now]
   milestoneId: null
   ```
6. Save document
7. Refresh Flutter app → Investments page should show entry

**Method 2: Node.js Script**
```javascript
// create_manual_contribution.js
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

async function createManualContribution() {
  const contribution = {
    projectId: 'PROJECT_ID_HERE',
    contributorId: '5GqHzQJ4wrRawS6z2GY1opoSb543',
    amount: 10.00,
    currency: 'EUR',
    paymentIntentId: 'pi_manual_test_' + Date.now(),
    status: 'completed',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    milestoneId: null,
  };

  const ref = await db.collection('contributions').add(contribution);
  console.log('✅ Manual contribution created:', ref.id);
}

createManualContribution();
```

**Expected Result**:
- ✅ User can see test contribution in Investments page
- ✅ Validates that frontend query logic works correctly
- ⚠️ TEMPORARY - Does not fix underlying webhook issue

**Risk**: LOW - Can be deleted later
**Complexity**: LOW - Manual data entry
**Time**: 5 minutes

---

## 🛠️ Implementation Instructions

### PRIORITY 1: Configure Stripe Webhook (DO THIS FIRST)

**Exact Steps**:

1. **Verify Current Deployment Status**:
```bash
# Terminal commands
firebase use social-impact-mvp-prod-b6805
firebase functions:list
```

Expected output should include `stripeWebhook`. If missing, run:
```bash
cd functions
npm install
npm run build
firebase deploy --only functions:stripeWebhook
```

2. **Get Webhook URL**:
```
https://us-central1-social-impact-mvp-prod-b6805.cloudfunctions.net/stripeWebhook
```

3. **Configure in Stripe Dashboard**:
- Login: https://dashboard.stripe.com
- Navigate: Developers → Webhooks
- Click: "Add endpoint"
- Enter URL from step 2
- Select events:
  - `payment_intent.succeeded` ✅
  - `payment_intent.payment_failed` ✅
  - `charge.refunded` ✅
- Copy signing secret (format: `whsec_...`)

4. **Update Firebase Config**:
```bash
firebase functions:config:set stripe.webhook_secret="whsec_PASTE_SECRET_HERE"
firebase deploy --only functions:stripeWebhook
```

5. **Test Webhook**:
```bash
# In Stripe Dashboard, send test webhook
# Then check logs:
firebase functions:log --project social-impact-mvp-prod-b6805

# Should see:
# "Webhook received"
# "Payment succeeded for project..."
```

6. **Test with Real Payment**:
- Flutter app → Make test contribution
- Check Firestore → Should have new document in `contributions` collection
- Check Investments page → Should display contribution

---

### PRIORITY 2: Add Debug Logging (If Solution 1 Doesn't Work)

**Files to Modify**:
- `functions/src/payments/stripe-webhook.ts`

**Changes**: See Solution 3 above for exact code additions

**Deployment**:
```bash
cd functions
npm run build
firebase deploy --only functions:stripeWebhook
```

---

## 📊 Test Validation

### Test Case 1: Webhook Configuration Verification
**Steps**:
1. Stripe Dashboard → Webhooks → Check endpoint exists
2. URL matches Cloud Function URL
3. Events include `payment_intent.succeeded`
4. Status is "Enabled"

**Expected Result**: ✅ All checks pass

---

### Test Case 2: Webhook Invocation Test
**Steps**:
1. Stripe Dashboard → Webhook endpoint → "Send test webhook"
2. Select event: `payment_intent.succeeded`
3. Send webhook
4. Check Firebase logs: `firebase functions:log`

**Expected Result**: 
```
✅ Log entry: "Webhook received"
✅ Log entry: "Payment succeeded for project..."
✅ No errors
```

---

### Test Case 3: End-to-End Payment Flow
**Steps**:
1. Flutter app → Navigate to project
2. Click "Invest" button
3. Enter test amount (€10)
4. Complete payment with test card: `4242 4242 4242 4242`
5. Wait for success message
6. Navigate to Investments page

**Expected Result**:
```
✅ Payment succeeds
✅ Success message displayed
✅ Contribution appears in Investments page
✅ Firestore: /contributions collection has new document
✅ Document fields:
   - contributorId = user's UID
   - projectId = correct project
   - amount = 10.00
   - currency = EUR
   - status = completed
   - paymentIntentId = pi_...
```

---

## 🔒 Security Considerations

### Webhook Signature Verification
**Current Implementation**: ✅ Good
```typescript
event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
```
- Verifies Stripe signature before processing
- Prevents spoofed webhook requests
- Uses secret key from Firebase config

**Recommendation**: Ensure `endpointSecret` is configured correctly in production

---

### Firestore Security Rules
**Current Rules** (`firestore.rules` line 68):
```javascript
match /contributions/{contributionId} {
  allow read: if isAuthenticated() && 
    (resource.data.contributorId == request.auth.uid || ...);
  allow create: if false; // ✅ Only Cloud Functions can create
  allow update: if false; // ✅ Only Cloud Functions can update
  allow delete: if false; // ✅ Audit trail protected
}
```

**Status**: ✅ CORRECT - Ensures only webhook can create contributions

---

## 📈 Impact Assessment

### Performance Impact
**Current**: N/A (webhook not running)
**After Fix**: MINIMAL
- Webhook processes payment events asynchronously
- Batch write (contribution + project update) is atomic
- Typical execution time: 200-500ms

### Cost Impact
**Cloud Functions Invocations**: 
- Per payment: 1 webhook invocation
- Expected monthly: ~100-1000 invocations (depends on usage)
- Cost: $0.000000001 per invocation (negligible)

**Firestore Writes**:
- Per payment: 2 writes (contribution + project update)
- Cost: $0.18 per 100K writes (negligible for MVP)

### User Experience Impact
**Before Fix**: ❌ CRITICAL
- Users complete payment but see no confirmation
- No contribution history
- Lost trust in platform

**After Fix**: ✅ EXCELLENT
- Immediate contribution tracking
- Complete payment history
- Transparent transaction records

---

## 📚 References

### Firebase Documentation
- Cloud Functions HTTP triggers: https://firebase.google.com/docs/functions/http-events
- Firestore batch writes: https://firebase.google.com/docs/firestore/manage-data/transactions

### Stripe Documentation
- Webhooks guide: https://stripe.com/docs/webhooks
- Webhook signatures: https://stripe.com/docs/webhooks/signatures
- Testing webhooks: https://stripe.com/docs/webhooks/test

### Project Files
- **Webhook Implementation**: `functions/src/payments/stripe-webhook.ts`
- **Payment Intent Creation**: `functions/src/payments/create-payment-intent.ts`
- **Frontend Integration**: `lib/features/investments/data/repositories/investments_repository_impl.dart`
- **Firestore Rules**: `firestore.rules` (lines 255-270)

---

## 🎯 Summary & Next Steps

### Immediate Action Required
1. ✅ **Solution 1**: Configure Stripe webhook endpoint (15 min)
2. ✅ **Solution 2**: Verify Cloud Functions deployment (10 min)
3. ✅ **Solution 3**: Add debug logging for future issues (20 min)

### Expected Timeline
- **Quick fix** (Solution 1): 15-20 minutes
- **Full resolution** (All solutions): 45-60 minutes
- **Testing & verification**: 15 minutes

### Success Criteria
- ✅ Stripe webhook endpoint configured and enabled
- ✅ Cloud Function receives and processes webhook events
- ✅ `/contributions` collection created in Firestore
- ✅ User contributions visible in Investments page
- ✅ End-to-end payment flow works seamlessly

---

**Backend AI Agent**: Please implement Solution 1 first, then Solution 2 if needed, then Solution 3 for robustness. Test thoroughly with Test Cases 1-3 before marking as complete.
