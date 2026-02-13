/**
 * Update Recommendations Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { UserDocument, ProjectDocument, ContributionDocument } from '../types/firestore';
import { STATUS, RECOMMENDATION_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour une recommandation générée
 */
interface GeneratedRecommendation {
  id: string;
  userId: string;
  userType: 'creator' | 'contributor' | 'auditor';
  type: 'project_match' | 'skill_opportunity' | 'impact_alignment' | 'performance_improvement';
  title: string;
  description: string;
  targetId: string; // ID du projet, audit, etc.
  score: number; // 0-100
  reasoning: string[];
  metadata: any;
  actionUrl: string;
  priority: 'low' | 'medium' | 'high';
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Interface pour les résultats d'analyse utilisateur
 */
interface UserAnalysis {
  userId: string;
  userType: 'creator' | 'contributor' | 'auditor';
  preferences: {
    categories: string[];
    impactAreas: string[];
    riskLevel: 'low' | 'medium' | 'high';
    contributionRange: { min: number; max: number };
  };
  behavior: {
    avgContributionAmount: number;
    preferredProjectTypes: string[];
    activityFrequency: 'low' | 'medium' | 'high';
    successRate: number;
    lastActivity: Date;
  };
  interestVector: Map<string, number>; // Scores par catégorie/type
}

/**
 * Interface pour les résultats de mise à jour
 */
interface RecommendationUpdateResults {
  totalUsers: number;
  usersProcessed: number;
  recommendationsGenerated: number;
  recommendationsExpired: number;
  errors: number;
  processingTime: number;
  batchId: string;
  byUserType: {
    creator: number;
    contributor: number;
    auditor: number;
  };
  byRecommendationType: {
    project_match: number;
    skill_opportunity: number;
    impact_alignment: number;
    performance_improvement: number;
  };
}

/**
 * Analyse le comportement et les préférences d'un utilisateur
 */
async function analyzeUserBehavior(user: UserDocument): Promise<UserAnalysis> {
  try {
    const now = new Date();
    const analysisWindow = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 jours

    let behavior: UserAnalysis['behavior'] = {
      avgContributionAmount: 0,
      preferredProjectTypes: [],
      activityFrequency: 'low',
      successRate: 0,
      lastActivity: user.stats?.lastActivity || user.createdAt
    };

    const interestVector = new Map<string, number>();

    if (user.userType === 'contributor') {
      // Analyser les contributions récentes
      const contributions = await firestoreHelper.queryDocuments<ContributionDocument>(
        'contributions',
        [
          ['contributorUid', '==', user.uid],
          ['confirmedAt', '>=', analysisWindow],
          ['status', '==', 'confirmed']
        ],
        { limit: 50 }
      );

      if (contributions.data.length > 0) {
        behavior.avgContributionAmount = contributions.data.reduce((sum, c) => sum + c.amount, 0) / contributions.data.length;

        // Analyser les catégories préférées
        const categoryFreq = new Map<string, number>();
        const projectTypeFreq = new Map<string, number>();

        for (const contrib of contributions.data) {
          try {
            const project = await firestoreHelper.getDocument<ProjectDocument>('projects', contrib.projectId);
            if (project) {
              categoryFreq.set(project.category, (categoryFreq.get(project.category) || 0) + contrib.amount);
              projectTypeFreq.set(project.type, (projectTypeFreq.get(project.type) || 0) + 1);
              
              // Construire le vecteur d'intérêt
              interestVector.set(project.category, (interestVector.get(project.category) || 0) + contrib.amount);
              interestVector.set(`${project.category}_${project.urgency}`, (interestVector.get(`${project.category}_${project.urgency}`) || 0) + 1);
            }
          } catch (error) {
            logger.error('Failed to analyze contribution project', error, { contributionId: contrib.id });
          }
        }

        behavior.preferredProjectTypes = Array.from(projectTypeFreq.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(entry => entry[0]);

        // Calculer la fréquence d'activité
        const daysActive = contributions.data.length > 1 ?
          Math.ceil((contributions.data[0].confirmedAt.getTime() - contributions.data[contributions.data.length - 1].confirmedAt.getTime()) / (24 * 60 * 60 * 1000)) : 1;

        const activityRate = contributions.data.length / Math.max(daysActive, 1);
        
        if (activityRate > 0.1) behavior.activityFrequency = 'high';
        else if (activityRate > 0.03) behavior.activityFrequency = 'medium';
        else behavior.activityFrequency = 'low';

        // Taux de succès basé sur les projets financés avec succès
        const successfulProjects = await Promise.all(
          contributions.data.map(async (contrib) => {
            try {
              const project = await firestoreHelper.getDocument<ProjectDocument>('projects', contrib.projectId);
              return project && project.status === STATUS.PROJECT.COMPLETED;
            } catch {
              return false;
            }
          })
        );
        behavior.successRate = successfulProjects.filter(Boolean).length / contributions.data.length;
      }
    }

    // Analyser les préférences explicites
    const preferences = {
      categories: user.preferences?.categories || [],
      impactAreas: user.preferences?.impactAreas || [],
      riskLevel: user.preferences?.riskLevel || 'medium',
      contributionRange: user.preferences?.contributionRange || { min: 10, max: 1000 }
    };

    // Enrichir les préférences avec les données comportementales
    if (behavior.preferredProjectTypes.length > 0) {
      preferences.categories = [...new Set([...preferences.categories, ...behavior.preferredProjectTypes])];
    }

    const analysis: UserAnalysis = {
      userId: user.uid,
      userType: user.userType,
      preferences,
      behavior,
      interestVector
    };

    logger.info('User behavior analysis completed', {
      userId: user.uid,
      userType: user.userType,
      contributionsAnalyzed: user.userType === 'contributor' ? 'analyzed' : 'n/a',
      interestCategories: Array.from(interestVector.keys()).length,
      activityFrequency: behavior.activityFrequency
    });

    return analysis;

  } catch (error) {
    logger.error('Failed to analyze user behavior', error, { userId: user.uid });
    throw error;
  }
}

/**
 * Génère des recommandations de projets pour un contributeur
 */
async function generateProjectRecommendations(analysis: UserAnalysis): Promise<GeneratedRecommendation[]> {
  if (analysis.userType !== 'contributor') {
    return [];
  }

  try {
    const recommendations: GeneratedRecommendation[] = [];
    const now = new Date();

    // Récupérer les projets actifs correspondant aux préférences
    const matchingProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['status', '==', STATUS.PROJECT.ACTIVE],
        ['fundingStatus', '==', 'open'],
        ['category', 'in', analysis.preferences.categories.length > 0 ? analysis.preferences.categories : ['environment', 'education', 'health']]
      ],
      { 
        limit: 20,
        orderBy: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }]
      }
    );

    // Vérifier que l'utilisateur n'a pas déjà contribué
    const userContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      'contributions',
      [
        ['contributorUid', '==', analysis.userId],
        ['status', 'in', ['pending', 'confirmed']]
      ]
    );
    const contributedProjectIds = new Set(userContributions.data.map(c => c.projectId));

    // Scorer chaque projet
    for (const project of matchingProjects.data) {
      if (contributedProjectIds.has(project.id)) {
        continue; // Skip les projets déjà contribués
      }

      let score = 0;
      const reasoning: string[] = [];

      // Score de correspondance de catégorie
      const categoryInterest = analysis.interestVector.get(project.category) || 0;
      if (categoryInterest > 0) {
        score += 30;
        reasoning.push(`Correspond à votre intérêt pour ${project.category}`);
      }

      // Score d'urgence
      if (project.urgency === 'high') {
        score += 25;
        reasoning.push('Projet à forte urgence sociale');
      } else if (project.urgency === 'medium') {
        score += 15;
      }

      // Score de montant correspondant
      const fundingNeeded = project.fundingGoal - project.currentFunding;
      if (fundingNeeded >= analysis.preferences.contributionRange.min && 
          fundingNeeded <= analysis.preferences.contributionRange.max * 2) {
        score += 20;
        reasoning.push('Montant de financement dans votre gamme');
      }

      // Score de performance du créateur
      if (project.creatorStats?.successRate && project.creatorStats.successRate > 0.8) {
        score += 15;
        reasoning.push('Créateur avec excellent historique');
      }

      // Score de proximité de l'objectif
      const fundingPercentage = (project.currentFunding / project.fundingGoal) * 100;
      if (fundingPercentage > 70) {
        score += 10;
        reasoning.push('Proche de l\'objectif de financement');
      }

      // Générer la recommandation si score suffisant
      if (score >= RECOMMENDATION_CONFIG.MIN_SCORE) {
        const recommendationId = helpers.string.generateId('rec');
        recommendations.push({
          id: recommendationId,
          userId: analysis.userId,
          userType: analysis.userType,
          type: 'project_match',
          title: `Projet recommandé: ${project.title}`,
          description: `Ce projet en ${project.category} correspond à vos intérêts et a besoin de €${Math.round(fundingNeeded / 100)} pour être financé.`,
          targetId: project.id,
          score,
          reasoning,
          metadata: {
            projectCategory: project.category,
            fundingNeeded,
            fundingPercentage: Math.round(fundingPercentage),
            urgency: project.urgency,
            matchedCategories: analysis.preferences.categories.filter(cat => cat === project.category)
          },
          actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
          priority: score > 80 ? 'high' : score > 60 ? 'medium' : 'low',
          expiresAt: new Date(now.getTime() + RECOMMENDATION_CONFIG.EXPIRES_AFTER_HOURS * 60 * 60 * 1000),
          createdAt: now
        });
      }
    }

    // Trier par score et limiter
    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, RECOMMENDATION_CONFIG.MAX_PER_USER);

  } catch (error) {
    logger.error('Failed to generate project recommendations', error, { userId: analysis.userId });
    return [];
  }
}

