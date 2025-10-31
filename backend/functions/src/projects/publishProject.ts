/**
 * Publish Project Firebase Function
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
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PROJECT_CONFIG, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  confirmTerms: Joi.boolean().valid(true).required(),
  marketingConsent: Joi.boolean().default(false),
}).required();

/**
 * Valide que le projet peut être publié
 */
async function validateProjectCanBePublished(
  projectId: string,
  uid: string
): Promise<{ user: UserDocument; project: ProjectDocument }> {
  try {
    // Récupérer l'utilisateur et le projet
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);
    
    // Vérifier que l'utilisateur est le créateur
    if (project.creatorUid !== uid) {
      throw new https.HttpsError('permission-denied', 'Only the project creator can publish this project');
    }

    // Vérifier le statut du projet
    const publishableStatuses = [STATUS.PROJECT.DRAFT, STATUS.PROJECT.UNDER_REVIEW];
    if (!publishableStatuses.includes(project.status)) {
      throw new https.HttpsError(
        'failed-precondition',
        `Project cannot be published from status: ${project.status}`
      );
    }

    // Vérifier que toutes les reviews sont complètes
    const complianceChecks = project.complianceChecks;
    if (complianceChecks.contentModeration !== STATUS.MODERATION.APPROVED ||
        complianceChecks.legalReview !== STATUS.MODERATION.APPROVED ||
        complianceChecks.financialReview !== STATUS.MODERATION.APPROVED) {
      throw new https.HttpsError(
        'failed-precondition',
        'All compliance checks must be approved before publication'
      );
    }

    // Vérifier l'audit si requis
    if (project.auditRequired && project.auditStatus !== STATUS.AUDIT.COMPLETED) {
      throw new https.HttpsError(
        'failed-precondition',
        'Audit must be completed before publication'
      );
    }

    // Vérifier la deadline de financement
    const now = new Date();
    const fundingDeadline = new Date(project.funding.deadline);
    if (fundingDeadline <= now) {
      throw new https.HttpsError(
        'failed-precondition',
        'Funding deadline has passed. Update the deadline first.'
      );
    }

    // Vérifier la durée minimum de financement
    const daysUntilDeadline = helpers.date.differenceInDays(fundingDeadline, now);
    if (daysUntilDeadline < PROJECT_CONFIG.MIN_FUNDING_DURATION_DAYS) {
      throw new https.HttpsError(
        'failed-precondition',
        `Funding period must be at least ${PROJECT_CONFIG.MIN_FUNDING_DURATION_DAYS} days`
      );
    }

    // Vérifier les limites de projets actifs du créateur
    const activeProjectsCount = await firestoreHelper.countDocuments('projects', [
      ['creatorUid', '==', uid],
      ['status', 'in', [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING]]
    ]);

    const maxActiveProjects = user.kyc.level >= PROJECT_CONFIG.ENHANCED_KYC_LEVEL ? 
      PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_ENHANCED : 
      PROJECT_CONFIG.MAX_ACTIVE_PROJECTS_BASIC;

    if (activeProjectsCount >= maxActiveProjects) {
      throw new https.HttpsError(
        'resource-exhausted',
        `Maximum number of active projects reached (${maxActiveProjects})`
      );
    }

    return { user, project };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate project for publication', error, { projectId, uid });
    throw new https.HttpsError('internal', 'Unable to validate project for publication');
  }
}

/**
 * Effectue les vérifications finales avant publication
 */
function performFinalValidation(project: ProjectDocument): void {
  // Vérifier l'intégrité des données
  
  // Milestones
  if (!project.milestones || project.milestones.length === 0) {
    throw new https.HttpsError('failed-precondition', 'Project must have at least one milestone');
  }

  const totalMilestonePercentage = project.milestones.reduce(
    (sum, milestone) => sum + milestone.fundingPercentage, 
    0
  );
  if (Math.abs(totalMilestonePercentage - 100) > 0.01) {
    throw new https.HttpsError('failed-precondition', 'Milestone funding percentages must sum to 100%');
  }

  // Équipe
  if (!project.team || project.team.length === 0) {
    throw new https.HttpsError('failed-precondition', 'Project must have at least one team member');
  }

  // Médias
  if (!project.media.coverImage) {
    throw new https.HttpsError('failed-precondition', 'Project must have a cover image');
  }

  // Impact goals
  if (!project.impactGoals.metrics || project.impactGoals.metrics.length === 0) {
    throw new https.HttpsError('failed-precondition', 'Project must have at least one impact metric');
  }

  // Financement
  if (project.funding.goal < PROJECT_CONFIG.MIN_FUNDING_GOAL) {
    throw new https.HttpsError(
      'failed-precondition',
      `Funding goal must be at least ${PROJECT_CONFIG.MIN_FUNDING_GOAL} cents`
    );
  }
}

/**
 * Prépare le projet pour la publication
 */
function prepareProjectForPublication(project: ProjectDocument): Partial<ProjectDocument> {
  const now = new Date();
  
  return {
    status: STATUS.PROJECT.ACTIVE,
    visibility: 'public',
    publishedAt: now,
    fundingStartsAt: now,
    
    // Réinitialiser certains compteurs
    'stats.views': 0,
    'stats.likes': 0,
    'stats.shares': 0,
    
    // Métadonnées de publication
    lastPublishedAt: now,
    publishVersion: project.version + 1,
    
    // Mise à jour générale
    updatedAt: now,
    version: project.version + 1,
  };
}

