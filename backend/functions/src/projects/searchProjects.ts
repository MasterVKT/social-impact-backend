/**
 * Search Projects Firebase Function
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
import { ProjectDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  // Filtres de recherche
  query: Joi.string().max(100).optional(),
  category: Joi.string().valid('environment', 'education', 'health', 'community', 'innovation').optional(),
  tags: Joi.array().items(Joi.string().max(30)).max(10).optional(),
  country: Joi.string().length(2).optional(),
  region: Joi.string().max(50).optional(),
  
  // Filtres de financement
  fundingRange: Joi.object({
    min: Joi.number().min(0).optional(),
    max: Joi.number().min(0).optional(),
  }).optional(),
  
  fundingStatus: Joi.string().valid('active', 'completed', 'all').default('active'),
  
  // Filtres temporels
  publishedSince: Joi.date().max('now').optional(),
  deadlineBefore: Joi.date().min('now').optional(),
  
  // Options de tri
  sortBy: Joi.string().valid(
    'relevance',
    'funding_progress',
    'funding_goal',
    'recent',
    'deadline',
    'popularity'
  ).default('relevance'),
  
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  
  // Pagination
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
  
  // Options d'inclusion
  includeStats: Joi.boolean().default(false),
  includeCreator: Joi.boolean().default(true),
}).required();

/**
 * Construit les filtres Firestore à partir des critères de recherche
 */
function buildFirestoreFilters(searchCriteria: ProjectsAPI.SearchProjectsRequest): any[] {
  const filters: any[] = [];

  // Filtres de base - toujours inclure les projets publics actifs
  filters.push(['visibility', '==', 'public']);
  
  // Filtres de statut
  if (searchCriteria.fundingStatus === 'active') {
    filters.push(['status', 'in', [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING]]);
  } else if (searchCriteria.fundingStatus === 'completed') {
    filters.push(['status', '==', STATUS.PROJECT.COMPLETED]);
  } else {
    filters.push(['status', 'in', [STATUS.PROJECT.ACTIVE, STATUS.PROJECT.FUNDING, STATUS.PROJECT.COMPLETED]]);
  }

  // Filtres de catégorie
  if (searchCriteria.category) {
    filters.push(['category', '==', searchCriteria.category]);
  }

  // Filtres géographiques
  if (searchCriteria.country) {
    filters.push(['location.country', '==', searchCriteria.country]);
  }

  if (searchCriteria.region) {
    filters.push(['location.region', '==', searchCriteria.region]);
  }

  // Filtres temporels
  if (searchCriteria.publishedSince) {
    filters.push(['publishedAt', '>=', searchCriteria.publishedSince]);
  }

  if (searchCriteria.deadlineBefore) {
    filters.push(['deadline', '<=', searchCriteria.deadlineBefore]);
  }

  // Filtres de financement
  if (searchCriteria.fundingRange?.min) {
    filters.push(['fundingGoal', '>=', searchCriteria.fundingRange.min]);
  }

  if (searchCriteria.fundingRange?.max) {
    filters.push(['fundingGoal', '<=', searchCriteria.fundingRange.max]);
  }

  return filters;
}

/**
 * Applique la recherche textuelle côté client
 */
function applyTextSearch(projects: ProjectDocument[], query?: string): ProjectDocument[] {
  if (!query || query.trim().length === 0) {
    return projects;
  }

  const searchTerms = query.toLowerCase().trim().split(/\s+/);

  return projects.filter(project => {
    const searchableText = [
      project.title,
      project.description || project.fullDescription || '',
      project.shortDescription,
      ...(project.tags || []),
      ...(project.team || []).map(member => member.name || ''),
      project.impactGoals?.primary || '',
      ...(project.impactGoals?.secondary || [])
    ].join(' ').toLowerCase();

    return searchTerms.every(term => searchableText.includes(term));
  });
}

/**
 * Applique les filtres de tags côté client
 */
function applyTagFilters(projects: ProjectDocument[], tags?: string[]): ProjectDocument[] {
  if (!tags || tags.length === 0) {
    return projects;
  }

  const normalizedTags = tags.map(tag => tag.toLowerCase().trim());

  return projects.filter(project => {
    return normalizedTags.every(tag =>
      (project.tags || []).some(projectTag => projectTag.toLowerCase().includes(tag))
    );
  });
}

/**
 * Trie les projets selon les critères
 */
