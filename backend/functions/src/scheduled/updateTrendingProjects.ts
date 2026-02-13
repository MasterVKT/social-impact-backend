/**
 * Update Trending Projects Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { ProjectDocument, ContributionDocument, UserDocument } from '../types/firestore';
import { STATUS, TRENDING_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les métriques de projet
 */
interface ProjectMetrics {
  projectId: string;
  contributionsCount: number;
  contributionsAmount: number;
  uniqueContributors: number;
  growthRate: number;
  momentum: number;
  socialEngagement: number;
  recency: number;
  categoryRanking: number;
  trendingScore: number;
  previousScore?: number;
}

/**
 * Interface pour les données de tendance
 */
interface TrendingData {
  projectId: string;
  slug: string;
  title: string;
  category: string;
  currentFunding: number;
  fundingGoal: number;
  fundingPercentage: number;
  contributorsCount: number;
  trendingScore: number;
  rank: number;
  trend: 'rising' | 'stable' | 'falling';
  metadata: {
    growthRate: number;
    momentum: number;
    socialEngagement: number;
    recency: number;
    categoryRank: number;
    scoreChange: number;
  };
  lastUpdated: Date;
}

/**
 * Interface pour les résultats de mise à jour
 */
interface TrendingUpdateResults {
  totalProjectsAnalyzed: number;
  trendingProjectsUpdated: number;
  categoriesUpdated: number;
  errors: number;
  processingTime: number;
  batchId: string;
  topTrendingProjects: TrendingData[];
  categoryBreakdown: Record<string, number>;
}

/**
 * Récupère les projets éligibles pour l'analyse de tendance
 */
async function getEligibleProjects(): Promise<ProjectDocument[]> {
  try {
    // Récupérer les projets actifs avec financement ouvert
    const activeProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['status', '==', STATUS.PROJECT.ACTIVE],
        ['fundingStatus', 'in', ['open', 'closing_soon']]
      ],
      { 
        limit: TRENDING_CONFIG.MAX_PROJECTS_TO_ANALYZE,
        orderBy: [{ field: 'createdAt', direction: 'desc' }]
      }
    );

    logger.info('Eligible projects for trending analysis retrieved', {
      totalProjects: activeProjects.data.length,
      maxAnalysisLimit: TRENDING_CONFIG.MAX_PROJECTS_TO_ANALYZE
    });

    return activeProjects.data;

  } catch (error) {
    logger.error('Failed to get eligible projects for trending analysis', error);
    throw error;
  }
}

/**
 * Calcule les métriques de tendance pour un projet
 */
