# Guide Webhooks et Endpoints Automatisé pour LLM
## Social Finance Impact Platform MVP

## 1. Architecture des webhooks sécurisés

### 1.1 Système de validation des webhooks

```typescript
// src/webhooks/webhookValidator.ts
import { Request, Response } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface WebhookConfig {
  service: string;
  secretKey: string;
  signatureHeader: string;
  signaturePrefix?: string;
  timestampTolerance?: number;
  algorithm?: string;
}

export class WebhookValidator {
  private configs: Map<string, WebhookConfig> = new Map();

  constructor() {
    this.initializeConfigs();
  }

  private initializeConfigs(): void {
    // Configuration Stripe
    this.configs.set('stripe', {
      service: 'stripe',
      secretKey: process.env.STRIPE_WEBHOOK_SECRET || '',
      signatureHeader: 'stripe-signature',
      signaturePrefix: 'v1=',
      timestampTolerance: 300, // 5 minutes
      algorithm: 'sha256'
    });

    // Configuration Sumsub
    this.configs.set('sumsub', {
      service: 'sumsub',
      secretKey: process.env.SUMSUB_WEBHOOK_SECRET || '',
      signatureHeader: 'x-payload-digest',
      algorithm: 'sha256'
    });

    // Configuration SendGrid
    this.configs.set('sendgrid', {
      service: 'sendgrid',
      secretKey: process.env.SENDGRID_WEBHOOK_SECRET || '',
      signatureHeader: 'x-twilio-email-event-webhook-signature',
      signaturePrefix: 'sha256=',
      algorithm: 'sha256'
    });
  }

  validateWebhook(service: string, req: Request): {
    isValid: boolean;
    error?: string;
    payload?: any;
  } {
    const config = this.configs.get(service);
    if (!config) {
      return { isValid: false, error: `Unknown webhook service: ${service}` };
    }

    if (!config.secretKey) {
      return { isValid: false, error: `Missing secret key for ${service}` };
    }

    try {
      switch (service) {
        case 'stripe':
          return this.validateStripeWebhook(req, config);
        case 'sumsub':
          return this.validateSumsubWebhook(req, config);
        case 'sendgrid':
          return this.validateSendGridWebhook(req, config);
        default:
          return this.validateGenericWebhook(req, config);
      }
    } catch (error) {
      logger.error('Webhook validation error', error as Error, { service });
      return { isValid: false, error: (error as Error).message };
    }
  }

  private validateStripeWebhook(req: Request, config: WebhookConfig) {
    const signature = req.headers[config.signatureHeader] as string;
    if (!signature) {
      return { isValid: false, error: 'Missing Stripe signature header' };
    }

    const payload = req.body;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(payload));

    // Parser la signature Stripe (format: t=timestamp,v1=signature)
    const sigElements = signature.split(',');
    const timestamp = sigElements.find(el => el.startsWith('t='))?.substring(2);
    const sig = sigElements.find(el => el.startsWith('v1='))?.substring(3);

    if (!timestamp || !sig) {
      return { isValid: false, error: 'Invalid Stripe signature format' };
    }

    // Vérifier l'âge du timestamp
    const webhookTimestamp = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    
    if (config.timestampTolerance && 
        Math.abs(currentTime - webhookTimestamp) > config.timestampTolerance) {
      return { isValid: false, error: 'Webhook timestamp too old' };
    }

    // Calculer la signature attendue
    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', config.secretKey)
      .update(signedPayload)
      .digest('hex');

    // Comparaison sécurisée
    const isValid = crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    return {
      isValid,
      error: isValid ? undefined : 'Invalid Stripe signature',
      payload: isValid ? payload : undefined
    };
  }

  private validateSumsubWebhook(req: Request, config: WebhookConfig) {
    const signature = req.headers[config.signatureHeader] as string;
    if (!signature) {
      return { isValid: false, error: 'Missing Sumsub signature header' };
    }

    const payload = req.body;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(payload));

    const expectedSignature = crypto
      .createHmac('sha256', config.secretKey)
      .update(rawBody)
      .digest('hex');

    const providedSignature = signature.startsWith('sha256=') 
      ? signature.substring(7) 
      : signature;

    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    return {
      isValid,
      error: isValid ? undefined : 'Invalid Sumsub signature',
      payload: isValid ? payload : undefined
    };
  }

  private validateSendGridWebhook(req: Request, config: WebhookConfig) {
    const signature = req.headers[config.signatureHeader] as string;
    const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string;

    if (!signature || !timestamp) {
      return { isValid: false, error: 'Missing SendGrid headers' };
    }

    const payload = JSON.stringify(req.body);
    const signatureData = timestamp + payload;

    const expectedSignature = crypto
      .createHmac('sha256', config.secretKey)
      .update(signatureData)
      .digest('base64');

    const providedSignature = signature.startsWith('sha256=') 
      ? signature.substring(7) 
      : signature;

    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );

    return {
      isValid,
      error: isValid ? undefined : 'Invalid SendGrid signature',
      payload: isValid ? req.body : undefined
    };
  }

  private validateGenericWebhook(req: Request, config: WebhookConfig) {
    const signature = req.headers[config.signatureHeader] as string;
    if (!signature) {
      return { isValid: false, error: `Missing signature header: ${config.signatureHeader}` };
    }

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expectedSignature = crypto
      .createHmac(config.algorithm || 'sha256', config.secretKey)
      .update(rawBody)
      .digest('hex');

    const providedSignature = config.signaturePrefix 
      ? signature.replace(config.signaturePrefix, '') 
      : signature;

    const isValid = crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );

    return {
      isValid,
      error: isValid ? undefined : 'Invalid webhook signature',
      payload: isValid ? req.body : undefined
    };
  }
}

// Middleware Express pour validation automatique
export function createWebhookMiddleware(service: string) {
  const validator = new WebhookValidator();

  return (req: Request, res: Response, next: any) => {
    const validation = validator.validateWebhook(service, req);

    if (!validation.isValid) {
      logger.warn('Webhook validation failed', {
        service,
        error: validation.error,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      return res.status(400).json({
        error: 'Webhook validation failed',
        message: validation.error
      });
    }

    // Ajouter payload validé à la requête
    req.validatedPayload = validation.payload;
    
    logger.info('Webhook validated successfully', {
      service,
      eventType: validation.payload?.type || validation.payload?.event_type,
      ip: req.ip
    });

    next();
  };
}
```