function sortProjects(
  projects: ProjectDocument[],
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  query?: string
): ProjectDocument[] {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return projects.sort((a, b) => {
    switch (sortBy) {
      case 'relevance':
        if (query) {
          // Score de pertinence basé sur la correspondance de texte
          const scoreA = calculateRelevanceScore(a, query);
          const scoreB = calculateRelevanceScore(b, query);
          return (scoreB - scoreA) * direction;
        }
        // Par défaut, trier par popularité
        const aViews = (a.stats?.views || a.analytics?.views || 0);
        const bViews = (b.stats?.views || b.analytics?.views || 0);
        const aLikes = (a.stats?.likes || 0);
        const bLikes = (b.stats?.likes || 0);
        return ((bViews + bLikes) - (aViews + aLikes)) * direction;

      case 'funding_progress':
        return ((b.funding?.percentage || 0) - (a.funding?.percentage || 0)) * direction;

      case 'funding_goal':
        return ((b.funding?.goal || b.fundingGoal || 0) - (a.funding?.goal || a.fundingGoal || 0)) * direction;

      case 'recent':
        const dateA = a.publishedAt ? (typeof a.publishedAt === 'object' && 'toMillis' in a.publishedAt ? a.publishedAt.toMillis() : new Date(a.publishedAt).getTime()) : 0;
        const dateB = b.publishedAt ? (typeof b.publishedAt === 'object' && 'toMillis' in b.publishedAt ? b.publishedAt.toMillis() : new Date(b.publishedAt).getTime()) : 0;
        return (dateB - dateA) * direction;

      case 'deadline':
        const deadlineA = a.deadline ? (typeof a.deadline === 'object' && 'toMillis' in a.deadline ? a.deadline.toMillis() : new Date(a.deadline).getTime()) : 0;
        const deadlineB = b.deadline ? (typeof b.deadline === 'object' && 'toMillis' in b.deadline ? b.deadline.toMillis() : new Date(b.deadline).getTime()) : 0;
        return (deadlineA - deadlineB) * direction;

      case 'popularity':
        const popA = (a.stats?.views || a.analytics?.views || 0) + (a.stats?.likes || 0) * 2 + (a.stats?.shares || a.analytics?.shares || 0) * 3;
        const popB = (b.stats?.views || b.analytics?.views || 0) + (b.stats?.likes || 0) * 2 + (b.stats?.shares || b.analytics?.shares || 0) * 3;
        return (popB - popA) * direction;

      default:
        return 0;
    }
  });
}

/**
 * Calcule un score de pertinence pour la recherche textuelle
 */
function calculateRelevanceScore(project: ProjectDocument, query: string): number {
  const searchTerms = query.toLowerCase().trim().split(/\s+/);
  let score = 0;

  searchTerms.forEach(term => {
    // Titre (poids 3)
    if (project.title.toLowerCase().includes(term)) {
      score += 3;
    }

    // Tags (poids 2)
    if ((project.tags || []).some(tag => tag.toLowerCase().includes(term))) {
      score += 2;
    }

    // Description courte (poids 2)
    if (project.shortDescription?.toLowerCase().includes(term)) {
      score += 2;
    }

    // Description complète (poids 1)
    if ((project.description || project.fullDescription || '').toLowerCase().includes(term)) {
      score += 1;
    }

    // Objectifs d'impact (poids 1)
    if (project.impactGoals?.primary?.toLowerCase().includes(term)) {
      score += 1;
    }
  });

  return score;
}

/**
 * Applique la pagination
 */
function applyPagination<T>(
  items: T[],
  page: number,
  limit: number
): { items: T[]; pagination: any } {
  const offset = (page - 1) * limit;
  const paginatedItems = items.slice(offset, offset + limit);
  
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / limit);

  return {
    items: paginatedItems,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage: limit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    }
  };
}

/**
 * Enrichit les projets avec les informations du créateur
 */
