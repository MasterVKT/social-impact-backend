/**
 * Manage Project Status Firebase Function
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
import { emailService } from '../integrations/sendgrid/emailService';
import { stripeService } from '../integrations/stripe/stripeService';
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, PROJECT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  action: Joi.string().valid(
    'approve',
    'reject',
    'suspend',
    'reactivate',
    'cancel',
    'complete',
    'extend_deadline',
    'pause_funding'
  ).required(),
  
  // Données spécifiques selon l'action
  actionData: Joi.object({
    // Pour reject/suspend
    reason: Joi.string().min(10).max(500).optional(),
    
    // Pour extend_deadline
    newDeadline: Joi.date().min('now').optional(),
    
    // Pour complete (si forcé par admin)
    forceComplete: Joi.boolean().optional(),
    completionReason: Joi.string().max(500).optional(),
    
    // Pour approve (modération)
    moderatorNotes: Joi.string().max(500).optional(),
    
    // Paramètres généraux
    notifyCreator: Joi.boolean().default(true),
    notifyContributors: Joi.boolean().default(false),
  }).optional(),
}).required();

/**
 * Valide que l'utilisateur peut modifier le statut du projet
 */
async function validateStatusChangePermissions(
  uid: string,
  projectId: string,
  action: string
): Promise<{ user: UserDocument; project: ProjectDocument }> {
  try {
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);

    // Actions que seuls les admins peuvent effectuer
    const adminOnlyActions = ['approve', 'reject', 'suspend', 'reactivate'];
    
    if (adminOnlyActions.includes(action)) {
      if (!user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS)) {
        throw new https.HttpsError('permission-denied', 'Insufficient permissions for this action');
      }
    }

    // Actions que le créateur peut effectuer
    const creatorActions = ['cancel', 'complete', 'extend_deadline', 'pause_funding'];
    
    if (creatorActions.includes(action)) {
      if (project.creatorUid !== uid && !user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS)) {
        throw new https.HttpsError('permission-denied', 'Only the project creator or admins can perform this action');
      }
    }

    return { user, project };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate status change permissions', error, { uid, projectId, action });
    throw new https.HttpsError('internal', 'Unable to validate permissions');
  }
}

/**
 * Valide que le changement de statut est valide
 */
function validateStatusTransition(
  currentStatus: string,
  action: string,
  project: ProjectDocument
): void {
  const validTransitions: Record<string, string[]> = {
    [STATUS.PROJECT.DRAFT]: ['approve', 'reject'],
    [STATUS.PROJECT.UNDER_REVIEW]: ['approve', 'reject'],
    [STATUS.PROJECT.ACTIVE]: ['suspend', 'cancel', 'pause_funding', 'complete'],
    [STATUS.PROJECT.FUNDING]: ['suspend', 'cancel', 'complete', 'extend_deadline'],
    [STATUS.PROJECT.PAUSED]: ['reactivate', 'cancel'],
    [STATUS.PROJECT.SUSPENDED]: ['reactivate', 'cancel'],
    [STATUS.PROJECT.COMPLETED]: [], // Aucune transition possible
    [STATUS.PROJECT.CANCELLED]: ['reactivate'], // Réactivation possible dans certains cas
  };

  const allowedActions = validTransitions[currentStatus] || [];
  
  if (!allowedActions.includes(action)) {
    throw new https.HttpsError(
      'failed-precondition',
      `Cannot ${action} project in status ${currentStatus}`
    );
  }

  // Validations spécifiques
  if (action === 'complete') {
    const now = new Date();
    const deadline = new Date(project.funding.deadline);
    
    // Vérifier que la deadline est atteinte ou que c'est un forçage admin
    if (now < deadline && !project.funding.goal <= project.funding.raised) {
      throw new https.HttpsError(
        'failed-precondition',
        'Project can only be completed after deadline or when funding goal is reached'
      );
    }
  }

  if (action === 'extend_deadline') {
    const currentDeadline = new Date(project.funding.deadline);
    const now = new Date();
    
    // Vérifier que la deadline n'est pas déjà passée
    if (currentDeadline <= now) {
      throw new https.HttpsError(
        'failed-precondition',
        'Cannot extend deadline after it has passed'
      );
    }
  }
}

/**
 * Exécute l'action de changement de statut
 */
