/**
 * Calculate Interest Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { stripeService } from '../integrations/stripe/stripeService';
import { UserDocument, ProjectDocument, EscrowDocument } from '../types/firestore';
import { ESCROW_CONFIG, INTEREST_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les calculs d'intérêts
 */
interface InterestCalculation {
  escrowId: string;
  projectId: string;
  contributorUid: string;
  principalAmount: number;
  interestRate: number;
  daysHeld: number;
  interestEarned: number;
  totalAmount: number;
  calculationDate: Date;
  lastCalculationDate?: Date;
}

/**
 * Interface pour les résultats de calcul par lot
 */
interface BatchInterestResults {
  totalEscrowRecords: number;
  recordsProcessed: number;
  totalInterestAccrued: number;
  errorCount: number;
  processingTime: number;
  batchId: string;
}

/**
 * Récupère tous les enregistrements d'escrow éligibles
 */
async function getEligibleEscrowRecords(): Promise<EscrowDocument[]> {
  try {
    // Récupérer les enregistrements d'escrow actifs
    const escrowRecords = await firestoreHelper.queryDocuments<EscrowDocument>(
      'escrow_records',
      [
        ['status', '==', 'held'],
        ['amount', '>', 0]
      ],
      {
        limit: INTEREST_CONFIG.MAX_BATCH_SIZE,
        orderBy: [{ field: 'lastInterestCalculation', direction: 'asc' }]
      }
    );

    // Filtrer ceux qui n'ont pas été calculés récemment
    const now = new Date();
    const eligibleRecords = escrowRecords.filter(record => {
      if (!record.lastInterestCalculation) {
        return true; // Jamais calculé
      }

      const daysSinceLastCalculation = Math.floor(
        (now.getTime() - record.lastInterestCalculation.getTime()) / (24 * 60 * 60 * 1000)
      );

      return daysSinceLastCalculation >= 1; // Au moins 1 jour depuis le dernier calcul
    });

    logger.info('Eligible escrow records retrieved', {
      totalRecords: escrowRecords.length,
      eligibleRecords: eligibleRecords.length,
      batchSize: INTEREST_CONFIG.MAX_BATCH_SIZE
    });

    return eligibleRecords;

  } catch (error) {
    logger.error('Failed to get eligible escrow records', error);
    throw error;
  }
}

/**
 * Calcule les intérêts pour un enregistrement d'escrow
 */
async function calculateInterestForEscrow(escrowRecord: EscrowDocument): Promise<InterestCalculation> {
  try {
    const now = new Date();
    
    // Calculer le nombre de jours depuis la dernière calculation
    const lastCalculation = escrowRecord.lastInterestCalculation || escrowRecord.createdAt;
    const daysHeld = Math.floor((now.getTime() - lastCalculation.getTime()) / (24 * 60 * 60 * 1000));

    if (daysHeld <= 0) {
      throw new Error('No interest calculation needed - insufficient time elapsed');
    }

    // Récupérer le taux d'intérêt applicable
    const interestRate = await getApplicableInterestRate(escrowRecord);

    // Calculer les intérêts (composés quotidiennement)
    const dailyRate = interestRate / 365;
    const interestEarned = Math.round(
      escrowRecord.amount * dailyRate * daysHeld
    );

    const calculation: InterestCalculation = {
      escrowId: escrowRecord.id,
      projectId: escrowRecord.projectId,
      contributorUid: escrowRecord.contributorUid,
      principalAmount: escrowRecord.amount,
      interestRate,
      daysHeld,
      interestEarned,
      totalAmount: escrowRecord.amount + interestEarned,
      calculationDate: now,
      lastCalculationDate: lastCalculation
    };

    logger.info('Interest calculated for escrow record', {
      escrowId: escrowRecord.id,
      principalAmount: escrowRecord.amount,
      daysHeld,
      interestRate,
      interestEarned,
      totalAmount: calculation.totalAmount
    });

    return calculation;

  } catch (error) {
    logger.error('Failed to calculate interest for escrow', error, {
      escrowId: escrowRecord.id,
      amount: escrowRecord.amount
    });
    throw error;
  }
}