/**
 * Génère des recommandations d'opportunités pour un auditeur
 */
async function generateAuditorRecommendations(analysis: UserAnalysis): Promise<GeneratedRecommendation[]> {
  if (analysis.userType !== 'auditor') {
    return [];
  }

  try {
    const recommendations: GeneratedRecommendation[] = [];
    const now = new Date();

    // Récupérer les opportunités d'audit disponibles
    const availableAudits = await firestoreHelper.queryDocuments<any>(
      'audit_requests',
      [
        ['status', '==', 'pending_assignment'],
        ['deadline', '>', new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)] // Au moins 7 jours
      ],
      { limit: 20 }
    );

    const user = await firestoreHelper.getDocument<UserDocument>('users', analysis.userId);
    const userQualifications = user.qualifications || [];
    const userSpecializations = user.specializations || [];

    for (const audit of availableAudits.data) {
      let score = 0;
      const reasoning: string[] = [];

      // Score de correspondance des qualifications
      const matchingQualifications = audit.requiredQualifications?.filter((qual: string) => 
        userQualifications.includes(qual)
      ) || [];
      
      if (matchingQualifications.length > 0) {
        score += 40;
        reasoning.push(`Correspond à ${matchingQualifications.length} de vos qualifications`);
      }

      // Score de correspondance des spécialisations
      const matchingSpecializations = audit.preferredSpecializations?.filter((spec: string) =>
        userSpecializations.includes(spec)
      ) || [];

      if (matchingSpecializations.length > 0) {
        score += 30;
        reasoning.push(`Correspond à vos spécialisations en ${matchingSpecializations.join(', ')}`);
      }

      // Score de compensation
      if (audit.estimatedAmount >= user.minAuditFee && audit.estimatedAmount <= user.maxAuditFee * 1.5) {
        score += 20;
        reasoning.push('Compensation dans votre gamme préférée');
      }

      // Score de complexité
      if (audit.complexity && user.preferredComplexity) {
        if (audit.complexity === user.preferredComplexity) {
          score += 15;
          reasoning.push(`Complexité ${audit.complexity} correspondant à vos préférences`);
        }
      }

      // Score de disponibilité
      const daysUntilDeadline = Math.ceil((audit.deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysUntilDeadline >= 14) {
        score += 10;
        reasoning.push('Délai confortable pour l\'audit');
      }

      // Générer la recommandation si score suffisant
      if (score >= RECOMMENDATION_CONFIG.MIN_SCORE) {
        const recommendationId = helpers.string.generateId('rec');
        recommendations.push({
          id: recommendationId,
          userId: analysis.userId,
          userType: analysis.userType,
          type: 'skill_opportunity',
          title: `Opportunité d'audit: ${audit.projectTitle}`,
          description: `Audit ${audit.complexity || 'standard'} avec compensation de €${Math.round(audit.estimatedAmount / 100)}. Correspond à vos qualifications.`,
          targetId: audit.id,
          score,
          reasoning,
          metadata: {
            auditType: audit.type,
            complexity: audit.complexity,
            estimatedAmount: audit.estimatedAmount,
            deadline: audit.deadline,
            matchingQualifications,
            matchingSpecializations,
            daysUntilDeadline
          },
          actionUrl: `${process.env.FRONTEND_URL}/auditor/opportunities/${audit.id}`,
          priority: score > 80 ? 'high' : score > 60 ? 'medium' : 'low',
          expiresAt: new Date(Math.min(
            audit.deadline.getTime() - 24 * 60 * 60 * 1000, // 1 jour avant deadline
            now.getTime() + RECOMMENDATION_CONFIG.EXPIRES_AFTER_HOURS * 60 * 60 * 1000
          )),
          createdAt: now
        });
      }
    }

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, RECOMMENDATION_CONFIG.MAX_PER_USER);

  } catch (error) {
    logger.error('Failed to generate auditor recommendations', error, { userId: analysis.userId });
    return [];
  }
}

