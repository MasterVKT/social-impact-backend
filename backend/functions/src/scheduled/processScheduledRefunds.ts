/**
 * Process Scheduled Refunds Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { stripeService } from '../integrations/stripe/stripeService';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument, ContributionDocument, RefundDocument } from '../types/firestore';
import { STATUS, REFUND_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour une demande de remboursement programmé
 */
interface ScheduledRefundRequest {
  id: string;
  contributionId: string;
  contributorUid: string;
  projectId: string;
  amount: number;
  reason: 'project_cancelled' | 'funding_deadline_missed' | 'creator_breach' | 'audit_failure' | 'voluntary_withdrawal';
  scheduledFor: Date;
  createdAt: Date;
  metadata: any;
  paymentIntentId?: string;
  stripeChargeId?: string;
}

/**
 * Interface pour les résultats de traitement des remboursements
 */
interface RefundProcessingResults {
  totalScheduledRefunds: number;
  refundsProcessed: number;
  refundsSuccessful: number;
  refundsFailed: number;
  totalAmountRefunded: number;
  errors: number;
  processingTime: number;
  batchId: string;
  byReason: Record<string, number>;
  byStatus: Record<string, number>;
}

/**
 * Récupère les remboursements programmés éligibles
 */
async function getScheduledRefunds(): Promise<ScheduledRefundRequest[]> {
  try {
    const now = new Date();
    
    // Récupérer les remboursements programmés pour aujourd'hui ou avant
    const scheduledRefunds = await firestoreHelper.queryDocuments<ScheduledRefundRequest>(
      'scheduled_refunds',
      [
        ['scheduledFor', '<=', now],
        ['status', '==', 'pending'],
        ['processed', '!=', true]
      ],
      { 
        limit: REFUND_CONFIG.MAX_BATCH_SIZE,
        orderBy: [{ field: 'scheduledFor', direction: 'asc' }, { field: 'amount', direction: 'desc' }]
      }
    );

    logger.info('Scheduled refunds retrieved', {
      totalFound: scheduledRefunds.data.length,
      maxBatchSize: REFUND_CONFIG.MAX_BATCH_SIZE
    });

    return scheduledRefunds.data;

  } catch (error) {
    logger.error('Failed to get scheduled refunds', error);
    throw error;
  }
}

/**
 * Valide qu'un remboursement peut être traité
 */
async function validateRefundEligibility(refundRequest: ScheduledRefundRequest): Promise<{
  eligible: boolean;
  reason?: string;
  contribution?: ContributionDocument;
  contributor?: UserDocument;
  project?: ProjectDocument;
}> {
  try {
    // Récupérer la contribution originale
    const contribution = await firestoreHelper.getDocument<ContributionDocument>(
      'contributions',
      refundRequest.contributionId
    );

    if (!contribution) {
      return { eligible: false, reason: 'Contribution not found' };
    }

    if (contribution.status !== 'confirmed') {
      return { eligible: false, reason: 'Contribution not confirmed', contribution };
    }

    if (contribution.refunded) {
      return { eligible: false, reason: 'Already refunded', contribution };
    }

    // Récupérer le contributeur
    const contributor = await firestoreHelper.getDocument<UserDocument>('users', refundRequest.contributorUid);
    if (!contributor) {
      return { eligible: false, reason: 'Contributor not found', contribution };
    }

    // Récupérer le projet
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', refundRequest.projectId);
    if (!project) {
      return { eligible: false, reason: 'Project not found', contribution };
    }

    // Vérifications selon la raison du remboursement
    switch (refundRequest.reason) {
      case 'project_cancelled':
        if (project.status !== STATUS.PROJECT.CANCELLED) {
          return { eligible: false, reason: 'Project not cancelled', contribution, contributor, project };
        }
        break;

      case 'funding_deadline_missed':
        if (project.status !== STATUS.PROJECT.EXPIRED) {
          return { eligible: false, reason: 'Project not expired', contribution, contributor, project };
        }
        break;

      case 'creator_breach':
        if (!project.breachReported) {
          return { eligible: false, reason: 'No breach reported', contribution, contributor, project };
        }
        break;

      case 'audit_failure':
        if (!project.auditScore || project.auditScore >= REFUND_CONFIG.MIN_AUDIT_SCORE_FOR_REFUND) {
          return { eligible: false, reason: 'Audit score sufficient', contribution, contributor, project };
        }
        break;

      case 'voluntary_withdrawal':
        // Vérifier la période de retrait volontaire
        const daysSinceContribution = Math.floor(
          (Date.now() - contribution.confirmedAt.getTime()) / (24 * 60 * 60 * 1000)
        );
        if (daysSinceContribution > REFUND_CONFIG.VOLUNTARY_WITHDRAWAL_PERIOD_DAYS) {
          return { eligible: false, reason: 'Voluntary withdrawal period expired', contribution, contributor, project };
        }
        break;

      default:
        return { eligible: false, reason: 'Invalid refund reason', contribution, contributor, project };
    }

    return { eligible: true, contribution, contributor, project };

  } catch (error) {
    logger.error('Failed to validate refund eligibility', error, {
      refundId: refundRequest.id,
      contributionId: refundRequest.contributionId
    });
    return { eligible: false, reason: 'Validation error' };
  }
}