/**
 * Détermine le taux d'intérêt applicable
 */
async function getApplicableInterestRate(escrowRecord: EscrowDocument): Promise<number> {
  try {
    // Récupérer le projet pour déterminer la catégorie
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', escrowRecord.projectId);

    // Taux de base selon la catégorie d'impact
    const categoryRates = {
      environment: INTEREST_CONFIG.RATES.ENVIRONMENT, // Ex: 0.03 (3%)
      education: INTEREST_CONFIG.RATES.EDUCATION,     // Ex: 0.025 (2.5%)
      health: INTEREST_CONFIG.RATES.HEALTH,           // Ex: 0.035 (3.5%)
      community: INTEREST_CONFIG.RATES.COMMUNITY,     // Ex: 0.02 (2%)
      technology: INTEREST_CONFIG.RATES.TECHNOLOGY    // Ex: 0.015 (1.5%)
    };

    let baseRate = categoryRates[project.category as keyof typeof categoryRates] || INTEREST_CONFIG.RATES.DEFAULT;

    // Bonus pour projets performants
    if (project.auditScore && project.auditScore >= 90) {
      baseRate += INTEREST_CONFIG.BONUS.HIGH_PERFORMANCE; // +0.5%
    } else if (project.auditScore && project.auditScore >= 80) {
      baseRate += INTEREST_CONFIG.BONUS.GOOD_PERFORMANCE; // +0.25%
    }

    // Bonus pour durée de détention longue
    const holdingDays = Math.floor(
      (new Date().getTime() - escrowRecord.createdAt.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (holdingDays >= 180) { // 6 mois
      baseRate += INTEREST_CONFIG.BONUS.LONG_TERM; // +0.5%
    } else if (holdingDays >= 90) { // 3 mois
      baseRate += INTEREST_CONFIG.BONUS.MEDIUM_TERM; // +0.25%
    }

    // Plafonner le taux maximal
    const finalRate = Math.min(baseRate, INTEREST_CONFIG.MAX_RATE);

    logger.info('Interest rate calculated', {
      escrowId: escrowRecord.id,
      projectCategory: project.category,
      baseRate: categoryRates[project.category as keyof typeof categoryRates] || INTEREST_CONFIG.RATES.DEFAULT,
      bonuses: finalRate - (categoryRates[project.category as keyof typeof categoryRates] || INTEREST_CONFIG.RATES.DEFAULT),
      finalRate,
      holdingDays
    });

    return finalRate;

  } catch (error) {
    logger.error('Failed to get applicable interest rate', error, {
      escrowId: escrowRecord.id,
      projectId: escrowRecord.projectId
    });
    
    // Retourner le taux par défaut en cas d'erreur
    return INTEREST_CONFIG.RATES.DEFAULT;
  }
}

/**
 * Met à jour les enregistrements d'escrow avec les intérêts
 */
async function updateEscrowWithInterest(
  calculation: InterestCalculation
): Promise<void> {
  try {
    if (calculation.interestEarned <= 0) {
      // Mettre à jour seulement la date de calcul
      await firestoreHelper.updateDocument('escrow_records', calculation.escrowId, {
        lastInterestCalculation: calculation.calculationDate
      });
      return;
    }

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour l'enregistrement d'escrow
      const escrowRef = firestoreHelper.getDocumentRef('escrow_records', calculation.escrowId);
      transaction.update(escrowRef, {
        accruedInterest: firestoreHelper.increment(calculation.interestEarned),
        lastInterestCalculation: calculation.calculationDate,
        interestRate: calculation.interestRate,
        totalWithInterest: calculation.totalAmount,
        updatedAt: calculation.calculationDate
      });

      // Créer enregistrement de calcul d'intérêts
      const interestRecordId = helpers.string.generateId('interest');
      const interestRef = firestoreHelper.getDocumentRef('interest_calculations', interestRecordId);
      transaction.set(interestRef, {
        id: interestRecordId,
        escrowId: calculation.escrowId,
        projectId: calculation.projectId,
        contributorUid: calculation.contributorUid,
        principalAmount: calculation.principalAmount,
        interestRate: calculation.interestRate,
        daysCalculated: calculation.daysHeld,
        interestEarned: calculation.interestEarned,
        calculationDate: calculation.calculationDate,
        previousCalculationDate: calculation.lastCalculationDate,
        calculationMethod: 'compound_daily',
        createdAt: calculation.calculationDate
      });

      // Mettre à jour les statistiques du contributeur
      const contributorRef = firestoreHelper.getDocumentRef('users', calculation.contributorUid);
      transaction.update(contributorRef, {
        'stats.totalInterestEarned': firestoreHelper.increment(calculation.interestEarned),
        'stats.lastInterestCalculation': calculation.calculationDate
      });
    });

    logger.info('Escrow updated with interest calculation', {
      escrowId: calculation.escrowId,
      interestEarned: calculation.interestEarned,
      daysCalculated: calculation.daysHeld,
      interestRate: calculation.interestRate
    });

  } catch (error) {
    logger.error('Failed to update escrow with interest', error, {
      escrowId: calculation.escrowId,
      interestEarned: calculation.interestEarned
    });
    throw error;
  }
}

