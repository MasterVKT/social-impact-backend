/**
 * Get Projects by Creator Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  creatorUid: Joi.string().optional(), // Si omis, utilise l'UID de l'utilisateur connecté
  status: Joi.string().valid('all', 'draft', 'active', 'funding', 'completed', 'cancelled').default('all'),
  includeStats: Joi.boolean().default(true),
  includeContributions: Joi.boolean().default(false),
  sortBy: Joi.string().valid('created', 'updated', 'funding_progress', 'deadline').default('updated'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
}).required();

/**
 * Valide l'accès aux projets du créateur
 */
async function validateCreatorAccess(
  requestedCreatorUid: string | undefined,
  requestingUid: string | undefined
): Promise<{ creatorUid: string; canViewPrivate: boolean; creator: UserDocument }> {
  const targetCreatorUid = requestedCreatorUid || requestingUid;
  
  if (!targetCreatorUid) {
    throw new https.HttpsError('invalid-argument', 'Creator UID is required');
  }

  try {
    // Récupérer le créateur
    const creator = await firestoreHelper.getDocument<UserDocument>('users', targetCreatorUid);
    
    // Déterminer les permissions d'accès
    let canViewPrivate = false;
    
    if (requestingUid) {
      if (requestingUid === targetCreatorUid) {
        // L'utilisateur consulte ses propres projets
        canViewPrivate = true;
      } else {
        // Vérifier si l'utilisateur a des permissions d'admin
        const requestingUser = await firestoreHelper.getDocument<UserDocument>('users', requestingUid);
        canViewPrivate = requestingUser.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS);
      }
    }

    return { 
      creatorUid: targetCreatorUid, 
      canViewPrivate, 
      creator 
    };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate creator access', error, { requestedCreatorUid, requestingUid });
    throw new https.HttpsError('internal', 'Unable to validate creator access');
  }
}

/**
 * Construit les filtres Firestore pour les projets du créateur
 */
function buildCreatorProjectFilters(
  creatorUid: string,
  status: string,
  canViewPrivate: boolean
): any[] {
  const filters: any[] = [
    ['creatorUid', '==', creatorUid]
  ];

  // Filtres de statut
  if (status !== 'all') {
    const statusMap: Record<string, string> = {
      'draft': STATUS.PROJECT.DRAFT,
      'active': STATUS.PROJECT.ACTIVE,
      'funding': STATUS.PROJECT.FUNDING,
      'completed': STATUS.PROJECT.COMPLETED,
      'cancelled': STATUS.PROJECT.CANCELLED,
    };
    
    filters.push(['status', '==', statusMap[status]]);
  }

  // Si pas d'accès privé, filtrer les projets publics uniquement
  if (!canViewPrivate) {
    filters.push(['visibility', '==', 'public']);
    // Exclure les brouillons et projets en review
    filters.push(['status', 'not-in', [STATUS.PROJECT.DRAFT, STATUS.PROJECT.UNDER_REVIEW]]);
  }

  return filters;
}

/**
 * Enrichit les projets avec des statistiques détaillées
 */