## 2. Handlers de webhooks spécialisés

### 2.1 Webhook Stripe complet

```typescript
// src/webhooks/stripeWebhook.ts
import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import { createWebhookMiddleware } from './webhookValidator';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { withRetry } from '../utils/errors';

export const handleStripeWebhook = https.onRequest(async (req: Request, res: Response) => {
  // Validation du webhook
  const validationMiddleware = createWebhookMiddleware('stripe');
  
  return new Promise<void>((resolve, reject) => {
    validationMiddleware(req, res, async () => {
      try {
        await processStripeEvent(req.validatedPayload);
        res.status(200).json({ received: true });
        resolve();
      } catch (error) {
        logger.error('Stripe webhook processing failed', error as Error);
        res.status(500).json({ error: 'Processing failed' });
        reject(error);
      }
    });
  });
});

async function processStripeEvent(event: any): Promise<void> {
  const { type, data } = event;

  logger.info('Processing Stripe webhook event', {
    eventType: type,
    eventId: event.id,
    livemode: event.livemode
  });

  switch (type) {
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(data.object);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(data.object);
      break;

    case 'payment_intent.canceled':
      await handlePaymentCanceled(data.object);
      break;

    case 'charge.dispute.created':
      await handleChargeDispute(data.object);
      break;

    case 'transfer.created':
      await handleTransferCreated(data.object);
      break;

    case 'account.updated':
      await handleAccountUpdated(data.object);
      break;

    default:
      logger.info('Unhandled Stripe event type', { eventType: type });
  }
}

const handlePaymentSucceeded = withRetry(async (paymentIntent: any) => {
  const { id: paymentId, amount, metadata } = paymentIntent;
  const { projectId, contributorUid, contributionId } = metadata;

  logger.info('Processing successful payment', {
    paymentId,
    amount,
    projectId,
    contributorUid
  });

  await firestoreHelper.runTransaction(async (transaction) => {
    // 1. Mettre à jour la contribution
    const contributionRef = firestoreHelper.getDocumentRef(
      `projects/${projectId}/contributions`,
      contributionId
    );

    transaction.update(contributionRef, {
      status: 'confirmed',
      paymentId,
      confirmedAt: new Date(),
      paymentMethod: 'stripe'
    });

    // 2. Mettre à jour les stats du projet
    const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
    const project = await transaction.get(projectRef);
    
    if (project.exists) {
      const projectData = project.data();
      const newFundingRaised = (projectData?.fundingRaised || 0) + amount;
      const fundingPercentage = Math.round((newFundingRaised / projectData?.fundingGoal) * 100);

      transaction.update(projectRef, {
        fundingRaised: newFundingRaised,
        fundingPercentage,
        'stats.contributions': (projectData?.stats?.contributions || 0) + 1,
        'stats.contributors': (projectData?.stats?.contributors || 0) + 1,
        lastContributionAt: new Date()
      });

      // 3. Vérifier si objectif atteint
      if (fundingPercentage >= 100 && projectData?.status === 'live') {
        transaction.update(projectRef, {
          status: 'funded',
          fundedAt: new Date()
        });

        // Déclencher processus post-funding
        // TODO: Trigger audit assignment
      }
    }

    // 4. Mettre à jour les stats utilisateur
    const userRef = firestoreHelper.getDocumentRef('users', contributorUid);
    const user = await transaction.get(userRef);
    
    if (user.exists) {
      const userData = user.data();
      transaction.update(userRef, {
        'stats.totalContributed': (userData?.stats?.totalContributed || 0) + amount,
        'stats.contributionsCount': (userData?.stats?.contributionsCount || 0) + 1,
        lastContributionAt: new Date()
      });
    }

    // 5. Créer transaction dans ledger
    const transactionRef = firestoreHelper.getCollectionRef('transactions').doc();
    transaction.set(transactionRef, {
      type: 'contribution',
      status: 'completed',
      amount,
      currency: 'EUR',
      from: contributorUid,
      to: 'platform_escrow',
      projectId,
      contributionId,
      paymentId,
      createdAt: new Date(),
      metadata: {
        source: 'stripe_webhook',
        eventType: 'payment_intent.succeeded'
      }
    });
  });

  // 6. Déclencher notifications
  await sendContributionConfirmation(contributorUid, projectId, amount);
  
  logger.info('Payment processing completed', { paymentId, amount, projectId });
});

const handlePaymentFailed = withRetry(async (paymentIntent: any) => {
  const { id: paymentId, amount, metadata, last_payment_error } = paymentIntent;
  const { projectId, contributorUid, contributionId } = metadata;

  logger.warn('Processing failed payment', {
    paymentId,
    amount,
    projectId,
    error: last_payment_error?.message
  });

  await firestoreHelper.runTransaction(async (transaction) => {
    // Mettre à jour la contribution comme échouée
    const contributionRef = firestoreHelper.getDocumentRef(
      `projects/${projectId}/contributions`,
      contributionId
    );

    transaction.update(contributionRef, {
      status: 'failed',
      paymentId,
      failedAt: new Date(),
      failureReason: last_payment_error?.message || 'Payment failed',
      retryCount: 1
    });

    // Enregistrer l'échec dans le ledger
    const transactionRef = firestoreHelper.getCollectionRef('transactions').doc();
    transaction.set(transactionRef, {
      type: 'contribution',
      status: 'failed',
      amount,
      currency: 'EUR',
      from: contributorUid,
      projectId,
      contributionId,
      paymentId,
      failureReason: last_payment_error?.message,
      createdAt: new Date()
    });
  });

  // Notifier l'utilisateur de l'échec
  await sendPaymentFailureNotification(contributorUid, projectId, last_payment_error?.message);
});

const handleChargeDispute = withRetry(async (dispute: any) => {
  const { id: disputeId, amount, charge, reason, status } = dispute;

  logger.warn('Processing charge dispute', {
    disputeId,
    chargeId: charge,
    amount,
    reason,
    status
  });

  // Trouver la contribution associée
  const charge_data = await getStripeCharge(charge);
  const paymentId = charge_data.payment_intent;
  
  const contributionsSnapshot = await firestoreHelper.queryDocuments(
    'contributions', // Note: utiliser collectionGroup pour rechercher dans toutes les contributions
    [{ field: 'paymentId', operator: '==', value: paymentId }]
  );

  if (contributionsSnapshot.data.length === 0) {
    logger.error('No contribution found for disputed charge', { disputeId, paymentId });
    return;
  }

  const contribution = contributionsSnapshot.data[0];

  await firestoreHelper.runTransaction(async (transaction) => {
    // Marquer la contribution comme disputée
    const contributionPath = `projects/${contribution.projectId}/contributions/${contribution.id}`;
    const contributionRef = firestoreHelper.getDocumentRef('', contributionPath);

    transaction.update(contributionRef, {
      status: 'disputed',
      disputeId,
      disputedAt: new Date(),
      disputeReason: reason,
      disputeStatus: status
    });

    // Enregistrer dans ledger
    const transactionRef = firestoreHelper.getCollectionRef('transactions').doc();
    transaction.set(transactionRef, {
      type: 'dispute',
      status: 'created',
      amount: -amount, // Montant négatif pour dispute
      currency: 'EUR',
      projectId: contribution.projectId,
      contributionId: contribution.id,
      disputeId,
      reason,
      createdAt: new Date()
    });
  });

  // Notifier les administrateurs
  await sendDisputeAlert(disputeId, contribution, reason);
});
```