/**
 * Met à jour les statistiques globales d'intérêts
 */
async function updateInterestStatistics(
  calculations: InterestCalculation[]
): Promise<void> {
  try {
    const totalInterest = calculations.reduce((sum, calc) => sum + calc.interestEarned, 0);
    const averageRate = calculations.reduce((sum, calc) => sum + calc.interestRate, 0) / calculations.length;
    const averageDaysHeld = calculations.reduce((sum, calc) => sum + calc.daysHeld, 0) / calculations.length;

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'interest.totalAccrued': totalInterest,
      'interest.calculationsPerformed': calculations.length,
      'interest.averageRate': averageRate,
      'interest.averageDaysHeld': averageDaysHeld,
      'interest.lastCalculationRun': new Date()
    });

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      'interest.monthlyAccrued': totalInterest,
      'interest.calculations': calculations.length
    });

    // Statistiques par projet (grouper par projectId)
    const projectInterestMap = new Map<string, number>();
    calculations.forEach(calc => {
      const current = projectInterestMap.get(calc.projectId) || 0;
      projectInterestMap.set(calc.projectId, current + calc.interestEarned);
    });

    for (const [projectId, projectInterest] of projectInterestMap) {
      await firestoreHelper.incrementDocument('projects', projectId, {
        'escrow.totalInterestAccrued': projectInterest,
        'escrow.lastInterestCalculation': new Date()
      });
    }

    logger.info('Interest statistics updated', {
      totalCalculations: calculations.length,
      totalInterestAccrued: totalInterest,
      averageRate,
      averageDaysHeld,
      projectsAffected: projectInterestMap.size,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update interest statistics', error, {
      calculationsCount: calculations.length
    });
  }
}

/**
 * Envoie des notifications pour les intérêts importants
 */