async function calculateProjectMetrics(project: ProjectDocument): Promise<ProjectMetrics> {
  try {
    const now = new Date();
    const analysisWindow = new Date(now.getTime() - TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);
    const previousWindow = new Date(analysisWindow.getTime() - TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000);

    // Récupérer les contributions récentes
    const [recentContributions, previousContributions] = await Promise.all([
      firestoreHelper.queryDocuments<ContributionDocument>(
        'contributions',
        [
          ['projectId', '==', project.id],
          ['confirmedAt', '>=', analysisWindow],
          ['status', '==', 'confirmed']
        ]
      ),
      firestoreHelper.queryDocuments<ContributionDocument>(
        'contributions',
        [
          ['projectId', '==', project.id],
          ['confirmedAt', '>=', previousWindow],
          ['confirmedAt', '<', analysisWindow],
          ['status', '==', 'confirmed']
        ]
      )
    ]);

    // Métriques de base
    const contributionsCount = recentContributions.data.length;
    const contributionsAmount = recentContributions.data.reduce((sum, contrib) => sum + contrib.amount, 0);
    const uniqueContributors = new Set(recentContributions.data.map(contrib => contrib.contributorUid)).size;

    // Calcul du taux de croissance
    const previousAmount = previousContributions.data.reduce((sum, contrib) => sum + contrib.amount, 0);
    const growthRate = previousAmount > 0 
      ? ((contributionsAmount - previousAmount) / previousAmount) * 100
      : contributionsAmount > 0 ? 100 : 0;

    // Calcul du momentum (accélération des contributions)
    const timeSlots = 4; // Diviser la période en 4 tranches
    const slotDuration = TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS / timeSlots * 60 * 60 * 1000;
    
    const momentumData: number[] = [];
    for (let i = 0; i < timeSlots; i++) {
      const slotStart = new Date(analysisWindow.getTime() + i * slotDuration);
      const slotEnd = new Date(slotStart.getTime() + slotDuration);
      
      const slotContributions = recentContributions.data.filter(contrib =>
        contrib.confirmedAt >= slotStart && contrib.confirmedAt < slotEnd
      );
      
      momentumData.push(slotContributions.reduce((sum, contrib) => sum + contrib.amount, 0));
    }

    // Calculer la tendance (régression linéaire simple)
    let momentum = 0;
    if (momentumData.length >= 2) {
      const avgIndex = (momentumData.length - 1) / 2;
      const avgAmount = momentumData.reduce((sum, amount) => sum + amount, 0) / momentumData.length;
      
      let numerator = 0;
      let denominator = 0;
      
      momentumData.forEach((amount, index) => {
        numerator += (index - avgIndex) * (amount - avgAmount);
        denominator += Math.pow(index - avgIndex, 2);
      });
      
      momentum = denominator > 0 ? numerator / denominator : 0;
    }

    // Calcul de l'engagement social (vues, partages, commentaires)
    const socialEngagement = await calculateSocialEngagement(project.id, analysisWindow);

    // Facteur de récence (projets récents ont un bonus)
    const daysSinceCreation = Math.floor((now.getTime() - project.createdAt.getTime()) / (24 * 60 * 60 * 1000));
    const recency = Math.max(0, 100 - daysSinceCreation); // Plus récent = score plus élevé

    // Récupérer le rang dans la catégorie
    const categoryRanking = await getCategoryRanking(project.id, project.category);

    // Calcul du score de tendance final
    const trendingScore = calculateTrendingScore({
      contributionsCount,
      contributionsAmount,
      uniqueContributors,
      growthRate,
      momentum,
      socialEngagement,
      recency,
      categoryRanking,
      fundingPercentage: (project.currentFunding / project.fundingGoal) * 100
    });

    const metrics: ProjectMetrics = {
      projectId: project.id,
      contributionsCount,
      contributionsAmount,
      uniqueContributors,
      growthRate,
      momentum,
      socialEngagement,
      recency,
      categoryRanking,
      trendingScore,
      previousScore: project.trendingScore
    };

    logger.info('Project metrics calculated', {
      projectId: project.id,
      title: project.title,
      trendingScore,
      growthRate,
      momentum,
      contributionsCount,
      uniqueContributors
    });

    return metrics;

  } catch (error) {
    logger.error('Failed to calculate project metrics', error, { projectId: project.id });
    throw error;
  }
}

/**
 * Calcule l'engagement social pour un projet
 */
async function calculateSocialEngagement(projectId: string, since: Date): Promise<number> {
  try {
    // Récupérer les événements d'engagement social récents
    const engagementEvents = await firestoreHelper.queryDocuments<any>(
      'project_analytics',
      [
        ['projectId', '==', projectId],
        ['eventType', 'in', ['view', 'share', 'comment', 'like', 'bookmark']],
        ['timestamp', '>=', since]
      ]
    );

    // Pondérer les différents types d'engagement
    const weights = {
      view: 1,
      like: 2,
      bookmark: 3,
      comment: 4,
      share: 5
    };

    const engagementScore = engagementEvents.data.reduce((score, event) => {
      const weight = weights[event.eventType as keyof typeof weights] || 1;
      return score + weight;
    }, 0);

    // Normaliser le score (0-100)
    return Math.min(100, Math.round(engagementScore / 10));

  } catch (error) {
    logger.error('Failed to calculate social engagement', error, { projectId });
    return 0;
  }
}

