/**
 * Process Refunds Firebase Function
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
import { PaymentsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, PAYMENT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  refundType: Joi.string().valid('single', 'project_cancelled', 'project_failed', 'dispute_resolution').required(),
  
  // Pour refund individuel
  contributionId: Joi.string().when('refundType', { is: 'single', then: Joi.required() }),
  refundReason: Joi.string().min(10).max(500).when('refundType', { is: 'single', then: Joi.required() }),
  
  // Pour refunds groupés par projet
  projectId: Joi.string().when('refundType', { 
    is: Joi.string().valid('project_cancelled', 'project_failed'), 
    then: Joi.required() 
  }),
  
  // Paramètres de contrôle
  amount: Joi.number().min(0).optional(), // Montant partiel si spécifié
  notifyContributors: Joi.boolean().default(true),
  processImmediately: Joi.boolean().default(false), // Pour bypass du délai de sécurité
  adminOverride: Joi.boolean().default(false),
}).required();

/**
 * Valide les permissions pour le remboursement
 */
async function validateRefundPermissions(
  uid: string,
  refundType: string,
  contributionId?: string,
  projectId?: string
): Promise<{ user: UserDocument; hasAdminAccess: boolean }> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);
    
    const hasAdminAccess = user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS) ||
                          user.permissions.includes(USER_PERMISSIONS.PROCESS_REFUNDS);

    // Valider selon le type de remboursement
    switch (refundType) {
      case 'single':
        if (!contributionId) {
          throw new https.HttpsError('invalid-argument', 'Contribution ID required for single refund');
        }
        
        // Seuls les admins peuvent faire des remboursements individuels
        if (!hasAdminAccess) {
          throw new https.HttpsError('permission-denied', 'Admin access required for individual refunds');
        }
        break;

      case 'project_cancelled':
      case 'project_failed':
        if (!projectId) {
          throw new https.HttpsError('invalid-argument', 'Project ID required for project refunds');
        }
        
        // Vérifier que l'utilisateur est le créateur ou admin
        const project = await firestoreHelper.getDocument<ProjectDocument>('projects', projectId);
        if (project.creatorUid !== uid && !hasAdminAccess) {
          throw new https.HttpsError('permission-denied', 'Only project creator or admins can process project refunds');
        }
        break;

      case 'dispute_resolution':
        // Seuls les admins peuvent traiter les résolutions de litiges
        if (!hasAdminAccess) {
          throw new https.HttpsError('permission-denied', 'Admin access required for dispute resolution');
        }
        break;

      default:
        throw new https.HttpsError('invalid-argument', `Unsupported refund type: ${refundType}`);
    }

    return { user, hasAdminAccess };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate refund permissions', error, { uid, refundType, contributionId, projectId });
    throw new https.HttpsError('internal', 'Unable to validate refund permissions');
  }
}

/**
 * Récupère les contributions éligibles au remboursement
 */
async function getEligibleContributions(
  refundType: string,
  contributionId?: string,
  projectId?: string
): Promise<ContributionDocument[]> {
  try {
    if (refundType === 'single' && contributionId) {
      // Remboursement individuel
      const contribution = await firestoreHelper.getDocument<ContributionDocument>(
        `projects/${projectId}/contributions`,
        contributionId
      );
      
      if (contribution.status !== 'confirmed') {
        throw new https.HttpsError('failed-precondition', 'Only confirmed contributions can be refunded');
      }
      
      return [contribution];
    }

    if ((refundType === 'project_cancelled' || refundType === 'project_failed') && projectId) {
      // Remboursements groupés par projet
      const contributions = await firestoreHelper.queryDocuments<ContributionDocument>(
        `projects/${projectId}/contributions`,
        [['status', '==', 'confirmed']]
      );

      return contributions.data;
    }

    throw new https.HttpsError('invalid-argument', 'Invalid refund configuration');

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to get eligible contributions', error, { refundType, contributionId, projectId });
    throw new https.HttpsError('internal', 'Unable to retrieve contributions for refund');
  }
}

/**
 * Calcule le montant de remboursement
 */
function calculateRefundAmount(
  contribution: ContributionDocument,
  refundType: string,
  requestedAmount?: number
): { refundAmount: number; refundFees: number; netRefund: number } {
  const originalAmount = contribution.amount.gross;
  const originalFees = contribution.amount.totalFees;
  
  let refundAmount = requestedAmount || originalAmount;
  
  // Limiter au montant original
  refundAmount = Math.min(refundAmount, originalAmount);
  
  // Calculer les frais de remboursement selon le type
  let refundFees = 0;
  
  switch (refundType) {
    case 'project_cancelled':
    case 'project_failed':
      // Remboursement complet pour échec de projet
      refundFees = 0;
      break;
      
    case 'single':
    case 'dispute_resolution':
      // Frais de traitement pour remboursements individuels
      refundFees = Math.min(
        Math.round(refundAmount * PAYMENT_CONFIG.REFUND_FEE_RATE),
        PAYMENT_CONFIG.MAX_REFUND_FEE
      );
      break;
  }
  
  const netRefund = refundAmount - refundFees;
  
  return { refundAmount, refundFees, netRefund };
}