### 2.2 Webhook Sumsub (KYC)

```typescript
// src/webhooks/sumsubWebhook.ts
import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import { createWebhookMiddleware } from './webhookValidator';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { getAuth } from 'firebase-admin/auth';

export const handleSumsubWebhook = https.onRequest(async (req: Request, res: Response) => {
  const validationMiddleware = createWebhookMiddleware('sumsub');
  
  return new Promise<void>((resolve, reject) => {
    validationMiddleware(req, res, async () => {
      try {
        await processSumsubEvent(req.validatedPayload);
        res.status(200).json({ received: true });
        resolve();
      } catch (error) {
        logger.error('Sumsub webhook processing failed', error as Error);
        res.status(500).json({ error: 'Processing failed' });
        reject(error);
      }
    });
  });
});

async function processSumsubEvent(event: any): Promise<void> {
  const { type, applicantId, inspectionId, correlationId } = event;

  logger.info('Processing Sumsub webhook event', {
    eventType: type,
    applicantId,
    inspectionId,
    correlationId
  });

  // Trouver l'utilisateur par correlationId (qui contient l'UID Firebase)
  const userId = correlationId;
  
  switch (type) {
    case 'applicantReviewed':
      await handleApplicantReviewed(event, userId);
      break;

    case 'applicantPending':
      await handleApplicantPending(event, userId);
      break;

    case 'applicantOnHold':
      await handleApplicantOnHold(event, userId);
      break;

    case 'applicantActionPending':
      await handleApplicantActionPending(event, userId);
      break;

    default:
      logger.info('Unhandled Sumsub event type', { eventType: type });
  }
}

async function handleApplicantReviewed(event: any, userId: string): Promise<void> {
  const { reviewResult, rejectLabels, applicantId } = event;

  const kycStatus = reviewResult === 'GREEN' ? 'approved' : 'rejected';
  const kycLevel = reviewResult === 'GREEN' ? 1 : 0;

  logger.info('Processing KYC review result', {
    userId,
    applicantId,
    reviewResult,
    kycStatus
  });

  await firestoreHelper.runTransaction(async (transaction) => {
    const userRef = firestoreHelper.getDocumentRef('users', userId);
    const userDoc = await transaction.get(userRef);
    
    if (!userDoc.exists) {
      throw new Error(`User not found: ${userId}`);
    }

    // Mettre à jour le statut KYC
    const updateData = {
      kycStatus,
      kycLevel,
      kycCompletedAt: new Date(),
      kycApplicantId: applicantId,
      kycReviewResult: reviewResult,
      ...(kycStatus === 'rejected' && { kycRejectionReasons: rejectLabels })
    };

    transaction.update(userRef, updateData);

    // Enregistrer dans l'historique KYC
    const kycHistoryRef = firestoreHelper.getCollectionRef(`users/${userId}/kyc_history`).doc();
    transaction.set(kycHistoryRef, {
      status: kycStatus,
      level: kycLevel,
      applicantId,
      reviewResult,
      rejectLabels: rejectLabels || null,
      processedAt: new Date(),
      source: 'sumsub_webhook'
    });
  });

  // Mettre à jour les custom claims Firebase Auth
  const customClaims = {
    kycStatus,
    kycLevel
  };

  await getAuth().setCustomUserClaims(userId, customClaims);

  // Envoyer notification à l'utilisateur
  if (kycStatus === 'approved') {
    await sendKYCApprovalNotification(userId);
  } else {
    await sendKYCRejectionNotification(userId, rejectLabels);
  }

  logger.info('KYC status updated successfully', { userId, kycStatus, kycLevel });
}

async function handleApplicantPending(event: any, userId: string): Promise<void> {
  const { applicantId } = event;

  await firestoreHelper.updateDocument('users', userId, {
    kycStatus: 'pending',
    kycApplicantId: applicantId,
    kycSubmittedAt: new Date()
  });

  await sendKYCPendingNotification(userId);

  logger.info('KYC status set to pending', { userId, applicantId });
}

async function handleApplicantActionPending(event: any, userId: string): Promise<void> {
  const { applicantId } = event;

  await firestoreHelper.updateDocument('users', userId, {
    kycStatus: 'requires_action',
    kycApplicantId: applicantId,
    kycActionRequiredAt: new Date()
  });

  await sendKYCActionRequiredNotification(userId);

  logger.info('KYC requires user action', { userId, applicantId });
}
```

