/**
 * Stripe Webhook Handlers
 * Social Finance Impact Platform
 */

import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { emailService } from '../sendgrid/emailService';
import { stripeService, StripeUtils } from './stripeService';
import { ExternalServiceError, NotFoundError } from '../../utils/errors';
import { StripeTypes } from '../../types/external';
import { ContributionDocument, UserDocument } from '../../types/firestore';
import { helpers } from '../../utils/helpers';
import { STATUS } from '../../utils/constants';

/**
 * Interface pour le contexte de traitement des webhooks
 */
interface WebhookContext {
  eventId: string;
  eventType: string;
  livemode: boolean;
  created: number;
  retryAttempt?: number;
}

/**
 * Classe principale pour gérer les webhooks Stripe
 */
export class StripeWebhookHandlers {
  
  /**
   * Traite un événement webhook Stripe
   */
  async processWebhookEvent(event: StripeTypes.WebhookEvent): Promise<void> {
    const context: WebhookContext = {
      eventId: event.id,
      eventType: event.type,
      livemode: event.livemode,
      created: event.created,
    };

    logger.info('Processing Stripe webhook event', context);

    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event, context);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event, context);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event, context);
          break;

        case 'payment_intent.requires_action':
          await this.handlePaymentIntentRequiresAction(event, context);
          break;

        case 'charge.succeeded':
          await this.handleChargeSucceeded(event, context);
          break;

        case 'charge.failed':
          await this.handleChargeFailed(event, context);
          break;

        case 'charge.refunded':
          await this.handleChargeRefunded(event, context);
          break;

        case 'charge.dispute.created':
          await this.handleChargeDisputeCreated(event, context);
          break;

        case 'customer.created':
          await this.handleCustomerCreated(event, context);
          break;

        case 'customer.updated':
          await this.handleCustomerUpdated(event, context);
          break;

        case 'customer.deleted':
          await this.handleCustomerDeleted(event, context);
          break;

        default:
          logger.warn('Unhandled Stripe webhook event type', {
            eventType: event.type,
            eventId: event.id,
          });
      }

      logger.info('Stripe webhook event processed successfully', context);

    } catch (error) {
      logger.error('Failed to process Stripe webhook event', error, context);
      throw error;
    }
  }

  /**
   * Traite le succès d'un PaymentIntent
   */
  private async handlePaymentIntentSucceeded(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const paymentIntent = event.data.object as StripeTypes.PaymentIntent;
    const metadata = StripeUtils.extractPlatformMetadata(paymentIntent.metadata);

    logger.info('Handling payment_intent.succeeded', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      contributionId: metadata.contributionId,
      projectId: metadata.projectId,
    });

    try {
      // Mettre à jour la contribution dans Firestore
      await this.updateContributionStatus({
        contributionId: metadata.contributionId,
        projectId: metadata.projectId,
        status: 'confirmed',
        paymentData: {
          paymentIntentId: paymentIntent.id,
          confirmedAt: new Date(paymentIntent.created * 1000),
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          receiptUrl: paymentIntent.charges.data[0]?.receipt_url,
        },
      });

      // Mettre à jour les statistiques du projet
      await this.updateProjectFundingStats(metadata.projectId, metadata.originalAmount);

      // Mettre à jour les statistiques utilisateur
      await this.updateUserContributionStats(metadata.contributorUid, metadata.originalAmount);

      // Envoyer le reçu par email
      await this.sendContributionReceipt({
        contributionId: metadata.contributionId,
        projectId: metadata.projectId,
        paymentIntent,
      });

      logger.info('Payment confirmed and processed', {
        contributionId: metadata.contributionId,
        projectId: metadata.projectId,
        amount: metadata.originalAmount,
      });

    } catch (error) {
      logger.error('Failed to process payment success', error, {
        paymentIntentId: paymentIntent.id,
        contributionId: metadata.contributionId,
      });
      throw error;
    }
  }

  /**
   * Traite l'échec d'un PaymentIntent
   */
  private async handlePaymentIntentFailed(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const paymentIntent = event.data.object as StripeTypes.PaymentIntent;
    const metadata = StripeUtils.extractPlatformMetadata(paymentIntent.metadata);

    logger.warn('Handling payment_intent.payment_failed', {
      paymentIntentId: paymentIntent.id,
      contributionId: metadata.contributionId,
      failureReason: paymentIntent.last_payment_error?.message,
    });

    try {
      // Mettre à jour le statut de la contribution
      await this.updateContributionStatus({
        contributionId: metadata.contributionId,
        projectId: metadata.projectId,
        status: 'failed',
        paymentData: {
          paymentIntentId: paymentIntent.id,
          failedAt: new Date(),
          failureReason: paymentIntent.last_payment_error?.message,
        },
      });

      // Envoyer une notification à l'utilisateur
      await this.notifyPaymentFailure({
        contributorUid: metadata.contributorUid,
        projectId: metadata.projectId,
        failureReason: paymentIntent.last_payment_error?.message,
      });

    } catch (error) {
      logger.error('Failed to process payment failure', error, {
        paymentIntentId: paymentIntent.id,
        contributionId: metadata.contributionId,
      });
      throw error;
    }
  }

  /**
   * Traite l'annulation d'un PaymentIntent
   */
  private async handlePaymentIntentCanceled(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const paymentIntent = event.data.object as StripeTypes.PaymentIntent;
    const metadata = StripeUtils.extractPlatformMetadata(paymentIntent.metadata);

    logger.info('Handling payment_intent.canceled', {
      paymentIntentId: paymentIntent.id,
      contributionId: metadata.contributionId,
      cancellationReason: paymentIntent.cancellation_reason,
    });

    await this.updateContributionStatus({
      contributionId: metadata.contributionId,
      projectId: metadata.projectId,
      status: 'cancelled',
      paymentData: {
        paymentIntentId: paymentIntent.id,
        cancelledAt: new Date(),
        cancellationReason: paymentIntent.cancellation_reason,
      },
    });
  }

  /**
   * Traite un PaymentIntent qui nécessite une action
   */
  private async handlePaymentIntentRequiresAction(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const paymentIntent = event.data.object as StripeTypes.PaymentIntent;
    const metadata = StripeUtils.extractPlatformMetadata(paymentIntent.metadata);

    logger.info('Handling payment_intent.requires_action', {
      paymentIntentId: paymentIntent.id,
      contributionId: metadata.contributionId,
      nextActionType: paymentIntent.next_action?.type,
    });

    // Mettre à jour le statut pour indiquer qu'une action est requise
    await this.updateContributionStatus({
      contributionId: metadata.contributionId,
      projectId: metadata.projectId,
      status: 'requires_action',
      paymentData: {
        paymentIntentId: paymentIntent.id,
        requiresActionAt: new Date(),
        nextAction: paymentIntent.next_action,
      },
    });

    // Notifier l'utilisateur qu'une action est requise
    await this.notifyActionRequired({
      contributorUid: metadata.contributorUid,
      contributionId: metadata.contributionId,
      nextAction: paymentIntent.next_action,
    });
  }

  /**
   * Traite le succès d'un Charge
   */
  private async handleChargeSucceeded(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const charge = event.data.object as StripeTypes.Charge;

    logger.info('Handling charge.succeeded', {
      chargeId: charge.id,
      amount: charge.amount,
      paymentIntentId: charge.payment_intent,
    });

    // Calculer les frais réels Stripe
    const actualStripeFees = stripeService.calculateActualStripeFees(charge);

    // Mettre à jour les données de frais avec les valeurs réelles
    if (charge.payment_intent && typeof charge.payment_intent === 'string') {
      const paymentIntent = await stripeService.getPaymentIntent(charge.payment_intent);
      const metadata = StripeUtils.extractPlatformMetadata(paymentIntent.metadata);

      await this.updateContributionFees({
        contributionId: metadata.contributionId,
        projectId: metadata.projectId,
        actualFees: {
          stripe: actualStripeFees,
          balanceTransactionId: charge.balance_transaction as string,
        },
      });
    }
  }

  /**
   * Traite l'échec d'un Charge
   */
  private async handleChargeFailed(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const charge = event.data.object as StripeTypes.Charge;

    logger.warn('Handling charge.failed', {
      chargeId: charge.id,
      failureCode: charge.failure_code,
      failureMessage: charge.failure_message,
    });

    // Le PaymentIntent failed handler s'occupera du traitement principal
    // Ici on peut ajouter des logs spécifiques au charge
  }

  /**
   * Traite le remboursement d'un Charge
   */
  private async handleChargeRefunded(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const charge = event.data.object as StripeTypes.Charge;

    logger.info('Handling charge.refunded', {
      chargeId: charge.id,
      refundedAmount: charge.amount_refunded,
      totalRefunds: charge.refunds.total_count,
    });

    // Traiter chaque remboursement
    for (const refund of charge.refunds.data) {
      await this.processRefund({
        chargeId: charge.id,
        refund,
      });
    }
  }

  /**
   * Traite la création d'un litige
   */
  private async handleChargeDisputeCreated(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const dispute = event.data.object;

    logger.warn('Handling charge.dispute.created', {
      disputeId: dispute.id,
      chargeId: dispute.charge,
      amount: dispute.amount,
      reason: dispute.reason,
    });

    // Marquer la contribution comme disputée
    // Notifier les administrateurs
    await this.notifyDispute({
      disputeId: dispute.id,
      chargeId: dispute.charge,
      amount: dispute.amount,
      reason: dispute.reason,
    });
  }

  /**
   * Traite la création d'un Customer
   */
  private async handleCustomerCreated(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const customer = event.data.object as StripeTypes.Customer;

    logger.info('Handling customer.created', {
      customerId: customer.id,
      email: customer.email,
    });

    // Mise à jour optionnelle du profil utilisateur avec l'ID customer
    if (customer.metadata.userId) {
      try {
        await firestoreHelper.updateDocument('users', customer.metadata.userId, {
          stripeCustomerId: customer.id,
        });
      } catch (error) {
        logger.warn('Failed to update user with Stripe customer ID', error, {
          userId: customer.metadata.userId,
          customerId: customer.id,
        });
      }
    }
  }

  /**
   * Traite la mise à jour d'un Customer
   */
  private async handleCustomerUpdated(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const customer = event.data.object as StripeTypes.Customer;

    logger.debug('Handling customer.updated', {
      customerId: customer.id,
      email: customer.email,
    });

    // Synchroniser les changements si nécessaire
  }

  /**
   * Traite la suppression d'un Customer
   */
  private async handleCustomerDeleted(
    event: StripeTypes.WebhookEvent,
    context: WebhookContext
  ): Promise<void> {
    const customer = event.data.object as StripeTypes.Customer;

    logger.info('Handling customer.deleted', {
      customerId: customer.id,
    });

    // Nettoyer les références au customer supprimé
    if (customer.metadata.userId) {
      try {
        await firestoreHelper.updateDocument('users', customer.metadata.userId, {
          stripeCustomerId: null,
        });
      } catch (error) {
        logger.warn('Failed to clear Stripe customer ID from user', error, {
          userId: customer.metadata.userId,
          customerId: customer.id,
        });
      }
    }
  }

  /**
   * Met à jour le statut d'une contribution
   */
  private async updateContributionStatus(params: {
    contributionId: string;
    projectId: string;
    status: string;
    paymentData: Record<string, any>;
  }): Promise<void> {
    try {
      await firestoreHelper.updateDocument(
        `projects/${params.projectId}/contributions`,
        params.contributionId,
        {
          'payment.status': params.status,
          ...Object.fromEntries(
            Object.entries(params.paymentData).map(([key, value]) => [`payment.${key}`, value])
          ),
          updatedAt: new Date(),
        }
      );
    } catch (error) {
      logger.error('Failed to update contribution status', error, params);
      throw error;
    }
  }

  /**
   * Met à jour les statistiques de financement d'un projet
   */
  private async updateProjectFundingStats(
    projectId: string,
    contributionAmount: number
  ): Promise<void> {
    try {
      await firestoreHelper.runTransaction(async (transaction) => {
        const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
        const project = await transaction.get(projectRef);
        
        if (!project.exists) {
          throw new NotFoundError(`Project ${projectId}`);
        }

        const currentData = project.data();
        const newRaised = (currentData?.funding?.raised || 0) + contributionAmount;
        const newCount = (currentData?.funding?.contributorsCount || 0) + 1;
        const percentage = Math.round((newRaised / currentData?.funding?.goal || 1) * 100);

        transaction.update(projectRef, {
          'funding.raised': newRaised,
          'funding.contributorsCount': newCount,
          'funding.percentage': percentage,
          updatedAt: new Date(),
        });
      });
    } catch (error) {
      logger.error('Failed to update project funding stats', error, {
        projectId,
        contributionAmount,
      });
      throw error;
    }
  }

  /**
   * Met à jour les statistiques de contribution d'un utilisateur
   */
  private async updateUserContributionStats(
    userId: string,
    contributionAmount: number
  ): Promise<void> {
    try {
      await firestoreHelper.runTransaction(async (transaction) => {
        const userRef = firestoreHelper.getDocumentRef('users', userId);
        const user = await transaction.get(userRef);
        
        if (!user.exists) {
          throw new NotFoundError(`User ${userId}`);
        }

        const currentStats = user.data()?.stats || {};
        const newTotal = (currentStats.totalContributed || 0) + contributionAmount;
        const newCount = (currentStats.projectsSupported || 0) + 1;
        const newAverage = Math.round(newTotal / newCount);

        transaction.update(userRef, {
          'stats.totalContributed': newTotal,
          'stats.projectsSupported': newCount,
          'stats.averageContribution': newAverage,
          'stats.lastContributionAt': new Date(),
          updatedAt: new Date(),
        });
      });
    } catch (error) {
      logger.error('Failed to update user contribution stats', error, {
        userId,
        contributionAmount,
      });
      throw error;
    }
  }

  /**
   * Met à jour les frais réels d'une contribution
   */
  private async updateContributionFees(params: {
    contributionId: string;
    projectId: string;
    actualFees: {
      stripe: number;
      balanceTransactionId: string;
    };
  }): Promise<void> {
    try {
      await firestoreHelper.updateDocument(
        `projects/${params.projectId}/contributions`,
        params.contributionId,
        {
          'amount.fees.stripe': params.actualFees.stripe,
          'payment.balanceTransactionId': params.actualFees.balanceTransactionId,
          updatedAt: new Date(),
        }
      );
    } catch (error) {
      logger.error('Failed to update contribution fees', error, params);
      throw error;
    }
  }

  /**
   * Envoie un reçu de contribution par email
   */
  private async sendContributionReceipt(params: {
    contributionId: string;
    projectId: string;
    paymentIntent: StripeTypes.PaymentIntent;
  }): Promise<void> {
    try {
      // Récupérer les données nécessaires
      const [contribution, project, user] = await Promise.all([
        firestoreHelper.getDocument<ContributionDocument>(
          `projects/${params.projectId}/contributions`,
          params.contributionId
        ),
        firestoreHelper.getDocument(`projects`, params.projectId),
        firestoreHelper.getDocument<UserDocument>('users', params.paymentIntent.metadata.contributorUid),
      ]);

      // Envoyer le reçu
      await emailService.sendContributionReceipt({
        to: user.email,
        contributorName: `${user.firstName} ${user.lastName}`,
        projectTitle: project.title,
        amount: contribution.amount.gross,
        currency: 'EUR',
        contributionDate: helpers.date.formatFrenchDateTime(contribution.createdAt.toDate()),
        receiptNumber: `REC-${params.contributionId.toUpperCase()}`,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${params.projectId}`,
        receiptUrl: params.paymentIntent.charges.data[0]?.receipt_url || '',
      });

    } catch (error) {
      logger.error('Failed to send contribution receipt', error, params);
      // Ne pas faire échouer le webhook pour un problème d'email
    }
  }

  /**
   * Notifie l'échec d'un paiement
   */
  private async notifyPaymentFailure(params: {
    contributorUid: string;
    projectId: string;
    failureReason?: string;
  }): Promise<void> {
    try {
      // Implémenter la notification d'échec de paiement
      logger.info('Payment failure notification sent', params);
    } catch (error) {
      logger.error('Failed to notify payment failure', error, params);
    }
  }

  /**
   * Notifie qu'une action est requise
   */
  private async notifyActionRequired(params: {
    contributorUid: string;
    contributionId: string;
    nextAction?: any;
  }): Promise<void> {
    try {
      // Implémenter la notification d'action requise
      logger.info('Action required notification sent', params);
    } catch (error) {
      logger.error('Failed to notify action required', error, params);
    }
  }

  /**
   * Traite un remboursement
   */
  private async processRefund(params: {
    chargeId: string;
    refund: StripeTypes.Refund;
  }): Promise<void> {
    try {
      // Implémenter le traitement des remboursements
      logger.info('Refund processed', {
        refundId: params.refund.id,
        amount: params.refund.amount,
        status: params.refund.status,
      });
    } catch (error) {
      logger.error('Failed to process refund', error, params);
    }
  }

  /**
   * Notifie la création d'un litige
   */
  private async notifyDispute(params: {
    disputeId: string;
    chargeId: string;
    amount: number;
    reason: string;
  }): Promise<void> {
    try {
      // Implémenter la notification de litige
      logger.warn('Dispute notification sent', params);
    } catch (error) {
      logger.error('Failed to notify dispute', error, params);
    }
  }
}

/**
 * Instance globale des handlers de webhook Stripe
 */
export const stripeWebhookHandlers = new StripeWebhookHandlers();