async function enrichProjectsWithStats(
  projects: ProjectDocument[],
  includeStats: boolean,
  includeContributions: boolean
): Promise<any[]> {
  if (!includeStats && !includeContributions) {
    return projects;
  }

  try {
    const enrichedProjects = await Promise.all(
      projects.map(async (project) => {
        const enrichedProject: any = { ...project };

        if (includeStats) {
          // Calculer les stats enrichies
          const daysRemaining = helpers.date.differenceInDays(new Date(project.funding.deadline), new Date());
          const daysSincePublished = project.publishedAt ? 
            helpers.date.differenceInDays(new Date(), project.publishedAt) : 0;

          enrichedProject.enrichedStats = {
            ...project.stats,
            daysRemaining: Math.max(0, daysRemaining),
            daysSincePublished,
            fundingVelocity: daysSincePublished > 0 ? 
              Math.round(project.funding.raised / daysSincePublished) : 0,
            completionRate: project.milestones.length > 0 ? 
              Math.round((project.milestones.filter(m => m.status === STATUS.MILESTONE.COMPLETED).length / project.milestones.length) * 100) : 0,
          };
        }

        if (includeContributions) {
          // Récupérer les contributions récentes
          const recentContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
            `projects/${project.uid}/contributions`,
            [['status', '==', 'confirmed']],
            { 
              orderBy: [{ field: 'createdAt', direction: 'desc' }],
              limit: 10 
            }
          );

          enrichedProject.recentContributions = recentContributions.map(contribution => ({
            id: contribution.id,
            amount: contribution.amount.gross,
            currency: contribution.amount.currency,
            contributorName: contribution.anonymous ? 'Anonyme' : contribution.contributorName,
            createdAt: contribution.createdAt,
            message: contribution.message,
          }));
        }

        return enrichedProject;
      })
    );

    return enrichedProjects;

  } catch (error) {
    logger.error('Failed to enrich projects with stats', error);
    return projects; // Retourner sans enrichissement
  }
}

/**
 * Calcule les statistiques agrégées du créateur
 */
async function calculateCreatorAggregateStats(
  projects: ProjectDocument[]
): Promise<any> {
  const stats = {
    totalProjects: projects.length,
    activeProjects: projects.filter(p => [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING].includes(p.status)).length,
    completedProjects: projects.filter(p => p.status === STATUS.PROJECT.COMPLETED).length,
    draftProjects: projects.filter(p => p.status === STATUS.PROJECT.DRAFT).length,
    
    totalFundingGoal: projects.reduce((sum, p) => sum + p.funding.goal, 0),
    totalFundingRaised: projects.reduce((sum, p) => sum + p.funding.raised, 0),
    averageProjectSize: 0,
    
    totalMilestones: projects.reduce((sum, p) => sum + p.milestones.length, 0),
    completedMilestones: projects.reduce((sum, p) => sum + p.milestones.filter(m => m.status === STATUS.MILESTONE.COMPLETED).length, 0),
    
    successRate: 0,
    averageFundingDuration: 0,
  };

  // Calculs dérivés
  if (stats.totalProjects > 0) {
    stats.averageProjectSize = Math.round(stats.totalFundingGoal / stats.totalProjects);
    stats.successRate = Math.round((stats.completedProjects / stats.totalProjects) * 100);
  }

  // Durée moyenne de financement pour les projets complétés
  const completedProjectsWithDuration = projects
    .filter(p => p.status === STATUS.PROJECT.COMPLETED && p.publishedAt && p.completedAt)
    .map(p => helpers.date.differenceInDays(p.completedAt!, p.publishedAt!));

  if (completedProjectsWithDuration.length > 0) {
    stats.averageFundingDuration = Math.round(
      completedProjectsWithDuration.reduce((sum, duration) => sum + duration, 0) / completedProjectsWithDuration.length
    );
  }

  return stats;
}

/**
 * Filtre les données sensibles selon les permissions
 */
function filterSensitiveData(projects: any[], canViewPrivate: boolean): any[] {
  if (canViewPrivate) {
    return projects;
  }

  return projects.map(project => {
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

    // Masquer les détails de compliance
    filtered.complianceChecks = undefined;
    filtered.auditStatus = undefined;
    filtered.auditAssignedTo = undefined;

    // Masquer les métadonnées système
    filtered.ipAddress = undefined;
    filtered.userAgent = undefined;
    filtered.lastModifiedBy = undefined;

    return filtered;
  });
}

/**
 * Exécute la récupération des projets du créateur
 */
