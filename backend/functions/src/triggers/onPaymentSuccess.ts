/**
 * Payment Success Trigger Firebase Function
 * Social Finance Impact Platform
 */

import { firestore } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { stripeService } from '../integrations/stripe/stripeService';
import { UserDocument, ProjectDocument, PaymentDocument, NotificationDocument } from '../types/firestore';
import { STATUS, PAYMENT_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les détails de paiement traité
 */
interface ProcessedPaymentDetails {
  paymentId: string;
  contributorUid: string;
  projectId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  stripePaymentIntentId?: string;
  escrowAmount: number;
  platformFee: number;
  netAmount: number;
  contributionType: 'one_time' | 'recurring';
  metadata: Record<string, any>;
}

/**
 * Valide et enrichit les données de paiement
 */
async function validateAndEnrichPayment(
  paymentData: PaymentDocument
): Promise<ProcessedPaymentDetails> {
  try {
    // Récupérer les données du projet et du contributeur
    const [project, contributor] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', paymentData.projectId),
      firestoreHelper.getDocument<UserDocument>('users', paymentData.contributorUid)
    ]);

    // Valider que le projet peut encore recevoir des contributions
    if (project.status !== STATUS.PROJECT.ACTIVE) {
      throw new Error(`Project ${project.id} is not active for contributions`);
    }

    if (project.fundingStatus === 'closed' || project.fundingStatus === 'completed') {
      throw new Error(`Project ${project.id} is no longer accepting contributions`);
    }

    // Calculer les frais et montants
    const platformFeeRate = PAYMENT_CONFIG.PLATFORM_FEE_RATE; // Ex: 0.05 pour 5%
    const platformFee = Math.round(paymentData.amount * platformFeeRate);
    const netAmount = paymentData.amount - platformFee;
    const escrowAmount = netAmount;

    const processedDetails: ProcessedPaymentDetails = {
      paymentId: paymentData.id,
      contributorUid: paymentData.contributorUid,
      projectId: paymentData.projectId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      paymentMethod: paymentData.paymentMethod,
      stripePaymentIntentId: paymentData.stripePaymentIntentId,
      escrowAmount,
      platformFee,
      netAmount,
      contributionType: paymentData.metadata?.contributionType || 'one_time',
      metadata: paymentData.metadata || {}
    };

    logger.info('Payment details validated and enriched', {
      paymentId: paymentData.id,
      amount: paymentData.amount,
      platformFee,
      netAmount,
      projectTitle: project.title,
      contributorEmail: contributor.email
    });

    return processedDetails;

  } catch (error) {
    logger.error('Failed to validate and enrich payment', error, {
      paymentId: paymentData.id,
      projectId: paymentData.projectId,
      contributorUid: paymentData.contributorUid
    });
    throw error;
  }
}

/**
 * Met à jour le financement du projet
 */