async function executeStatusAction(
  project: ProjectDocument,
  action: string,
  actionData: any,
  uid: string
): Promise<Partial<ProjectDocument>> {
  const now = new Date();
  const updateData: any = {
    lastModifiedBy: uid,
    updatedAt: now,
    version: project.version + 1,
  };

  switch (action) {
    case 'approve':
      updateData.status = STATUS.PROJECT.ACTIVE;
      updateData.publishedAt = now;
      updateData.fundingStartsAt = now;
      updateData['complianceChecks.contentModeration'] = STATUS.MODERATION.APPROVED;
      updateData['complianceChecks.legalReview'] = STATUS.MODERATION.APPROVED;
      updateData['complianceChecks.financialReview'] = STATUS.MODERATION.APPROVED;
      if (actionData?.moderatorNotes) {
        updateData.moderatorNotes = actionData.moderatorNotes;
      }
      break;

    case 'reject':
      updateData.status = STATUS.PROJECT.REJECTED;
      updateData.rejectedAt = now;
      updateData.rejectionReason = actionData?.reason || 'Project does not meet platform standards';
      break;

    case 'suspend':
      updateData.status = STATUS.PROJECT.SUSPENDED;
      updateData.suspendedAt = now;
      updateData.suspensionReason = actionData?.reason || 'Platform policy violation';
      break;

    case 'reactivate':
      const previousStatus = project.suspendedAt ? STATUS.PROJECT.ACTIVE : 
                           project.status === STATUS.PROJECT.CANCELLED ? STATUS.PROJECT.ACTIVE :
                           STATUS.PROJECT.ACTIVE;
      updateData.status = previousStatus;
      updateData.reactivatedAt = now;
      updateData.suspendedAt = undefined;
      updateData.suspensionReason = undefined;
      break;

    case 'cancel':
      updateData.status = STATUS.PROJECT.CANCELLED;
      updateData.cancelledAt = now;
      updateData.cancellationReason = actionData?.reason || 'Cancelled by creator';
      break;

    case 'complete':
      updateData.status = STATUS.PROJECT.COMPLETED;
      updateData.completedAt = now;
      if (actionData?.forceComplete) {
        updateData.forceCompletedBy = uid;
        updateData.forceCompletionReason = actionData.completionReason;
      }
      break;

    case 'extend_deadline':
      if (!actionData?.newDeadline) {
        throw new https.HttpsError('invalid-argument', 'New deadline is required');
      }
      
      const newDeadline = new Date(actionData.newDeadline);
      const maxExtension = helpers.date.addMonths(new Date(), PROJECT_CONFIG.MAX_DURATION_MONTHS);
      
      if (newDeadline > maxExtension) {
        throw new https.HttpsError(
          'invalid-argument',
          `Deadline cannot be extended beyond ${PROJECT_CONFIG.MAX_DURATION_MONTHS} months`
        );
      }
      
      updateData['funding.deadline'] = newDeadline;
      updateData.deadlineExtended = true;
      updateData.originalDeadline = project.funding.deadline;
      break;

    case 'pause_funding':
      updateData.status = STATUS.PROJECT.PAUSED;
      updateData.pausedAt = now;
      updateData.pauseReason = actionData?.reason;
      break;

    default:
      throw new https.HttpsError('invalid-argument', `Unsupported action: ${action}`);
  }

  return updateData;
}

/**
 * Gère les processus post-changement de statut
 */
async function handlePostStatusChange(
  project: ProjectDocument,
  action: string,
  actionData: any,
  user: UserDocument
): Promise<void> {
  try {
    // Notifications selon l'action
    if (actionData?.notifyCreator !== false) {
      await notifyCreatorOfStatusChange(project, action, actionData, user);
    }

    if (actionData?.notifyContributors) {
      await notifyContributorsOfStatusChange(project, action, actionData);
    }

    // Actions spéciales selon le changement
    switch (action) {
      case 'cancel':
        await handleProjectCancellation(project);
        break;

      case 'complete':
        await handleProjectCompletion(project);
        break;

      case 'approve':
        await handleProjectApproval(project);
        break;

      case 'suspend':
        await handleProjectSuspension(project);
        break;
    }

  } catch (error) {
    logger.error('Failed to handle post-status change processes', error, {
      projectId: project.uid,
      action
    });
    // Ne pas faire échouer la fonction pour les processus post-changement
  }
}

/**
 * Gère l'annulation d'un projet
 */
async function handleProjectCancellation(project: ProjectDocument): Promise<void> {
  try {
    if (project.funding.raised > 0) {
      // Initier les remboursements automatiques
      logger.info('Initiating refunds for cancelled project', {
        projectId: project.uid,
        totalToRefund: project.funding.raised,
        contributorsCount: project.funding.contributorsCount
      });

      // TODO: Implémenter la logique de remboursement
      // - Récupérer toutes les contributions confirmées
      // - Créer des refunds Stripe pour chaque contribution
      // - Mettre à jour le statut des contributions
      // - Notifier les contributeurs
    }

    // Mettre à jour les stats de la plateforme
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'projects.cancelled': 1,
      [`categories.${project.category}.cancelledProjects`]: 1,
    });

  } catch (error) {
    logger.error('Failed to handle project cancellation', error, { projectId: project.uid });
  }
}

