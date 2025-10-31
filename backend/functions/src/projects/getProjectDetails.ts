/**
 * Get Project Details Firebase Function
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
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  includeStats: Joi.boolean().default(true),
  includeContributions: Joi.boolean().default(false),
  includeTeamDetails: Joi.boolean().default(true),
  includeMilestoneDetails: Joi.boolean().default(true),
}).required();

/**
 * Valide l'accès au projet
 */
async function validateProjectAccess(
  projectId: string,
  uid?: string
): Promise<{ project: ProjectDocument; canViewPrivate: boolean }> {
  try {
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', projectId);
    
    // Vérifier la visibilité
    if (project.visibility === 'private') {
      if (!uid) {
        throw new https.HttpsError('permission-denied', 'Authentication required for private project');
      }

      // Seul le créateur ou les admins peuvent voir les projets privés
      if (project.creatorUid !== uid) {
        const user = await firestoreHelper.getDocument<UserDocument>('users', uid);
        if (!user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS)) {
          throw new https.HttpsError('permission-denied', 'Access denied to private project');
        }
      }
    }

    // Vérifier le statut du projet
    const publicStatuses = [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING, STATUS.PROJECT.COMPLETED];
    const canViewPrivate = uid && (
      project.creatorUid === uid || 
      (uid && (await firestoreHelper.getDocument<UserDocument>('users', uid)).permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS))
    );

    if (!publicStatuses.includes(project.status) && !canViewPrivate) {
      throw new https.HttpsError('not-found', 'Project not found or not available');
    }

    return { project, canViewPrivate: !!canViewPrivate };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate project access', error, { projectId, uid });
    throw new https.HttpsError('internal', 'Unable to validate project access');
  }
}

/**
 * Enrichit les données du projet avec des statistiques
 */
async function enrichProjectWithStats(
  project: ProjectDocument,
  includeStats: boolean
): Promise<any> {
  if (!includeStats) {
    return project;
  }

  try {
    // Récupérer les statistiques additionnelles
    const [
      contributionsCount,
      uniqueContributorsCount,
      averageContribution,
      recentActivity
    ] = await Promise.all([
      // Nombre total de contributions
      firestoreHelper.countDocuments(`projects/${project.uid}/contributions`, [
        ['status', '==', 'confirmed']
      ]),

      // Nombre de contributeurs uniques (approximatif)
      firestoreHelper.queryDocuments<ContributionDocument>(
        `projects/${project.uid}/contributions`,
        [['status', '==', 'confirmed']],
        { limit: 1000 }
      ).then(contributions => {
        const uniqueContributors = new Set(contributions.map(c => c.contributorUid));
        return uniqueContributors.size;
      }),

      // Contribution moyenne
      firestoreHelper.queryDocuments<ContributionDocument>(
        `projects/${project.uid}/contributions`,
        [['status', '==', 'confirmed']],
        { limit: 1000 }
      ).then(contributions => {
        if (contributions.length === 0) return 0;
        const total = contributions.reduce((sum, c) => sum + c.amount.gross, 0);
        return Math.round(total / contributions.length);
      }),

      // Activité récente (derniers 7 jours)
      firestoreHelper.queryDocuments<ContributionDocument>(
        `projects/${project.uid}/contributions`,
        [
          ['status', '==', 'confirmed'],
          ['createdAt', '>=', helpers.date.subtractDays(new Date(), 7)]
        ]
      ).then(contributions => contributions.length)
    ]);

    // Calculer le momentum (tendance de financement)
    const momentum = calculateFundingMomentum(project, recentActivity);

    return {
      ...project,
      enrichedStats: {
        ...project.stats,
        contributionsCount,
        uniqueContributorsCount,
        averageContribution,
        recentActivity,
        momentum,
        daysRemaining: helpers.date.differenceInDays(new Date(project.funding.deadline), new Date()),
        fundingVelocity: calculateFundingVelocity(project),
      }
    };

  } catch (error) {
    logger.error('Failed to enrich project with stats', error, { projectId: project.uid });
    return project; // Retourner le projet sans enrichissement
  }
}

/**
 * Calcule le momentum de financement
 */
function calculateFundingMomentum(project: ProjectDocument, recentActivity: number): 'low' | 'medium' | 'high' {
  const daysRemaining = helpers.date.differenceInDays(new Date(project.funding.deadline), new Date());
  
  if (daysRemaining <= 0) return 'low';
  
  const dailyActivityNeeded = (project.funding.goal - project.funding.raised) / daysRemaining;
  const currentDailyActivity = recentActivity / 7; // Moyenne sur 7 jours
  
  const momentumRatio = currentDailyActivity / dailyActivityNeeded;
  
  if (momentumRatio >= 1.5) return 'high';
  if (momentumRatio >= 0.8) return 'medium';
  return 'low';
}

/**
 * Calcule la vélocité de financement
 */
function calculateFundingVelocity(project: ProjectDocument): number {
  if (!project.publishedAt) return 0;
  
  const daysSincePublished = helpers.date.differenceInDays(new Date(), project.publishedAt);
  if (daysSincePublished <= 0) return 0;
  
  return Math.round(project.funding.raised / daysSincePublished);
}

/**
 * Récupère les contributions si demandées
 */