### 2.3 Webhook SendGrid (Email Events)

```typescript
// src/webhooks/sendgridWebhook.ts
import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import { createWebhookMiddleware } from './webhookValidator';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export const handleSendGridWebhook = https.onRequest(async (req: Request, res: Response) => {
  const validationMiddleware = createWebhookMiddleware('sendgrid');
  
  return new Promise<void>((resolve, reject) => {
    validationMiddleware(req, res, async () => {
      try {
        // SendGrid envoie un array d'événements
        const events = Array.isArray(req.validatedPayload) 
          ? req.validatedPayload 
          : [req.validatedPayload];

        await Promise.all(events.map(processSendGridEvent));
        
        res.status(200).json({ received: true, processed: events.length });
        resolve();
      } catch (error) {
        logger.error('SendGrid webhook processing failed', error as Error);
        res.status(500).json({ error: 'Processing failed' });
        reject(error);
      }
    });
  });
});

async function processSendGridEvent(event: any): Promise<void> {
  const { event: eventType, email, sg_message_id, timestamp } = event;

  logger.info('Processing SendGrid event', {
    eventType,
    email,
    messageId: sg_message_id,
    timestamp
  });

  // Mettre à jour les statistiques d'email
  await updateEmailStats(eventType, email, sg_message_id, event);

  switch (eventType) {
    case 'delivered':
      await handleEmailDelivered(event);
      break;

    case 'opened':
      await handleEmailOpened(event);
      break;

    case 'click':
      await handleEmailClicked(event);
      break;

    case 'bounce':
      await handleEmailBounced(event);
      break;

    case 'dropped':
      await handleEmailDropped(event);
      break;

    case 'spam_report':
      await handleSpamReport(event);
      break;

    case 'unsubscribe':
      await handleUnsubscribe(event);
      break;

    default:
      logger.info('Unhandled SendGrid event type', { eventType });
  }
}

async function updateEmailStats(
  eventType: string, 
  email: string, 
  messageId: string, 
  eventData: any
): Promise<void> {
  const statsRef = firestoreHelper.getDocumentRef('email_stats', 'global');
  
  const incrementField = `events.${eventType}`;
  const dailyField = `daily.${new Date().toISOString().split('T')[0]}.${eventType}`;

  await firestoreHelper.runTransaction(async (transaction) => {
    const doc = await transaction.get(statsRef);
    
    if (!doc.exists) {
      transaction.set(statsRef, {
        events: { [eventType]: 1 },
        daily: { [new Date().toISOString().split('T')[0]]: { [eventType]: 1 } },
        lastUpdated: new Date()
      });
    } else {
      const data = doc.data() || {};
      const events = data.events || {};
      const daily = data.daily || {};
      const today = new Date().toISOString().split('T')[0];
      
      transaction.update(statsRef, {
        [`events.${eventType}`]: (events[eventType] || 0) + 1,
        [`daily.${today}.${eventType}`]: ((daily[today] || {})[eventType] || 0) + 1,
        lastUpdated: new Date()
      });
    }

    // Enregistrer événement détaillé
    const eventRef = firestoreHelper.getCollectionRef('email_events').doc();
    transaction.set(eventRef, {
      type: eventType,
      email,
      messageId,
      timestamp: new Date(eventData.timestamp * 1000),
      data: eventData,
      createdAt: new Date()
    });
  });
}

async function handleEmailBounced(event: any): Promise<void> {
  const { email, reason, type } = event;
  
  // Marquer email comme bounced pour éviter les futurs envois
  await firestoreHelper.setDocument('email_bounces', email.replace(/[^a-zA-Z0-9]/g, '_'), {
    email,
    bounceType: type,
    reason,
    bouncedAt: new Date(),
    status: 'bounced'
  });

  logger.warn('Email bounced', { email, reason, type });
}

async function handleSpamReport(event: any): Promise<void> {
  const { email } = event;
  
  // Marquer comme spam et désabonner automatiquement
  await firestoreHelper.setDocument('email_unsubscribes', email.replace(/[^a-zA-Z0-9]/g, '_'), {
    email,
    reason: 'spam_report',
    unsubscribedAt: new Date(),
    source: 'sendgrid_webhook'
  });

  // Trouver l'utilisateur et mettre à jour ses préférences
  const usersSnapshot = await firestoreHelper.queryDocuments(
    'users',
    [{ field: 'email', operator: '==', value: email }]
  );

  if (usersSnapshot.data.length > 0) {
    const user = usersSnapshot.data[0];
    await firestoreHelper.updateDocument('users', user.id, {
      'preferences.notifications.email': false,
      'preferences.unsubscribedAt': new Date(),
      'preferences.unsubscribeReason': 'spam_report'
    });
  }

  logger.warn('Spam report received', { email });
}
```