/**
 * Récupère le rang dans la catégorie
 */
async function getCategoryRanking(projectId: string, category: string): Promise<number> {
  try {
    // Récupérer tous les projets de la même catégorie
    const categoryProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['category', '==', category],
        ['status', '==', STATUS.PROJECT.ACTIVE],
        ['fundingStatus', 'in', ['open', 'closing_soon']]
      ],
      { orderBy: [{ field: 'currentFunding', direction: 'desc' }] }
    );

    const projectIndex = categoryProjects.data.findIndex(p => p.id === projectId);

    if (projectIndex === -1) {
      return 0;
    }

    // Convertir le rang en score (1er = 100, dernier = 0)
    const rank = projectIndex + 1;
    const totalProjects = categoryProjects.data.length;
    
    return Math.round(((totalProjects - rank + 1) / totalProjects) * 100);

  } catch (error) {
    logger.error('Failed to get category ranking', error, { projectId, category });
    return 50; // Score neutre en cas d'erreur
  }
}

/**
 * Calcule le score de tendance final
 */
function calculateTrendingScore(data: {
  contributionsCount: number;
  contributionsAmount: number;
  uniqueContributors: number;
  growthRate: number;
  momentum: number;
  socialEngagement: number;
  recency: number;
  categoryRanking: number;
  fundingPercentage: number;
}): number {
  // Pondérations pour chaque facteur
  const weights = {
    contributions: 0.2,      // 20% - Nombre de contributions
    amount: 0.15,           // 15% - Montant des contributions
    contributors: 0.15,     // 15% - Diversité des contributeurs
    growth: 0.15,           // 15% - Taux de croissance
    momentum: 0.1,          // 10% - Momentum/accélération
    social: 0.1,            // 10% - Engagement social
    recency: 0.05,          // 5% - Récence du projet
    category: 0.05,         // 5% - Rang dans la catégorie
    funding: 0.05           // 5% - Progression du financement
  };

  // Normaliser chaque métrique (0-100)
  const normalizedMetrics = {
    contributions: Math.min(100, (data.contributionsCount / 20) * 100), // Max 20 contributions
    amount: Math.min(100, (data.contributionsAmount / 100000) * 100),   // Max €1000
    contributors: Math.min(100, (data.uniqueContributors / 15) * 100),  // Max 15 contributeurs
    growth: Math.min(100, Math.max(0, data.growthRate + 50)),           // -50% à +50% = 0-100
    momentum: Math.min(100, Math.max(0, (data.momentum / 1000) * 100)), // Normalisation momentum
    social: data.socialEngagement,                                       // Déjà 0-100
    recency: data.recency,                                              // Déjà 0-100
    category: data.categoryRanking,                                     // Déjà 0-100
    funding: Math.min(100, data.fundingPercentage)                     // 0-100%
  };

  // Calcul du score pondéré
  const weightedScore = Object.entries(weights).reduce((score, [key, weight]) => {
    const metricValue = normalizedMetrics[key as keyof typeof normalizedMetrics];
    return score + (metricValue * weight);
  }, 0);

  // Arrondir le score final
  return Math.round(Math.max(0, Math.min(100, weightedScore)));
}

/**
 * Met à jour les données de tendance d'un projet
 */
