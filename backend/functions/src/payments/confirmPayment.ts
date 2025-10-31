/**
 * Confirm Payment Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { stripeService } from '../integrations/stripe/stripeService';
import { emailService } from '../integrations/sendgrid/emailService';
import { ContributionsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PAYMENT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  contributionId: Joi.string().required(),
  paymentIntentId: Joi.string().required(),
  stripeClientSecret: Joi.string().required(),
}).required();

/**
 * Valide que l'utilisateur peut confirmer cette contribution
 */
async function validateConfirmationAccess(
  uid: string,
  contributionId: string,
  paymentIntentId: string
): Promise<{ contribution: ContributionDocument; project: ProjectDocument; user: UserDocument }> {
  try {
    // Récupérer la contribution
    const contribution = await firestoreHelper.getDocument<ContributionDocument>(
      `users/${uid}/contributions`,
      contributionId
    );

    // Vérifier que c'est bien la contribution de cet utilisateur
    if (contribution.contributorUid !== uid) {
      throw new https.HttpsError('permission-denied', 'Access denied to this contribution');
    }

    // Vérifier que la contribution correspond au PaymentIntent
    if (contribution.payment.paymentIntentId !== paymentIntentId) {
      throw new https.HttpsError('invalid-argument', 'PaymentIntent does not match contribution');
    }

    // Vérifier le statut de la contribution
    if (contribution.status !== 'pending') {
      throw new https.HttpsError('failed-precondition', `Contribution is in status: ${contribution.status}`);
    }

    // Récupérer le projet et l'utilisateur
    const [project, user] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', contribution.projectId),
      firestoreHelper.getDocument<UserDocument>('users', uid)
    ]);

    return { contribution, project, user };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate confirmation access', error, { uid, contributionId, paymentIntentId });
    throw new https.HttpsError('internal', 'Unable to validate confirmation access');
  }
}

/**
 * Vérifie le statut du PaymentIntent auprès de Stripe
 */
async function verifyStripePaymentIntent(
  paymentIntentId: string,
  clientSecret: string,
  expectedAmount: number
): Promise<any> {
  try {
    const paymentIntent = await stripeService.retrievePaymentIntent(paymentIntentId);

    // Vérifier que le client secret correspond
    if (!paymentIntent.client_secret || !paymentIntent.client_secret.startsWith(clientSecret.split('_secret_')[0])) {
      throw new https.HttpsError('permission-denied', 'Invalid client secret');
    }

    // Vérifier le statut du paiement
    if (paymentIntent.status !== 'succeeded') {
      throw new https.HttpsError(
        'failed-precondition',
        `Payment not successful. Status: ${paymentIntent.status}`
      );
    }

    // Vérifier que le montant correspond
    if (paymentIntent.amount !== expectedAmount) {
      throw new https.HttpsError(
        'invalid-argument',
        `Payment amount mismatch. Expected: ${expectedAmount}, Received: ${paymentIntent.amount}`
      );
    }

    logger.info('Stripe PaymentIntent verified', {
      paymentIntentId,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      created: paymentIntent.created,
    });

    return paymentIntent;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to verify Stripe PaymentIntent', error, { paymentIntentId });
    throw new https.HttpsError('internal', 'Unable to verify payment with Stripe');
  }
}

/**
 * Confirme la contribution et met à jour toutes les données
 */
