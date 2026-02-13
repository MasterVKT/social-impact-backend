/**
 * Stripe Payment Service
 * Social Finance Impact Platform
 */

import Stripe from 'stripe';
import { logger } from '../../utils/logger';
import { ExternalServiceError, ValidationError } from '../../utils/errors';
import { withRetry } from '../../utils/errors';
import { FEES, LIMITS } from '../../utils/constants';
import { StripeTypes } from '../../types/external';
import { helpers } from '../../utils/helpers';

/**
 * Configuration Stripe
 */
const STRIPE_CONFIG = {
  apiVersion: '2023-10-16' as const,
  timeout: 30000, // 30 secondes
  maxRetries: 3,
  telemetry: false,
};

/**
 * Service principal Stripe
 */
export class StripeService {
  private stripe: Stripe;
  private webhookSecret: string;
  private initialized = false;

  constructor() {
    // Don't initialize here - use lazy initialization
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  }

  /**
   * Initialize Stripe client lazily when first used
   */
  private initialize(): void {
    if (this.initialized) return;

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    this.stripe = new Stripe(secretKey, STRIPE_CONFIG);

    logger.info('Stripe service initialized', {
      environment: secretKey.startsWith('sk_live_') ? 'live' : 'test',
      apiVersion: STRIPE_CONFIG.apiVersion,
    });

    this.initialized = true;
  }

  private ensureInitialized(): void {
    this.initialize();
  }