/**
 * Génère des recommandations d'amélioration pour un créateur
 */
async function generateCreatorRecommendations(analysis: UserAnalysis): Promise<GeneratedRecommendation[]> {
  if (analysis.userType !== 'creator') {
    return [];
  }

  try {
    const recommendations: GeneratedRecommendation[] = [];
    const now = new Date();

    // Récupérer les projets du créateur
    const userProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [['creatorUid', '==', analysis.userId]],
      { limit: 20 }
    );

    for (const project of userProjects.data) {
      const reasoning: string[] = [];
      let score = 0;

      // Analyser les performances du projet
      const fundingPercentage = (project.currentFunding / project.fundingGoal) * 100;
      
      if (project.status === STATUS.PROJECT.ACTIVE) {
        // Recommandations pour projets actifs sous-performants
        if (fundingPercentage < 25) {
          score = 70;
          reasoning.push('Projet nécessite plus de visibilité');
          reasoning.push('Taux de financement faible');
          
          const recommendationId = helpers.string.generateId('rec');
          recommendations.push({
            id: recommendationId,
            userId: analysis.userId,
            userType: analysis.userType,
            type: 'performance_improvement',
            title: `Boostez votre projet "${project.title}"`,
            description: `Votre projet n'a atteint que ${Math.round(fundingPercentage)}% de son objectif. Ajoutez des visuels et mises à jour pour attirer plus de contributeurs.`,
            targetId: project.id,
            score,
            reasoning,
            metadata: {
              currentFunding: project.currentFunding,
              fundingGoal: project.fundingGoal,
              fundingPercentage: Math.round(fundingPercentage),
              suggestions: [
                'add_visuals',
                'update_description',
                'share_progress',
                'engage_community'
              ]
            },
            actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/edit`,
            priority: 'high',
            expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 jours
            createdAt: now
          });
        }

        // Recommandations pour projets proches de l'objectif
        if (fundingPercentage >= 80 && fundingPercentage < 100) {
          score = 80;
          reasoning.push('Projet proche de son objectif');
          reasoning.push('Dernière ligne droite de financement');
          
          const recommendationId = helpers.string.generateId('rec');
          recommendations.push({
            id: recommendationId,
            userId: analysis.userId,
            userType: analysis.userType,
            type: 'performance_improvement',
            title: `Dernière ligne droite pour "${project.title}"`,
            description: `Plus que €${Math.round((project.fundingGoal - project.currentFunding) / 100)} pour atteindre l'objectif ! Partagez votre projet sur les réseaux sociaux.`,
            targetId: project.id,
            score,
            reasoning,
            metadata: {
              remainingAmount: project.fundingGoal - project.currentFunding,
              fundingPercentage: Math.round(fundingPercentage),
              suggestions: [
                'social_media_share',
                'contact_network',
                'create_urgency',
                'thank_contributors'
              ]
            },
            actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/promote`,
            priority: 'high',
            expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), // 3 jours
            createdAt: now
          });
        }
      }

      // Recommandations pour créer de nouveaux projets
      if (project.status === STATUS.PROJECT.COMPLETED && project.auditScore && project.auditScore >= 85) {
        score = 60;
        reasoning.push('Projet précédent réussi avec excellente note');
        reasoning.push('Créateur expérimenté');
        
        const recommendationId = helpers.string.generateId('rec');
        recommendations.push({
          id: recommendationId,
          userId: analysis.userId,
          userType: analysis.userType,
          type: 'impact_alignment',
          title: 'Créez votre prochain projet d\'impact',
          description: `Votre projet "${project.title}" a été un succès (note: ${project.auditScore}/100). Lancez votre prochain projet d'impact social !`,
          targetId: 'new_project',
          score,
          reasoning,
          metadata: {
            previousProjectSuccess: true,
            previousAuditScore: project.auditScore,
            suggestedCategories: analysis.preferences.categories,
            experienceLevel: 'advanced'
          },
          actionUrl: `${process.env.FRONTEND_URL}/projects/create`,
          priority: 'medium',
          expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), // 30 jours
          createdAt: now
        });
      }
    }

    return recommendations;

  } catch (error) {
    logger.error('Failed to generate creator recommendations', error, { userId: analysis.userId });
    return [];
  }
}