async function updateProjectTrendingData(
  project: ProjectDocument,
  metrics: ProjectMetrics
): Promise<void> {
  try {
    const now = new Date();
    
    // Déterminer la tendance par rapport au score précédent
    let trend: 'rising' | 'stable' | 'falling' = 'stable';
    let scoreChange = 0;

    if (metrics.previousScore !== undefined) {
      scoreChange = metrics.trendingScore - metrics.previousScore;
      if (scoreChange > TRENDING_CONFIG.SIGNIFICANT_CHANGE_THRESHOLD) {
        trend = 'rising';
      } else if (scoreChange < -TRENDING_CONFIG.SIGNIFICANT_CHANGE_THRESHOLD) {
        trend = 'falling';
      }
    }

    // Mettre à jour le projet avec les nouvelles données
    await firestoreHelper.updateDocument('projects', project.id, {
      trendingScore: metrics.trendingScore,
      trendingRank: 0, // Sera mis à jour lors du classement final
      trendingTrend: trend,
      trendingScoreChange: scoreChange,
      'trendingData.growthRate': metrics.growthRate,
      'trendingData.momentum': metrics.momentum,
      'trendingData.socialEngagement': metrics.socialEngagement,
      'trendingData.contributionsCount': metrics.contributionsCount,
      'trendingData.uniqueContributors': metrics.uniqueContributors,
      'trendingData.lastUpdated': now,
      'trendingData.analysisWindow': TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS,
      updatedAt: now
    });

    logger.info('Project trending data updated', {
      projectId: project.id,
      previousScore: metrics.previousScore,
      newScore: metrics.trendingScore,
      scoreChange,
      trend,
      growthRate: metrics.growthRate
    });

  } catch (error) {
    logger.error('Failed to update project trending data', error, {
      projectId: project.id,
      trendingScore: metrics.trendingScore
    });
    throw error;
  }
}

/**
 * Met à jour le classement global des projets tendance
 */
async function updateGlobalTrendingRankings(): Promise<TrendingData[]> {
  try {
    // Récupérer tous les projets avec scores de tendance
    const allProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['status', '==', STATUS.PROJECT.ACTIVE],
        ['trendingScore', '>', 0]
      ],
      { 
        limit: 500,
        orderBy: [{ field: 'trendingScore', direction: 'desc' }]
      }
    );

    const trendingData: TrendingData[] = [];
    const categoryRanks = new Map<string, number>();

    // Créer les données de tendance et mettre à jour les rangs
    for (let i = 0; i < allProjects.data.length; i++) {
      const project = allProjects.data[i];
      const globalRank = i + 1;

      // Calculer le rang dans la catégorie
      const categoryCount = categoryRanks.get(project.category) || 0;
      categoryRanks.set(project.category, categoryCount + 1);
      const categoryRank = categoryCount + 1;

      const trending: TrendingData = {
        projectId: project.id,
        slug: project.slug,
        title: project.title,
        category: project.category,
        currentFunding: project.currentFunding,
        fundingGoal: project.fundingGoal,
        fundingPercentage: Math.round((project.currentFunding / project.fundingGoal) * 100),
        contributorsCount: project.stats?.contributorsCount || 0,
        trendingScore: project.trendingScore || 0,
        rank: globalRank,
        trend: project.trendingTrend || 'stable',
        metadata: {
          growthRate: project.trendingData?.growthRate || 0,
          momentum: project.trendingData?.momentum || 0,
          socialEngagement: project.trendingData?.socialEngagement || 0,
          recency: Math.max(0, 100 - Math.floor((Date.now() - project.createdAt.getTime()) / (24 * 60 * 60 * 1000))),
          categoryRank,
          scoreChange: project.trendingScoreChange || 0
        },
        lastUpdated: new Date()
      };

      trendingData.push(trending);

      // Mettre à jour le rang du projet
      await firestoreHelper.updateDocument('projects', project.id, {
        trendingRank: globalRank,
        trendingCategoryRank: categoryRank
      });
    }

    // Sauvegarder le classement global
    await firestoreHelper.setDocument('platform_data', 'trending_projects', {
      lastUpdated: new Date(),
      totalProjects: allProjects.data.length,
      analysisWindow: TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS,
      topTrending: trendingData.slice(0, TRENDING_CONFIG.TOP_TRENDING_COUNT),
      byCategory: Object.fromEntries(
        Array.from(categoryRanks.entries()).map(([category, count]) => [
          category,
          {
            projectsCount: count,
            topProjects: trendingData
              .filter(td => td.category === category)
              .slice(0, 10)
              .map(td => ({
                projectId: td.projectId,
                title: td.title,
                score: td.trendingScore,
                rank: td.metadata.categoryRank
              }))
          }
        ])
      ),
      createdAt: new Date()
    });

    logger.info('Global trending rankings updated', {
      totalProjects: allProjects.data.length,
      categoriesUpdated: categoryRanks.size,
      topScore: trendingData[0]?.trendingScore || 0,
      topProject: trendingData[0]?.title || 'N/A'
    });

    return trendingData;

  } catch (error) {
    logger.error('Failed to update global trending rankings', error);
    throw error;
  }
}

