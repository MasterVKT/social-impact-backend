/**
 * Project Update Trigger Firebase Function
 * Social Finance Impact Platform
 */

import { firestore } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument, NotificationDocument } from '../types/firestore';
import { STATUS, USER_PERMISSIONS } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les changements de projet détectés
 */
interface ProjectChanges {
  statusChanged: boolean;
  fundingChanged: boolean;
  milestoneChanged: boolean;
  descriptionChanged: boolean;
  deadlineChanged: boolean;
  goalChanged: boolean;
  oldStatus?: string;
  newStatus?: string;
  oldFunding?: number;
  newFunding?: number;
  fundingDifference?: number;
}

/**
 * Analyse les changements dans le projet
 */
function analyzeProjectChanges(
  beforeData: ProjectDocument,
  afterData: ProjectDocument
): ProjectChanges {
  const changes: ProjectChanges = {
    statusChanged: beforeData.status !== afterData.status,
    fundingChanged: beforeData.currentFunding !== afterData.currentFunding,
    milestoneChanged: beforeData.currentMilestone !== afterData.currentMilestone,
    descriptionChanged: beforeData.description !== afterData.description,
    deadlineChanged: beforeData.deadline?.toMillis() !== afterData.deadline?.toMillis(),
    goalChanged: beforeData.fundingGoal !== afterData.fundingGoal
  };

  if (changes.statusChanged) {
    changes.oldStatus = beforeData.status;
    changes.newStatus = afterData.status;
  }

  if (changes.fundingChanged) {
    changes.oldFunding = beforeData.currentFunding;
    changes.newFunding = afterData.currentFunding;
    changes.fundingDifference = afterData.currentFunding - beforeData.currentFunding;
  }

  return changes;
}

/**
 * Notifie les contributeurs des mises à jour importantes
 */
async function notifyContributors(
  project: ProjectDocument,
  changes: ProjectChanges
): Promise<void> {
  try {
    if (!project.contributors || project.contributors.length === 0) {
      return;
    }

    // Déterminer le type de notification selon les changements
    let notificationType = 'project_update';
    let notificationTitle = '';
    let notificationMessage = '';
    let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

    if (changes.statusChanged) {
      switch (changes.newStatus) {
        case STATUS.PROJECT.ACTIVE:
          notificationTitle = 'Projet activé !';
          notificationMessage = `Le projet "${project.title}" est maintenant actif et collecte des fonds.`;
          priority = 'high';
          break;
        case STATUS.PROJECT.COMPLETED:
          notificationTitle = 'Projet terminé avec succès !';
          notificationMessage = `Le projet "${project.title}" a atteint ses objectifs et est maintenant terminé.`;
          priority = 'high';
          break;
        case STATUS.PROJECT.CANCELLED:
          notificationTitle = 'Projet annulé';
          notificationMessage = `Le projet "${project.title}" a été annulé. Les fonds seront remboursés.`;
          priority = 'urgent';
          break;
        case STATUS.PROJECT.SUSPENDED:
          notificationTitle = 'Projet suspendu';
          notificationMessage = `Le projet "${project.title}" a été temporairement suspendu.`;
          priority = 'high';
          break;
        default:
          notificationTitle = 'Statut du projet mis à jour';
          notificationMessage = `Le statut du projet "${project.title}" a été modifié.`;
      }
    } else if (changes.milestoneChanged) {
      notificationTitle = 'Nouveau jalon atteint !';
      notificationMessage = `Le projet "${project.title}" a franchi une nouvelle étape importante.`;
      priority = 'medium';
    } else if (changes.fundingChanged && changes.fundingDifference! > 0) {
      const percentage = Math.round((project.currentFunding / project.fundingGoal) * 100);
      notificationTitle = 'Progression du financement';
      notificationMessage = `Le projet "${project.title}" a atteint ${percentage}% de son objectif.`;
      priority = 'medium';
    } else if (changes.deadlineChanged) {
      notificationTitle = 'Échéance modifiée';
      notificationMessage = `L'échéance du projet "${project.title}" a été mise à jour.`;
      priority = 'medium';
    } else {
      notificationTitle = 'Projet mis à jour';
      notificationMessage = `Le projet "${project.title}" a été mis à jour.`;
      priority = 'low';
    }

    // Envoyer notifications aux contributeurs en lot
    const notificationPromises = project.contributors.map(async (contributorUid) => {
      try {
        const notificationId = helpers.string.generateId('notif');
        
        await firestoreHelper.setDocument('notifications', notificationId, {
          id: notificationId,
          recipientUid: contributorUid,
          senderUid: project.creatorUid,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          data: {
            projectId: project.id,
            projectTitle: project.title,
            projectSlug: project.slug,
            changes: {
              statusChanged: changes.statusChanged,
              fundingChanged: changes.fundingChanged,
              milestoneChanged: changes.milestoneChanged,
              deadlineChanged: changes.deadlineChanged
            },
            newStatus: changes.newStatus,
            currentFunding: project.currentFunding,
            fundingGoal: project.fundingGoal,
            fundingPercentage: Math.round((project.currentFunding / project.fundingGoal) * 100),
            deadline: project.deadline?.toDate().toISOString()
          },
          priority,
          actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
          groupKey: `project_updates_${project.id}`, // Grouper les mises à jour du même projet
          read: false,
          readAt: null,
          delivered: true,
          deliveredAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          version: 1,
          autoDelete: false
        } as unknown as NotificationDocument);

        // Mettre à jour le compteur du contributeur
        await firestoreHelper.updateDocument('users', contributorUid, {
          'notificationCounters.unread': firestoreHelper.increment(1),
          'notificationCounters.total': firestoreHelper.increment(1),
          'notificationCounters.lastNotificationAt': Timestamp.now()
        });

        return notificationId;

      } catch (error) {
        logger.error('Failed to send notification to contributor', error, {
          contributorUid,
          projectId: project.id,
          notificationType
        });
        return null;
      }
    });

    const notificationResults = await Promise.allSettled(notificationPromises);
    const successfulNotifications = notificationResults
      .filter(result => result.status === 'fulfilled' && result.value)
      .length;

    logger.info('Contributor notifications sent', {
      projectId: project.id,
      totalContributors: project.contributors.length,
      successfulNotifications,
      notificationType,
      priority,
      changes
    });

  } catch (error) {
    logger.error('Failed to notify contributors', error, {
      projectId: project.id,
      contributorCount: project.contributors?.length || 0
    });
  }
}