/**
 * Génère des recommandations d'alignement d'impact basées sur les tendances
 */
async function generateImpactAlignmentRecommendations(analysis: UserAnalysis): Promise<GeneratedRecommendation[]> {
  try {
    const recommendations: GeneratedRecommendation[] = [];
    const now = new Date();

    // Récupérer les tendances d'impact récentes
    const impactTrends = await firestoreHelper.getDocument<any>('platform_stats', 'impact_trends');
    
    if (!impactTrends || !impactTrends.categories) {
      return [];
    }

    // Analyser les catégories en croissance qui correspondent aux intérêts
    const growingCategories = Object.entries(impactTrends.categories)
      .filter(([category, data]: [string, any]) => 
        data.growthRate > 0.1 && // Croissance de +10%
        (analysis.preferences.categories.includes(category) || analysis.interestVector.has(category))
      )
      .sort((a: [string, any], b: [string, any]) => b[1].growthRate - a[1].growthRate)
      .slice(0, 3);

    for (const [category, trendData] of growingCategories) {
      const score = 65 + Math.round(trendData.growthRate * 100); // Score basé sur la croissance
      const reasoning = [
        `Catégorie ${category} en forte croissance (+${Math.round(trendData.growthRate * 100)}%)`,
        'Correspond à vos centres d\'intérêt',
        'Opportunité d\'impact élevé'
      ];

      const recommendationId = helpers.string.generateId('rec');
      recommendations.push({
        id: recommendationId,
        userId: analysis.userId,
        userType: analysis.userType,
        type: 'impact_alignment',
        title: `Tendance d'impact: ${category}`,
        description: `Les projets en ${category} connaissent une forte croissance (+${Math.round(trendData.growthRate * 100)}%). C'est le moment idéal pour ${analysis.userType === 'creator' ? 'créer' : 'contribuer à'} un projet dans ce domaine.`,
        targetId: category,
        score,
        reasoning,
        metadata: {
          category,
          growthRate: trendData.growthRate,
          activeProjects: trendData.activeProjects,
          avgFundingSuccess: trendData.avgFundingSuccess,
          trendAnalysisPeriod: '30_days'
        },
        actionUrl: analysis.userType === 'creator' 
          ? `${process.env.FRONTEND_URL}/projects/create?category=${category}`
          : `${process.env.FRONTEND_URL}/explore?category=${category}`,
        priority: score > 80 ? 'high' : 'medium',
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 jours
        createdAt: now
      });
    }

    return recommendations;

  } catch (error) {
    logger.error('Failed to generate impact alignment recommendations', error, { userId: analysis.userId });
    return [];
  }
}

