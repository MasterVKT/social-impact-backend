/**
 * Handle Stripe Webhook Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { firestoreHelper } from '../utils/firestore';
import { stripeService } from '../integrations/stripe/stripeService';
import { emailService } from '../integrations/sendgrid/emailService';
import { PaymentsAPI } from '../types/api';
import { ContributionDocument, ProjectDocument, UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PAYMENT_CONFIG } from '../utils/constants';

/**
 * Valide l'origine et la signature du webhook Stripe
 */
function validateWebhookOrigin(req: Request): { isValid: boolean; event?: any } {
  try {
    const sig = req.get('stripe-signature');
    if (!sig) {
      return { isValid: false };
    }

    // Vérifier la signature Stripe
    const event = stripeService.constructWebhookEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
    
    logger.info('Stripe webhook signature validated', {
      eventType: event.type,
      eventId: event.id,
      created: event.created,
    });

    return { isValid: true, event };

  } catch (error) {
    logger.error('Invalid Stripe webhook signature', error, {
      hasSignature: !!req.get('stripe-signature'),
      bodyType: typeof req.body,
    });
    return { isValid: false };
  }
}

/**
 * Traite les événements de PaymentIntent
 */
async function processPaymentIntentEvents(event: any): Promise<void> {
  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id;
  
  logger.info('Processing PaymentIntent event', {
    eventType: event.type,
    paymentIntentId,
    status: paymentIntent.status,
    amount: paymentIntent.amount,
  });

  try {
    // Récupérer la contribution correspondante via les métadonnées
    const contributionId = paymentIntent.metadata?.contributionId;
    const projectId = paymentIntent.metadata?.projectId;
    
    if (!contributionId || !projectId) {
      logger.warn('PaymentIntent missing required metadata', {
        paymentIntentId,
        hasContributionId: !!contributionId,
        hasProjectId: !!projectId,
      });
      return;
    }

    // Récupérer la contribution
    const contribution = await firestoreHelper.getDocument<ContributionDocument>(
      `projects/${projectId}/contributions`,
      contributionId
    );

    // Traiter selon le type d'événement
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(contribution, paymentIntent, event);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailure(contribution, paymentIntent, event);
        break;

      case 'payment_intent.canceled':
        await handlePaymentCancellation(contribution, paymentIntent, event);
        break;

      case 'payment_intent.requires_action':
        await handlePaymentRequiresAction(contribution, paymentIntent, event);
        break;

      default:
        logger.info('Unhandled PaymentIntent event type', {
          eventType: event.type,
          paymentIntentId,
        });
    }

  } catch (error) {
    logger.error('Failed to process PaymentIntent event', error, {
      eventType: event.type,
      paymentIntentId,
    });
    throw error;
  }
}

/**
 * Gère le succès du paiement
 */
async function handlePaymentSuccess(
  contribution: ContributionDocument,
  paymentIntent: any,
  event: any
): Promise<void> {
  try {
    if (contribution.status === 'confirmed') {
      logger.info('Contribution already confirmed, skipping', {
        contributionId: contribution.id,
        paymentIntentId: paymentIntent.id,
      });
      return;
    }

    const chargeId = paymentIntent.charges?.data?.[0]?.id;
    const receiptUrl = paymentIntent.charges?.data?.[0]?.receipt_url;
    const transactionId = helpers.string.generateId('txn');

    // Mettre à jour la contribution
    await firestoreHelper.runTransaction(async (transaction) => {
      const contributionRef = firestoreHelper.getDocumentRef(
        `projects/${contribution.projectId}/contributions`,
        contribution.id
      );
      
      transaction.update(contributionRef, {
        status: 'confirmed',
        confirmedAt: new Date(),
        transactionId,
        'payment.stripeChargeId': chargeId,
        'payment.receiptUrl': receiptUrl,
        'payment.processorStatus': paymentIntent.status,
        receiptGenerated: true,
        updatedAt: new Date(),
        version: contribution.version + 1,
      });

      // Mettre à jour la référence utilisateur
      const userContributionRef = firestoreHelper.getDocumentRef(
        `users/${contribution.contributorUid}/contributions`,
        contribution.id
      );
      
      transaction.update(userContributionRef, {
        status: 'confirmed',
        confirmedAt: new Date(),
        transactionId,
        updatedAt: new Date(),
      });
    });

    // Mettre à jour les statistiques du projet
    await updateProjectFundingFromWebhook(contribution.projectId, contribution.amount.gross);

    // Envoyer le reçu si pas encore fait
    if (!contribution.receiptGenerated && receiptUrl) {
      await sendReceiptFromWebhook(contribution, receiptUrl);
    }

    logger.business('Payment confirmed via webhook', 'payments', {
      contributionId: contribution.id,
      transactionId,
      paymentIntentId: paymentIntent.id,
      chargeId,
      amount: contribution.amount.gross,
      contributorUid: contribution.contributorUid,
      projectId: contribution.projectId,
    });

  } catch (error) {
    logger.error('Failed to handle payment success', error, {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
    });
    throw error;
  }
}