/**
 * Met à jour les métriques du projet
 */
async function updateProjectMetrics(
  project: ProjectDocument,
  changes: ProjectChanges
): Promise<void> {
  try {
    const metricsUpdate: Record<string, any> = {};

    // Métriques de statut
    if (changes.statusChanged) {
      metricsUpdate[`projects.statusChanges.${changes.newStatus}`] = 1;
      
      // Métriques spéciales pour certains statuts
      if (changes.newStatus === STATUS.PROJECT.COMPLETED) {
        metricsUpdate['projects.completed.total'] = 1;
        metricsUpdate[`projects.completed.byCategory.${project.category}`] = 1;

        // Calculer le temps de completion
        const completionDays = Math.ceil(
          (Date.now() - project.createdAt.toMillis()) / (24 * 60 * 60 * 1000)
        );
        metricsUpdate['projects.averageCompletionTime'] = completionDays;
      }
    }

    // Métriques de financement
    if (changes.fundingChanged && changes.fundingDifference! > 0) {
      metricsUpdate['projects.totalFunding'] = changes.fundingDifference;
      metricsUpdate[`projects.fundingByCategory.${project.category}`] = changes.fundingDifference;
      
      // Calculer le pourcentage de financement
      const fundingPercentage = (project.currentFunding / project.fundingGoal) * 100;
      if (fundingPercentage >= 100) {
        metricsUpdate['projects.fullyFunded'] = 1;
      } else if (fundingPercentage >= 75) {
        metricsUpdate['projects.nearlyFunded'] = 1;
      }
    }

    // Métriques de jalons
    if (changes.milestoneChanged) {
      metricsUpdate['projects.milestonesReached'] = 1;
      metricsUpdate[`projects.milestonesByCategory.${project.category}`] = 1;
    }

    // Mettre à jour les statistiques globales
    if (Object.keys(metricsUpdate).length > 0) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', metricsUpdate);
    }

    // Métriques temporelles
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      'projects.updates': 1,
      [`projects.updatesByCategory.${project.category}`]: 1
    });

    logger.info('Project metrics updated', {
      projectId: project.id,
      category: project.category,
      changes,
      metricsUpdated: Object.keys(metricsUpdate).length
    });

  } catch (error) {
    logger.error('Failed to update project metrics', error, {
      projectId: project.id,
      changes
    });
  }
}