/**
 * Gère la completion d'un projet
 */
async function handleProjectCompletion(project: ProjectDocument): Promise<void> {
  try {
    // Calculer les métriques finales
    const finalStats = {
      finalFundingPercentage: Math.round((project.funding.raised / project.funding.goal) * 100),
      totalDuration: project.publishedAt ? 
        helpers.date.differenceInDays(new Date(), project.publishedAt) : 0,
      milestonesCompleted: project.milestones.filter(m => m.status === STATUS.MILESTONE.COMPLETED).length,
      totalMilestones: project.milestones.length,
    };

    // Mettre à jour les stats du créateur
    await firestoreHelper.runTransaction(async (transaction) => {
      const creatorRef = firestoreHelper.getDocumentRef('users', project.creatorUid);
      const creatorDoc = await transaction.get(creatorRef);
      
      if (creatorDoc.exists) {
        const creatorData = creatorDoc.data();
        const currentStats = creatorData?.stats || {};
        
        transaction.update(creatorRef, {
          'stats.successfulProjects': (currentStats.successfulProjects || 0) + 1,
          'stats.totalFundsRaised': (currentStats.totalFundsRaised || 0) + project.funding.raised,
          'stats.averageProjectSize': Math.round(
            ((currentStats.totalFundsRaised || 0) + project.funding.raised) / 
            ((currentStats.successfulProjects || 0) + 1)
          ),
        });
      }
    });

    // Mettre à jour les stats de la plateforme
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'projects.completed': 1,
      [`categories.${project.category}.completedProjects`]: 1,
      [`categories.${project.category}.totalRaised`]: project.funding.raised,
    });

    logger.info('Project completion processed', {
      projectId: project.uid,
      finalStats,
      creatorUid: project.creatorUid
    });

  } catch (error) {
    logger.error('Failed to handle project completion', error, { projectId: project.uid });
  }
}

/**
 * Gère l'approbation d'un projet
 */
async function handleProjectApproval(project: ProjectDocument): Promise<void> {
  try {
    // Créer l'entrée dans le feed public
    const feedEntry = {
      id: helpers.string.generateId('feed'),
      type: 'project_approved',
      projectId: project.uid,
      projectTitle: project.title,
      creatorUid: project.creatorUid,
      creatorName: project.creatorDisplayName,
      category: project.category,
      fundingGoal: project.funding.goal,
      currency: project.funding.currency,
      deadline: project.funding.deadline,
      coverImage: project.media.coverImage,
      approvedAt: new Date(),
      visibility: 'public',
    };

    await firestoreHelper.addDocument('activity_feed', feedEntry);

    logger.info('Project approval processed', {
      projectId: project.uid,
      creatorUid: project.creatorUid,
      category: project.category
    });

  } catch (error) {
    logger.error('Failed to handle project approval', error, { projectId: project.uid });
  }
}

/**
 * Gère la suspension d'un projet
 */
async function handleProjectSuspension(project: ProjectDocument): Promise<void> {
  try {
    // Pause les contributions actives
    if (project.funding.raised > 0) {
      logger.info('Pausing active contributions for suspended project', {
        projectId: project.uid,
        currentFunding: project.funding.raised
      });

      // TODO: Implémenter la pause des contributions
      // - Mettre en pause les PaymentIntents en cours
      // - Empêcher les nouvelles contributions
      // - Notifier les contributeurs de la suspension
    }

    // Log d'audit sécurité
    logger.security('Project suspended', 'high', {
      projectId: project.uid,
      creatorUid: project.creatorUid,
      suspendedBy: project.lastModifiedBy,
      reason: project.suspensionReason,
      fundingRaised: project.funding.raised,
    });

  } catch (error) {
    logger.error('Failed to handle project suspension', error, { projectId: project.uid });
  }
}

/**
 * Envoie les notifications de changement de statut
 */
async function notifyCreatorOfStatusChange(
  project: ProjectDocument,
  action: string,
  actionData: any,
  moderator: UserDocument
): Promise<void> {
  try {
    const creator = await firestoreHelper.getDocument<UserDocument>('users', project.creatorUid);

    const notificationData = {
      projectId: project.uid,
      projectTitle: project.title,
      action,
      reason: actionData?.reason,
      moderatorName: moderator.displayName,
      moderatorNotes: actionData?.moderatorNotes,
    };

    logger.info('Creator status change notification would be sent', {
      projectId: project.uid,
      creatorUid: creator.uid,
      action,
      hasReason: !!actionData?.reason
    });

    // TODO: Implémenter l'envoi d'email spécifique selon l'action
    // - Approval: Email de félicitations + prochaines étapes
    // - Rejection: Email avec raisons + possibilité de corriger
    // - Suspension: Email d'alerte + procédure d'appel
    // - Cancellation: Email de confirmation

  } catch (error) {
    logger.error('Failed to notify creator of status change', error, {
      projectId: project.uid,
      action
    });
  }
}