/**
 * Crée le remboursement Stripe
 */
async function createStripeRefund(
  contribution: ContributionDocument,
  refundAmount: number,
  reason: string
): Promise<any> {
  try {
    const refundData = {
      charge: contribution.payment.stripeChargeId,
      amount: refundAmount,
      reason: reason || 'requested_by_customer',
      metadata: {
        contributionId: contribution.id,
        projectId: contribution.projectId,
        refundType: reason,
        processedAt: new Date().toISOString(),
      },
    };

    const refund = await stripeService.createRefund(refundData);

    logger.info('Stripe refund created', {
      refundId: refund.id,
      contributionId: contribution.id,
      chargeId: contribution.payment.stripeChargeId,
      amount: refundAmount,
      status: refund.status,
    });

    return refund;

  } catch (error) {
    logger.error('Failed to create Stripe refund', error, {
      contributionId: contribution.id,
      chargeId: contribution.payment.stripeChargeId,
      refundAmount,
    });
    throw new https.HttpsError('internal', 'Unable to process refund with payment processor');
  }
}

/**
 * Met à jour les documents après remboursement
 */
async function updateDocumentsAfterRefund(
  contribution: ContributionDocument,
  refund: any,
  refundDetails: any,
  uid: string
): Promise<void> {
  try {
    const now = new Date();
    const refundTransactionId = helpers.string.generateId('refund_txn');

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour la contribution
      const contributionRef = firestoreHelper.getDocumentRef(
        `projects/${contribution.projectId}/contributions`,
        contribution.id
      );
      
      transaction.update(contributionRef, {
        status: 'refunded',
        refundedAt: now,
        refundTransactionId,
        'payment.refundId': refund.id,
        'payment.refundAmount': refundDetails.refundAmount,
        'payment.refundFees': refundDetails.refundFees,
        'payment.netRefund': refundDetails.netRefund,
        'payment.refundStatus': refund.status,
        processedBy: uid,
        updatedAt: now,
        version: contribution.version + 1,
      });

      // Mettre à jour la référence utilisateur
      const userContributionRef = firestoreHelper.getDocumentRef(
        `users/${contribution.contributorUid}/contributions`,
        contribution.id
      );
      
      transaction.update(userContributionRef, {
        status: 'refunded',
        refundedAt: now,
        refundAmount: refundDetails.netRefund,
        updatedAt: now,
      });

      // Mettre à jour les statistiques du projet
      const projectRef = firestoreHelper.getDocumentRef('projects', contribution.projectId);
      const projectDoc = await transaction.get(projectRef);
      
      if (projectDoc.exists) {
        const projectData = projectDoc.data()!;
        const newRaised = Math.max(0, projectData.funding.raised - contribution.amount.gross);
        const newPercentage = Math.round((newRaised / projectData.funding.goal) * 100);
        const newContributorsCount = Math.max(0, projectData.funding.contributorsCount - 1);

        transaction.update(projectRef, {
          'funding.raised': newRaised,
          'funding.percentage': newPercentage,
          'funding.contributorsCount': newContributorsCount,
          'stats.lastRefundAt': now,
          updatedAt: now,
        });
      }

      // Créer l'entrée dans le ledger des remboursements
      const refundEntry = {
        id: refundTransactionId,
        type: 'refund_processed',
        originalContributionId: contribution.id,
        projectId: contribution.projectId,
        contributorUid: contribution.contributorUid,
        originalAmount: contribution.amount.gross,
        refundAmount: refundDetails.refundAmount,
        fees: refundDetails.refundFees,
        netRefund: refundDetails.netRefund,
        stripeRefundId: refund.id,
        processedBy: uid,
        createdAt: now,
        processedAt: now,
      };

      const refundRef = firestoreHelper.getDocumentRef('refund_transactions', refundTransactionId);
      transaction.set(refundRef, refundEntry);
    });

  } catch (error) {
    logger.error('Failed to update documents after refund', error, {
      contributionId: contribution.id,
      refundId: refund.id,
    });
    throw error;
  }
}

/**
 * Envoie la notification de remboursement
 */