## 3. Rate limiting et protection DDoS

### 3.1 Rate limiter pour webhooks

```typescript
// src/webhooks/rateLimiter.ts
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
  blocked: boolean;
}

export class WebhookRateLimiter {
  private limits: Map<string, RateLimitRecord> = new Map();
  private configs: Map<string, RateLimitConfig> = new Map();

  constructor() {
    // Configuration par service
    this.configs.set('stripe', { windowMs: 60000, maxRequests: 100 }); // 100 req/min
    this.configs.set('sumsub', { windowMs: 60000, maxRequests: 50 });  // 50 req/min
    this.configs.set('sendgrid', { windowMs: 60000, maxRequests: 200 }); // 200 req/min
    
    // Nettoyage périodique
    setInterval(() => this.cleanup(), 60000); // Toutes les minutes
  }

  checkLimit(service: string, clientId: string): {
    allowed: boolean;
    remaining: number;
    resetTime: number;
  } {
    const config = this.configs.get(service);
    if (!config) {
      // Pas de limite configurée, autoriser
      return { allowed: true, remaining: -1, resetTime: 0 };
    }

    const key = `${service}:${clientId}`;
    const now = Date.now();
    const record = this.limits.get(key) || {
      count: 0,
      resetTime: now + config.windowMs,
      blocked: false
    };

    // Reset si fenêtre expirée
    if (now >= record.resetTime) {
      record.count = 0;
      record.resetTime = now + config.windowMs;
      record.blocked = false;
    }

    // Vérifier limite
    if (record.count >= config.maxRequests) {
      record.blocked = true;
      this.limits.set(key, record);
      
      logger.warn('Rate limit exceeded', {
        service,
        clientId,
        count: record.count,
        limit: config.maxRequests
      });

      return {
        allowed: false,
        remaining: 0,
        resetTime: record.resetTime
      };
    }

    // Incrémenter compteur
    record.count++;
    this.limits.set(key, record);

    return {
      allowed: true,
      remaining: config.maxRequests - record.count,
      resetTime: record.resetTime
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, record] of this.limits.entries()) {
      if (now >= record.resetTime) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.limits.delete(key));
    
    if (keysToDelete.length > 0) {
      logger.info('Rate limiter cleanup completed', { removedEntries: keysToDelete.length });
    }
  }
}

export function createRateLimitMiddleware(service: string) {
  const rateLimiter = new WebhookRateLimiter();

  return (req: Request, res: Response, next: any) => {
    const clientId = req.ip || 'unknown';
    const limit = rateLimiter.checkLimit(service, clientId);

    // Ajouter headers de rate limit
    res.set({
      'X-RateLimit-Service': service,
      'X-RateLimit-Remaining': limit.remaining.toString(),
      'X-RateLimit-Reset': new Date(limit.resetTime).toISOString()
    });

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        service,
        resetTime: new Date(limit.resetTime).toISOString(),
        retryAfter: Math.ceil((limit.resetTime - Date.now()) / 1000)
      });
    }

    next();
  };
}
```