/**
 * Met à jour les tendances par catégorie
 */
async function updateCategoryTrends(): Promise<Record<string, any>> {
  try {
    const categories = ['environment', 'education', 'health', 'community', 'technology'];
    const categoryTrends: Record<string, any> = {};

    for (const category of categories) {
      try {
        // Récupérer les projets de la catégorie avec leurs métriques
        const categoryProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
          'projects',
          [
            ['category', '==', category],
            ['status', '==', STATUS.PROJECT.ACTIVE],
            ['trendingScore', '>', 0]
          ],
          { 
            limit: 50,
            orderBy: [{ field: 'trendingScore', direction: 'desc' }]
          }
        );

        if (categoryProjects.data.length === 0) {
          continue;
        }

        // Calculer les statistiques de la catégorie
        const totalFunding = categoryProjects.data.reduce((sum, p) => sum + p.currentFunding, 0);
        const avgScore = categoryProjects.data.reduce((sum, p) => sum + (p.trendingScore || 0), 0) / categoryProjects.data.length;
        const avgGrowth = categoryProjects.data.reduce((sum, p) => sum + (p.trendingData?.growthRate || 0), 0) / categoryProjects.data.length;

        // Identifier les projets en forte croissance
        const risingProjects = categoryProjects.data.filter(p => p.trendingTrend === 'rising').length;
        const stableProjects = categoryProjects.data.filter(p => p.trendingTrend === 'stable').length;
        const fallingProjects = categoryProjects.data.filter(p => p.trendingTrend === 'falling').length;

        categoryTrends[category] = {
          totalProjects: categoryProjects.data.length,
          totalFunding,
          averageScore: Math.round(avgScore),
          averageGrowthRate: Math.round(avgGrowth * 100) / 100,
          distribution: {
            rising: risingProjects,
            stable: stableProjects,
            falling: fallingProjects
          },
          topProjects: categoryProjects.data.slice(0, 5).map(p => ({
            projectId: p.id,
            title: p.title,
            score: p.trendingScore,
            trend: p.trendingTrend,
            fundingPercentage: Math.round((p.currentFunding / p.fundingGoal) * 100)
          })),
          lastUpdated: new Date()
        };

      } catch (error) {
        logger.error('Failed to update category trend', error, { category });
        categoryTrends[category] = {
          error: 'Failed to analyze category',
          lastUpdated: new Date()
        };
      }
    }

    // Sauvegarder les tendances par catégorie
    await firestoreHelper.setDocument('platform_data', 'category_trends', {
      lastUpdated: new Date(),
      analysisWindow: TRENDING_CONFIG.ANALYSIS_WINDOW_HOURS,
      categories: categoryTrends,
      summary: {
        totalCategories: Object.keys(categoryTrends).length,
        mostActivePCategory: Object.entries(categoryTrends)
          .filter(([_, data]) => !data.error)
          .sort((a, b) => (b[1].totalProjects || 0) - (a[1].totalProjects || 0))[0]?.[0] || 'N/A',
        fastestGrowingCategory: Object.entries(categoryTrends)
          .filter(([_, data]) => !data.error)
          .sort((a, b) => (b[1].averageGrowthRate || 0) - (a[1].averageGrowthRate || 0))[0]?.[0] || 'N/A'
      },
      createdAt: new Date()
    });

    logger.info('Category trends updated', {
      categoriesAnalyzed: Object.keys(categoryTrends).length,
      totalProjectsAcrossCategories: Object.values(categoryTrends).reduce((sum, cat: any) => sum + (cat.totalProjects || 0), 0)
    });

    return categoryTrends;

  } catch (error) {
    logger.error('Failed to update category trends', error);
    return {};
  }
}