/**
 * Gère les actions de financement automatiques
 */
async function handleFundingMilestones(
  project: ProjectDocument,
  changes: ProjectChanges
): Promise<void> {
  try {
    if (!changes.fundingChanged || !changes.fundingDifference || changes.fundingDifference <= 0) {
      return;
    }

    const fundingPercentage = (project.currentFunding / project.fundingGoal) * 100;
    const previousPercentage = ((project.currentFunding - changes.fundingDifference) / project.fundingGoal) * 100;

    // Vérifier les seuils de financement franchis
    const milestones = [25, 50, 75, 90, 100];
    const crossedMilestones = milestones.filter(milestone => 
      previousPercentage < milestone && fundingPercentage >= milestone
    );

    for (const milestone of crossedMilestones) {
      // Créer événement de jalon
      const milestoneEventId = helpers.string.generateId('milestone');
      await firestoreHelper.setDocument('project_events', milestoneEventId, {
        id: milestoneEventId,
        projectId: project.id,
        type: 'funding_milestone',
        title: `${milestone}% de financement atteint`,
        description: milestone === 100
          ? 'Félicitations ! Le projet est entièrement financé.'
          : `Le projet a atteint ${milestone}% de son objectif de financement.`,
        data: {
          milestone,
          currentFunding: project.currentFunding,
          fundingGoal: project.fundingGoal,
          percentage: fundingPercentage,
          contributorCount: project.contributors?.length || 0
        },
        createdAt: Timestamp.now(),
        createdBy: 'system'
      });

      // Actions spéciales pour 100%
      if (milestone === 100) {
        await handleFullyFundedProject(project);
      }

      logger.info('Funding milestone reached', {
        projectId: project.id,
        milestone,
        currentFunding: project.currentFunding,
        fundingGoal: project.fundingGoal,
        milestoneEventId
      });
    }

  } catch (error) {
    logger.error('Failed to handle funding milestones', error, {
      projectId: project.id,
      fundingPercentage: (project.currentFunding / project.fundingGoal) * 100
    });
  }
}

/**
 * Gère les projets entièrement financés
 */