async function sendRefundNotification(
  contribution: ContributionDocument,
  project: ProjectDocument,
  refundDetails: any,
  refundReason: string
): Promise<void> {
  try {
    if (contribution.anonymous) {
      return; // Pas de notification pour les contributions anonymes
    }

    const user = await firestoreHelper.getDocument<UserDocument>('users', contribution.contributorUid);

    const emailData = {
      to: user.email,
      templateId: 'refund_notification',
      dynamicTemplateData: {
        contributorName: `${user.firstName} ${user.lastName}`,
        projectTitle: project.title,
        originalAmount: (contribution.amount.gross / 100).toFixed(2),
        refundAmount: (refundDetails.netRefund / 100).toFixed(2),
        currency: contribution.amount.currency,
        refundReason,
        processedDate: new Date().toLocaleDateString('fr-FR'),
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        supportUrl: `${process.env.FRONTEND_URL}/support`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Refund notification sent', {
      contributionId: contribution.id,
      recipientEmail: user.email,
      refundAmount: refundDetails.netRefund,
    });

  } catch (error) {
    logger.error('Failed to send refund notification', error, {
      contributionId: contribution.id,
    });
    // Ne pas faire échouer le remboursement pour l'envoi d'email
  }
}

/**
 * Met à jour les statistiques de plateforme
 */
async function updateRefundStats(
  contributions: ContributionDocument[],
  refundType: string
): Promise<void> {
  try {
    const totalRefunded = contributions.reduce((sum, c) => sum + c.amount.gross, 0);
    const contributorsCount = new Set(contributions.map(c => c.contributorUid)).size;

    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'refunds.total': contributions.length,
      'refunds.totalAmount': totalRefunded,
      'refunds.uniqueContributors': contributorsCount,
      [`refunds.byType.${refundType}`]: contributions.length,
    });

    logger.info('Refund statistics updated', {
      refundType,
      contributionsCount: contributions.length,
      totalRefunded,
      contributorsCount,
    });

  } catch (error) {
    logger.error('Failed to update refund statistics', error, {
      refundType,
      contributionsCount: contributions.length,
    });
  }
}

/**
 * Traite un remboursement individuel
 */
async function processSingleRefund(
  contributionId: string,
  refundReason: string,
  requestedAmount: number | undefined,
  uid: string,
  notifyContributor: boolean
): Promise<any> {
  try {
    // Récupérer la contribution et vérifier l'éligibilité
    const contributionDoc = await firestoreHelper.queryDocuments<ContributionDocument>(
      'contributions',
      [['id', '==', contributionId], ['status', '==', 'confirmed']],
      { limit: 1 }
    );

    if (contributionDoc.data.length === 0) {
      throw new https.HttpsError('not-found', 'Eligible contribution not found');
    }

    const contribution = contributionDoc.data[0];
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', contribution.projectId);

    // Calculer le montant de remboursement
    const refundDetails = calculateRefundAmount(contribution, 'single', requestedAmount);

    // Créer le remboursement Stripe
    const stripeRefund = await createStripeRefund(contribution, refundDetails.refundAmount, refundReason);

    // Mettre à jour les documents
    await updateDocumentsAfterRefund(contribution, stripeRefund, refundDetails, uid);

    // Envoyer la notification
    if (notifyContributor) {
      await sendRefundNotification(contribution, project, refundDetails, refundReason);
    }

    return {
      contributionId,
      refundId: stripeRefund.id,
      originalAmount: contribution.amount.gross,
      refundAmount: refundDetails.refundAmount,
      fees: refundDetails.refundFees,
      netRefund: refundDetails.netRefund,
      status: stripeRefund.status,
    };

  } catch (error) {
    logger.error('Failed to process single refund', error, { contributionId, refundReason });
    throw error;
  }
}

/**
 * Traite les remboursements groupés pour un projet
 */