/**
 * Identifie et notifie les créateurs de projets en forte progression
 */
async function notifyTrendingCreators(trendingData: TrendingData[]): Promise<void> {
  try {
    // Identifier les projets avec forte progression (top 10% ou score > 80)
    const significantlyTrending = trendingData.filter(td => 
      td.rank <= Math.max(10, trendingData.length * 0.1) || td.trendingScore >= 80
    );

    if (significantlyTrending.length === 0) {
      return;
    }

    const notificationPromises = significantlyTrending.map(async (trending) => {
      try {
        const project = await firestoreHelper.getDocument<ProjectDocument>('projects', trending.projectId);
        if (!project) return;

        const creator = await firestoreHelper.getDocument<UserDocument>('users', project.creatorUid);
        if (!creator) return;

        // Créer notification pour le créateur
        const notificationId = helpers.string.generateId('notif');
        await firestoreHelper.setDocument('notifications', notificationId, {
          id: notificationId,
          recipientUid: creator.uid,
          senderUid: 'system',
          type: 'project_trending',
          title: `🔥 Votre projet "${project.title}" est en tendance !`,
          message: `Félicitations ! Votre projet est classé #${trending.rank} dans les projets tendance avec un score de ${trending.trendingScore}/100.`,
          data: {
            projectId: project.id,
            projectSlug: project.slug,
            trendingRank: trending.rank,
            trendingScore: trending.trendingScore,
            scoreChange: trending.metadata.scoreChange,
            trend: trending.trend,
            categoryRank: trending.metadata.categoryRank,
            category: trending.category,
            suggestions: [
              'Partagez cette excellente nouvelle sur vos réseaux sociaux',
              'Mettez à jour votre projet avec du nouveau contenu',
              'Répondez aux commentaires de vos contributeurs',
              'Préparez une mise à jour sur vos progrès'
            ]
          },
          priority: 'medium',
          actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
          read: false,
          readAt: null,
          delivered: true,
          deliveredAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1
        });

        // Mettre à jour le compteur de notifications
        await firestoreHelper.updateDocument('users', creator.uid, {
          'notificationCounters.unread': firestoreHelper.increment(1),
          'notificationCounters.total': firestoreHelper.increment(1)
        });

        logger.info('Trending notification sent to creator', {
          creatorUid: creator.uid,
          projectId: project.id,
          trendingRank: trending.rank,
          trendingScore: trending.trendingScore
        });

      } catch (error) {
        logger.error('Failed to notify trending creator', error, {
          projectId: trending.projectId,
          rank: trending.rank
        });
      }
    });

    await Promise.allSettled(notificationPromises);

    logger.info('Trending creators notified', {
      projectsNotified: significantlyTrending.length,
      topRank: significantlyTrending[0]?.rank || 'N/A',
      topScore: significantlyTrending[0]?.trendingScore || 'N/A'
    });

  } catch (error) {
    logger.error('Failed to notify trending creators', error);
  }
}

/**
 * Met à jour les métriques de tendances
 */
async function updateTrendingMetrics(results: TrendingUpdateResults): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'trending.totalAnalyses': results.totalProjectsAnalyzed,
      'trending.lastUpdate': new Date(),
      'trending.processingTime': results.processingTime
    });

    // Statistiques par catégorie
    for (const [category, count] of Object.entries(results.categoryBreakdown)) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', {
        [`trending.byCategory.${category}`]: count
      });
    }

    // Sauvegarder les métriques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.setDocument('platform_stats', `trending_${monthKey}`, {
      month: monthKey,
      projectsAnalyzed: results.totalProjectsAnalyzed,
      trendingProjectsUpdated: results.trendingProjectsUpdated,
      categoriesUpdated: results.categoriesUpdated,
      processingTime: results.processingTime,
      batchId: results.batchId,
      categoryBreakdown: results.categoryBreakdown,
      topTrendingSnapshots: results.topTrendingProjects.slice(0, 10),
      updatedAt: new Date()
    });

    logger.info('Trending metrics updated', {
      ...results,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update trending metrics', error);
  }
}

