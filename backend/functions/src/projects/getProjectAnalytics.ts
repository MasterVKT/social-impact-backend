/**
 * Get Project Analytics Firebase Function
 * Social Finance Impact Platform
 *
 * Retourne les analytics détaillées d'un projet
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { ProjectDocument, UserDocument } from '../types/firestore';
import admin from 'firebase-admin';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  includeContributions: Joi.boolean().default(true),
  includeMilestones: Joi.boolean().default(true),
  includeTimeseries: Joi.boolean().default(false), // Données temporelles (graphiques)
  timeRange: Joi.string()
    .valid('7d', '30d', '90d', 'all')
    .default('all')
    .when('includeTimeseries', {
      is: true,
      then: Joi.required(),
    }),
}).required();

/**
 * Interface pour les analytics retournées
 */
interface ProjectAnalytics {
  projectId: string;
  projectTitle: string;
  status: string;
  overview: {
    totalViews: number;
    uniqueViews: number;
    totalContributions: number;
    totalContributors: number;
    fundingRaised: number;
    fundingGoal: number;
    fundingProgress: number;
    averageContribution: number;
    conversionRate: number; // Taux de conversion vues -> contributions
    daysRemaining?: number;
    daysActive: number;
  };
  contributions?: {
    byAmount: {
      total: number;
      average: number;
      median: number;
      min: number;
      max: number;
    };
    byTime: {
      first: string;
      last: string;
      distribution: any[]; // Distribution temporelle si includeTimeseries
    };
    byStatus: {
      confirmed: number;
      pending: number;
      failed: number;
      refunded: number;
    };
    topContributors: Array<{
      contributorId: string;
      displayName: string;
      amount: number;
      date: string;
    }>;
  };
  milestones?: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    completionRate: number;
    avgCompletionTime?: number; // En jours
  };
  engagement: {
    views: {
      total: number;
      unique: number;
      daily: number; // Moyenne journalière
    };
    saves: number;
    shares: number;
    bounceRate: number;
    averageTimeSpent: number; // En secondes
  };
  traffic?: {
    sources: Record<string, number>;
    topReferrers: Array<{
      source: string;
      visits: number;
    }>;
  };
}

/**
 * Récupère les analytics des contributions
 */