async function handleFullyFundedProject(project: ProjectDocument): Promise<void> {
  try {
    // Marquer le projet comme entièrement financé
    await firestoreHelper.updateDocument('projects', project.id, {
      fundingStatus: 'fully_funded',
      fullyFundedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    // Déclencher le processus d'assignation d'auditeur
    await initiateAuditAssignment(project);

    // Notifier le créateur
    const creatorNotificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', creatorNotificationId, {
      id: creatorNotificationId,
      recipientUid: project.creatorUid,
      senderUid: 'system',
      type: 'milestone_approved',
      title: 'Projet entièrement financé !',
      message: `Félicitations ! Votre projet "${project.title}" a atteint 100% de son objectif de financement.`,
      data: {
        projectId: project.id,
        projectTitle: project.title,
        finalAmount: project.currentFunding,
        contributorCount: project.contributors?.length || 0,
        nextStep: 'audit_assignment'
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/dashboard`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      version: 1,
      autoDelete: false
    } as unknown as NotificationDocument);

    // Mettre à jour le compteur du créateur
    await firestoreHelper.updateDocument('users', project.creatorUid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    logger.info('Fully funded project handled', {
      projectId: project.id,
      finalAmount: project.currentFunding,
      contributorCount: project.contributors?.length || 0
    });

  } catch (error) {
    logger.error('Failed to handle fully funded project', error, { projectId: project.id });
  }
}

/**
 * Initie l'assignation d'auditeur pour projet financé
 */
async function initiateAuditAssignment(project: ProjectDocument): Promise<void> {
  try {
    // Créer demande d'audit automatique
    const auditRequestId = helpers.string.generateId('audit_req');
    
    await firestoreHelper.setDocument('audit_requests', auditRequestId, {
      id: auditRequestId,
      projectId: project.id,
      projectTitle: project.title,
      projectCreatorUid: project.creatorUid,
      requestType: 'automatic_funding_complete',
      priority: 'high',
      status: 'pending_assignment',
      estimatedAmount: project.currentFunding,
      category: project.category,
      complexity: calculateProjectComplexity(project),
      requiredQualifications: getRequiredAuditQualifications(project),
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 jours
      createdAt: Timestamp.now(),
      createdBy: 'system'
    });

    logger.info('Audit assignment initiated', {
      projectId: project.id,
      auditRequestId,
      complexity: calculateProjectComplexity(project),
      requiredQualifications: getRequiredAuditQualifications(project).length
    });

  } catch (error) {
    logger.error('Failed to initiate audit assignment', error, { projectId: project.id });
  }
}

/**
 * Calcule la complexité du projet pour l'audit
 */
function calculateProjectComplexity(project: ProjectDocument): 'low' | 'medium' | 'high' {
  let complexityScore = 0;

  // Facteurs de complexité
  if (project.currentFunding > 50000) complexityScore += 2; // > €500
  if (project.currentFunding > 100000) complexityScore += 1; // > €1000
  if (project.contributors && project.contributors.length > 50) complexityScore += 1;
  if (project.milestones && project.milestones.length > 5) complexityScore += 1;
  if (project.category === 'technology' || project.category === 'health') complexityScore += 1;
  if (project.internationalScope) complexityScore += 1;

  if (complexityScore >= 5) return 'high';
  if (complexityScore >= 3) return 'medium';
  return 'low';
}

/**
 * Détermine les qualifications requises pour l'audit
 */
function getRequiredAuditQualifications(project: ProjectDocument): string[] {
  const qualifications = ['basic_audit'];

  // Qualifications selon la catégorie
  const category = project.category as string;
  switch (category) {
    case 'environment':
      qualifications.push('environmental_assessment', 'sustainability_metrics');
      break;
    case 'education':
      qualifications.push('educational_impact', 'social_metrics');
      break;
    case 'technology':
      qualifications.push('technical_review', 'innovation_assessment');
      break;
    case 'health':
      qualifications.push('health_impact', 'medical_ethics');
      break;
    case 'community':
      qualifications.push('community_impact', 'social_development');
      break;
  }

  // Qualifications selon le montant
  if (project.currentFunding > 100000) { // > €1000
    qualifications.push('high_value_audit', 'financial_analysis');
  }

  // Qualifications selon la complexité
  if (project.internationalScope) {
    qualifications.push('international_compliance');
  }

  return qualifications;
}

/**
 * Gère les mises à jour de statut critiques
 */
async function handleCriticalStatusUpdates(
  project: ProjectDocument,
  changes: ProjectChanges
): Promise<void> {
  try {
    if (!changes.statusChanged) return;

    // Actions selon le nouveau statut
    switch (changes.newStatus) {
      case STATUS.PROJECT.CANCELLED:
        await handleProjectCancellation(project);
        break;
        
      case STATUS.PROJECT.SUSPENDED:
        await handleProjectSuspension(project);
        break;
        
      case STATUS.PROJECT.COMPLETED:
        await handleProjectCompletion(project);
        break;
        
      case STATUS.PROJECT.UNDER_REVIEW:
        await handleProjectUnderReview(project);
        break;
    }

  } catch (error) {
    logger.error('Failed to handle critical status updates', error, {
      projectId: project.id,
      oldStatus: changes.oldStatus,
      newStatus: changes.newStatus
    });
  }
}

/**
 * Gère l'annulation de projet
 */
async function handleProjectCancellation(project: ProjectDocument): Promise<void> {
  try {
    // Initier le processus de remboursement automatique
    if (project.currentFunding > 0) {
      const refundRequestId = helpers.string.generateId('refund_req');
      
      await firestoreHelper.setDocument('refund_requests', refundRequestId, {
        id: refundRequestId,
        projectId: project.id,
        reason: 'project_cancelled',
        totalAmount: project.currentFunding,
        status: 'pending_processing',
        contributorCount: project.contributors?.length || 0,
        requestedBy: 'system',
        createdAt: Timestamp.now(),
        priority: 'high'
      });
    }

    // Marquer toutes les contributions comme remboursables
    if (project.contributors) {
      const updatePromises = project.contributors.map(contributorUid =>
        firestoreHelper.updateDocument(`projects/${project.id}/contributions`, contributorUid, {
          refundStatus: 'pending',
          refundRequestedAt: Timestamp.now()
        })
      );
      
      await Promise.allSettled(updatePromises);
    }

    logger.info('Project cancellation handled', {
      projectId: project.id,
      refundAmount: project.currentFunding,
      contributorCount: project.contributors?.length || 0
    });

  } catch (error) {
    logger.error('Failed to handle project cancellation', error, { projectId: project.id });
  }
}

/**
 * Gère la suspension de projet
 */
async function handleProjectSuspension(project: ProjectDocument): Promise<void> {
  try {
    // Créer ticket de support automatique
    const supportTicketId = helpers.string.generateId('support');
    
    await firestoreHelper.setDocument('support_tickets', supportTicketId, {
      id: supportTicketId,
      projectId: project.id,
      creatorUid: project.creatorUid,
      type: 'project_suspension',
      priority: 'high',
      status: 'open',
      title: `Projet suspendu: ${project.title}`,
      description: 'Ce ticket a été créé automatiquement suite à la suspension du projet.',
      assignedTo: null,
      createdAt: Timestamp.now(),
      autoGenerated: true
    });

    logger.info('Project suspension handled', {
      projectId: project.id,
      supportTicketId
    });

  } catch (error) {
    logger.error('Failed to handle project suspension', error, { projectId: project.id });
  }
}

/**
 * Gère l'achèvement de projet
 */
async function handleProjectCompletion(project: ProjectDocument): Promise<void> {
  try {
    // Calculer les métriques d'impact final
    const impactMetrics = {
      totalFunding: project.currentFunding,
      contributorCount: project.contributors?.length || 0,
      duration: Math.ceil((Date.now() - project.createdAt.toMillis()) / (24 * 60 * 60 * 1000)),
      category: project.category,
      impactScore: calculateImpactScore(project)
    };

    // Sauvegarder le rapport d'impact
    await firestoreHelper.setDocument(`projects/${project.id}/impact_report`, 'final', {
      projectId: project.id,
      metrics: impactMetrics,
      status: 'completed',
      generatedAt: Timestamp.now(),
      version: 1
    });

    // Déclencher les récompenses pour les contributeurs actifs
    await processContributorRewards(project);

    logger.info('Project completion handled', {
      projectId: project.id,
      impactMetrics
    });

  } catch (error) {
    logger.error('Failed to handle project completion', error, { projectId: project.id });
  }
}

/**
 * Gère la mise en révision de projet
 */
async function handleProjectUnderReview(project: ProjectDocument): Promise<void> {
  try {
    // Suspendre temporairement les nouvelles contributions
    await firestoreHelper.updateDocument('projects', project.id, {
      acceptingContributions: false,
      reviewStartedAt: Timestamp.now()
    });

    // Notifier les modérateurs
    const moderators = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['permissions', 'array-contains', USER_PERMISSIONS.MODERATE_PROJECTS],
        ['status', '==', 'active']
      ]
    );

    const moderatorNotificationPromises = moderators.data.map(async (moderator) => {
      const notificationId = helpers.string.generateId('notif');
      return firestoreHelper.setDocument('notifications', notificationId, {
        id: notificationId,
        recipientUid: moderator.uid,
        senderUid: 'system',
        type: 'project_review_required',
        title: 'Projet à réviser',
        message: `Le projet "${project.title}" nécessite une révision.`,
        data: {
          projectId: project.id,
          projectTitle: project.title,
          creatorUid: project.creatorUid,
          currentFunding: project.currentFunding,
          urgency: 'medium'
        },
        priority: 'high',
        actionUrl: `${process.env.FRONTEND_URL}/admin/projects/${project.id}/review`,
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: Timestamp.now(),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        version: 1,
        autoDelete: false
      } as unknown as NotificationDocument);
    });

    await Promise.allSettled(moderatorNotificationPromises);

    logger.info('Project under review handled', {
      projectId: project.id,
      moderatorsNotified: moderators.data.length
    });

  } catch (error) {
    logger.error('Failed to handle project under review', error, { projectId: project.id });
  }
}

/**
 * Calcule le score d'impact du projet
 */
function calculateImpactScore(project: ProjectDocument): number {
  let score = 0;

  // Score basé sur le financement (max 40 points)
  const fundingScore = Math.min((project.currentFunding / project.fundingGoal) * 40, 40);
  score += fundingScore;

  // Score basé sur l'engagement communautaire (max 30 points)
  const contributorCount = project.contributors?.length || 0;
  const engagementScore = Math.min(contributorCount * 0.5, 30);
  score += engagementScore;

  // Score basé sur la rapidité de financement (max 20 points)
  const daysSinceCreation = (Date.now() - project.createdAt.toMillis()) / (24 * 60 * 60 * 1000);
  const speedScore = Math.max(20 - (daysSinceCreation / 30) * 20, 0);
  score += speedScore;

  // Score basé sur la catégorie d'impact (max 10 points)
  const categoryBonus = {
    environment: 10,
    education: 8,
    health: 9,
    community: 7,
    technology: 6
  };
  score += categoryBonus[project.category as keyof typeof categoryBonus] || 5;

  return Math.round(score);
}

/**
 * Traite les récompenses pour les contributeurs actifs
 */
async function processContributorRewards(project: ProjectDocument): Promise<void> {
  try {
    if (!project.contributors || project.contributors.length === 0) return;

    // Calculer les récompenses pour les contributeurs précoces (premiers 10%)
    const earlyContributorCount = Math.max(1, Math.ceil(project.contributors.length * 0.1));
    const earlyContributors = project.contributors.slice(0, earlyContributorCount);

    const rewardPromises = earlyContributors.map(async (contributorUid) => {
      try {
        // Créer récompense
        const rewardId = helpers.string.generateId('reward');
        await firestoreHelper.setDocument('contributor_rewards', rewardId, {
          id: rewardId,
          userId: contributorUid,
          projectId: project.id,
          type: 'early_contributor',
          description: 'Récompense pour contribution précoce',
          value: 500, // €5.00 en centimes
          status: 'pending',
          eligibleAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 jours
          createdAt: Timestamp.now()
        });

        // Notifier le contributeur
        const notificationId = helpers.string.generateId('notif');
        await firestoreHelper.setDocument('notifications', notificationId, {
          id: notificationId,
          recipientUid: contributorUid,
          senderUid: 'system',
          type: 'reward_earned',
          title: 'Récompense gagnée !',
          message: `Vous avez gagné une récompense pour votre contribution précoce au projet "${project.title}".`,
          data: {
            projectId: project.id,
            projectTitle: project.title,
            rewardType: 'early_contributor',
            rewardValue: 500,
            rewardId
          },
          priority: 'medium',
          actionUrl: `${process.env.FRONTEND_URL}/rewards`,
          read: false,
          readAt: null,
          delivered: true,
          deliveredAt: Timestamp.now(),
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          version: 1,
          autoDelete: false
        } as unknown as NotificationDocument);

        await firestoreHelper.updateDocument('users', contributorUid, {
          'notificationCounters.unread': firestoreHelper.increment(1),
          'notificationCounters.total': firestoreHelper.increment(1)
        });

        return rewardId;

      } catch (error) {
        logger.error('Failed to process contributor reward', error, {
          contributorUid,
          projectId: project.id
        });
        return null;
      }
    });

    await Promise.allSettled(rewardPromises);

    logger.info('Contributor rewards processed', {
      projectId: project.id,
      earlyContributorCount,
      totalContributors: project.contributors.length
    });

  } catch (error) {
    logger.error('Failed to process contributor rewards', error, { projectId: project.id });
  }
}

/**
 * Met à jour l'index de recherche du projet
 */
async function updateProjectSearchIndex(project: ProjectDocument): Promise<void> {
  try {
    // Créer/mettre à jour l'entrée d'index de recherche
    const searchData = {
      projectId: project.id,
      title: project.title,
      description: project.description,
      category: project.category,
      tags: project.tags || [],
      location: project.location,
      status: project.status,
      fundingStatus: project.fundingStatus,
      currentFunding: project.currentFunding,
      fundingGoal: project.fundingGoal,
      fundingPercentage: Math.round((project.currentFunding / project.fundingGoal) * 100),
      contributorCount: project.contributors?.length || 0,
      urgency: project.urgency,
      creatorUid: project.creatorUid,
      lastUpdated: Timestamp.now(),
      searchKeywords: generateSearchKeywords(project)
    };

    await firestoreHelper.setDocument('search_index', project.id, searchData);

    logger.info('Project search index updated', {
      projectId: project.id,
      keywordCount: searchData.searchKeywords.length
    });

  } catch (error) {
    logger.error('Failed to update project search index', error, { projectId: project.id });
  }
}

/**
 * Génère les mots-clés de recherche pour le projet
 */
function generateSearchKeywords(project: ProjectDocument): string[] {
  const keywords = new Set<string>();

  // Mots du titre
  project.title.toLowerCase().split(/\s+/).forEach(word => {
    if (word.length > 2) keywords.add(word);
  });

  // Mots de la description (premiers mots significatifs)
  project.description.toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .slice(0, 20)
    .forEach(word => keywords.add(word));

  // Catégorie et tags
  keywords.add(project.category);
  if (project.tags) {
    project.tags.forEach(tag => keywords.add(tag.toLowerCase()));
  }

  // Localisation
  if (project.location) {
    keywords.add(project.location.country.toLowerCase());
    if (project.location.region) {
      keywords.add(project.location.region.toLowerCase());
    }
    if (project.location.city) {
      keywords.add(project.location.city.toLowerCase());
    }
  }

  // Statuts
  keywords.add(project.status);
  keywords.add(project.fundingStatus || 'open');

  return Array.from(keywords).slice(0, 50); // Limiter à 50 mots-clés
}

/**
 * Trigger principal - Mise à jour de projet
 */
export const onProjectUpdate = firestore
  .document('projects/{projectId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() as ProjectDocument;
    const afterData = change.after.data() as ProjectDocument;
    const projectId = context.params.projectId;

    try {
      logger.info('Project update trigger started', {
        projectId,
        title: afterData.title,
        status: afterData.status,
        currentFunding: afterData.currentFunding
      });

      // Analyser les changements
      const changes = analyzeProjectChanges(beforeData, afterData);

      // Exécution en parallèle des tâches
      await Promise.allSettled([
        notifyContributors(afterData, changes),
        updateProjectMetrics(afterData, changes),
        handleFundingMilestones(afterData, changes),
        handleCriticalStatusUpdates(afterData, changes),
        updateProjectSearchIndex(afterData)
      ]);

      // Log business pour changements importants
      if (changes.statusChanged || changes.fundingChanged || changes.milestoneChanged) {
        logger.business('Project updated with significant changes', 'projects', {
          projectId,
          projectTitle: afterData.title,
          creatorUid: afterData.creatorUid,
          changes,
          currentFunding: afterData.currentFunding,
          fundingGoal: afterData.fundingGoal,
          status: afterData.status,
          contributorCount: afterData.contributors?.length || 0,
          timestamp: new Date().toISOString()
        });
      }

      // Log security pour statuts critiques
      if (changes.statusChanged && changes.newStatus &&
          [STATUS.PROJECT.CANCELLED, STATUS.PROJECT.SUSPENDED, STATUS.PROJECT.UNDER_REVIEW].includes(changes.newStatus as any)) {
        logger.security('Critical project status change', 'medium', {
          projectId,
          projectTitle: afterData.title,
          creatorUid: afterData.creatorUid,
          oldStatus: changes.oldStatus,
          newStatus: changes.newStatus,
          currentFunding: afterData.currentFunding,
          contributorCount: afterData.contributors?.length || 0
        });
      }

      logger.info('Project update trigger completed successfully', {
        projectId,
        changes,
        processingTime: Date.now() - afterData.updatedAt.toMillis()
      });

    } catch (error) {
      logger.error('Project update trigger failed', error, {
        projectId,
        title: afterData.title,
        status: afterData.status
      });
      throw error;
    }
  });