async function executeGetProjectsByCreator(
  data: ProjectsAPI.GetProjectsByCreatorRequest,
  context: CallableContext
): Promise<ProjectsAPI.GetProjectsByCreatorResponse> {
  // Validation de l'accès
  const { creatorUid, canViewPrivate, creator } = await validateCreatorAccess(
    data.creatorUid,
    context.auth?.uid
  );

  // Construire les filtres
  const filters = buildCreatorProjectFilters(creatorUid, data.status, canViewPrivate);

  // Options de requête
  const queryOptions: any = {
    limit: 1000, // Limite élevée pour pagination côté client
  };

  // Ajouter le tri Firestore
  switch (data.sortBy) {
    case 'created':
      queryOptions.orderBy = [{ field: 'createdAt', direction: data.sortOrder }];
      break;
    case 'updated':
      queryOptions.orderBy = [{ field: 'updatedAt', direction: data.sortOrder }];
      break;
    case 'deadline':
      queryOptions.orderBy = [{ field: 'funding.deadline', direction: data.sortOrder }];
      break;
    case 'funding_progress':
      // Tri côté client car basé sur un calcul
      break;
  }

  // Récupérer les projets
  const projectsResult = await firestoreHelper.queryDocuments<ProjectDocument>(
    'projects',
    filters,
    queryOptions
  );

  let projects = projectsResult.data;

  // Tri côté client si nécessaire
  if (data.sortBy === 'funding_progress') {
    const direction = data.sortOrder === 'asc' ? 1 : -1;
    projects.sort((a, b) => (b.funding.percentage - a.funding.percentage) * direction);
  }

  // Enrichir avec les statistiques
  const enrichedProjects = await enrichProjectsWithStats(
    projects,
    data.includeStats,
    data.includeContributions
  );

  // Filtrer les données sensibles
  const filteredProjects = filterSensitiveData(enrichedProjects, canViewPrivate);

  // Pagination
  const offset = (data.page - 1) * data.limit;
  const paginatedProjects = filteredProjects.slice(offset, offset + data.limit);

  // Calculer les statistiques agrégées
  const aggregateStats = await calculateCreatorAggregateStats(projects);

  // Informations du créateur (filtrées si nécessaire)
  const creatorInfo = {
    uid: creator.uid,
    displayName: creator.displayName,
    profilePicture: creator.profilePicture,
    bio: canViewPrivate ? creator.bio : undefined,
    verified: creator.kyc.status === STATUS.KYC.APPROVED,
    joinedAt: creator.createdAt,
    lastActiveAt: canViewPrivate ? creator.stats.lastLoginAt : undefined,
    stats: canViewPrivate ? {
      projectsCreated: creator.stats.projectsCreated,
      totalFundsRaised: creator.stats.totalFundsRaised,
      successfulProjects: creator.stats.successfulProjects,
      averageProjectSize: creator.stats.averageProjectSize,
    } : undefined,
  };

  logger.info('Creator projects retrieved', {
    creatorUid,
    requestingUid: context.auth?.uid,
    totalProjects: projects.length,
    returnedProjects: paginatedProjects.length,
    status: data.status,
    canViewPrivate,
  });

  return {
    projects: paginatedProjects,
    creator: creatorInfo,
    aggregateStats,
    pagination: {
      currentPage: data.page,
      totalPages: Math.ceil(filteredProjects.length / data.limit),
      totalItems: filteredProjects.length,
      itemsPerPage: data.limit,
      hasNextPage: data.page < Math.ceil(filteredProjects.length / data.limit),
      hasPreviousPage: data.page > 1,
    },
    filters: {
      status: data.status,
      canViewPrivate,
    },
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const getProjectsByCreator = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.GetProjectsByCreatorResponse> => {
    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.GetProjectsByCreatorRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Getting projects by creator', {
      functionName: 'getProjectsByCreator',
      requestingUid: context.auth?.uid,
      creatorUid: validatedData.creatorUid,
      status: validatedData.status,
      includeStats: validatedData.includeStats,
      page: validatedData.page,
      limit: validatedData.limit,
    });

    // Exécution
    const result = await executeGetProjectsByCreator(validatedData, context);

    // Logging de succès
    logger.info('Creator projects retrieved successfully', {
      functionName: 'getProjectsByCreator',
      requestingUid: context.auth?.uid,
      creatorUid: result.creator.uid,
      totalProjects: result.aggregateStats.totalProjects,
      returnedProjects: result.projects.length,
      success: true,
    });

    return result;
  })
);