async function processProjectRefunds(
  projectId: string,
  refundType: string,
  uid: string,
  notifyContributors: boolean
): Promise<any[]> {
  try {
    // Récupérer toutes les contributions confirmées du projet
    const contributionsResult = await firestoreHelper.queryDocuments<ContributionDocument>(
      `projects/${projectId}/contributions`,
      [['status', '==', 'confirmed']]
    );

    const contributions = contributionsResult.data;

    if (contributions.length === 0) {
      logger.info('No confirmed contributions to refund', { projectId, refundType });
      return [];
    }

    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', projectId);
    const refundResults: any[] = [];

    // Traiter les remboursements par lots pour éviter les timeouts
    const batchSize = 10;
    for (let i = 0; i < contributions.length; i += batchSize) {
      const batch = contributions.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(async (contribution) => {
          try {
            const refundDetails = calculateRefundAmount(contribution, refundType);
            const stripeRefund = await createStripeRefund(contribution, refundDetails.refundAmount, refundType);
            
            await updateDocumentsAfterRefund(contribution, stripeRefund, refundDetails, uid);
            
            if (notifyContributors) {
              await sendRefundNotification(contribution, project, refundDetails, refundType);
            }

            return {
              contributionId: contribution.id,
              refundId: stripeRefund.id,
              originalAmount: contribution.amount.gross,
              refundAmount: refundDetails.refundAmount,
              netRefund: refundDetails.netRefund,
              status: stripeRefund.status,
              success: true,
            };

          } catch (error) {
            logger.error('Failed to process individual refund in batch', error, {
              contributionId: contribution.id,
              projectId,
            });
            
            return {
              contributionId: contribution.id,
              error: error instanceof Error ? error.message : 'Unknown error',
              success: false,
            };
          }
        })
      );

      // Collecter les résultats
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          refundResults.push(result.value);
        } else {
          refundResults.push({
            error: result.reason,
            success: false,
          });
        }
      });
    }

    // Mettre à jour les statistiques
    const successfulRefunds = refundResults.filter(r => r.success);
    if (successfulRefunds.length > 0) {
      await updateRefundStats(
        successfulRefunds.map(r => ({ 
          amount: { gross: r.originalAmount }, 
          contributorUid: contributions.find(c => c.id === r.contributionId)?.contributorUid 
        })) as ContributionDocument[],
        refundType
      );
    }

    logger.info('Project refunds processed', {
      projectId,
      refundType,
      totalContributions: contributions.length,
      successfulRefunds: successfulRefunds.length,
      failedRefunds: refundResults.length - successfulRefunds.length,
    });

    return refundResults;

  } catch (error) {
    logger.error('Failed to process project refunds', error, { projectId, refundType });
    throw error;
  }
}

/**
 * Exécute le traitement des remboursements
 */
async function executeProcessRefunds(
  data: PaymentsAPI.ProcessRefundsRequest,
  context: CallableContext
): Promise<PaymentsAPI.ProcessRefundsResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  const { user, hasAdminAccess } = await validateRefundPermissions(
    uid,
    data.refundType,
    data.contributionId,
    data.projectId
  );

  let refundResults: any[] = [];

  // Traiter selon le type de remboursement
  switch (data.refundType) {
    case 'single':
      const singleResult = await processSingleRefund(
        data.contributionId!,
        data.refundReason!,
        data.amount,
        uid,
        data.notifyContributors
      );
      refundResults = [singleResult];
      break;

    case 'project_cancelled':
    case 'project_failed':
      refundResults = await processProjectRefunds(
        data.projectId!,
        data.refundType,
        uid,
        data.notifyContributors
      );
      break;

    case 'dispute_resolution':
      // TODO: Implémenter la logique spécifique aux résolutions de litiges
      throw new https.HttpsError('unimplemented', 'Dispute resolution refunds not yet implemented');

    default:
      throw new https.HttpsError('invalid-argument', `Unsupported refund type: ${data.refundType}`);
  }

  // Calculer les statistiques de résultats
  const successful = refundResults.filter(r => r.success);
  const failed = refundResults.filter(r => !r.success);
  const totalRefunded = successful.reduce((sum, r) => sum + (r.refundAmount || 0), 0);

  // Log business
  logger.business('Refunds processed', 'refunds', {
    refundType: data.refundType,
    processedBy: uid,
    totalAttempted: refundResults.length,
    successful: successful.length,
    failed: failed.length,
    totalRefunded,
    projectId: data.projectId,
    contributionId: data.contributionId,
  });

  // Log financial pour audit
  logger.financial('Refund batch completed', {
    refundType: data.refundType,
    processedBy: uid,
    totalRefunded,
    successfulRefunds: successful.length,
    failedRefunds: failed.length,
    projectId: data.projectId,
    hasAdminOverride: data.adminOverride,
  });

  return {
    refundType: data.refundType,
    totalProcessed: refundResults.length,
    successful: successful.length,
    failed: failed.length,
    totalRefunded,
    results: refundResults,
    processedAt: new Date().toISOString(),
    processedBy: uid,
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const processRefunds = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<PaymentsAPI.ProcessRefundsResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<PaymentsAPI.ProcessRefundsRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Processing refunds', {
      functionName: 'processRefunds',
      uid: context.auth.uid,
      refundType: validatedData.refundType,
      projectId: validatedData.projectId,
      contributionId: validatedData.contributionId,
      processImmediately: validatedData.processImmediately,
    });

    // Exécution
    const result = await executeProcessRefunds(validatedData, context);

    // Logging de succès
    logger.info('Refunds processed successfully', {
      functionName: 'processRefunds',
      uid: context.auth.uid,
      refundType: result.refundType,
      totalProcessed: result.totalProcessed,
      successful: result.successful,
      failed: result.failed,
      totalRefunded: result.totalRefunded,
      success: true,
    });

    return result;
  })
);