/**
 * Traite un remboursement via Stripe
 */
async function processStripeRefund(
  refundRequest: ScheduledRefundRequest,
  contribution: ContributionDocument
): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    if (!contribution.stripeChargeId && !contribution.stripePaymentIntentId) {
      throw new Error('No Stripe charge ID or payment intent ID found');
    }

    // Calculer le montant à rembourser (inclure les intérêts si applicable)
    let refundAmount = contribution.amount;
    
    // Ajouter les intérêts accumulés si le projet n'est pas en faute
    if (refundRequest.reason !== 'creator_breach' && refundRequest.reason !== 'audit_failure') {
      const escrowRecord = await firestoreHelper.queryDocuments<any>(
        'escrow_records',
        [
          ['contributionId', '==', contribution.id],
          ['status', '==', 'held']
        ],
        { limit: 1 }
      );

      if (escrowRecord.data.length > 0) {
        refundAmount += escrowRecord.data[0].accruedInterest || 0;
      }
    }

    // Créer le remboursement Stripe
    const stripeRefund = await stripeService.createRefund({
      chargeId: contribution.stripeChargeId,
      paymentIntentId: contribution.stripePaymentIntentId,
      amount: refundAmount,
      reason: getStripeRefundReason(refundRequest.reason),
      metadata: {
        contributionId: contribution.id,
        projectId: refundRequest.projectId,
        refundRequestId: refundRequest.id,
        refundReason: refundRequest.reason,
        originalAmount: contribution.amount,
        interestIncluded: refundAmount > contribution.amount,
        processedBy: 'system'
      }
    });

    logger.info('Stripe refund processed successfully', {
      refundId: refundRequest.id,
      contributionId: contribution.id,
      stripeRefundId: stripeRefund.id,
      originalAmount: contribution.amount,
      refundAmount,
      reason: refundRequest.reason
    });

    return {
      success: true,
      refundId: stripeRefund.id
    };

  } catch (error) {
    logger.error('Failed to process Stripe refund', error, {
      refundId: refundRequest.id,
      contributionId: contribution.id,
      amount: refundRequest.amount,
      reason: refundRequest.reason
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Stripe error'
    };
  }
}

/**
 * Convertit la raison du remboursement pour Stripe
 */
function getStripeRefundReason(reason: string): 'duplicate' | 'fraudulent' | 'requested_by_customer' {
  switch (reason) {
    case 'creator_breach':
    case 'audit_failure':
      return 'fraudulent';
    case 'voluntary_withdrawal':
      return 'requested_by_customer';
    default:
      return 'requested_by_customer';
  }
}

/**
 * Met à jour les enregistrements après un remboursement réussi
 */