## 4. Monitoring et alertes webhooks

### 4.1 Health check endpoints

```typescript
// src/webhooks/healthCheck.ts
import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export const webhookHealth = https.onRequest(async (req: Request, res: Response) => {
  try {
    const health = await checkWebhookHealth();
    const status = health.overall === 'healthy' ? 200 : 503;
    
    res.status(status).json({
      status: health.overall,
      timestamp: new Date().toISOString(),
      checks: health.checks,
      uptime: process.uptime(),
      version: process.env.FUNCTION_VERSION || '1.0.0'
    });

  } catch (error) {
    logger.error('Health check failed', error as Error);
    res.status(500).json({
      status: 'error',
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    });
  }
});

async function checkWebhookHealth(): Promise<{
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: any[];
}> {
  const checks = [];

  // Vérifier connectivité Firestore
  try {
    await firestoreHelper.getDocumentOptional('_health', 'webhook_test');
    checks.push({ component: 'firestore', status: 'healthy' });
  } catch (error) {
    checks.push({ component: 'firestore', status: 'unhealthy', error: (error as Error).message });
  }

  // Vérifier historique récent des webhooks
  try {
    const recentEvents = await firestoreHelper.queryDocuments(
      'webhook_events',
      [],
      { limit: 10, orderBy: 'timestamp', orderDirection: 'desc' }
    );

    const successRate = recentEvents.data.filter(e => e.status === 'success').length / recentEvents.data.length;
    
    checks.push({
      component: 'webhook_processing',
      status: successRate > 0.9 ? 'healthy' : successRate > 0.5 ? 'degraded' : 'unhealthy',
      successRate,
      recentEvents: recentEvents.data.length
    });
  } catch (error) {
    checks.push({ component: 'webhook_processing', status: 'unknown', error: (error as Error).message });
  }

  // Déterminer santé globale
  const unhealthy = checks.filter(c => c.status === 'unhealthy').length;
  const degraded = checks.filter(c => c.status === 'degraded').length;

  let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (unhealthy > 0) overall = 'unhealthy';
  else if (degraded > 0) overall = 'degraded';

  return { overall, checks };
}

// Endpoint de test pour valider configuration webhooks
export const testWebhookConfig = https.onRequest(async (req: Request, res: Response) => {
  const { service } = req.query;

  if (!service || typeof service !== 'string') {
    return res.status(400).json({ error: 'Service parameter required' });
  }

  try {
    const config = await validateWebhookConfig(service);
    res.json({
      service,
      configured: true,
      config: {
        hasSecret: !!config.secretKey,
        signatureHeader: config.signatureHeader,
        algorithm: config.algorithm
      }
    });

  } catch (error) {
    res.status(500).json({
      service,
      configured: false,
      error: (error as Error).message
    });
  }
});

async function validateWebhookConfig(service: string): Promise<any> {
  const requiredEnvVars: Record<string, string> = {
    stripe: 'STRIPE_WEBHOOK_SECRET',
    sumsub: 'SUMSUB_WEBHOOK_SECRET',
    sendgrid: 'SENDGRID_WEBHOOK_SECRET'
  };

  const envVar = requiredEnvVars[service];
  if (!envVar) {
    throw new Error(`Unknown service: ${service}`);
  }

  const secret = process.env[envVar];
  if (!secret) {
    throw new Error(`Missing environment variable: ${envVar}`);
  }

  return {
    secretKey: secret,
    signatureHeader: service === 'stripe' ? 'stripe-signature' : 'x-signature',
    algorithm: 'sha256'
  };
}
```

Ce système de webhooks complet permet à un LLM de gérer automatiquement toutes les intégrations externes avec sécurité, monitoring et gestion d'erreurs robuste.