async function updateProjectFunding(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    await firestoreHelper.runTransaction(async (transaction) => {
      // Récupérer le projet actuel
      const projectRef = firestoreHelper.getDocumentRef('projects', paymentDetails.projectId);
      const projectDoc = await transaction.get(projectRef);
      const project = projectDoc.data() as ProjectDocument;

      // Calculer le nouveau financement
      const newFunding = project.currentFunding + paymentDetails.netAmount;
      const fundingPercentage = (newFunding / project.fundingGoal) * 100;

      // Ajouter le contributeur s'il n'y est pas déjà
      const contributors = project.contributors || [];
      if (!contributors.includes(paymentDetails.contributorUid)) {
        contributors.push(paymentDetails.contributorUid);
      }

      // Déterminer le nouveau statut de financement
      let fundingStatus = project.fundingStatus;
      if (fundingPercentage >= 100) {
        fundingStatus = 'fully_funded';
      } else if (fundingPercentage >= 75) {
        fundingStatus = 'nearly_funded';
      }

      // Mettre à jour le projet
      transaction.update(projectRef, {
        currentFunding: newFunding,
        fundingStatus,
        contributors,
        contributorCount: contributors.length,
        lastContributionAt: new Date(),
        updatedAt: new Date()
      });

      // Créer l'enregistrement de contribution
      const contributionId = helpers.string.generateId('contrib');
      const contributionRef = firestoreHelper.getDocumentRef(
        `projects/${paymentDetails.projectId}/contributions`,
        contributionId
      );
      
      transaction.set(contributionRef, {
        id: contributionId,
        contributorUid: paymentDetails.contributorUid,
        paymentId: paymentDetails.paymentId,
        amount: paymentDetails.amount,
        netAmount: paymentDetails.netAmount,
        platformFee: paymentDetails.platformFee,
        currency: paymentDetails.currency,
        paymentMethod: paymentDetails.paymentMethod,
        contributionType: paymentDetails.contributionType,
        status: 'confirmed',
        escrowStatus: 'held',
        escrowAmount: paymentDetails.escrowAmount,
        metadata: paymentDetails.metadata,
        createdAt: new Date(),
        confirmedAt: new Date()
      });
    });

    logger.info('Project funding updated successfully', {
      projectId: paymentDetails.projectId,
      contributionAmount: paymentDetails.netAmount,
      paymentId: paymentDetails.paymentId
    });

  } catch (error) {
    logger.error('Failed to update project funding', error, {
      projectId: paymentDetails.projectId,
      paymentId: paymentDetails.paymentId
    });
    throw error;
  }
}

/**
 * Envoie les notifications de confirmation
 */
async function sendPaymentConfirmationNotifications(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    // Récupérer les données nécessaires
    const [project, contributor] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', paymentDetails.projectId),
      firestoreHelper.getDocument<UserDocument>('users', paymentDetails.contributorUid)
    ]);

    // Notification au contributeur
    const contributorNotificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', contributorNotificationId, {
      id: contributorNotificationId,
      recipientUid: paymentDetails.contributorUid,
      senderUid: 'system',
      type: 'payment_processed',
      title: 'Paiement confirmé !',
      message: `Votre contribution de €${(paymentDetails.amount / 100).toFixed(2)} pour le projet "${project.title}" a été confirmée.`,
      data: {
        projectId: paymentDetails.projectId,
        projectTitle: project.title,
        projectSlug: project.slug,
        amount: paymentDetails.amount,
        netAmount: paymentDetails.netAmount,
        platformFee: paymentDetails.platformFee,
        paymentId: paymentDetails.paymentId,
        paymentMethod: paymentDetails.paymentMethod,
        transactionId: paymentDetails.stripePaymentIntentId,
        contributionType: paymentDetails.contributionType,
        escrowAmount: paymentDetails.escrowAmount
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/contributions/${paymentDetails.paymentId}`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as NotificationDocument);

    // Notification au créateur
    const creatorNotificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', creatorNotificationId, {
      id: creatorNotificationId,
      recipientUid: project.creatorUid,
      senderUid: 'system',
      type: 'contribution_received',
      title: 'Nouvelle contribution reçue !',
      message: `${contributor.firstName} ${contributor.lastName} a contribué €${(paymentDetails.amount / 100).toFixed(2)} à votre projet "${project.title}".`,
      data: {
        projectId: paymentDetails.projectId,
        projectTitle: project.title,
        contributorUid: paymentDetails.contributorUid,
        contributorName: `${contributor.firstName} ${contributor.lastName}`,
        amount: paymentDetails.amount,
        netAmount: paymentDetails.netAmount,
        paymentId: paymentDetails.paymentId,
        currentFunding: project.currentFunding + paymentDetails.netAmount,
        fundingGoal: project.fundingGoal,
        newFundingPercentage: Math.round(((project.currentFunding + paymentDetails.netAmount) / project.fundingGoal) * 100)
      },
      priority: 'medium',
      actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/contributions`,
      groupKey: `contributions_${project.id}`, // Grouper les contributions du même projet
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as NotificationDocument);

    // Mettre à jour les compteurs de notifications
    await Promise.all([
      firestoreHelper.updateDocument('users', paymentDetails.contributorUid, {
        'notificationCounters.unread': firestoreHelper.increment(1),
        'notificationCounters.total': firestoreHelper.increment(1),
        'notificationCounters.lastNotificationAt': new Date()
      }),
      firestoreHelper.updateDocument('users', project.creatorUid, {
        'notificationCounters.unread': firestoreHelper.increment(1),
        'notificationCounters.total': firestoreHelper.increment(1),
        'notificationCounters.lastNotificationAt': new Date()
      })
    ]);

    logger.info('Payment confirmation notifications sent', {
      paymentId: paymentDetails.paymentId,
      contributorNotificationId,
      creatorNotificationId,
      amount: paymentDetails.amount
    });

  } catch (error) {
    logger.error('Failed to send payment confirmation notifications', error, {
      paymentId: paymentDetails.paymentId,
      contributorUid: paymentDetails.contributorUid,
      projectId: paymentDetails.projectId
    });
  }
}