async function confirmContributionTransaction(
  contribution: ContributionDocument,
  project: ProjectDocument,
  paymentIntent: any,
  uid: string
): Promise<void> {
  try {
    const now = new Date();
    const transactionId = helpers.string.generateId('txn');

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mise à jour de la contribution principale
      const contributionRef = firestoreHelper.getDocumentRef(
        `projects/${contribution.projectId}/contributions`,
        contribution.id
      );
      
      transaction.update(contributionRef, {
        status: 'confirmed',
        confirmedAt: now,
        transactionId,
        'payment.confirmedPaymentIntentId': paymentIntent.id,
        'payment.processorStatus': paymentIntent.status,
        'payment.stripeChargeId': paymentIntent.charges?.data?.[0]?.id,
        'payment.receiptUrl': paymentIntent.charges?.data?.[0]?.receipt_url,
        updatedAt: now,
        version: contribution.version + 1,
      });

      // Mise à jour de la référence utilisateur
      const userContributionRef = firestoreHelper.getDocumentRef(
        `users/${uid}/contributions`,
        contribution.id
      );
      
      transaction.update(userContributionRef, {
        status: 'confirmed',
        confirmedAt: now,
        transactionId,
        updatedAt: now,
      });

      // Mise à jour des statistiques du projet
      const projectRef = firestoreHelper.getDocumentRef('projects', contribution.projectId);
      const projectDoc = await transaction.get(projectRef);
      
      if (projectDoc.exists) {
        const projectData = projectDoc.data()!;
        const newRaised = projectData.funding.raised + contribution.amount.gross;
        const newPercentage = Math.round((newRaised / projectData.funding.goal) * 100);

        // Calculer le nouveau statut si l'objectif est atteint
        let newStatus = projectData.status;
        if (newPercentage >= 100 && projectData.status === STATUS.PROJECT.ACTIVE) {
          newStatus = STATUS.PROJECT.FUNDING_COMPLETE;
        }

        transaction.update(projectRef, {
          'funding.raised': newRaised,
          'funding.percentage': newPercentage,
          'funding.contributorsCount': projectData.funding.contributorsCount + 1,
          'stats.lastContributionAt': now,
          status: newStatus,
          updatedAt: now,
          version: projectData.version + 1,
        });
      }

      // Créer l'entrée dans le ledger des transactions
      const transactionEntry = {
        id: transactionId,
        type: 'contribution_confirmed',
        contributionId: contribution.id,
        projectId: contribution.projectId,
        contributorUid: uid,
        amount: contribution.amount,
        fees: {
          platformFee: contribution.amount.platformFee,
          stripeFee: contribution.amount.stripeFee,
          total: contribution.amount.totalFees,
        },
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          chargeId: paymentIntent.charges?.data?.[0]?.id,
        },
        escrow: {
          held: true,
          amount: contribution.amount.net,
          releaseSchedule: contribution.escrow.releaseSchedule,
        },
        createdAt: now,
        processedAt: now,
      };

      const transactionRef = firestoreHelper.getDocumentRef('transactions', transactionId);
      transaction.set(transactionRef, transactionEntry);
    });

    logger.info('Contribution confirmation transaction completed', {
      contributionId: contribution.id,
      transactionId,
      amount: contribution.amount.gross,
      projectId: contribution.projectId,
    });

  } catch (error) {
    logger.error('Failed to confirm contribution transaction', error, {
      contributionId: contribution.id,
      paymentIntentId: paymentIntent.id,
    });
    throw new https.HttpsError('internal', 'Unable to confirm contribution');
  }
}

/**
 * Envoie le reçu par email
 */
async function sendContributionReceipt(
  contribution: ContributionDocument,
  project: ProjectDocument,
  user: UserDocument,
  receiptUrl: string
): Promise<void> {
  try {
    if (contribution.anonymous) {
      return; // Pas de reçu pour les contributions anonymes
    }

    const emailData = {
      to: user.email,
      templateId: 'contribution_receipt',
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

    logger.info('Contribution receipt sent', {
      contributionId: contribution.id,
      recipientEmail: user.email,
      amount: contribution.amount.gross,
    });

  } catch (error) {
    logger.error('Failed to send contribution receipt', error, {
      contributionId: contribution.id,
      userEmail: user.email,
    });
    // Ne pas faire échouer la confirmation pour l'envoi d'email
  }
}

/**
 * Met à jour les statistiques globales
 */
async function updatePlatformStats(
  contribution: ContributionDocument,
  project: ProjectDocument
): Promise<void> {
  try {
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'contributions.total': 1,
      'contributions.totalAmount': contribution.amount.gross,
      'contributions.platformRevenue': contribution.amount.platformFee,
      [`categories.${project.category}.totalContributions`]: 1,
      [`categories.${project.category}.totalAmount`]: contribution.amount.gross,
    });

    logger.info('Platform stats updated for contribution', {
      contributionId: contribution.id,
      amount: contribution.amount.gross,
      category: project.category,
    });

  } catch (error) {
    logger.error('Failed to update platform stats', error, {
      contributionId: contribution.id,
    });
    // Ne pas faire échouer la confirmation pour les stats
  }
}

/**
 * Crée l'activité dans le feed
 */