/**
 * Gère l'échec du paiement
 */
async function handlePaymentFailure(
  contribution: ContributionDocument,
  paymentIntent: any,
  event: any
): Promise<void> {
  try {
    const failureReason = paymentIntent.last_payment_error?.message || 'Payment failed';
    const failureCode = paymentIntent.last_payment_error?.code || 'unknown';

    await firestoreHelper.updateDocument(
      `projects/${contribution.projectId}/contributions`,
      contribution.id,
      {
        status: 'failed',
        failedAt: new Date(),
        'payment.processorStatus': paymentIntent.status,
        'payment.failureReason': failureReason,
        'payment.failureCode': failureCode,
        updatedAt: new Date(),
        version: contribution.version + 1,
      }
    );

    // Mettre à jour la référence utilisateur
    await firestoreHelper.updateDocument(
      `users/${contribution.contributorUid}/contributions`,
      contribution.id,
      {
        status: 'failed',
        failedAt: new Date(),
        failureReason,
        updatedAt: new Date(),
      }
    );

    logger.business('Payment failed via webhook', 'payments', {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
      failureReason,
      failureCode,
      amount: contribution.amount.gross,
      contributorUid: contribution.contributorUid,
      projectId: contribution.projectId,
    });

  } catch (error) {
    logger.error('Failed to handle payment failure', error, {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
    });
    throw error;
  }
}

/**
 * Gère l'annulation du paiement
 */
async function handlePaymentCancellation(
  contribution: ContributionDocument,
  paymentIntent: any,
  event: any
): Promise<void> {
  try {
    await firestoreHelper.updateDocument(
      `projects/${contribution.projectId}/contributions`,
      contribution.id,
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        'payment.processorStatus': paymentIntent.status,
        updatedAt: new Date(),
        version: contribution.version + 1,
      }
    );

    // Mettre à jour la référence utilisateur
    await firestoreHelper.updateDocument(
      `users/${contribution.contributorUid}/contributions`,
      contribution.id,
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      }
    );

    logger.business('Payment cancelled via webhook', 'payments', {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
      amount: contribution.amount.gross,
      contributorUid: contribution.contributorUid,
      projectId: contribution.projectId,
    });

  } catch (error) {
    logger.error('Failed to handle payment cancellation', error, {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
    });
    throw error;
  }
}

/**
 * Gère les paiements nécessitant une action
 */
async function handlePaymentRequiresAction(
  contribution: ContributionDocument,
  paymentIntent: any,
  event: any
): Promise<void> {
  try {
    await firestoreHelper.updateDocument(
      `projects/${contribution.projectId}/contributions`,
      contribution.id,
      {
        'payment.processorStatus': paymentIntent.status,
        'payment.requiresAction': true,
        'payment.nextActionType': paymentIntent.next_action?.type || 'unknown',
        updatedAt: new Date(),
        version: contribution.version + 1,
      }
    );

    logger.info('Payment requires additional action', {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
      actionType: paymentIntent.next_action?.type,
      contributorUid: contribution.contributorUid,
    });

  } catch (error) {
    logger.error('Failed to handle payment requires action', error, {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
    });
    throw error;
  }
}

/**
 * Met à jour les statistiques du projet depuis le webhook
 */
async function updateProjectFundingFromWebhook(
  projectId: string,
  contributionAmount: number
): Promise<void> {
  try {
    await firestoreHelper.runTransaction(async (transaction) => {
      const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
      const projectDoc = await transaction.get(projectRef);
      
      if (!projectDoc.exists) {
        logger.warn('Project not found for funding update', { projectId });
        return;
      }

      const projectData = projectDoc.data()!;
      const newRaised = projectData.funding.raised + contributionAmount;
      const newPercentage = Math.round((newRaised / projectData.funding.goal) * 100);

      transaction.update(projectRef, {
        'funding.raised': newRaised,
        'funding.percentage': newPercentage,
        'stats.lastContributionAt': new Date(),
        updatedAt: new Date(),
      });
    });

  } catch (error) {
    logger.error('Failed to update project funding from webhook', error, {
      projectId,
      contributionAmount,
    });
  }
}