  /**
   * Crée un PaymentIntent pour une contribution
   */
  async createPaymentIntent(params: {
    amount: number; // en centimes
    contributorUid: string;
    contributorEmail: string;
    projectId: string;
    contributionId: string;
    description: string;
    metadata?: Record<string, string>;
  }): Promise<StripeTypes.PaymentIntent> {
    this.ensureInitialized();
    try {
      // Validation du montant
      if (!helpers.validation.validateAmount(params.amount)) {
        throw new ValidationError(
          `Amount must be between ${LIMITS.CONTRIBUTION.MIN_AMOUNT} and ${LIMITS.CONTRIBUTION.MAX_AMOUNT} cents`
        );
      }

      // Calcul des frais
      const fees = FEES.calculateFees(params.amount);
      const totalAmount = params.amount + fees.total;

      const paymentIntentParams: StripeTypes.PaymentIntentCreateParams = {
        amount: totalAmount,
        currency: 'eur',
        payment_method_types: ['card'],
        receipt_email: params.contributorEmail,
        description: params.description,
        metadata: {
          platform: 'social-impact-platform',
          contributorUid: params.contributorUid,
          projectId: params.projectId,
          contributionId: params.contributionId,
          originalAmount: params.amount.toString(),
          platformFee: fees.platform.toString(),
          auditFee: fees.audit.toString(),
          stripeFee: fees.stripe.toString(),
          ...params.metadata,
        },
        setup_future_usage: 'on_session', // Pour sauvegarder la carte si souhaité
      };

      const paymentIntent = await withRetry(
        () => this.stripe.paymentIntents.create(paymentIntentParams),
        3,
        1000
      );

      logger.info('PaymentIntent created', {
        paymentIntentId: paymentIntent.id,
        amount: totalAmount,
        contributorUid: params.contributorUid,
        projectId: params.projectId,
      });

      return paymentIntent;

    } catch (error) {
      logger.error('Failed to create PaymentIntent', error, {
        contributorUid: params.contributorUid,
        projectId: params.projectId,
        amount: params.amount,
      });

      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Récupère un PaymentIntent par son ID
   */
  async getPaymentIntent(paymentIntentId: string): Promise<StripeTypes.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      
      logger.debug('PaymentIntent retrieved', {
        paymentIntentId,
        status: paymentIntent.status,
      });

      return paymentIntent;

    } catch (error) {
      logger.error('Failed to retrieve PaymentIntent', error, { paymentIntentId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Confirme un PaymentIntent
   */
  async confirmPaymentIntent(
    paymentIntentId: string,
    paymentMethodId?: string
  ): Promise<StripeTypes.PaymentIntent> {
    try {
      const confirmParams: any = {
        return_url: process.env.STRIPE_RETURN_URL || 'https://socialimpact.fr/payment/return',
      };

      if (paymentMethodId) {
        confirmParams.payment_method = paymentMethodId;
      }

      const paymentIntent = await this.stripe.paymentIntents.confirm(
        paymentIntentId,
        confirmParams
      );

      logger.info('PaymentIntent confirmed', {
        paymentIntentId,
        status: paymentIntent.status,
      });

      return paymentIntent;

    } catch (error) {
      logger.error('Failed to confirm PaymentIntent', error, { paymentIntentId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Annule un PaymentIntent
   */
  async cancelPaymentIntent(
    paymentIntentId: string,
    reason?: string
  ): Promise<StripeTypes.PaymentIntent> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.cancel(paymentIntentId, {
        cancellation_reason: reason as any,
      });

      logger.info('PaymentIntent cancelled', {
        paymentIntentId,
        reason,
      });

      return paymentIntent;

    } catch (error) {
      logger.error('Failed to cancel PaymentIntent', error, { paymentIntentId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Crée un remboursement
   */
  async createRefund(params: {
    paymentIntentId: string;
    amount?: number; // Montant partiel optionnel
    reason?: StripeTypes.RefundReason;
    metadata?: Record<string, string>;
  }): Promise<StripeTypes.Refund> {
    try {
      const refundParams: any = {
        payment_intent: params.paymentIntentId,
        reason: params.reason || 'requested_by_customer',
        metadata: {
          platform: 'social-impact-platform',
          refundedAt: new Date().toISOString(),
          ...params.metadata,
        },
      };

      if (params.amount) {
        refundParams.amount = params.amount;
      }

      const refund = await this.stripe.refunds.create(refundParams);

      logger.info('Refund created', {
        refundId: refund.id,
        paymentIntentId: params.paymentIntentId,
        amount: refund.amount,
        reason: params.reason,
      });

      return refund;

    } catch (error) {
      logger.error('Failed to create refund', error, {
        paymentIntentId: params.paymentIntentId,
        amount: params.amount,
      });

      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Crée ou récupère un Customer Stripe
   */
  async createOrGetCustomer(params: {
    userId: string;
    email: string;
    name?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeTypes.Customer> {
    try {
      // Rechercher un customer existant par metadata
      const existingCustomers = await this.stripe.customers.search({
        query: `metadata["userId"]:"${params.userId}"`,
      });

      if (existingCustomers.data.length > 0) {
        const customer = existingCustomers.data[0];
        logger.debug('Existing Stripe customer found', {
          customerId: customer.id,
          userId: params.userId,
        });
        return customer;
      }

      // Créer un nouveau customer
      const customer = await this.stripe.customers.create({
        email: params.email,
        name: params.name,
        metadata: {
          platform: 'social-impact-platform',
          userId: params.userId,
          createdAt: new Date().toISOString(),
          ...params.metadata,
        },
      });

      logger.info('Stripe customer created', {
        customerId: customer.id,
        userId: params.userId,
        email: params.email,
      });

      return customer;

    } catch (error) {
      logger.error('Failed to create/get Stripe customer', error, {
        userId: params.userId,
        email: params.email,
      });

      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Attache un moyen de paiement à un customer
   */
  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string
  ): Promise<StripeTypes.PaymentMethod> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      logger.info('Payment method attached to customer', {
        paymentMethodId,
        customerId,
      });

      return paymentMethod;

    } catch (error) {
      logger.error('Failed to attach payment method', error, {
        paymentMethodId,
        customerId,
      });

      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Liste les moyens de paiement d'un customer
   */
  async listPaymentMethods(
    customerId: string,
    type: StripeTypes.PaymentMethodType = 'card'
  ): Promise<StripeTypes.PaymentMethod[]> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type,
      });

      logger.debug('Payment methods listed', {
        customerId,
        count: paymentMethods.data.length,
      });

      return paymentMethods.data;

    } catch (error) {
      logger.error('Failed to list payment methods', error, { customerId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Supprime un moyen de paiement
   */
  async detachPaymentMethod(paymentMethodId: string): Promise<StripeTypes.PaymentMethod> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.detach(paymentMethodId);

      logger.info('Payment method detached', { paymentMethodId });

      return paymentMethod;

    } catch (error) {
      logger.error('Failed to detach payment method', error, { paymentMethodId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Construit et vérifie un webhook Stripe
   */
  constructWebhookEvent(
    payload: string | Buffer,
    signature: string,
    endpointSecret?: string
  ): StripeTypes.WebhookEvent {
    try {
      const webhookSecret = endpointSecret || this.webhookSecret;
      
      if (!webhookSecret) {
        throw new Error('Webhook secret not configured');
      }

      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        webhookSecret
      );

      logger.debug('Stripe webhook event constructed', {
        eventType: event.type,
        eventId: event.id,
        livemode: event.livemode,
      });

      return event;

    } catch (error) {
      logger.error('Failed to construct webhook event', error, { signature });
      throw new ExternalServiceError('Stripe', error, 'Invalid webhook signature');
    }
  }

  /**
   * Récupère les détails d'un événement webhook
   */
  async getWebhookEvent(eventId: string): Promise<StripeTypes.WebhookEvent> {
    try {
      const event = await this.stripe.events.retrieve(eventId);
      
      logger.debug('Webhook event retrieved', {
        eventId,
        eventType: event.type,
      });

      return event;

    } catch (error) {
      logger.error('Failed to retrieve webhook event', error, { eventId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Récupère les frais d'une transaction
   */
  async getBalanceTransaction(balanceTransactionId: string) {
    try {
      const balanceTransaction = await this.stripe.balanceTransactions.retrieve(
        balanceTransactionId
      );

      logger.debug('Balance transaction retrieved', {
        balanceTransactionId,
        amount: balanceTransaction.amount,
        fee: balanceTransaction.fee,
      });

      return balanceTransaction;

    } catch (error) {
      logger.error('Failed to retrieve balance transaction', error, { balanceTransactionId });
      throw new ExternalServiceError('Stripe', error);
    }
  }

  /**
   * Utilitaire pour calculer les frais réels Stripe
   */
  calculateActualStripeFees(charge: StripeTypes.Charge): number {
    // Les frais réels sont dans le balance_transaction
    if (charge.balance_transaction && typeof charge.balance_transaction === 'object') {
      return charge.balance_transaction.fee;
    }
    
    // Fallback sur le calcul estimé
    return FEES.calculateFees(charge.amount).stripe;
  }

  /**
   * Vérifie si un PaymentIntent peut être remboursé
   */
  canBeRefunded(paymentIntent: StripeTypes.PaymentIntent): boolean {
    return (
      paymentIntent.status === 'succeeded' &&
      paymentIntent.charges.data.length > 0 &&
      !paymentIntent.charges.data[0].refunded
    );
  }

  /**
   * Obtient les statistiques d'un customer
   */
  async getCustomerStats(customerId: string) {
    try {
      const [paymentIntents, charges] = await Promise.all([
        this.stripe.paymentIntents.search({
          query: `customer:"${customerId}" AND status:"succeeded"`,
          limit: 100,
        }),
        this.stripe.charges.search({
          query: `customer:"${customerId}"`,
          limit: 100,
        }),
      ]);

      const totalAmount = paymentIntents.data.reduce(
        (sum, pi) => sum + pi.amount, 
        0
      );

      const stats = {
        totalTransactions: paymentIntents.data.length,
        totalAmount,
        averageAmount: paymentIntents.data.length > 0 ? Math.round(totalAmount / paymentIntents.data.length) : 0,
        failedPayments: charges.data.filter(c => c.status === 'failed').length,
        refundedAmount: charges.data.reduce(
          (sum, c) => sum + c.amount_refunded, 
          0
        ),
      };

      logger.debug('Customer stats calculated', { customerId, ...stats });

      return stats;

    } catch (error) {
      logger.error('Failed to get customer stats', error, { customerId });
      throw new ExternalServiceError('Stripe', error);
    }
  }
}

/**
 * Instance globale du service Stripe
 */
export const stripeService = new StripeService();

/**
 * Types utilitaires pour Stripe
 */
export namespace StripeUtils {
  /**
   * Convertit un statut Stripe vers notre système
   */
  export function mapPaymentStatus(stripeStatus: StripeTypes.PaymentIntentStatus): string {
    const statusMap: Record<StripeTypes.PaymentIntentStatus, string> = {
      'requires_payment_method': 'pending',
      'requires_confirmation': 'pending', 
      'requires_action': 'requires_action',
      'processing': 'processing',
      'requires_capture': 'processing',
      'canceled': 'failed',
      'succeeded': 'confirmed',
    };

    return statusMap[stripeStatus] || 'unknown';
  }

  /**
   * Extrait les métadonnées de notre plateforme
   */
  export function extractPlatformMetadata(metadata: Record<string, string>) {
    return {
      contributorUid: metadata.contributorUid,
      projectId: metadata.projectId,
      contributionId: metadata.contributionId,
      originalAmount: parseInt(metadata.originalAmount || '0'),
      platformFee: parseInt(metadata.platformFee || '0'),
      auditFee: parseInt(metadata.auditFee || '0'),
      stripeFee: parseInt(metadata.stripeFee || '0'),
    };
  }

  /**
   * Formate un montant Stripe pour l'affichage
   */
  export function formatAmount(amountInCents: number, currency: string = 'EUR'): string {
    return helpers.amount.formatEuros(amountInCents);
  }

  /**
   * Détermine si une erreur Stripe est récupérable
   */
  export function isRetryableError(error: any): boolean {
    const retryableCodes = [
      'rate_limit_error',
      'api_connection_error',
      'api_error',
    ];

    return retryableCodes.includes(error.code);
  }
}