async function createContributionActivity(
  contribution: ContributionDocument,
  project: ProjectDocument,
  user: UserDocument
): Promise<void> {
  try {
    const feedEntry = {
      id: helpers.string.generateId('feed'),
      type: 'contribution_confirmed',
      contributionId: contribution.id,
      projectId: contribution.projectId,
      projectTitle: project.title,
      contributorUid: contribution.anonymous ? '' : user.uid,
      contributorName: contribution.anonymous ? 'Contributeur anonyme' : `${user.firstName} ${user.lastName}`,
      amount: contribution.amount.gross,
      currency: contribution.amount.currency,
      message: contribution.message,
      anonymous: contribution.anonymous,
      createdAt: new Date(),
      visibility: 'public',
    };

    await firestoreHelper.addDocument('activity_feed', feedEntry);

    logger.info('Contribution activity created', {
      contributionId: contribution.id,
      feedEntryId: feedEntry.id,
      projectId: contribution.projectId,
    });

  } catch (error) {
    logger.error('Failed to create contribution activity', error, {
      contributionId: contribution.id,
    });
    // Ne pas faire échouer la confirmation pour l'activité
  }
}

/**
 * Exécute la confirmation de paiement
 */
async function executeConfirmPayment(
  contributionId: string,
  data: ContributionsAPI.ConfirmContributionRequest,
  context: CallableContext
): Promise<ContributionsAPI.ConfirmContributionResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'accès et récupération des données
  const { contribution, project, user } = await validateConfirmationAccess(
    uid,
    contributionId,
    data.paymentIntentId
  );
  
  // Vérification auprès de Stripe
  const paymentIntent = await verifyStripePaymentIntent(
    data.paymentIntentId,
    data.stripeClientSecret,
    contribution.amount.gross
  );
  
  // Transaction de confirmation
  await confirmContributionTransaction(contribution, project, paymentIntent, uid);
  
  // Processus post-confirmation en parallèle
  await Promise.all([
    sendContributionReceipt(
      contribution, 
      project, 
      user, 
      paymentIntent.charges?.data?.[0]?.receipt_url || ''
    ),
    updatePlatformStats(contribution, project),
    createContributionActivity(contribution, project, user),
  ]);

  // Générer l'ID de transaction
  const transactionId = helpers.string.generateId('txn');

  // Log business
  logger.business('Contribution confirmed', 'contributions', {
    contributionId,
    transactionId,
    paymentIntentId: data.paymentIntentId,
    contributorUid: uid,
    projectId: contribution.projectId,
    amount: contribution.amount.gross,
    netAmount: contribution.amount.net,
    fees: {
      platform: contribution.amount.platformFee,
      stripe: contribution.amount.stripeFee,
    },
    anonymous: contribution.anonymous,
    projectTitle: project.title,
  });

  // Log financial pour audit
  logger.financial('Payment confirmed and processed', {
    transactionId,
    contributionId,
    paymentIntentId: data.paymentIntentId,
    stripeChargeId: paymentIntent.charges?.data?.[0]?.id,
    grossAmount: contribution.amount.gross,
    netAmount: contribution.amount.net,
    platformRevenue: contribution.amount.platformFee,
    currency: contribution.amount.currency,
    contributorUid: uid,
    projectId: contribution.projectId,
    escrowHeld: contribution.escrow.held,
    escrowAmount: contribution.escrow.heldAmount,
  });

  return {
    status: 'confirmed',
    receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url || '',
    transactionId,
    escrowDetails: {
      amount: contribution.amount.net,
      heldUntil: contribution.escrow.expectedReleaseDate.toISOString(),
      releaseSchedule: contribution.escrow.releaseSchedule.map(schedule => ({
        milestoneId: schedule.milestoneId,
        amount: schedule.amount,
        conditions: schedule.releaseCondition,
      })),
    },
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const confirmPayment = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ContributionsAPI.ConfirmContributionResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ContributionsAPI.ConfirmContributionRequest>(requestSchema, data);

    // Extraction de l'ID de contribution depuis le context ou les données
    // Note: Dans une implémentation réelle, l'ID de contribution pourrait être passé différemment
    const contributionId = (data as any).contributionId;
    if (!contributionId) {
      throw new https.HttpsError('invalid-argument', 'Contribution ID is required');
    }

    // Logging de démarrage
    logger.info('Confirming payment', {
      functionName: 'confirmPayment',
      uid: context.auth.uid,
      contributionId,
      paymentIntentId: validatedData.paymentIntentId,
    });

    // Exécution
    const result = await executeConfirmPayment(contributionId, validatedData, context);

    // Logging de succès
    logger.info('Payment confirmed successfully', {
      functionName: 'confirmPayment',
      uid: context.auth.uid,
      contributionId,
      transactionId: result.transactionId,
      paymentIntentId: validatedData.paymentIntentId,
      status: result.status,
      escrowAmount: result.escrowDetails.amount,
      success: true,
    });

    return result;
  })
);