async function notifySignificantInterest(
  calculations: InterestCalculation[]
): Promise<void> {
  try {
    // Filtrer les calculs avec intérêts significatifs (>€1.00)
    const significantCalculations = calculations.filter(calc => 
      calc.interestEarned >= INTEREST_CONFIG.NOTIFICATION_THRESHOLD
    );

    if (significantCalculations.length === 0) {
      return;
    }

    // Grouper par contributeur pour éviter le spam
    const contributorInterestMap = new Map<string, InterestCalculation[]>();
    significantCalculations.forEach(calc => {
      const existing = contributorInterestMap.get(calc.contributorUid) || [];
      existing.push(calc);
      contributorInterestMap.set(calc.contributorUid, existing);
    });

    const notificationPromises = Array.from(contributorInterestMap.entries()).map(
      async ([contributorUid, contributorCalculations]) => {
        try {
          const totalInterest = contributorCalculations.reduce((sum, calc) => sum + calc.interestEarned, 0);
          const projectCount = new Set(contributorCalculations.map(calc => calc.projectId)).size;

          const notificationId = helpers.string.generateId('notif');
          await firestoreHelper.setDocument('notifications', notificationId, {
            id: notificationId,
            recipientUid: contributorUid,
            senderUid: 'system',
            type: 'interest_earned',
            title: 'Intérêts générés sur vos contributions',
            message: `Vous avez gagné €${(totalInterest / 100).toFixed(2)} d'intérêts sur vos contributions à ${projectCount} projet${projectCount > 1 ? 's' : ''}.`,
            data: {
              totalInterestEarned: totalInterest,
              projectCount,
              calculations: contributorCalculations.map(calc => ({
                projectId: calc.projectId,
                interestEarned: calc.interestEarned,
                daysHeld: calc.daysHeld,
                rate: calc.interestRate
              })),
              calculationDate: new Date().toISOString()
            },
            priority: 'low',
            actionUrl: `${process.env.FRONTEND_URL}/contributions/interest`,
            read: false,
            readAt: null,
            delivered: true,
            deliveredAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1
          } as NotificationDocument);

          await firestoreHelper.updateDocument('users', contributorUid, {
            'notificationCounters.unread': firestoreHelper.increment(1),
            'notificationCounters.total': firestoreHelper.increment(1)
          });

          return notificationId;

        } catch (error) {
          logger.error('Failed to send interest notification to contributor', error, {
            contributorUid,
            calculationsCount: contributorCalculations.length
          });
          return null;
        }
      }
    );

    await Promise.allSettled(notificationPromises);

    logger.info('Interest notifications sent', {
      contributorsNotified: contributorInterestMap.size,
      totalInterestNotified: significantCalculations.reduce((sum, calc) => sum + calc.interestEarned, 0)
    });

  } catch (error) {
    logger.error('Failed to notify significant interest', error, {
      calculationsCount: calculations.length
    });
  }
}

/**
 * Traite un lot d'enregistrements d'escrow
 */
async function processBatchInterestCalculations(
  escrowRecords: EscrowDocument[]
): Promise<BatchInterestResults> {
  const batchId = helpers.string.generateId('batch');
  const startTime = Date.now();
  
  try {
    logger.info('Starting batch interest calculations', {
      batchId,
      recordCount: escrowRecords.length
    });

    const calculations: InterestCalculation[] = [];
    const errors: Array<{ escrowId: string; error: any }> = [];

    // Traiter chaque enregistrement
    for (const escrowRecord of escrowRecords) {
      try {
        const calculation = await calculateInterestForEscrow(escrowRecord);
        calculations.push(calculation);
        
        // Mettre à jour l'enregistrement avec les intérêts
        await updateEscrowWithInterest(calculation);

      } catch (error) {
        logger.error('Failed to process escrow record in batch', error, {
          batchId,
          escrowId: escrowRecord.id
        });
        errors.push({ escrowId: escrowRecord.id, error });
      }
    }

    // Mettre à jour les statistiques si on a des calculs réussis
    if (calculations.length > 0) {
      await updateInterestStatistics(calculations);
      await notifySignificantInterest(calculations);
    }

    const results: BatchInterestResults = {
      totalEscrowRecords: escrowRecords.length,
      recordsProcessed: calculations.length,
      totalInterestAccrued: calculations.reduce((sum, calc) => sum + calc.interestEarned, 0),
      errorCount: errors.length,
      processingTime: Date.now() - startTime,
      batchId
    };

    // Sauvegarder les résultats du lot
    await firestoreHelper.setDocument('interest_batch_results', batchId, {
      ...results,
      errors: errors.map(e => ({ escrowId: e.escrowId, message: e.error.message })),
      completedAt: new Date(),
      successRate: calculations.length / escrowRecords.length
    });

    logger.info('Batch interest calculations completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to process batch interest calculations', error, { batchId });
    throw error;
  }
}