/**
 * Sauvegarde les recommandations dans le cache
 */
async function saveRecommendationsToCache(
  userId: string,
  recommendations: GeneratedRecommendation[]
): Promise<void> {
  try {
    if (recommendations.length === 0) {
      return;
    }

    const cacheId = `${userId}_${Date.now()}`;
    
    await firestoreHelper.setDocument('recommendation_cache', cacheId, {
      id: cacheId,
      userId,
      recommendations,
      totalCount: recommendations.length,
      byType: recommendations.reduce((counts, rec) => {
        counts[rec.type] = (counts[rec.type] || 0) + 1;
        return counts;
      }, {} as Record<string, number>),
      byPriority: recommendations.reduce((counts, rec) => {
        counts[rec.priority] = (counts[rec.priority] || 0) + 1;
        return counts;
      }, {} as Record<string, number>),
      expiresAt: new Date(Date.now() + RECOMMENDATION_CONFIG.CACHE_TTL_HOURS * 60 * 60 * 1000),
      createdAt: new Date(),
      version: 1
    });

    // Mettre à jour les statistiques utilisateur
    await firestoreHelper.updateDocument('users', userId, {
      'recommendationStats.lastUpdate': new Date(),
      'recommendationStats.totalGenerated': firestoreHelper.increment(recommendations.length),
      'recommendationStats.lastCount': recommendations.length
    });

    logger.info('Recommendations saved to cache', {
      userId,
      cacheId,
      recommendationsCount: recommendations.length,
      expirationTime: RECOMMENDATION_CONFIG.CACHE_TTL_HOURS
    });

  } catch (error) {
    logger.error('Failed to save recommendations to cache', error, {
      userId,
      recommendationsCount: recommendations.length
    });
  }
}