async function enrichWithCreatorInfo(
  projects: ProjectDocument[],
  includeCreator: boolean
): Promise<any[]> {
  if (!includeCreator || projects.length === 0) {
    return projects;
  }

  try {
    // Récupérer les infos des créateurs uniques
    const creatorUids = [...new Set(projects.map(p => p.creatorUid || p.creator?.uid).filter(Boolean))];
    const creators = await Promise.all(
      creatorUids.map(uid => uid ? firestoreHelper.getDocumentOptional('users', uid) : null)
    );

    const creatorsMap = new Map();
    creators.forEach(creator => {
      if (creator) {
        creatorsMap.set(creator.uid, {
          uid: creator.uid,
          displayName: creator.displayName,
          profilePicture: creator.profilePicture,
          bio: creator.bio,
          stats: {
            projectsCreated: creator.stats?.projectsCreated || 0,
            totalFundsRaised: creator.stats?.totalFundsRaised || 0,
            successfulProjects: creator.stats?.successfulProjects || 0,
          },
          verified: creator.kyc?.status === STATUS.KYC.APPROVED,
        });
      }
    });

    return projects.map(project => ({
      ...project,
      creator: creatorsMap.get(project.creatorUid || project.creator?.uid || '') || {
        uid: project.creatorUid || project.creator?.uid || '',
        displayName: project.creatorDisplayName || project.creator?.displayName || '',
        profilePicture: project.creatorAvatar || project.creator?.profilePicture,
        verified: false,
      }
    }));

  } catch (error) {
    logger.error('Failed to enrich projects with creator info', error);
    return projects; // Retourner sans enrichissement
  }
}

/**
 * Exécute la recherche de projets
 */
async function executeSearchProjects(
  data: ProjectsAPI.SearchProjectsRequest,
  context: CallableContext
): Promise<ProjectsAPI.SearchProjectsResponse> {
  // Construire les filtres Firestore
  const filters = buildFirestoreFilters(data);
  
  // Options de requête
  const queryOptions: any = {
    limit: 1000, // Limite élevée pour le post-processing côté client
  };

  // Ajouter le tri Firestore si possible
  if (data.sortBy === 'recent' && data.publishedSince) {
    queryOptions.orderBy = [{ field: 'publishedAt', direction: data.sortOrder }];
  } else if (data.sortBy === 'deadline') {
    queryOptions.orderBy = [{ field: 'deadline', direction: data.sortOrder }];
  } else if (data.sortBy === 'funding_goal') {
    queryOptions.orderBy = [{ field: 'fundingGoal', direction: data.sortOrder }];
  }

  // Exécuter la requête Firestore
  const projectsResult = await firestoreHelper.queryDocuments<ProjectDocument>(
    'projects',
    filters,
    queryOptions
  );

  // Post-processing côté client
  let projects = projectsResult.data;

  // Appliquer la recherche textuelle
  if (data.query) {
    projects = applyTextSearch(projects, data.query);
  }

  // Appliquer les filtres de tags
  if (data.tags && data.tags.length > 0) {
    projects = applyTagFilters(projects, data.tags);
  }

  // Trier les résultats
  projects = sortProjects(projects, data.sortBy, data.sortOrder, data.query);

  // Enrichir avec les stats si demandé
  if (data.includeStats) {
    // Calculs légers uniquement pour éviter les timeouts
    projects = projects.map(project => {
      const deadline = project.deadline || project.timeline?.endDate;
      const deadlineDate = deadline ? (typeof deadline === 'object' && 'toDate' in deadline ? deadline.toDate() : new Date(deadline)) : new Date();
      const publishedDate = project.publishedAt ? (typeof project.publishedAt === 'object' && 'toDate' in project.publishedAt ? project.publishedAt.toDate() : new Date(project.publishedAt)) : new Date();

      return {
        ...project,
        enrichedStats: {
          ...(project.stats || {}),
          daysRemaining: helpers.date.differenceInDays(new Date(), deadlineDate),
          fundingVelocity: project.publishedAt ?
            Math.round((project.funding?.raised || 0) / Math.max(helpers.date.differenceInDays(publishedDate, new Date()), 1)) : 0,
        }
      };
    });
  }

  // Enrichir avec les infos créateur
  const enrichedProjects = await enrichWithCreatorInfo(projects, data.includeCreator);

  // Appliquer la pagination
  const { items: paginatedProjects, pagination } = applyPagination(
    enrichedProjects,
    data.page,
    data.limit
  );

  // Calculer les agrégations pour les facettes
  const facets = calculateSearchFacets(projects);

  logger.info('Project search completed', {
    query: data.query,
    category: data.category,
    country: data.country,
    totalResults: projects.length,
    returnedResults: paginatedProjects.length,
    page: data.page,
    sortBy: data.sortBy,
  });

  return {
    projects: paginatedProjects,
    pagination,
    facets,
    totalResults: projects.length,
    searchQuery: data.query,
    appliedFilters: {
      category: data.category,
      tags: data.tags,
      country: data.country,
      region: data.region,
      fundingRange: data.fundingRange,
      fundingStatus: data.fundingStatus,
    },
    success: true,
  };
}