async function getProjectContributions(
  projectId: string,
  includeContributions: boolean,
  canViewPrivate: boolean
): Promise<ContributionDocument[] | undefined> {
  if (!includeContributions) {
    return undefined;
  }

  try {
    const contributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      `projects/${projectId}/contributions`,
      [['status', '==', 'confirmed']],
      { 
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
        limit: 50 
      }
    );

    // Filtrer les données sensibles si pas d'accès privé
    if (!canViewPrivate) {
      return contributions.map(contribution => ({
        ...contribution,
        contributorUid: undefined, // Masquer l'identité
        contributorName: contribution.anonymous ? 'Anonyme' : 'Contributeur',
        payment: {
          ...contribution.payment,
          // Masquer les détails de paiement
          paymentMethod: undefined,
          paymentIntentId: undefined,
        }
      }));
    }

    return contributions;

  } catch (error) {
    logger.error('Failed to get project contributions', error, { projectId });
    return undefined;
  }
}

/**
 * Incrémente le compteur de vues
 */
async function incrementProjectViews(projectId: string, uid?: string): Promise<void> {
  try {
    // Éviter de compter les vues du créateur
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', projectId);
    if (uid && project.creatorUid === uid) {
      return;
    }

    // Incrémenter les vues
    await firestoreHelper.incrementDocument('projects', projectId, {
      'stats.views': 1,
      lastViewedAt: new Date(),
    });

    // Log pour analytics
    logger.debug('Project view recorded', {
      projectId,
      viewerUid: uid,
      timestamp: new Date(),
    });

  } catch (error) {
    logger.error('Failed to increment project views', error, { projectId, uid });
    // Ne pas faire échouer la fonction pour le comptage des vues
  }
}

/**
 * Filtre les données sensibles selon les permissions
 */
function filterSensitiveData(
  project: any,
  canViewPrivate: boolean,
  uid?: string
): any {
  if (canViewPrivate) {
    return project;
  }

  // Filtrer les données sensibles pour les visiteurs publics
  const filtered = { ...project };

  // Masquer les informations financières détaillées
  if (filtered.funding) {
    filtered.funding = {
      ...filtered.funding,
      platformFees: undefined,
      stripeFees: undefined,
      netGoal: undefined,
      netRaised: undefined,
    };
  }

  // Masquer les détails d'audit
  filtered.auditStatus = undefined;
  filtered.auditAssignedTo = undefined;
  filtered.complianceChecks = undefined;

  // Masquer les métadonnées système
  filtered.ipAddress = undefined;
  filtered.userAgent = undefined;
  filtered.lastModifiedBy = undefined;

  // Masquer les informations d'équipe sensibles
  if (filtered.team) {
    filtered.team = filtered.team.map((member: any) => ({
      ...member,
      linkedin: undefined, // Garder privé sauf pour le créateur
    }));
  }

  return filtered;
}

/**
 * Exécute la récupération des détails du projet
 */
async function executeGetProjectDetails(
  data: ProjectsAPI.GetProjectDetailsRequest,
  context: CallableContext
): Promise<ProjectsAPI.GetProjectDetailsResponse> {
  const uid = context.auth?.uid;
  
  // Validation de l'accès au projet
  const { project, canViewPrivate } = await validateProjectAccess(data.projectId, uid);
  
  // Enrichir avec les statistiques si demandé
  const enrichedProject = await enrichProjectWithStats(project, data.includeStats);
  
  // Récupérer les contributions si demandées
  const contributions = await getProjectContributions(
    data.projectId,
    data.includeContributions,
    canViewPrivate
  );

  // Incrémenter les vues (en arrière-plan)
  incrementProjectViews(data.projectId, uid);

  // Filtrer les données sensibles
  const filteredProject = filterSensitiveData(enrichedProject, canViewPrivate, uid);

  // Préparer les données de l'équipe
  let teamDetails;
  if (data.includeTeamDetails) {
    teamDetails = project.team.map(member => ({
      ...member,
      // Masquer les infos sensibles si pas d'accès privé
      linkedin: canViewPrivate ? member.linkedin : undefined,
    }));
  }

  // Préparer les détails des milestones
  let milestoneDetails;
  if (data.includeMilestoneDetails) {
    milestoneDetails = project.milestones.map(milestone => ({
      ...milestone,
      // Filtrer les détails d'audit si pas d'accès privé
      auditStatus: canViewPrivate ? milestone.auditStatus : undefined,
      auditAssignedTo: canViewPrivate ? milestone.auditAssignedTo : undefined,
      evidence: canViewPrivate ? milestone.evidence : milestone.evidence?.filter(e => e.verified),
    }));
  }

  logger.info('Project details retrieved', {
    projectId: data.projectId,
    viewerUid: uid,
    includeStats: data.includeStats,
    includeContributions: data.includeContributions,
    canViewPrivate,
    contributionsCount: contributions?.length || 0,
  });

  return {
    project: filteredProject,
    team: teamDetails,
    milestones: milestoneDetails,
    contributions,
    viewerPermissions: {
      canEdit: canViewPrivate && (project.creatorUid === uid),
      canViewPrivateData: canViewPrivate,
      canContribute: !uid || (uid !== project.creatorUid),
      canComment: !!uid,
    },
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const getProjectDetails = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.GetProjectDetailsResponse> => {
    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.GetProjectDetailsRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Getting project details', {
      functionName: 'getProjectDetails',
      uid: context.auth?.uid,
      projectId: validatedData.projectId,
      includeStats: validatedData.includeStats,
      includeContributions: validatedData.includeContributions,
    });

    // Exécution
    const result = await executeGetProjectDetails(validatedData, context);

    // Logging de succès (sans données sensibles)
    logger.info('Project details retrieved successfully', {
      functionName: 'getProjectDetails',
      uid: context.auth?.uid,
      projectId: validatedData.projectId,
      projectTitle: result.project.title,
      projectStatus: result.project.status,
      canViewPrivate: result.viewerPermissions.canViewPrivateData,
      contributionsIncluded: !!result.contributions,
      success: true,
    });

    return result;
  })
);