/**
 * Supprime les anciennes recommandations expirées
 */
async function cleanupExpiredRecommendations(): Promise<number> {
  try {
    const now = new Date();
    
    // Récupérer les recommandations expirées
    const expiredRecommendations = await firestoreHelper.queryDocuments<any>(
      'recommendation_cache',
      [
        ['expiresAt', '<', now]
      ],
      { limit: 200 }
    );

    if (expiredRecommendations.data.length === 0) {
      return 0;
    }

    // Supprimer par lots
    const deletePromises = expiredRecommendations.data.map(rec =>
      firestoreHelper.deleteDocument('recommendation_cache', rec.id)
    );

    await Promise.allSettled(deletePromises);

    logger.info('Expired recommendations cleaned up', {
      expiredCount: expiredRecommendations.data.length
    });

    return expiredRecommendations.data.length;

  } catch (error) {
    logger.error('Failed to cleanup expired recommendations', error);
    return 0;
  }
}

/**
 * Met à jour les métriques de recommandations
 */
async function updateRecommendationMetrics(results: RecommendationUpdateResults): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'recommendations.totalGenerated': results.recommendationsGenerated,
      'recommendations.totalExpired': results.recommendationsExpired,
      'recommendations.lastUpdate': new Date(),
      'recommendations.usersProcessed': results.usersProcessed
    });

    // Statistiques par type
    for (const [type, count] of Object.entries(results.byRecommendationType)) {
      if (count > 0) {
        await firestoreHelper.incrementDocument('platform_stats', 'global', {
          [`recommendations.byType.${type}`]: count
        });
      }
    }

    // Statistiques par type d'utilisateur
    for (const [userType, count] of Object.entries(results.byUserType)) {
      if (count > 0) {
        await firestoreHelper.incrementDocument('platform_stats', 'global', {
          [`recommendations.byUserType.${userType}`]: count
        });
      }
    }

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.setDocument('platform_stats', `recommendations_${monthKey}`, {
      month: monthKey,
      generated: results.recommendationsGenerated,
      expired: results.recommendationsExpired,
      usersProcessed: results.usersProcessed,
      processingTime: results.processingTime,
      batchId: results.batchId,
      byType: results.byRecommendationType,
      byUserType: results.byUserType,
      updatedAt: new Date()
    });

    logger.info('Recommendation metrics updated', {
      ...results,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update recommendation metrics', error);
  }
}

/**
 * Traite les recommandations pour un lot d'utilisateurs
 */