/**
 * Valide l'intégrité des calculs d'intérêts
 */
async function validateInterestIntegrity(): Promise<void> {
  try {
    // Vérifier la cohérence des totaux
    const [escrowTotal, interestTotal] = await Promise.all([
      firestoreHelper.queryDocuments<EscrowDocument>('escrow_records', [['status', '==', 'held']]),
      firestoreHelper.getDocument('platform_stats', 'global')
    ]);

    const calculatedEscrowTotal = escrowTotal.reduce(
      (sum, record) => sum + (record.amount + (record.accruedInterest || 0)), 
      0
    );

    const recordedInterestTotal = interestTotal.interest?.totalAccrued || 0;
    const calculatedInterestTotal = escrowTotal.reduce(
      (sum, record) => sum + (record.accruedInterest || 0), 
      0
    );

    // Vérifier les écarts
    const interestDiscrepancy = Math.abs(recordedInterestTotal - calculatedInterestTotal);
    
    if (interestDiscrepancy > INTEREST_CONFIG.MAX_DISCREPANCY) {
      logger.security('Interest calculation discrepancy detected', 'medium', {
        recordedTotal: recordedInterestTotal,
        calculatedTotal: calculatedInterestTotal,
        discrepancy: interestDiscrepancy,
        escrowRecordsChecked: escrowTotal.length
      });

      // Créer ticket de support pour investigation
      const ticketId = helpers.string.generateId('support');
      await firestoreHelper.setDocument('support_tickets', ticketId, {
        id: ticketId,
        type: 'financial_discrepancy',
        priority: 'critical',
        title: 'Interest Calculation Discrepancy Detected',
        description: `Automated validation detected a ${interestDiscrepancy} cent discrepancy in interest calculations.`,
        data: {
          recordedTotal: recordedInterestTotal,
          calculatedTotal: calculatedInterestTotal,
          discrepancy: interestDiscrepancy,
          escrowRecordsAffected: escrowTotal.length
        },
        status: 'open',
        assignedTo: null,
        createdAt: new Date(),
        autoGenerated: true
      });
    }

    logger.info('Interest integrity validation completed', {
      escrowRecordsChecked: escrowTotal.length,
      calculatedEscrowTotal,
      calculatedInterestTotal,
      recordedInterestTotal,
      discrepancy: interestDiscrepancy,
      validationPassed: interestDiscrepancy <= INTEREST_CONFIG.MAX_DISCREPANCY
    });

  } catch (error) {
    logger.error('Failed to validate interest integrity', error);
  }
}

/**
 * Nettoie les anciens calculs d'intérêts
 */
async function cleanupOldInterestCalculations(): Promise<void> {
  try {
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    // Récupérer les anciens calculs
    const oldCalculations = await firestoreHelper.queryDocuments<any>(
      'interest_calculations',
      [
        ['calculationDate', '<', threeMonthsAgo]
      ],
      { limit: 100 }
    );

    if (oldCalculations.length === 0) {
      return;
    }

    // Archiver avant suppression
    const archivePromises = oldCalculations.map(calc =>
      firestoreHelper.setDocument(`archives/interest_calculations/${calc.id}`, 'data', {
        ...calc,
        archivedAt: new Date(),
        archivedBy: 'system'
      })
    );

    await Promise.all(archivePromises);

    // Supprimer les anciens enregistrements
    const deletePromises = oldCalculations.map(calc =>
      firestoreHelper.deleteDocument('interest_calculations', calc.id)
    );

    await Promise.all(deletePromises);

    logger.info('Old interest calculations cleaned up', {
      recordsArchived: oldCalculations.length,
      cutoffDate: threeMonthsAgo
    });

  } catch (error) {
    logger.error('Failed to cleanup old interest calculations', error);
  }
}