/**
 * Envoie les emails de confirmation de paiement
 */
async function sendPaymentConfirmationEmails(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    // Récupérer les données nécessaires
    const [project, contributor] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', paymentDetails.projectId),
      firestoreHelper.getDocument<UserDocument>('users', paymentDetails.contributorUid)
    ]);

    // Email au contributeur
    const contributorEmailPromise = emailService.sendEmail({
      to: contributor.email,
      templateId: 'payment_confirmation_contributor',
      dynamicTemplateData: {
        contributorName: `${contributor.firstName} ${contributor.lastName}`,
        projectTitle: project.title,
        projectSlug: project.slug,
        contributionAmount: `€${(paymentDetails.amount / 100).toFixed(2)}`,
        netAmount: `€${(paymentDetails.netAmount / 100).toFixed(2)}`,
        platformFee: `€${(paymentDetails.platformFee / 100).toFixed(2)}`,
        paymentMethod: paymentDetails.paymentMethod,
        transactionId: paymentDetails.stripePaymentIntentId,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        contributionUrl: `${process.env.FRONTEND_URL}/contributions/${paymentDetails.paymentId}`,
        receiptUrl: `${process.env.FRONTEND_URL}/receipts/${paymentDetails.paymentId}`,
        date: new Date().toLocaleDateString('fr-FR'),
        isRecurring: paymentDetails.contributionType === 'recurring'
      }
    });

    // Email au créateur du projet
    const creatorEmailPromise = emailService.sendEmail({
      to: project.creatorEmail,
      templateId: 'contribution_received_creator',
      dynamicTemplateData: {
        creatorName: project.creatorName,
        projectTitle: project.title,
        contributorName: `${contributor.firstName} ${contributor.lastName}`,
        contributionAmount: `€${(paymentDetails.amount / 100).toFixed(2)}`,
        netAmount: `€${(paymentDetails.netAmount / 100).toFixed(2)}`,
        currentFunding: `€${((project.currentFunding + paymentDetails.netAmount) / 100).toFixed(2)}`,
        fundingGoal: `€${(project.fundingGoal / 100).toFixed(2)}`,
        fundingPercentage: Math.round(((project.currentFunding + paymentDetails.netAmount) / project.fundingGoal) * 100),
        contributorCount: (project.contributors?.length || 0) + 1,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        dashboardUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/dashboard`,
        date: new Date().toLocaleDateString('fr-FR')
      }
    });

    // Envoyer les emails en parallèle
    const emailResults = await Promise.allSettled([
      contributorEmailPromise,
      creatorEmailPromise
    ]);

    const successfulEmails = emailResults.filter(result => result.status === 'fulfilled').length;

    logger.info('Payment confirmation emails sent', {
      paymentId: paymentDetails.paymentId,
      successfulEmails,
      contributorEmail: contributor.email,
      creatorEmail: project.creatorEmail
    });

  } catch (error) {
    logger.error('Failed to send payment confirmation emails', error, {
      paymentId: paymentDetails.paymentId,
      contributorUid: paymentDetails.contributorUid,
      projectId: paymentDetails.projectId
    });
  }
}

/**
 * Met à jour les statistiques de paiement
 */
async function updatePaymentStatistics(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', paymentDetails.projectId);

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'payments.totalProcessed': 1,
      'payments.totalAmount': paymentDetails.amount,
      'payments.totalNetAmount': paymentDetails.netAmount,
      'payments.totalPlatformFees': paymentDetails.platformFee,
      [`payments.byMethod.${paymentDetails.paymentMethod}`]: 1,
      [`payments.byCategory.${project.category}`]: paymentDetails.amount,
      [`payments.byType.${paymentDetails.contributionType}`]: 1,
      'contributions.total': 1,
      'contributions.totalAmount': paymentDetails.netAmount
    });

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      'payments.count': 1,
      'payments.amount': paymentDetails.amount,
      'payments.netAmount': paymentDetails.netAmount,
      'contributions.count': 1,
      [`contributions.byCategory.${project.category}`]: 1
    });

    // Statistiques utilisateur - contributeur
    await firestoreHelper.incrementDocument('users', paymentDetails.contributorUid, {
      'stats.totalContributed': paymentDetails.amount,
      'stats.contributionsCount': 1,
      'stats.projectsSupported': paymentDetails.contributionType === 'one_time' ? 1 : 0,
      'stats.lastContribution': new Date(),
      [`stats.contributionsByCategory.${project.category}`]: paymentDetails.amount
    });

    // Statistiques utilisateur - créateur
    await firestoreHelper.incrementDocument('users', project.creatorUid, {
      'stats.totalFundingReceived': paymentDetails.netAmount,
      'stats.contributorsCount': 1,
      'stats.lastContributionReceived': new Date()
    });

    logger.info('Payment statistics updated', {
      paymentId: paymentDetails.paymentId,
      amount: paymentDetails.amount,
      netAmount: paymentDetails.netAmount,
      platformFee: paymentDetails.platformFee,
      category: project.category,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update payment statistics', error, {
      paymentId: paymentDetails.paymentId
    });
  }
}

/**
 * Gère les récompenses et badges
 */
async function processContributorRewards(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    const contributor = await firestoreHelper.getDocument<UserDocument>('users', paymentDetails.contributorUid);
    
    // Calculer le nombre total de contributions du contributeur
    const contributorStats = contributor.stats || {};
    const totalContributions = (contributorStats.contributionsCount || 0) + 1;
    const totalContributed = (contributorStats.totalContributed || 0) + paymentDetails.amount;

    const rewardsToProcess = [];

    // Badge première contribution
    if (totalContributions === 1) {
      rewardsToProcess.push({
        type: 'badge',
        id: 'first_contribution',
        title: 'Première contribution',
        description: 'Félicitations pour votre première contribution !',
        value: 0,
        rarity: 'common'
      });
    }

    // Badge contributions multiples
    if ([5, 10, 25, 50, 100].includes(totalContributions)) {
      rewardsToProcess.push({
        type: 'badge',
        id: `contributions_${totalContributions}`,
        title: `${totalContributions} contributions`,
        description: `Vous avez effectué ${totalContributions} contributions !`,
        value: 0,
        rarity: totalContributions >= 50 ? 'legendary' : totalContributions >= 25 ? 'epic' : 'rare'
      });
    }

    // Récompense contribution importante (>€100)
    if (paymentDetails.amount >= 10000) {
      rewardsToProcess.push({
        type: 'reward',
        id: 'major_contribution',
        title: 'Contribution majeure',
        description: 'Merci pour votre contribution importante !',
        value: Math.round(paymentDetails.amount * 0.01), // 1% en points de récompense
        rarity: 'rare'
      });
    }

    // Récompense total cumulé
    const cumulativeThresholds = [10000, 50000, 100000, 500000]; // €100, €500, €1000, €5000
    for (const threshold of cumulativeThresholds) {
      if (totalContributed >= threshold && (totalContributed - paymentDetails.amount) < threshold) {
        rewardsToProcess.push({
          type: 'reward',
          id: `cumulative_${threshold}`,
          title: `€${threshold / 100} contributés au total`,
          description: `Vous avez contribué plus de €${threshold / 100} au total !`,
          value: Math.round(threshold * 0.02), // 2% en points
          rarity: 'epic'
        });
      }
    }

    // Traiter les récompenses
    for (const reward of rewardsToProcess) {
      try {
        const rewardId = helpers.string.generateId('reward');
        await firestoreHelper.setDocument('contributor_rewards', rewardId, {
          id: rewardId,
          userId: paymentDetails.contributorUid,
          projectId: paymentDetails.projectId,
          paymentId: paymentDetails.paymentId,
          type: reward.type,
          title: reward.title,
          description: reward.description,
          value: reward.value,
          rarity: reward.rarity,
          status: 'earned',
          earnedAt: new Date(),
          createdAt: new Date()
        });

        // Notifier le contributeur de la récompense
        if (reward.value > 0 || reward.type === 'badge') {
          const rewardNotificationId = helpers.string.generateId('notif');
          await firestoreHelper.setDocument('notifications', rewardNotificationId, {
            id: rewardNotificationId,
            recipientUid: paymentDetails.contributorUid,
            senderUid: 'system',
            type: 'reward_earned',
            title: `${reward.type === 'badge' ? 'Badge' : 'Récompense'} gagné${reward.type === 'badge' ? '' : 'e'} !`,
            message: `${reward.title}: ${reward.description}`,
            data: {
              rewardId,
              rewardType: reward.type,
              rewardTitle: reward.title,
              rewardValue: reward.value,
              rarity: reward.rarity,
              projectId: paymentDetails.projectId,
              projectTitle: project.title
            },
            priority: 'medium',
            actionUrl: `${process.env.FRONTEND_URL}/profile/rewards`,
            read: false,
            readAt: null,
            delivered: true,
            deliveredAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1
          });

          await firestoreHelper.updateDocument('users', paymentDetails.contributorUid, {
            'notificationCounters.unread': firestoreHelper.increment(1),
            'notificationCounters.total': firestoreHelper.increment(1)
          });
        }

      } catch (rewardError) {
        logger.error('Failed to process individual reward', rewardError, {
          paymentId: paymentDetails.paymentId,
          contributorUid: paymentDetails.contributorUid,
          rewardType: reward.type,
          rewardId: reward.id
        });
      }
    }

    logger.info('Contributor rewards processed', {
      paymentId: paymentDetails.paymentId,
      contributorUid: paymentDetails.contributorUid,
      rewardsProcessed: rewardsToProcess.length,
      totalContributions,
      totalContributed
    });

  } catch (error) {
    logger.error('Failed to process contributor rewards', error, {
      paymentId: paymentDetails.paymentId,
      contributorUid: paymentDetails.contributorUid
    });
  }
}

/**
 * Met à jour l'escrow et les fonds en attente
 */
async function updateEscrowRecords(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    // Créer enregistrement d'escrow
    const escrowId = helpers.string.generateId('escrow');
    
    await firestoreHelper.setDocument('escrow_records', escrowId, {
      id: escrowId,
      paymentId: paymentDetails.paymentId,
      projectId: paymentDetails.projectId,
      contributorUid: paymentDetails.contributorUid,
      amount: paymentDetails.escrowAmount,
      currency: paymentDetails.currency,
      status: 'held',
      holdReason: 'pending_project_completion',
      releaseConditions: [
        'project_completed',
        'audit_approved',
        'creator_milestone_verified'
      ],
      estimatedReleaseDate: calculateEstimatedReleaseDate(paymentDetails.projectId),
      stripePaymentIntentId: paymentDetails.stripePaymentIntentId,
      createdAt: new Date(),
      lastUpdated: new Date()
    });

    // Mettre à jour les totaux d'escrow du projet
    await firestoreHelper.updateDocument('projects', paymentDetails.projectId, {
      'escrow.totalHeld': firestoreHelper.increment(paymentDetails.escrowAmount),
      'escrow.recordCount': firestoreHelper.increment(1),
      'escrow.lastUpdated': new Date()
    });

    // Mettre à jour les statistiques d'escrow globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'escrow.totalHeld': paymentDetails.escrowAmount,
      'escrow.recordCount': 1,
      'escrow.averageHoldAmount': paymentDetails.escrowAmount
    });

    logger.info('Escrow records updated', {
      escrowId,
      paymentId: paymentDetails.paymentId,
      projectId: paymentDetails.projectId,
      escrowAmount: paymentDetails.escrowAmount
    });

  } catch (error) {
    logger.error('Failed to update escrow records', error, {
      paymentId: paymentDetails.paymentId,
      projectId: paymentDetails.projectId,
      escrowAmount: paymentDetails.escrowAmount
    });
  }
}

/**
 * Calcule la date estimée de libération des fonds
 */
async function calculateEstimatedReleaseDate(projectId: string): Promise<Date> {
  try {
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', projectId);
    
    // Base: deadline du projet + délai d'audit + marge de sécurité
    let releaseDate = new Date();
    
    if (project.deadline) {
      releaseDate = new Date(project.deadline);
    } else {
      // Si pas de deadline, estimer basé sur la taille du projet
      const estimatedDuration = project.fundingGoal > 100000 ? 90 : 60; // jours
      releaseDate = new Date(Date.now() + estimatedDuration * 24 * 60 * 60 * 1000);
    }

    // Ajouter délai d'audit (14 jours) + marge (7 jours)
    releaseDate.setDate(releaseDate.getDate() + 21);

    return releaseDate;

  } catch (error) {
    logger.error('Failed to calculate estimated release date', error, { projectId });
    // Retourner une date par défaut (90 jours)
    return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Gère les contributions récurrentes
 */
async function handleRecurringContribution(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    if (paymentDetails.contributionType !== 'recurring') {
      return;
    }

    // Créer/mettre à jour l'abonnement récurrent
    const subscriptionId = paymentDetails.metadata.subscriptionId || helpers.string.generateId('sub');
    
    await firestoreHelper.setDocument('recurring_contributions', subscriptionId, {
      id: subscriptionId,
      contributorUid: paymentDetails.contributorUid,
      projectId: paymentDetails.projectId,
      amount: paymentDetails.amount,
      currency: paymentDetails.currency,
      frequency: paymentDetails.metadata.frequency || 'monthly',
      status: 'active',
      stripeSubscriptionId: paymentDetails.metadata.stripeSubscriptionId,
      lastPaymentId: paymentDetails.paymentId,
      lastPaymentAt: new Date(),
      nextPaymentAt: calculateNextPaymentDate(paymentDetails.metadata.frequency || 'monthly'),
      totalPayments: 1,
      totalAmount: paymentDetails.amount,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    logger.info('Recurring contribution handled', {
      subscriptionId,
      paymentId: paymentDetails.paymentId,
      frequency: paymentDetails.metadata.frequency,
      nextPaymentAt: calculateNextPaymentDate(paymentDetails.metadata.frequency || 'monthly')
    });

  } catch (error) {
    logger.error('Failed to handle recurring contribution', error, {
      paymentId: paymentDetails.paymentId,
      contributorUid: paymentDetails.contributorUid
    });
  }
}

/**
 * Calcule la prochaine date de paiement récurrent
 */
function calculateNextPaymentDate(frequency: string): Date {
  const now = new Date();
  
  switch (frequency) {
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      return nextMonth;
    case 'quarterly':
      const nextQuarter = new Date(now);
      nextQuarter.setMonth(nextQuarter.getMonth() + 3);
      return nextQuarter;
    case 'yearly':
      const nextYear = new Date(now);
      nextYear.setFullYear(nextYear.getFullYear() + 1);
      return nextYear;
    default:
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 jours par défaut
  }
}

/**
 * Vérifie et traite les seuils de financement atteints
 */
async function checkFundingThresholds(
  paymentDetails: ProcessedPaymentDetails
): Promise<void> {
  try {
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', paymentDetails.projectId);
    const newTotal = project.currentFunding + paymentDetails.netAmount;
    const percentage = (newTotal / project.fundingGoal) * 100;

    // Actions automatiques selon les seuils
    if (percentage >= 100) {
      // Projet entièrement financé
      await firestoreHelper.updateDocument('projects', paymentDetails.projectId, {
        fundingStatus: 'fully_funded',
        fullyFundedAt: new Date(),
        acceptingContributions: false
      });

      // Démarrer le processus d'audit automatiquement
      await scheduleAuditProcess(paymentDetails.projectId);
      
    } else if (percentage >= 75 && (project.currentFunding / project.fundingGoal) * 100 < 75) {
      // Premier passage du seuil 75%
      await notifyNearingGoal(project, 75);
      
    } else if (percentage >= 50 && (project.currentFunding / project.fundingGoal) * 100 < 50) {
      // Premier passage du seuil 50%
      await notifyNearingGoal(project, 50);
    }

    logger.info('Funding thresholds checked', {
      projectId: paymentDetails.projectId,
      newPercentage: percentage,
      previousPercentage: (project.currentFunding / project.fundingGoal) * 100,
      thresholdsCrossed: percentage >= 100 ? ['100%'] : percentage >= 75 ? ['75%'] : percentage >= 50 ? ['50%'] : []
    });

  } catch (error) {
    logger.error('Failed to check funding thresholds', error, {
      paymentId: paymentDetails.paymentId,
      projectId: paymentDetails.projectId
    });
  }
}

/**
 * Planifie le processus d'audit pour projet entièrement financé
 */
async function scheduleAuditProcess(projectId: string): Promise<void> {
  try {
    const auditScheduleId = helpers.string.generateId('audit_schedule');
    
    await firestoreHelper.setDocument('audit_schedules', auditScheduleId, {
      id: auditScheduleId,
      projectId,
      status: 'scheduled',
      type: 'completion_audit',
      priority: 'high',
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
      estimatedDuration: 14, // jours
      requirements: [
        'financial_verification',
        'milestone_validation',
        'impact_assessment'
      ],
      createdAt: new Date(),
      createdBy: 'system'
    });

    logger.info('Audit process scheduled', {
      projectId,
      auditScheduleId,
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

  } catch (error) {
    logger.error('Failed to schedule audit process', error, { projectId });
  }
}

/**
 * Notifie l'approche de l'objectif de financement
 */
async function notifyNearingGoal(project: ProjectDocument, threshold: number): Promise<void> {
  try {
    // Notifier le créateur
    const notificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', notificationId, {
      id: notificationId,
      recipientUid: project.creatorUid,
      senderUid: 'system',
      type: 'milestone_approved',
      title: `${threshold}% de financement atteint !`,
      message: `Félicitations ! Votre projet "${project.title}" a atteint ${threshold}% de son objectif.`,
      data: {
        projectId: project.id,
        projectTitle: project.title,
        threshold,
        currentFunding: project.currentFunding,
        fundingGoal: project.fundingGoal,
        remainingAmount: project.fundingGoal - project.currentFunding,
        contributorCount: project.contributors?.length || 0
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/dashboard`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    });

    await firestoreHelper.updateDocument('users', project.creatorUid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    logger.info('Funding threshold notification sent', {
      projectId: project.id,
      threshold,
      creatorUid: project.creatorUid
    });

  } catch (error) {
    logger.error('Failed to notify nearing goal', error, {
      projectId: project.id,
      threshold
    });
  }
}