async function processBatchRecommendations(users: UserDocument[]): Promise<RecommendationUpdateResults> {
  const batchId = helpers.string.generateId('rec_batch');
  const startTime = Date.now();

  const results: RecommendationUpdateResults = {
    totalUsers: users.length,
    usersProcessed: 0,
    recommendationsGenerated: 0,
    recommendationsExpired: 0,
    errors: 0,
    processingTime: 0,
    batchId,
    byUserType: { creator: 0, contributor: 0, auditor: 0 },
    byRecommendationType: { project_match: 0, skill_opportunity: 0, impact_alignment: 0, performance_improvement: 0 }
  };

  try {
    // Nettoyer les anciennes recommandations expirées
    results.recommendationsExpired = await cleanupExpiredRecommendations();

    // Traiter chaque utilisateur
    for (const user of users) {
      try {
        // Analyser le comportement utilisateur
        const analysis = await analyzeUserBehavior(user);
        
        // Générer des recommandations selon le type d'utilisateur
        let recommendations: GeneratedRecommendation[] = [];

        switch (user.userType) {
          case 'contributor':
            const projectRecs = await generateProjectRecommendations(analysis);
            const impactRecs = await generateImpactAlignmentRecommendations(analysis);
            recommendations = [...projectRecs, ...impactRecs];
            break;

          case 'creator':
            const creatorRecs = await generateCreatorRecommendations(analysis);
            const creatorImpactRecs = await generateImpactAlignmentRecommendations(analysis);
            recommendations = [...creatorRecs, ...creatorImpactRecs];
            break;

          case 'auditor':
            const auditorRecs = await generateAuditorRecommendations(analysis);
            recommendations = auditorRecs;
            break;

          default:
            logger.warn('Unknown user type for recommendations', { userId: user.uid, userType: user.userType });
            continue;
        }

        // Sauvegarder les recommandations
        if (recommendations.length > 0) {
          await saveRecommendationsToCache(user.uid, recommendations);
          
          results.recommendationsGenerated += recommendations.length;
          results.byUserType[user.userType] += recommendations.length;
          
          // Compter par type de recommandation
          recommendations.forEach(rec => {
            results.byRecommendationType[rec.type]++;
          });
        }

        results.usersProcessed++;

      } catch (error) {
        logger.error('Failed to process user recommendations', error, { userId: user.uid });
        results.errors++;
      }
    }

    results.processingTime = Date.now() - startTime;

    logger.info('Batch recommendations processing completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to process batch recommendations', error, { batchId });
    results.errors++;
    return results;
  }
}

/**
 * Récupère les utilisateurs éligibles pour les recommandations
 */
async function getEligibleUsersForRecommendations(): Promise<UserDocument[]> {
  try {
    const now = new Date();
    const updateThreshold = new Date(now.getTime() - RECOMMENDATION_CONFIG.UPDATE_FREQUENCY_HOURS * 60 * 60 * 1000);

    // Récupérer les utilisateurs actifs qui n'ont pas eu de mise à jour récente
    const users = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['status', '==', 'active'],
        ['kycStatus', '==', 'approved']
      ],
      { 
        limit: RECOMMENDATION_CONFIG.MAX_USERS_PER_RUN,
        orderBy: [{ field: 'recommendationStats.lastUpdate', direction: 'asc' }]
      }
    );

    // Filtrer selon la fréquence de mise à jour
    const eligibleUsers = users.data.filter(user => {
      const lastUpdate = user.recommendationStats?.lastUpdate;
      
      if (!lastUpdate) {
        return true; // Jamais mis à jour
      }

      return lastUpdate.getTime() < updateThreshold.getTime();
    });

    logger.info('Eligible users for recommendations retrieved', {
      totalUsers: users.data.length,
      eligibleUsers: eligibleUsers.length,
      updateThresholdHours: RECOMMENDATION_CONFIG.UPDATE_FREQUENCY_HOURS
    });

    return eligibleUsers;

  } catch (error) {
    logger.error('Failed to get eligible users for recommendations', error);
    throw error;
  }
}

/**
 * Fonction principale de mise à jour des recommandations
 */