/**
 * Envoie les notifications aux contributeurs
 */
async function notifyContributorsOfStatusChange(
  project: ProjectDocument,
  action: string,
  actionData: any
): Promise<void> {
  try {
    if (project.funding.contributorsCount === 0) {
      return;
    }

    // Récupérer les contributeurs
    const contributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `projects/${project.uid}/contributions`,
      [
        ['status', '==', 'confirmed'],
        ['notificationsEnabled', '==', true]
      ]
    );

    const uniqueContributors = new Set(contributions.map(c => c.contributorUid));

    logger.info('Contributor status change notifications would be sent', {
      projectId: project.uid,
      action,
      contributorsToNotify: uniqueContributors.size,
      totalContributions: contributions.length
    });

    // TODO: Implémenter les notifications aux contributeurs
    // - Email groupé avec détails du changement
    // - Instructions spécifiques selon l'action (remboursement, etc.)
    // - Notification push si activée

  } catch (error) {
    logger.error('Failed to notify contributors of status change', error, {
      projectId: project.uid,
      action
    });
  }
}

/**
 * Exécute le changement de statut du projet
 */
async function executeManageProjectStatus(
  data: ProjectsAPI.ManageProjectStatusRequest,
  context: CallableContext
): Promise<ProjectsAPI.ManageProjectStatusResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  const { user, project } = await validateStatusChangePermissions(uid, data.projectId, data.action);
  
  // Validation de la transition de statut
  validateStatusTransition(project.status, data.action, project);
  
  // Préparer les données de mise à jour
  const updateData = await executeStatusAction(project, data.action, data.actionData, uid);
  
  // Ajouter les métadonnées de contexte
  if (context.rawRequest.ip) {
    updateData.ipAddress = context.rawRequest.ip;
  }
  if (context.rawRequest.headers['user-agent']) {
    updateData.userAgent = context.rawRequest.headers['user-agent'] as string;
  }

  // Transaction pour mettre à jour le projet
  await firestoreHelper.runTransaction(async (transaction) => {
    const projectRef = firestoreHelper.getDocumentRef('projects', data.projectId);
    
    // Vérifier la version pour éviter les conflits
    const currentDoc = await transaction.get(projectRef);
    if (!currentDoc.exists) {
      throw new https.HttpsError('not-found', 'Project not found');
    }

    const currentVersion = currentDoc.data()?.version || 0;
    if (project.version !== currentVersion) {
      throw new https.HttpsError('aborted', 'Project was modified by another operation. Please refresh and try again.');
    }

    // Appliquer la mise à jour
    transaction.update(projectRef, updateData);
  });

  // Processus post-changement en parallèle
  await handlePostStatusChange(project, data.action, data.actionData, user);

  // Log business avec audit trail
  logger.business('Project status changed', 'projects', {
    projectId: data.projectId,
    previousStatus: project.status,
    newStatus: updateData.status,
    action: data.action,
    changedBy: uid,
    isAdmin: user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS),
    isCreator: project.creatorUid === uid,
    reason: data.actionData?.reason,
    fundingRaised: project.funding.raised,
    contributorsCount: project.funding.contributorsCount,
  });

  // Log d'audit sécurité pour les actions sensibles
  const sensitiveActions = ['reject', 'suspend', 'cancel', 'complete'];
  if (sensitiveActions.includes(data.action)) {
    logger.security('Sensitive project action performed', 'high', {
      projectId: data.projectId,
      action: data.action,
      performedBy: uid,
      reason: data.actionData?.reason,
      projectTitle: project.title,
      creatorUid: project.creatorUid,
      fundingRaised: project.funding.raised,
      ipAddress: context.rawRequest.ip,
    });
  }

  return {
    projectId: data.projectId,
    previousStatus: project.status,
    newStatus: updateData.status as string,
    action: data.action,
    version: updateData.version as number,
    updatedAt: updateData.updatedAt.toISOString(),
    requiresFollowUp: ['cancel', 'suspend'].includes(data.action) && project.funding.raised > 0,
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const manageProjectStatus = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.ManageProjectStatusResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.ManageProjectStatusRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Managing project status', {
      functionName: 'manageProjectStatus',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      action: validatedData.action,
      hasReason: !!validatedData.actionData?.reason,
    });

    // Exécution
    const result = await executeManageProjectStatus(validatedData, context);

    // Logging de succès
    logger.info('Project status managed successfully', {
      functionName: 'manageProjectStatus',
      uid: context.auth.uid,
      projectId: result.projectId,
      action: result.action,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      version: result.version,
      requiresFollowUp: result.requiresFollowUp,
      success: true,
    });

    return result;
  })
);