/**
 * Crée les notifications et alertes de publication
 */
async function createPublicationNotifications(
  project: ProjectDocument,
  creator: UserDocument
): Promise<void> {
  try {
    // Notification de confirmation au créateur
    logger.info('Project publication notifications would be sent', {
      projectId: project.uid,
      creatorUid: creator.uid,
      title: project.title,
      category: project.category,
      fundingGoal: project.funding.goal
    });

    // TODO: Implémenter les notifications complètes
    // - Email de confirmation au créateur
    // - Notification aux utilisateurs intéressés par la catégorie
    // - Ajout au feed public
    // - Notification aux auditeurs si audit requis
    // - Alerte modération si montant élevé

    // Créer une entrée dans le feed d'activité public
    const feedEntry = {
      id: helpers.string.generateId('feed'),
      type: 'project_published',
      projectId: project.uid,
      projectTitle: project.title,
      creatorUid: creator.uid,
      creatorName: creator.displayName,
      category: project.category,
      fundingGoal: project.funding.goal,
      currency: project.funding.currency,
      coverImage: project.media.coverImage,
      publishedAt: new Date(),
      visibility: 'public',
    };

    await firestoreHelper.addDocument('activity_feed', feedEntry);

    logger.info('Project publication processing completed', {
      projectId: project.uid,
      feedEntryCreated: true
    });

  } catch (error) {
    logger.error('Failed to create publication notifications', error, {
      projectId: project.uid,
      creatorUid: creator.uid
    });
    // Ne pas faire échouer la publication pour les notifications
  }
}

/**
 * Met à jour les statistiques de la plateforme
 */
async function updatePlatformStats(project: ProjectDocument): Promise<void> {
  try {
    // Mettre à jour les compteurs globaux
    const statsUpdate = {
      [`categories.${project.category}.projectsCount`]: 1,
      [`categories.${project.category}.totalFunding`]: project.funding.goal,
      'projects.total': 1,
      'projects.active': 1,
      'funding.totalGoals': project.funding.goal,
      lastUpdatedAt: new Date(),
    };

    await firestoreHelper.incrementDocument('platform_stats', 'global', statsUpdate);

    logger.info('Platform stats updated for project publication', {
      projectId: project.uid,
      category: project.category,
      fundingGoal: project.funding.goal
    });

  } catch (error) {
    logger.error('Failed to update platform stats', error, {
      projectId: project.uid
    });
    // Ne pas faire échouer la publication pour les stats
  }
}

/**
 * Exécute la publication du projet
 */
async function executePublishProject(
  data: ProjectsAPI.PublishProjectRequest,
  context: CallableContext
): Promise<ProjectsAPI.PublishProjectResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions et données
  const { user, project } = await validateProjectCanBePublished(data.projectId, uid);
  
  // Vérifications finales
  performFinalValidation(project);
  
  // Préparer les données de publication
  const publicationData = prepareProjectForPublication(project);
  
  // Ajouter les métadonnées de contexte
  publicationData.lastModifiedBy = uid;
  if (context.rawRequest.ip) {
    publicationData.ipAddress = context.rawRequest.ip;
  }
  if (context.rawRequest.headers['user-agent']) {
    publicationData.userAgent = context.rawRequest.headers['user-agent'] as string;
  }

  // Transaction pour publier le projet
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

    // Publier le projet
    transaction.update(projectRef, publicationData);
  });

  // Créer les notifications et activités (en parallèle)
  await Promise.all([
    createPublicationNotifications(project, user),
    updatePlatformStats(project),
  ]);

  // Calculer les dates importantes
  const now = new Date();
  const fundingDeadline = new Date(project.funding.deadline);
  const fundingDurationDays = helpers.date.differenceInDays(fundingDeadline, now);

  logger.business('Project published', 'projects', {
    projectId: data.projectId,
    creatorUid: user.uid,
    title: project.title,
    category: project.category,
    fundingGoal: project.funding.goal,
    currency: project.funding.currency,
    fundingDurationDays,
    milestonesCount: project.milestones.length,
    teamSize: project.team.length,
    auditRequired: project.auditRequired,
    riskLevel: project.riskLevel,
    publishedAt: now,
  });

  return {
    projectId: data.projectId,
    status: STATUS.PROJECT.ACTIVE,
    publishedAt: now.toISOString(),
    fundingStartsAt: now.toISOString(),
    fundingEndsAt: fundingDeadline.toISOString(),
    fundingDurationDays,
    projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
    shareUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}?share=true`,
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const publishProject = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.PublishProjectResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.PublishProjectRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Publishing project', {
      functionName: 'publishProject',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      marketingConsent: validatedData.marketingConsent,
    });

    // Exécution
    const result = await executePublishProject(validatedData, context);

    // Logging de succès
    logger.info('Project published successfully', {
      functionName: 'publishProject',
      uid: context.auth.uid,
      projectId: result.projectId,
      fundingDurationDays: result.fundingDurationDays,
      success: true,
    });

    return result;
  })
);