async function executeRecommendationUpdate(): Promise<RecommendationUpdateResults> {
  try {
    // Récupérer les utilisateurs éligibles
    const eligibleUsers = await getEligibleUsersForRecommendations();

    if (eligibleUsers.length === 0) {
      logger.info('No eligible users for recommendation updates');
      return {
        totalUsers: 0,
        usersProcessed: 0,
        recommendationsGenerated: 0,
        recommendationsExpired: 0,
        errors: 0,
        processingTime: 0,
        batchId: helpers.string.generateId('rec_batch'),
        byUserType: { creator: 0, contributor: 0, auditor: 0 },
        byRecommendationType: { project_match: 0, skill_opportunity: 0, impact_alignment: 0, performance_improvement: 0 }
      };
    }

    // Traiter par lots pour éviter les timeouts
    const batchSize = RECOMMENDATION_CONFIG.PROCESSING_BATCH_SIZE;
    const allResults: RecommendationUpdateResults[] = [];

    for (let i = 0; i < eligibleUsers.length; i += batchSize) {
      const batch = eligibleUsers.slice(i, i + batchSize);
      const batchResults = await processBatchRecommendations(batch);
      allResults.push(batchResults);

      // Pause entre les lots
      if (i + batchSize < eligibleUsers.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Agrégation des résultats
    const aggregatedResults: RecommendationUpdateResults = allResults.reduce((acc, result) => ({
      totalUsers: acc.totalUsers + result.totalUsers,
      usersProcessed: acc.usersProcessed + result.usersProcessed,
      recommendationsGenerated: acc.recommendationsGenerated + result.recommendationsGenerated,
      recommendationsExpired: acc.recommendationsExpired + result.recommendationsExpired,
      errors: acc.errors + result.errors,
      processingTime: acc.processingTime + result.processingTime,
      batchId: acc.batchId,
      byUserType: {
        creator: acc.byUserType.creator + result.byUserType.creator,
        contributor: acc.byUserType.contributor + result.byUserType.contributor,
        auditor: acc.byUserType.auditor + result.byUserType.auditor
      },
      byRecommendationType: {
        project_match: acc.byRecommendationType.project_match + result.byRecommendationType.project_match,
        skill_opportunity: acc.byRecommendationType.skill_opportunity + result.byRecommendationType.skill_opportunity,
        impact_alignment: acc.byRecommendationType.impact_alignment + result.byRecommendationType.impact_alignment,
        performance_improvement: acc.byRecommendationType.performance_improvement + result.byRecommendationType.performance_improvement
      }
    }), {
      totalUsers: 0,
      usersProcessed: 0,
      recommendationsGenerated: 0,
      recommendationsExpired: 0,
      errors: 0,
      processingTime: 0,
      batchId: helpers.string.generateId('aggregate'),
      byUserType: { creator: 0, contributor: 0, auditor: 0 },
      byRecommendationType: { project_match: 0, skill_opportunity: 0, impact_alignment: 0, performance_improvement: 0 }
    });

    // Mettre à jour les métriques
    await updateRecommendationMetrics(aggregatedResults);

    return aggregatedResults;

  } catch (error) {
    logger.error('Failed to execute recommendation update', error);
    throw error;
  }
}

/**
 * Fonction Cloud Scheduler - Mise à jour des recommandations
 */
export const updateRecommendations = pubsub
  .schedule('0 4 * * *') // Tous les jours à 4h du matin UTC
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('rec_exec');
    const startTime = Date.now();

    try {
      logger.info('Update recommendations scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter la mise à jour des recommandations
      const results = await executeRecommendationUpdate();

      // Log business
      logger.business('Recommendations updated', 'engagement', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalUsers: results.totalUsers,
        usersProcessed: results.usersProcessed,
        recommendationsGenerated: results.recommendationsGenerated,
        recommendationsExpired: results.recommendationsExpired,
        successRate: results.usersProcessed / results.totalUsers,
        timestamp: new Date().toISOString()
      });

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'updateRecommendations',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Update recommendations scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        usersProcessed: results.usersProcessed,
        recommendationsGenerated: results.recommendationsGenerated
      });

    } catch (error) {
      logger.error('Update recommendations scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'updateRecommendations',
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
        logger.error('Failed to log recommendation execution failure', logError, { executionId });
      }

      throw error;
    }
  });