/**
 * Traite la mise à jour complète des tendances
 */
async function processTrendingUpdate(): Promise<TrendingUpdateResults> {
  const batchId = helpers.string.generateId('trending_batch');
  const startTime = Date.now();

  const results: TrendingUpdateResults = {
    totalProjectsAnalyzed: 0,
    trendingProjectsUpdated: 0,
    categoriesUpdated: 0,
    errors: 0,
    processingTime: 0,
    batchId,
    topTrendingProjects: [],
    categoryBreakdown: {}
  };

  try {
    // Récupérer les projets éligibles
    const eligibleProjects = await getEligibleProjects();
    results.totalProjectsAnalyzed = eligibleProjects.length;

    if (eligibleProjects.length === 0) {
      logger.info('No eligible projects for trending analysis');
      return results;
    }

    // Calculer les métriques pour chaque projet
    const metricsPromises = eligibleProjects.map(async (project) => {
      try {
        const metrics = await calculateProjectMetrics(project);
        await updateProjectTrendingData(project, metrics);
        
        // Compter par catégorie
        results.categoryBreakdown[project.category] = (results.categoryBreakdown[project.category] || 0) + 1;
        results.trendingProjectsUpdated++;
        
        return { project, metrics };

      } catch (error) {
        logger.error('Failed to process project metrics', error, { projectId: project.id });
        results.errors++;
        return null;
      }
    });

    // Traiter par lots pour éviter la surcharge
    const batchSize = 10;
    for (let i = 0; i < metricsPromises.length; i += batchSize) {
      const batch = metricsPromises.slice(i, i + batchSize);
      await Promise.allSettled(batch);
      
      // Pause entre les lots
      if (i + batchSize < metricsPromises.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Mettre à jour les classements globaux
    const trendingData = await updateGlobalTrendingRankings();
    results.topTrendingProjects = trendingData.slice(0, TRENDING_CONFIG.TOP_TRENDING_COUNT);

    // Mettre à jour les tendances par catégorie
    const categoryTrends = await updateCategoryTrends();
    results.categoriesUpdated = Object.keys(categoryTrends).length;

    // Notifier les créateurs de projets en forte progression
    await notifyTrendingCreators(trendingData.slice(0, 20)); // Top 20

    results.processingTime = Date.now() - startTime;

    logger.info('Trending update processing completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to process trending update', error, { batchId });
    results.errors++;
    return results;
  }
}

/**
 * Fonction Cloud Scheduler - Mise à jour des projets tendance
 */
export const updateTrendingProjects = pubsub
  .schedule('0 */6 * * *') // Toutes les 6 heures
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('trending_exec');
    const startTime = Date.now();

    try {
      logger.info('Update trending projects scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter la mise à jour des tendances
      const results = await processTrendingUpdate();

      // Log business
      logger.business('Trending projects updated', 'analytics', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalProjectsAnalyzed: results.totalProjectsAnalyzed,
        trendingProjectsUpdated: results.trendingProjectsUpdated,
        categoriesUpdated: results.categoriesUpdated,
        successRate: results.trendingProjectsUpdated / results.totalProjectsAnalyzed,
        timestamp: new Date().toISOString()
      });

      // Mettre à jour les métriques
      await updateTrendingMetrics(results);

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'updateTrendingProjects',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 heures
        createdAt: new Date()
      });

      logger.info('Update trending projects scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        projectsAnalyzed: results.totalProjectsAnalyzed,
        projectsUpdated: results.trendingProjectsUpdated
      });

    } catch (error) {
      logger.error('Update trending projects scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'updateTrendingProjects',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 30 * 60 * 1000), // Retry dans 30 minutes
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log trending execution failure', logError, { executionId });
      }

      throw error;
    }
  });