/**
 * Envoie le reçu depuis le webhook
 */
async function sendReceiptFromWebhook(
  contribution: ContributionDocument,
  receiptUrl: string
): Promise<void> {
  try {
    if (contribution.anonymous) {
      return;
    }

    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', contribution.contributorUid),
      firestoreHelper.getDocument<ProjectDocument>('projects', contribution.projectId)
    ]);

    const emailData = {
      to: user.email,
      templateId: 'contribution_receipt_webhook',
      dynamicTemplateData: {
        contributorName: `${user.firstName} ${user.lastName}`,
        projectTitle: project.title,
        contributionAmount: (contribution.amount.gross / 100).toFixed(2),
        currency: contribution.amount.currency,
        contributionDate: contribution.createdAt.toLocaleDateString('fr-FR'),
        receiptUrl,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        transactionId: contribution.payment.paymentIntentId,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Receipt sent from webhook', {
      contributionId: contribution.id,
      recipientEmail: user.email,
    });

  } catch (error) {
    logger.error('Failed to send receipt from webhook', error, {
      contributionId: contribution.id,
    });
  }
}

/**
 * Traite les événements de charge/remboursement
 */
async function processChargeEvents(event: any): Promise<void> {
  const charge = event.data.object;
  const paymentIntentId = charge.payment_intent;
  
  logger.info('Processing Charge event', {
    eventType: event.type,
    chargeId: charge.id,
    paymentIntentId,
    status: charge.status,
    amount: charge.amount,
  });

  try {
    switch (event.type) {
      case 'charge.succeeded':
        await handleChargeSuccess(charge);
        break;

      case 'charge.failed':
        await handleChargeFailed(charge);
        break;

      case 'charge.dispute.created':
        await handleChargeDispute(charge, event);
        break;

      case 'charge.refunded':
        await handleChargeRefund(charge, event);
        break;

      default:
        logger.info('Unhandled Charge event type', {
          eventType: event.type,
          chargeId: charge.id,
        });
    }

  } catch (error) {
    logger.error('Failed to process Charge event', error, {
      eventType: event.type,
      chargeId: charge.id,
      paymentIntentId,
    });
    throw error;
  }
}

/**
 * Gère le succès d'une charge
 */
async function handleChargeSuccess(charge: any): Promise<void> {
  try {
    // Déjà géré par les événements PaymentIntent
    logger.info('Charge succeeded (handled by PaymentIntent events)', {
      chargeId: charge.id,
      paymentIntentId: charge.payment_intent,
      amount: charge.amount,
    });

  } catch (error) {
    logger.error('Failed to handle charge success', error, {
      chargeId: charge.id,
    });
  }
}

/**
 * Gère l'échec d'une charge
 */
async function handleChargeFailed(charge: any): Promise<void> {
  try {
    // Déjà géré par les événements PaymentIntent
    logger.info('Charge failed (handled by PaymentIntent events)', {
      chargeId: charge.id,
      paymentIntentId: charge.payment_intent,
      failureReason: charge.failure_message,
    });

  } catch (error) {
    logger.error('Failed to handle charge failure', error, {
      chargeId: charge.id,
    });
  }
}

/**
 * Gère les litiges sur les charges
 */
async function handleChargeDispute(charge: any, event: any): Promise<void> {
  try {
    const dispute = event.data.object;
    const paymentIntentId = charge.payment_intent;

    // Récupérer la contribution via les métadonnées
    const contributionId = charge.metadata?.contributionId;
    if (!contributionId) {
      logger.warn('Charge dispute without contribution metadata', {
        chargeId: charge.id,
        disputeId: dispute.id,
      });
      return;
    }

    // Marquer la contribution comme en litige
    await firestoreHelper.updateDocument(
      `projects/${charge.metadata.projectId}/contributions`,
      contributionId,
      {
        status: 'disputed',
        disputedAt: new Date(),
        'payment.disputeId': dispute.id,
        'payment.disputeReason': dispute.reason,
        'payment.disputeStatus': dispute.status,
        updatedAt: new Date(),
      }
    );

    // Log de sécurité pour audit
    logger.security('Payment dispute created', 'high', {
      contributionId,
      chargeId: charge.id,
      disputeId: dispute.id,
      disputeReason: dispute.reason,
      amount: charge.amount,
      contributorUid: charge.metadata?.contributorUid,
      projectId: charge.metadata?.projectId,
    });

  } catch (error) {
    logger.error('Failed to handle charge dispute', error, {
      chargeId: charge.id,
      disputeId: event.data.object.id,
    });
  }
}