/**
 * Trigger principal - Succès de paiement
 */
export const onPaymentSuccess = firestore
  .document('payments/{paymentId}')
  .onWrite(async (change, context) => {
    // Vérifier que c'est bien une mise à jour vers 'succeeded'
    const beforeData = change.before.exists ? change.before.data() as PaymentDocument : null;
    const afterData = change.after.exists ? change.after.data() as PaymentDocument : null;
    
    if (!afterData || afterData.status !== 'succeeded') {
      return; // Pas un succès de paiement
    }

    // Éviter le double traitement
    if (beforeData && beforeData.status === 'succeeded') {
      return; // Déjà traité
    }

    const paymentId = context.params.paymentId;

    try {
      logger.info('Payment success trigger started', {
        paymentId,
        amount: afterData.amount,
        contributorUid: afterData.contributorUid,
        projectId: afterData.projectId
      });

      // Valider et enrichir les données de paiement
      const paymentDetails = await validateAndEnrichPayment(afterData);

      // Exécution en parallèle des tâches principales
      await Promise.allSettled([
        updateProjectFunding(paymentDetails),
        sendPaymentConfirmationNotifications(paymentDetails),
        sendPaymentConfirmationEmails(paymentDetails),
        updatePaymentStatistics(paymentDetails),
        updateEscrowRecords(paymentDetails),
        handleRecurringContribution(paymentDetails),
        checkFundingThresholds(paymentDetails)
      ]);

      // Traiter les récompenses (après les tâches principales)
      await processContributorRewards(paymentDetails);

      // Log business
      logger.business('Payment processed successfully', 'payments', {
        paymentId,
        contributorUid: paymentDetails.contributorUid,
        projectId: paymentDetails.projectId,
        amount: paymentDetails.amount,
        netAmount: paymentDetails.netAmount,
        platformFee: paymentDetails.platformFee,
        paymentMethod: paymentDetails.paymentMethod,
        contributionType: paymentDetails.contributionType,
        escrowAmount: paymentDetails.escrowAmount,
        stripePaymentIntentId: paymentDetails.stripePaymentIntentId,
        timestamp: new Date().toISOString()
      });

      // Log financial pour audit
      logger.financial('Payment received and processed', {
        paymentId,
        amount: paymentDetails.amount,
        netAmount: paymentDetails.netAmount,
        platformFee: paymentDetails.platformFee,
        currency: paymentDetails.currency,
        projectId: paymentDetails.projectId,
        contributorUid: paymentDetails.contributorUid,
        escrowStatus: 'held',
        processingTimestamp: new Date().toISOString()
      });

      logger.info('Payment success trigger completed successfully', {
        paymentId,
        amount: paymentDetails.amount,
        projectId: paymentDetails.projectId,
        processingTime: Date.now() - new Date(afterData.updatedAt).getTime()
      });

    } catch (error) {
      logger.error('Payment success trigger failed', error, {
        paymentId,
        amount: afterData.amount,
        contributorUid: afterData.contributorUid,
        projectId: afterData.projectId
      });

      // Marquer le paiement comme ayant échoué le traitement
      try {
        await firestoreHelper.updateDocument('payments', paymentId, {
          processingStatus: 'failed',
          processingError: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date(),
            retryCount: 0
          },
          updatedAt: new Date()
        });
      } catch (updateError) {
        logger.error('Failed to mark payment processing as failed', updateError, { paymentId });
      }

      throw error;
    }
  });