async function getContributionsAnalytics(
  projectId: string,
  includeTimeseries: boolean
): Promise<any> {
  try {
    const contributionsSnapshot = await admin
      .firestore()
      .collection('contributions')
      .where('projectId', '==', projectId)
      .where('payment.status', '==', 'confirmed')
      .orderBy('createdAt', 'desc')
      .get();

    if (contributionsSnapshot.empty) {
      return null;
    }

    const contributions = contributionsSnapshot.docs.map((doc) => doc.data());
    const amounts = contributions.map((c: any) => c.amount?.gross || 0);

    // Calculs statistiques
    const total = amounts.reduce((sum, amt) => sum + amt, 0);
    const average = amounts.length > 0 ? total / amounts.length : 0;
    const sortedAmounts = [...amounts].sort((a, b) => a - b);
    const median =
      sortedAmounts.length > 0
        ? sortedAmounts[Math.floor(sortedAmounts.length / 2)]
        : 0;
    const min = sortedAmounts.length > 0 ? sortedAmounts[0] : 0;
    const max = sortedAmounts.length > 0 ? sortedAmounts[sortedAmounts.length - 1] : 0;

    // Top contributeurs
    const contributorMap = new Map<string, any>();
    contributions.forEach((c: any) => {
      const existing = contributorMap.get(c.contributorUid) || {
        contributorId: c.contributorUid,
        displayName: c.contributor?.displayName || 'Anonymous',
        amount: 0,
        contributions: 0,
      };
      existing.amount += c.amount?.gross || 0;
      existing.contributions += 1;
      contributorMap.set(c.contributorUid, existing);
    });

    const topContributors = Array.from(contributorMap.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((c) => ({
        contributorId: c.contributorId,
        displayName: c.displayName,
        amount: c.amount,
        contributions: c.contributions,
      }));

    // Distribution temporelle si demandée
    let distribution: any[] = [];
    if (includeTimeseries) {
      // Grouper par jour
      const dailyMap = new Map<string, number>();
      contributions.forEach((c: any) => {
        if (c.createdAt?._seconds) {
          const date = new Date(c.createdAt._seconds * 1000);
          const dateKey = date.toISOString().split('T')[0];
          dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + (c.amount?.gross || 0));
        }
      });
      distribution = Array.from(dailyMap.entries())
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Statuts
    const byStatus = {
      confirmed: contributions.filter((c: any) => c.payment?.status === 'confirmed')
        .length,
      pending: contributions.filter((c: any) => c.payment?.status === 'pending').length,
      failed: contributions.filter((c: any) => c.payment?.status === 'failed').length,
      refunded: contributions.filter((c: any) => c.payment?.status === 'refunded').length,
    };

    // Dates
    const dates = contributions
      .filter((c: any) => c.createdAt?._seconds)
      .map((c: any) => c.createdAt._seconds)
      .sort((a, b) => a - b);

    return {
      byAmount: {
        total,
        average,
        median,
        min,
        max,
      },
      byTime: {
        first: dates.length > 0 ? new Date(dates[0] * 1000).toISOString() : null,
        last:
          dates.length > 0
            ? new Date(dates[dates.length - 1] * 1000).toISOString()
            : null,
        distribution,
      },
      byStatus,
      topContributors,
    };
  } catch (error) {
    logger.error('Error fetching contributions analytics', { error, projectId });
    return null;
  }
}

/**
 * Récupère les analytics des milestones
 */
async function getMilestonesAnalytics(projectId: string): Promise<any> {
  try {
    const milestonesSnapshot = await admin
      .firestore()
      .collection('projects')
      .doc(projectId)
      .collection('milestones')
      .get();

    if (milestonesSnapshot.empty) {
      return null;
    }

    const milestones = milestonesSnapshot.docs.map((doc) => doc.data());

    const total = milestones.length;
    const completed = milestones.filter((m: any) => m.status === 'approved').length;
    const inProgress = milestones.filter(
      (m: any) => m.status === 'in_progress' || m.status === 'submitted'
    ).length;
    const pending = milestones.filter((m: any) => m.status === 'pending').length;
    const completionRate = total > 0 ? (completed / total) * 100 : 0;

    // Temps moyen de complétion
    const completedMilestones = milestones.filter(
      (m: any) =>
        m.status === 'approved' &&
        m.timeline?.actualStartDate &&
        m.timeline?.actualEndDate
    );
    let avgCompletionTime;
    if (completedMilestones.length > 0) {
      const completionTimes = completedMilestones.map((m: any) => {
        const start = m.timeline.actualStartDate._seconds;
        const end = m.timeline.actualEndDate._seconds;
        return (end - start) / (24 * 60 * 60); // Convertir en jours
      });
      avgCompletionTime =
        completionTimes.reduce((sum, t) => sum + t, 0) / completionTimes.length;
    }

    return {
      total,
      completed,
      inProgress,
      pending,
      completionRate,
      avgCompletionTime,
    };
  } catch (error) {
    logger.error('Error fetching milestones analytics', { error, projectId });
    return null;
  }
}

/**
 * Firebase Function principale
 */
export const getProjectAnalytics = https.onCall(
  withErrorHandling(async (data: any, context: CallableContext) => {
    // ÉTAPE 1 : Vérifier authentification
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;

    // ÉTAPE 2 : Valider les données d'entrée
    const validatedData = await validateWithJoi(data, requestSchema);
    const {
      projectId,
      includeContributions,
      includeMilestones,
      includeTimeseries,
    } = validatedData;

    logger.info('Fetching project analytics', { userId, projectId });

    // ÉTAPE 3 : Récupérer le projet
    const project = await firestoreHelper.getDocument<ProjectDocument>(
      'projects',
      projectId
    );

    if (!project) {
      throw new https.HttpsError('not-found', `Project ${projectId} not found`);
    }

    // ÉTAPE 4 : Vérifier les permissions
    // Seuls le créateur et les admins peuvent voir les analytics détaillées
    const user = await firestoreHelper.getDocument<UserDocument>('users', userId);

    const isCreator = project.creatorUid === userId || project.creator?.uid === userId;
    const isAdmin = user?.userType === 'admin';

    if (!isCreator && !isAdmin) {
      throw new https.HttpsError(
        'permission-denied',
        'Only the project creator or admins can view detailed analytics'
      );
    }

    // ÉTAPE 5 : Calculer les analytics de base
    const now = new Date();
    const createdAt = project.createdAt?._seconds
      ? new Date(project.createdAt._seconds * 1000)
      : now;
    const daysActive = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    let daysRemaining;
    if (project.funding?.deadline?._seconds) {
      const deadline = new Date(project.funding.deadline._seconds * 1000);
      daysRemaining = Math.max(
        0,
        Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    const overview = {
      totalViews: project.analytics?.totalViews || 0,
      uniqueViews: project.analytics?.views || 0,
      totalContributions: project.funding?.contributorsCount || 0,
      totalContributors: project.funding?.contributorsCount || 0,
      fundingRaised: project.funding?.raised || 0,
      fundingGoal: project.funding?.goal || 0,
      fundingProgress: project.funding?.percentage || 0,
      averageContribution: project.funding?.averageContribution || 0,
      conversionRate:
        project.analytics?.views > 0
          ? ((project.funding?.contributorsCount || 0) / project.analytics.views) * 100
          : 0,
      daysRemaining,
      daysActive,
    };

    // ÉTAPE 6 : Récupérer analytics contributions si demandées
    let contributionsAnalytics = null;
    if (includeContributions) {
      contributionsAnalytics = await getContributionsAnalytics(
        projectId,
        includeTimeseries
      );
    }

    // ÉTAPE 7 : Récupérer analytics milestones si demandées
    let milestonesAnalytics = null;
    if (includeMilestones) {
      milestonesAnalytics = await getMilestonesAnalytics(projectId);
    }

    // ÉTAPE 8 : Construire la réponse
    const analytics: ProjectAnalytics = {
      projectId,
      projectTitle: project.title,
      status: project.status,
      overview,
      engagement: {
        views: {
          total: project.analytics?.totalViews || 0,
          unique: project.analytics?.views || 0,
          daily:
            daysActive > 0
              ? (project.analytics?.totalViews || 0) / daysActive
              : 0,
        },
        saves: project.analytics?.saves || 0,
        shares: project.analytics?.shares || 0,
        bounceRate: project.analytics?.bounceRate || 0,
        averageTimeSpent: project.analytics?.averageTimeSpent || 0,
      },
    };

    if (contributionsAnalytics) {
      analytics.contributions = contributionsAnalytics;
    }

    if (milestonesAnalytics) {
      analytics.milestones = milestonesAnalytics;
    }

    if (project.analytics?.trafficSources) {
      analytics.traffic = {
        sources: project.analytics.trafficSources,
        topReferrers: Object.entries(project.analytics.trafficSources)
          .map(([source, visits]) => ({ source, visits: visits as number }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 10),
      };
    }

    logger.info('Project analytics fetched successfully', {
      projectId,
      userId,
    });

    return analytics;
  })
);