/**
 * Gère les remboursements de charges
 */
async function handleChargeRefund(charge: any, event: any): Promise<void> {
  try {
    const refunds = charge.refunds?.data || [];
    const latestRefund = refunds[refunds.length - 1];
    
    if (!latestRefund) {
      logger.warn('Refund event without refund data', {
        chargeId: charge.id,
      });
      return;
    }

    const contributionId = charge.metadata?.contributionId;
    if (!contributionId) {
      logger.warn('Charge refund without contribution metadata', {
        chargeId: charge.id,
        refundId: latestRefund.id,
      });
      return;
    }

    // Mettre à jour la contribution
    await firestoreHelper.updateDocument(
      `projects/${charge.metadata.projectId}/contributions`,
      contributionId,
      {
        status: 'refunded',
        refundedAt: new Date(),
        'payment.refundId': latestRefund.id,
        'payment.refundAmount': latestRefund.amount,
        'payment.refundReason': latestRefund.reason || 'refund_requested',
        updatedAt: new Date(),
      }
    );

    logger.business('Payment refunded via webhook', 'payments', {
      contributionId,
      chargeId: charge.id,
      refundId: latestRefund.id,
      refundAmount: latestRefund.amount,
      originalAmount: charge.amount,
      contributorUid: charge.metadata?.contributorUid,
      projectId: charge.metadata?.projectId,
    });

  } catch (error) {
    logger.error('Failed to handle charge refund', error, {
      chargeId: charge.id,
    });
  }
}

/**
 * Traite les événements de compte Connect (si utilisé)
 */
async function processAccountEvents(event: any): Promise<void> {
  const account = event.data.object;
  
  logger.info('Processing Account event', {
    eventType: event.type,
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
  });

  // TODO: Implémenter la gestion des comptes Connect si nécessaire
  // pour les créateurs qui veulent recevoir des paiements directs
}

/**
 * Fonction principale de traitement des webhooks
 */
async function processStripeWebhook(req: Request): Promise<PaymentsAPI.StripeWebhookResponse> {
  // Valider la signature
  const validation = validateWebhookOrigin(req);
  if (!validation.isValid || !validation.event) {
    throw new https.HttpsError('permission-denied', 'Invalid webhook signature');
  }

  const event = validation.event;

  logger.info('Processing Stripe webhook', {
    eventType: event.type,
    eventId: event.id,
    created: event.created,
    livemode: event.livemode,
  });

  try {
    // Router les événements selon leur type
    if (event.type.startsWith('payment_intent.')) {
      await processPaymentIntentEvents(event);
    } else if (event.type.startsWith('charge.')) {
      await processChargeEvents(event);
    } else if (event.type.startsWith('account.')) {
      await processAccountEvents(event);
    } else {
      logger.info('Unhandled Stripe webhook event type', {
        eventType: event.type,
        eventId: event.id,
      });
    }

    // Log de succès
    logger.info('Stripe webhook processed successfully', {
      eventType: event.type,
      eventId: event.id,
      processed: true,
    });

    return {
      received: true,
      eventType: event.type,
      eventId: event.id,
      processed: true,
    };

  } catch (error) {
    logger.error('Failed to process Stripe webhook', error, {
      eventType: event.type,
      eventId: event.id,
    });
    
    // Re-throw pour que Stripe retry automatiquement
    throw error;
  }
}

/**
 * Firebase Function principale (HTTP Request)
 */
export const handleStripeWebhook = https.onRequest(
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    // Vérifier la méthode HTTP
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Vérifier l'origine
    const originValidation = validateWebhookOrigin(req);
    if (!originValidation.isValid) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      // Traiter le webhook
      const result = await processStripeWebhook(req);
      
      // Répondre à Stripe
      res.status(200).json(result);

    } catch (error) {
      logger.error('Stripe webhook processing failed', error, {
        method: req.method,
        hasSignature: !!req.get('stripe-signature'),
      });
      
      // Stripe attend un code d'erreur 5xx pour retry automatique
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  })
);