async function updateRecordsAfterRefund(
  refundRequest: ScheduledRefundRequest,
  contribution: ContributionDocument,
  stripeRefundId: string,
  refundAmount: number
): Promise<void> {
  try {
    await firestoreHelper.runTransaction(async (transaction) => {
      // Créer l'enregistrement de remboursement
      const refundId = helpers.string.generateId('refund');
      const refundRef = firestoreHelper.getDocumentRef('refunds', refundId);
      
      const refundRecord: RefundDocument = {
        id: refundId,
        contributionId: contribution.id,
        contributorUid: refundRequest.contributorUid,
        projectId: refundRequest.projectId,
        originalAmount: contribution.amount,
        refundAmount,
        interestIncluded: refundAmount > contribution.amount,
        reason: refundRequest.reason,
        stripeRefundId,
        status: 'completed',
        processedAt: new Date(),
        processedBy: 'system',
        scheduledRefundId: refundRequest.id,
        metadata: refundRequest.metadata,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      transaction.set(refundRef, refundRecord);

      // Mettre à jour la contribution
      const contributionRef = firestoreHelper.getDocumentRef('contributions', contribution.id);
      transaction.update(contributionRef, {
        refunded: true,
        refundedAt: new Date(),
        refundAmount,
        refundId,
        stripeRefundId,
        status: 'refunded',
        updatedAt: new Date()
      });

      // Mettre à jour le projet
      const projectRef = firestoreHelper.getDocumentRef('projects', refundRequest.projectId);
      transaction.update(projectRef, {
        currentFunding: firestoreHelper.increment(-contribution.amount),
        'stats.totalRefunded': firestoreHelper.increment(refundAmount),
        'stats.refundsCount': firestoreHelper.increment(1),
        'stats.lastRefund': new Date(),
        updatedAt: new Date()
      });

      // Mettre à jour les statistiques du contributeur
      const contributorRef = firestoreHelper.getDocumentRef('users', refundRequest.contributorUid);
      transaction.update(contributorRef, {
        'stats.totalRefunded': firestoreHelper.increment(refundAmount),
        'stats.refundsReceived': firestoreHelper.increment(1),
        'stats.lastRefund': new Date()
      });

      // Marquer la demande programmée comme traitée
      const scheduledRefundRef = firestoreHelper.getDocumentRef('scheduled_refunds', refundRequest.id);
      transaction.update(scheduledRefundRef, {
        processed: true,
        processedAt: new Date(),
        status: 'completed',
        refundId,
        stripeRefundId,
        actualAmount: refundAmount
      });

      // Mettre à jour l'enregistrement d'escrow si applicable
      const escrowRecords = await firestoreHelper.queryDocuments<any>(
        'escrow_records',
        [
          ['contributionId', '==', contribution.id],
          ['status', '==', 'held']
        ],
        { limit: 1 }
      );

      if (escrowRecords.data.length > 0) {
        const escrowRef = firestoreHelper.getDocumentRef('escrow_records', escrowRecords.data[0].id);
        transaction.update(escrowRef, {
          status: 'refunded',
          refundedAt: new Date(),
          refundAmount,
          finalAmount: refundAmount
        });
      }
    });

    logger.info('Records updated after successful refund', {
      refundId: refundRequest.id,
      contributionId: contribution.id,
      stripeRefundId,
      refundAmount,
      reason: refundRequest.reason
    });

  } catch (error) {
    logger.error('Failed to update records after refund', error, {
      refundId: refundRequest.id,
      contributionId: contribution.id,
      stripeRefundId,
      refundAmount
    });
    throw error;
  }
}

/**
 * Envoie la notification de remboursement au contributeur
 */
async function sendRefundNotification(
  contributor: UserDocument,
  refundRequest: ScheduledRefundRequest,
  refundAmount: number,
  stripeRefundId: string
): Promise<void> {
  try {
    // Créer la notification in-app
    const notificationId = helpers.string.generateId('notif');
    const notification = {
      id: notificationId,
      recipientUid: contributor.uid,
      senderUid: 'system',
      type: 'refund_processed',
      title: 'Remboursement traité',
      message: `Votre contribution de €${(refundAmount / 100).toFixed(2)} a été remboursée suite à ${getRefundReasonText(refundRequest.reason)}.`,
      data: {
        refundRequestId: refundRequest.id,
        contributionId: refundRequest.contributionId,
        projectId: refundRequest.projectId,
        originalAmount: refundRequest.amount,
        refundAmount,
        reason: refundRequest.reason,
        stripeRefundId,
        estimatedRefundDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() // 5-7 jours ouvrés
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/contributions/${refundRequest.contributionId}`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    };

    await firestoreHelper.setDocument('notifications', notificationId, notification);

    // Mettre à jour le compteur de notifications
    await firestoreHelper.updateDocument('users', contributor.uid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    // Envoyer l'email de notification si les préférences le permettent
    if (contributor.preferences?.notifications?.email) {
      await emailService.sendEmail({
        to: contributor.email,
        templateId: 'refund_processed',
        dynamicTemplateData: {
          userName: `${contributor.firstName} ${contributor.lastName}`,
          refundAmount: (refundAmount / 100).toFixed(2),
          originalAmount: (refundRequest.amount / 100).toFixed(2),
          reason: getRefundReasonText(refundRequest.reason),
          refundReference: stripeRefundId,
          estimatedRefundDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR'),
          supportUrl: `${process.env.FRONTEND_URL}/support`,
          dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
          contributionUrl: `${process.env.FRONTEND_URL}/contributions/${refundRequest.contributionId}`
        }
      });
    }

    logger.info('Refund notification sent', {
      contributorUid: contributor.uid,
      notificationId,
      refundAmount,
      emailSent: !!contributor.preferences?.notifications?.email
    });

  } catch (error) {
    logger.error('Failed to send refund notification', error, {
      contributorUid: contributor.uid,
      refundId: refundRequest.id
    });
  }
}

/**
 * Convertit la raison du remboursement en texte lisible
 */
function getRefundReasonText(reason: string): string {
  const reasonTexts = {
    'project_cancelled': 'l\'annulation du projet',
    'funding_deadline_missed': 'l\'échec du financement dans les délais',
    'creator_breach': 'une violation des termes par le créateur',
    'audit_failure': 'l\'échec de l\'audit du projet',
    'voluntary_withdrawal': 'votre demande de retrait'
  };

  return reasonTexts[reason as keyof typeof reasonTexts] || 'une raison technique';
}

/**
 * Traite un remboursement programmé individual
 */
async function processSingleRefund(refundRequest: ScheduledRefundRequest): Promise<{
  success: boolean;
  refundAmount?: number;
  error?: string;
}> {
  try {
    // Valider l'éligibilité
    const validation = await validateRefundEligibility(refundRequest);
    
    if (!validation.eligible) {
      logger.warn('Refund request not eligible', {
        refundId: refundRequest.id,
        reason: validation.reason
      });

      // Marquer comme non éligible
      await firestoreHelper.updateDocument('scheduled_refunds', refundRequest.id, {
        processed: true,
        processedAt: new Date(),
        status: 'ineligible',
        ineligibilityReason: validation.reason
      });

      return { success: false, error: validation.reason };
    }

    const { contribution, contributor, project } = validation;

    // Calculer le montant exact à rembourser
    let refundAmount = contribution.amount;

    // Ajouter les intérêts si applicable
    if (refundRequest.reason !== 'creator_breach' && refundRequest.reason !== 'audit_failure') {
      const escrowRecord = await firestoreHelper.queryDocuments<any>(
        'escrow_records',
        [
          ['contributionId', '==', contribution.id],
          ['status', '==', 'held']
        ],
        { limit: 1 }
      );

      if (escrowRecord.data.length > 0 && escrowRecord.data[0].accruedInterest > 0) {
        refundAmount += escrowRecord.data[0].accruedInterest;
        logger.info('Interest included in refund', {
          refundId: refundRequest.id,
          originalAmount: contribution.amount,
          interestAmount: escrowRecord.data[0].accruedInterest,
          totalRefund: refundAmount
        });
      }
    }

    // Traiter le remboursement Stripe
    const stripeResult = await processStripeRefund(refundRequest, contribution);
    
    if (!stripeResult.success) {
      // Marquer comme échec
      await firestoreHelper.updateDocument('scheduled_refunds', refundRequest.id, {
        processed: true,
        processedAt: new Date(),
        status: 'failed',
        error: stripeResult.error,
        retryScheduled: new Date(Date.now() + 60 * 60 * 1000) // Retry dans 1h
      });

      return { success: false, error: stripeResult.error };
    }

    // Mettre à jour les enregistrements
    await updateRecordsAfterRefund(
      refundRequest,
      contribution,
      stripeResult.refundId!,
      refundAmount
    );

    // Envoyer les notifications
    await sendRefundNotification(
      contributor!,
      refundRequest,
      refundAmount,
      stripeResult.refundId!
    );

    // Log financial pour audit
    logger.financial('Refund processed', {
      refundRequestId: refundRequest.id,
      contributionId: contribution.id,
      contributorUid: contributor!.uid,
      projectId: refundRequest.projectId,
      originalAmount: contribution.amount,
      refundAmount,
      interestAmount: refundAmount - contribution.amount,
      stripeRefundId: stripeResult.refundId!,
      reason: refundRequest.reason,
      currency: 'EUR',
      processedAt: new Date().toISOString()
    });

    logger.info('Refund processed successfully', {
      refundId: refundRequest.id,
      contributionId: contribution.id,
      refundAmount,
      stripeRefundId: stripeResult.refundId
    });

    return { success: true, refundAmount };

  } catch (error) {
    logger.error('Failed to process single refund', error, {
      refundId: refundRequest.id,
      contributionId: refundRequest.contributionId
    });

    // Marquer comme échec
    try {
      await firestoreHelper.updateDocument('scheduled_refunds', refundRequest.id, {
        processed: true,
        processedAt: new Date(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        retryScheduled: new Date(Date.now() + 60 * 60 * 1000)
      });
    } catch (updateError) {
      logger.error('Failed to update failed refund record', updateError, {
        refundId: refundRequest.id
      });
    }

    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Traite un lot de remboursements programmés
 */
async function processBatchRefunds(refundRequests: ScheduledRefundRequest[]): Promise<RefundProcessingResults> {
  const batchId = helpers.string.generateId('refund_batch');
  const startTime = Date.now();

  const results: RefundProcessingResults = {
    totalScheduledRefunds: refundRequests.length,
    refundsProcessed: 0,
    refundsSuccessful: 0,
    refundsFailed: 0,
    totalAmountRefunded: 0,
    errors: 0,
    processingTime: 0,
    batchId,
    byReason: {},
    byStatus: {}
  };

  try {
    logger.info('Starting batch refund processing', {
      batchId,
      refundCount: refundRequests.length
    });

    // Traiter chaque remboursement
    for (const refundRequest of refundRequests) {
      try {
        const processResult = await processSingleRefund(refundRequest);
        
        results.refundsProcessed++;
        
        if (processResult.success) {
          results.refundsSuccessful++;
          results.totalAmountRefunded += processResult.refundAmount || 0;
          results.byStatus['successful'] = (results.byStatus['successful'] || 0) + 1;
        } else {
          results.refundsFailed++;
          results.byStatus['failed'] = (results.byStatus['failed'] || 0) + 1;
        }

        // Compter par raison
        results.byReason[refundRequest.reason] = (results.byReason[refundRequest.reason] || 0) + 1;

      } catch (error) {
        logger.error('Failed to process refund in batch', error, {
          batchId,
          refundId: refundRequest.id
        });
        results.errors++;
        results.refundsFailed++;
      }

      // Pause entre les remboursements pour respecter les limites Stripe
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 seconde
    }

    results.processingTime = Date.now() - startTime;

    logger.info('Batch refund processing completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to process batch refunds', error, { batchId });
    results.errors++;
    return results;
  }
}

/**
 * Met à jour les métriques de remboursement
 */
async function updateRefundMetrics(results: RefundProcessingResults): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'refunds.totalProcessed': results.refundsProcessed,
      'refunds.totalSuccessful': results.refundsSuccessful,
      'refunds.totalFailed': results.refundsFailed,
      'refunds.totalAmountRefunded': results.totalAmountRefunded,
      'refunds.lastProcessingRun': new Date()
    });

    // Statistiques par raison
    for (const [reason, count] of Object.entries(results.byReason)) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', {
        [`refunds.byReason.${reason}`]: count
      });
    }

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.setDocument('platform_stats', `refunds_${monthKey}`, {
      month: monthKey,
      processed: results.refundsProcessed,
      successful: results.refundsSuccessful,
      failed: results.refundsFailed,
      totalAmountRefunded: results.totalAmountRefunded,
      processingTime: results.processingTime,
      batchId: results.batchId,
      byReason: results.byReason,
      byStatus: results.byStatus,
      updatedAt: new Date()
    });

    logger.info('Refund metrics updated', {
      ...results,
      monthKey,
      successRate: results.refundsSuccessful / results.refundsProcessed
    });

  } catch (error) {
    logger.error('Failed to update refund metrics', error);
  }
}

/**
 * Vérifie l'intégrité financière après les remboursements
 */
async function validateRefundIntegrity(results: RefundProcessingResults): Promise<void> {
  try {
    // Récupérer les statistiques financières actuelles
    const [platformStats, totalRefunds] = await Promise.all([
      firestoreHelper.getDocument('platform_stats', 'global'),
      firestoreHelper.queryDocuments<RefundDocument>('refunds', [
        ['status', '==', 'completed'],
        ['processedAt', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)] // Dernières 24h
      ])
    ]);

    const calculatedRefundTotal = totalRefunds.data.reduce((sum, refund) => sum + refund.refundAmount, 0);
    const recordedRefundTotal = platformStats?.refunds?.totalAmountRefunded || 0;

    // Vérifier les écarts
    const discrepancy = Math.abs(recordedRefundTotal - calculatedRefundTotal);
    
    if (discrepancy > REFUND_CONFIG.MAX_DISCREPANCY) {
      logger.security('Refund amount discrepancy detected', 'high', {
        recordedTotal: recordedRefundTotal,
        calculatedTotal: calculatedRefundTotal,
        discrepancy,
        refundsChecked: totalRefunds.data.length,
        processingResults: results
      });

      // Créer un ticket de support critique
      const ticketId = helpers.string.generateId('support');
      await firestoreHelper.setDocument('support_tickets', ticketId, {
        id: ticketId,
        type: 'financial_discrepancy',
        priority: 'critical',
        title: 'Refund Amount Discrepancy Detected',
        description: `Automated validation detected a ${discrepancy} cent discrepancy in refund totals after scheduled processing.`,
        data: {
          recordedTotal: recordedRefundTotal,
          calculatedTotal: calculatedRefundTotal,
          discrepancy,
          processingBatchId: results.batchId,
          refundsInBatch: results.refundsProcessed,
          detectionTime: new Date().toISOString()
        },
        status: 'open',
        assignedTo: null,
        createdAt: new Date(),
        autoGenerated: true,
        severity: 'critical'
      });
    }

    logger.info('Refund integrity validation completed', {
      refundsValidated: totalRefunds.data.length,
      calculatedTotal: calculatedRefundTotal,
      recordedTotal: recordedRefundTotal,
      discrepancy,
      validationPassed: discrepancy <= REFUND_CONFIG.MAX_DISCREPANCY,
      batchId: results.batchId
    });

  } catch (error) {
    logger.error('Failed to validate refund integrity', error, {
      batchId: results.batchId
    });
  }
}

/**
 * Fonction principale de traitement des remboursements programmés
 */
async function executeScheduledRefundProcessing(): Promise<RefundProcessingResults> {
  try {
    // Récupérer les remboursements programmés
    const scheduledRefunds = await getScheduledRefunds();

    if (scheduledRefunds.length === 0) {
      logger.info('No scheduled refunds to process');
      return {
        totalScheduledRefunds: 0,
        refundsProcessed: 0,
        refundsSuccessful: 0,
        refundsFailed: 0,
        totalAmountRefunded: 0,
        errors: 0,
        processingTime: 0,
        batchId: helpers.string.generateId('refund_batch'),
        byReason: {},
        byStatus: {}
      };
    }

    // Traiter les remboursements par lots
    const results = await processBatchRefunds(scheduledRefunds);

    // Valider l'intégrité financière
    await validateRefundIntegrity(results);

    // Mettre à jour les métriques
    await updateRefundMetrics(results);

    return results;

  } catch (error) {
    logger.error('Failed to execute scheduled refund processing', error);
    throw error;
  }
}

/**
 * Fonction Cloud Scheduler - Traitement des remboursements programmés
 */
export const processScheduledRefunds = pubsub
  .schedule('0 10 * * *') // Tous les jours à 10h du matin UTC (après le calcul d'intérêts)
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('refund_exec');
    const startTime = Date.now();

    try {
      logger.info('Process scheduled refunds function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter le traitement des remboursements
      const results = await executeScheduledRefundProcessing();

      // Log business
      logger.business('Scheduled refunds processed', 'finance', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalScheduledRefunds: results.totalScheduledRefunds,
        refundsProcessed: results.refundsProcessed,
        refundsSuccessful: results.refundsSuccessful,
        totalAmountRefunded: results.totalAmountRefunded,
        successRate: results.refundsProcessed > 0 ? results.refundsSuccessful / results.refundsProcessed : 0,
        timestamp: new Date().toISOString()
      });

      // Log financial si des remboursements ont été traités
      if (results.refundsSuccessful > 0) {
        logger.financial('Refunds processed via scheduled function', {
          executionId,
          refundsCount: results.refundsSuccessful,
          totalAmountRefunded: results.totalAmountRefunded,
          averageRefund: results.totalAmountRefunded / results.refundsSuccessful,
          byReason: results.byReason,
          currency: 'EUR',
          processingDate: new Date().toISOString(),
          processingTime: results.processingTime
        });
      }

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'processScheduledRefunds',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Process scheduled refunds function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        refundsProcessed: results.refundsProcessed,
        refundsSuccessful: results.refundsSuccessful
      });

    } catch (error) {
      logger.error('Process scheduled refunds function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'processScheduledRefunds',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 2 * 60 * 60 * 1000), // Retry dans 2h
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log refund execution failure', logError, { executionId });
      }

      throw error;
    }
  });