/**
 * Fonction principale de calcul d'intérêts
 */
async function executeInterestCalculation(): Promise<BatchInterestResults> {
  try {
    // Récupérer les enregistrements éligibles
    const escrowRecords = await getEligibleEscrowRecords();

    if (escrowRecords.length === 0) {
      logger.info('No eligible escrow records for interest calculation');
      return {
        totalEscrowRecords: 0,
        recordsProcessed: 0,
        totalInterestAccrued: 0,
        errorCount: 0,
        processingTime: 0,
        batchId: helpers.string.generateId('batch')
      };
    }

    // Traiter en lots pour éviter les timeouts
    const batchSize = INTEREST_CONFIG.PROCESSING_BATCH_SIZE;
    const allResults: BatchInterestResults[] = [];

    for (let i = 0; i < escrowRecords.length; i += batchSize) {
      const batch = escrowRecords.slice(i, i + batchSize);
      const batchResults = await processBatchInterestCalculations(batch);
      allResults.push(batchResults);

      // Pause entre les lots pour éviter la surcharge
      if (i + batchSize < escrowRecords.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Agrégation des résultats
    const aggregatedResults: BatchInterestResults = {
      totalEscrowRecords: escrowRecords.length,
      recordsProcessed: allResults.reduce((sum, result) => sum + result.recordsProcessed, 0),
      totalInterestAccrued: allResults.reduce((sum, result) => sum + result.totalInterestAccrued, 0),
      errorCount: allResults.reduce((sum, result) => sum + result.errorCount, 0),
      processingTime: allResults.reduce((sum, result) => sum + result.processingTime, 0),
      batchId: helpers.string.generateId('aggregate')
    };

    // Validation d'intégrité post-calcul
    await validateInterestIntegrity();

    // Nettoyage des anciens calculs
    await cleanupOldInterestCalculations();

    return aggregatedResults;

  } catch (error) {
    logger.error('Failed to execute interest calculation', error);
    throw error;
  }
}

/**
 * Fonction Cloud Scheduler - Calcul quotidien des intérêts
 */
export const calculateInterest = pubsub
  .schedule('0 2 * * *') // Tous les jours à 2h du matin UTC
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('exec');
    const startTime = Date.now();

    try {
      logger.info('Interest calculation scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter le calcul d'intérêts
      const results = await executeInterestCalculation();

      // Log business
      logger.business('Daily interest calculation completed', 'finance', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalEscrowRecords: results.totalEscrowRecords,
        recordsProcessed: results.recordsProcessed,
        totalInterestAccrued: results.totalInterestAccrued,
        errorCount: results.errorCount,
        successRate: results.recordsProcessed / results.totalEscrowRecords,
        processingTime: results.processingTime,
        timestamp: new Date().toISOString()
      });

      // Log financial pour audit
      if (results.totalInterestAccrued > 0) {
        logger.financial('Interest accrued on escrow funds', {
          executionId,
          totalInterestAccrued: results.totalInterestAccrued,
          recordsProcessed: results.recordsProcessed,
          averageInterest: results.totalInterestAccrued / results.recordsProcessed,
          currency: 'EUR',
          calculationDate: new Date().toISOString(),
          processingTime: results.processingTime
        });
      }

      // Mettre à jour les statistiques d'exécution
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'calculateInterest',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Interest calculation scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        results
      });

    } catch (error) {
      logger.error('Interest calculation scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'calculateInterest',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 60 * 60 * 1000), // Retry dans 1h
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log execution failure', logError, { executionId });
      }

      throw error;
    }
  });