/**
 * Calcule les facettes pour affiner la recherche
 */
function calculateSearchFacets(projects: ProjectDocument[]): any {
  const facets: any = {
    categories: {},
    countries: {},
    fundingRanges: {
      '0-1000': 0,
      '1000-5000': 0,
      '5000-25000': 0,
      '25000-100000': 0,
      '100000+': 0,
    },
    tags: {},
  };

  projects.forEach(project => {
    // Catégories
    facets.categories[project.category] = (facets.categories[project.category] || 0) + 1;

    // Pays
    if (project.location?.country) {
      facets.countries[project.location.country] = (facets.countries[project.location.country] || 0) + 1;
    }

    // Fourchettes de financement
    const goal = helpers.amount.centsToEuros(project.funding?.goal || project.fundingGoal || 0);
    if (goal < 1000) {
      facets.fundingRanges['0-1000']++;
    } else if (goal < 5000) {
      facets.fundingRanges['1000-5000']++;
    } else if (goal < 25000) {
      facets.fundingRanges['5000-25000']++;
    } else if (goal < 100000) {
      facets.fundingRanges['25000-100000']++;
    } else {
      facets.fundingRanges['100000+']++;
    }

    // Tags populaires
    (project.tags || []).forEach(tag => {
      facets.tags[tag] = (facets.tags[tag] || 0) + 1;
    });
  });

  // Trier les tags par popularité et prendre les 20 premiers
  const sortedTags = Object.entries(facets.tags)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 20)
    .reduce((obj, [tag, count]) => {
      obj[tag] = count;
      return obj;
    }, {} as any);

  facets.tags = sortedTags;

  return facets;
}

/**
 * Optimise la requête pour de meilleures performances
 */
function optimizeQuery(searchCriteria: ProjectsAPI.SearchProjectsRequest): any {
  // Stratégies d'optimisation basées sur les filtres
  const optimizations = {
    useIndex: false,
    cacheable: false,
    estimatedComplexity: 'low',
  };

  // Requêtes simples peuvent utiliser les index
  if (searchCriteria.category && !searchCriteria.query && !searchCriteria.tags) {
    optimizations.useIndex = true;
    optimizations.cacheable = true;
  }

  // Requêtes sans recherche textuelle sont plus rapides
  if (!searchCriteria.query && !searchCriteria.tags) {
    optimizations.estimatedComplexity = 'low';
    optimizations.cacheable = true;
  } else {
    optimizations.estimatedComplexity = 'medium';
  }

  // Requêtes avec beaucoup de filtres sont complexes
  const filterCount = [
    searchCriteria.query,
    searchCriteria.category,
    searchCriteria.tags,
    searchCriteria.country,
    searchCriteria.fundingRange,
  ].filter(f => f !== undefined).length;

  if (filterCount > 3) {
    optimizations.estimatedComplexity = 'high';
    optimizations.cacheable = false;
  }

  return optimizations;
}

/**
 * Firebase Function principale
 */
export const searchProjects = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.SearchProjectsResponse> => {
    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.SearchProjectsRequest>(requestSchema, data);

    // Optimisation de la requête
    const queryOptimizations = optimizeQuery(validatedData);

    // Logging de démarrage
    logger.info('Searching projects', {
      functionName: 'searchProjects',
      uid: context.auth?.uid,
      query: validatedData.query,
      category: validatedData.category,
      country: validatedData.country,
      fundingStatus: validatedData.fundingStatus,
      sortBy: validatedData.sortBy,
      page: validatedData.page,
      limit: validatedData.limit,
      estimatedComplexity: queryOptimizations.estimatedComplexity,
    });

    // Exécution
    const result = await executeSearchProjects(validatedData, context);

    // Logging de succès
    logger.info('Project search completed successfully', {
      functionName: 'searchProjects',
      uid: context.auth?.uid,
      totalResults: result.totalResults,
      returnedResults: result.projects.length,
      page: validatedData.page,
      query: validatedData.query,
      category: validatedData.category,
      success: true,
    });

    return result;
  })
);