/**
 * Send Digest Emails Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument, NotificationDocument } from '../types/firestore';
import { STATUS, EMAIL_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les données de digest
 */
interface DigestData {
  userId: string;
  userType: 'creator' | 'contributor' | 'auditor';
  email: string;
  firstName: string;
  lastName: string;
  digestType: 'daily' | 'weekly' | 'monthly';
  unreadNotifications: NotificationDocument[];
  projectUpdates: any[];
  contributionSummary: any;
  personalizedRecommendations: any[];
  platformNews: any[];
  lastDigestSent?: Date;
}

/**
 * Interface pour les résultats d'envoi de digest
 */
interface DigestResults {
  totalUsers: number;
  digestsSent: number;
  errors: number;
  byType: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  byUserType: {
    creator: number;
    contributor: number;
    auditor: number;
  };
  executionTime: number;
}

/**
 * Détermine le type de digest à envoyer
 */
function getDigestType(): 'daily' | 'weekly' | 'monthly' {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = dimanche, 1 = lundi, etc.
  const dayOfMonth = now.getDate();

  // Digest mensuel le 1er de chaque mois
  if (dayOfMonth === 1) {
    return 'monthly';
  }

  // Digest hebdomadaire le lundi
  if (dayOfWeek === 1) {
    return 'weekly';
  }

  // Digest quotidien les autres jours
  return 'daily';
}

/**
 * Récupère les utilisateurs éligibles pour les digests
 */
async function getEligibleUsers(digestType: 'daily' | 'weekly' | 'monthly'): Promise<UserDocument[]> {
  try {
    // Récupérer les utilisateurs actifs avec préférences email activées
    const users = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['status', '==', 'active'],
        ['preferences.notifications.email', '==', true],
        [`preferences.notifications.digest${digestType.charAt(0).toUpperCase() + digestType.slice(1)}`, '!=', false] // Pas explicitement désactivé
      ],
      { limit: EMAIL_CONFIG.MAX_BATCH_SIZE }
    );

    // Filtrer selon la fréquence du dernier envoi
    const now = new Date();
    const eligibleUsers = users.filter(user => {
      const lastDigest = user.emailDigests?.[digestType]?.lastSent;
      
      if (!lastDigest) {
        return true; // Jamais reçu de digest
      }

      const hoursSinceLastDigest = (now.getTime() - lastDigest.getTime()) / (60 * 60 * 1000);
      
      switch (digestType) {
        case 'daily':
          return hoursSinceLastDigest >= 20; // Au moins 20h
        case 'weekly':
          return hoursSinceLastDigest >= 7 * 24 - 4; // Au moins 6j 20h
        case 'monthly':
          return hoursSinceLastDigest >= 28 * 24; // Au moins 28 jours
        default:
          return false;
      }
    });

    logger.info('Eligible users retrieved for digest', {
      digestType,
      totalUsers: users.length,
      eligibleUsers: eligibleUsers.length
    });

    return eligibleUsers;

  } catch (error) {
    logger.error('Failed to get eligible users for digest', error, { digestType });
    throw error;
  }
}

/**
 * Collecte les données de digest pour un utilisateur
 */
async function collectUserDigestData(
  user: UserDocument,
  digestType: 'daily' | 'weekly' | 'monthly'
): Promise<DigestData> {
  try {
    const now = new Date();
    const timeRanges = {
      daily: 24 * 60 * 60 * 1000, // 24 heures
      weekly: 7 * 24 * 60 * 60 * 1000, // 7 jours
      monthly: 30 * 24 * 60 * 60 * 1000 // 30 jours
    };

    const sinceDate = new Date(now.getTime() - timeRanges[digestType]);

    // Récupérer les notifications non lues récentes
    const unreadNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['recipientUid', '==', user.uid],
        ['read', '==', false],
        ['createdAt', '>=', sinceDate],
        ['superseded', '!=', true]
      ],
      { 
        limit: 20,
        orderBy: [{ field: 'priority', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }]
      }
    );

    // Récupérer les mises à jour de projets suivis/créés
    const projectUpdates = await getProjectUpdatesForUser(user, sinceDate);

    // Récupérer le résumé des contributions
    const contributionSummary = await getContributionSummary(user, sinceDate);

    // Générer des recommandations personnalisées
    const personalizedRecommendations = await generatePersonalizedRecommendations(user);

    // Récupérer les actualités de la plateforme
    const platformNews = await getPlatformNews(sinceDate);

    const digestData: DigestData = {
      userId: user.uid,
      userType: user.userType,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      digestType,
      unreadNotifications,
      projectUpdates,
      contributionSummary,
      personalizedRecommendations,
      platformNews,
      lastDigestSent: user.emailDigests?.[digestType]?.lastSent
    };

    logger.info('User digest data collected', {
      userId: user.uid,
      digestType,
      unreadCount: unreadNotifications.length,
      projectUpdatesCount: projectUpdates.length,
      recommendationsCount: personalizedRecommendations.length
    });

    return digestData;

  } catch (error) {
    logger.error('Failed to collect user digest data', error, {
      userId: user.uid,
      digestType
    });
    throw error;
  }
}

/**
 * Récupère les mises à jour de projets pour un utilisateur
 */
async function getProjectUpdatesForUser(
  user: UserDocument,
  sinceDate: Date
): Promise<any[]> {
  try {
    let projectIds: string[] = [];

    // Récupérer les projets selon le type d'utilisateur
    if (user.userType === 'creator') {
      // Projets créés par l'utilisateur
      const createdProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
        'projects',
        [['creatorUid', '==', user.uid]],
        { limit: 20 }
      );
      projectIds = createdProjects.map(p => p.id);

    } else if (user.userType === 'contributor') {
      // Projets auxquels l'utilisateur a contribué
      const contributions = await firestoreHelper.queryDocuments<any>(
        'contributions',
        [
          ['contributorUid', '==', user.uid],
          ['status', '==', 'confirmed']
        ],
        { limit: 20 }
      );
      projectIds = [...new Set(contributions.map(c => c.projectId))];

    } else if (user.userType === 'auditor') {
      // Projets audités par l'utilisateur
      const audits = await firestoreHelper.queryDocuments<any>(
        'audits',
        [['auditorUid', '==', user.uid]],
        { limit: 20 }
      );
      projectIds = [...new Set(audits.map(a => a.projectId))];
    }

    if (projectIds.length === 0) {
      return [];
    }

    // Récupérer les événements de projet récents
    const projectEvents = await firestoreHelper.queryDocuments<any>(
      'project_events',
      [
        ['projectId', 'in', projectIds.slice(0, 10)], // Limiter à 10 projets
        ['createdAt', '>=', sinceDate]
      ],
      {
        limit: 50,
        orderBy: [{ field: 'createdAt', direction: 'desc' }]
      }
    );

    // Enrichir avec les données de projet
    const enrichedUpdates = await Promise.all(
      projectEvents.map(async (event) => {
        try {
          const project = await firestoreHelper.getDocument<ProjectDocument>('projects', event.projectId);
          return {
            eventId: event.id,
            projectId: event.projectId,
            projectTitle: project.title,
            projectSlug: project.slug,
            eventType: event.type,
            eventTitle: event.title,
            eventDescription: event.description,
            eventData: event.data,
            createdAt: event.createdAt,
            currentFunding: project.currentFunding,
            fundingGoal: project.fundingGoal,
            fundingPercentage: Math.round((project.currentFunding / project.fundingGoal) * 100)
          };
        } catch (error) {
          logger.error('Failed to enrich project event', error, {
            eventId: event.id,
            projectId: event.projectId
          });
          return null;
        }
      })
    );

    return enrichedUpdates.filter(update => update !== null);

  } catch (error) {
    logger.error('Failed to get project updates for user', error, {
      userId: user.uid,
      userType: user.userType
    });
    return [];
  }
}

/**
 * Récupère le résumé des contributions
 */
async function getContributionSummary(
  user: UserDocument,
  sinceDate: Date
): Promise<any> {
  try {
    if (user.userType !== 'contributor') {
      return null;
    }

    // Récupérer les contributions récentes
    const recentContributions = await firestoreHelper.queryDocuments<any>(
      'contributions',
      [
        ['contributorUid', '==', user.uid],
        ['confirmedAt', '>=', sinceDate],
        ['status', '==', 'confirmed']
      ]
    );

    if (recentContributions.length === 0) {
      return null;
    }

    const totalAmount = recentContributions.reduce((sum, contrib) => sum + contrib.amount, 0);
    const projectCount = new Set(recentContributions.map(c => c.projectId)).size;

    // Calculer les intérêts gagnés
    const interestEarned = recentContributions.reduce((sum, contrib) => 
      sum + (contrib.accruedInterest || 0), 0
    );

    return {
      contributionsCount: recentContributions.length,
      totalAmount,
      averageContribution: Math.round(totalAmount / recentContributions.length),
      projectsSupported: projectCount,
      interestEarned,
      recentContributions: recentContributions.slice(0, 5).map(contrib => ({
        projectId: contrib.projectId,
        amount: contrib.amount,
        confirmedAt: contrib.confirmedAt,
        interestEarned: contrib.accruedInterest || 0
      }))
    };

  } catch (error) {
    logger.error('Failed to get contribution summary', error, { userId: user.uid });
    return null;
  }
}

/**
 * Génère des recommandations personnalisées
 */
async function generatePersonalizedRecommendations(user: UserDocument): Promise<any[]> {
  try {
    const recommendations: any[] = [];

    if (user.userType === 'contributor') {
      // Recommandations de projets basées sur l'historique
      const userContributions = await firestoreHelper.queryDocuments<any>(
        'contributions',
        [
          ['contributorUid', '==', user.uid],
          ['status', '==', 'confirmed']
        ],
        { limit: 10 }
      );

      // Analyser les catégories préférées
      const categoryInterests = new Map<string, number>();
      userContributions.forEach(contrib => {
        const category = contrib.projectCategory;
        categoryInterests.set(category, (categoryInterests.get(category) || 0) + contrib.amount);
      });

      // Trouver des projets similaires
      const topCategories = Array.from(categoryInterests.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);

      if (topCategories.length > 0) {
        const recommendedProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
          'projects',
          [
            ['status', '==', STATUS.PROJECT.ACTIVE],
            ['category', 'in', topCategories],
            ['fundingStatus', '==', 'open']
          ],
          { 
            limit: 5,
            orderBy: [{ field: 'urgency', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }]
          }
        );

        recommendations.push(...recommendedProjects.map(project => ({
          type: 'project_recommendation',
          projectId: project.id,
          title: project.title,
          category: project.category,
          fundingGoal: project.fundingGoal,
          currentFunding: project.currentFunding,
          fundingPercentage: Math.round((project.currentFunding / project.fundingGoal) * 100),
          urgency: project.urgency,
          reason: `Basé sur vos contributions en ${project.category}`,
          actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`
        })));
      }
    }

    if (user.userType === 'creator') {
      // Recommandations pour les créateurs
      const userProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
        'projects',
        [['creatorUid', '==', user.uid]],
        { limit: 10 }
      );

      // Recommandations d'amélioration
      const activeProjects = userProjects.filter(p => p.status === STATUS.PROJECT.ACTIVE);
      
      activeProjects.forEach(project => {
        const fundingPercentage = (project.currentFunding / project.fundingGoal) * 100;
        
        if (fundingPercentage < 25) {
          recommendations.push({
            type: 'project_improvement',
            projectId: project.id,
            title: `Boostez votre projet "${project.title}"`,
            suggestion: 'Ajoutez des visuels et mettez à jour la description',
            reason: 'Les projets avec des visuels reçoivent 40% de contributions en plus',
            actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/edit`
          });
        }
      });
    }

    if (user.userType === 'auditor') {
      // Opportunités d'audit
      const availableAudits = await firestoreHelper.queryDocuments<any>(
        'audit_requests',
        [
          ['status', '==', 'pending_assignment'],
          ['requiredQualifications', 'array-contains-any', user.qualifications || []]
        ],
        { limit: 5 }
      );

      recommendations.push(...availableAudits.map(audit => ({
        type: 'audit_opportunity',
        auditId: audit.id,
        projectTitle: audit.projectTitle,
        estimatedCompensation: audit.estimatedAmount,
        complexity: audit.complexity,
        deadline: audit.deadline,
        reason: 'Correspond à vos qualifications',
        actionUrl: `${process.env.FRONTEND_URL}/auditor/opportunities/${audit.id}`
      })));
    }

    return recommendations.slice(0, 8); // Limiter à 8 recommandations

  } catch (error) {
    logger.error('Failed to generate personalized recommendations', error, {
      userId: user.uid,
      userType: user.userType
    });
    return [];
  }
}

/**
 * Récupère les actualités de la plateforme
 */
async function getPlatformNews(sinceDate: Date): Promise<any[]> {
  try {
    // Récupérer les annonces récentes
    const announcements = await firestoreHelper.queryDocuments<any>(
      'platform_announcements',
      [
        ['publishedAt', '>=', sinceDate],
        ['status', '==', 'published'],
        ['includeInDigest', '==', true]
      ],
      {
        limit: 5,
        orderBy: [{ field: 'priority', direction: 'desc' }, { field: 'publishedAt', direction: 'desc' }]
      }
    );

    // Récupérer les statistiques intéressantes de la plateforme
    const platformStats = await firestoreHelper.getDocument('platform_stats', 'global');
    
    const news = announcements.map(announcement => ({
      type: 'platform_announcement',
      title: announcement.title,
      summary: announcement.summary,
      content: announcement.content,
      publishedAt: announcement.publishedAt,
      priority: announcement.priority,
      actionUrl: announcement.actionUrl
    }));

    // Ajouter des stats intéressantes si disponibles
    if (platformStats) {
      if (platformStats.projects?.totalActive > 0) {
        news.push({
          type: 'platform_stats',
          title: 'Activité de la plateforme',
          summary: `${platformStats.projects.totalActive} projets actifs, ${platformStats.users?.totalRegistered || 0} utilisateurs inscrits`,
          content: `La plateforme continue de croître avec de nouveaux projets et contributions.`,
          publishedAt: new Date(),
          priority: 'low'
        });
      }
    }

    return news.slice(0, 3); // Maximum 3 actualités par digest

  } catch (error) {
    logger.error('Failed to get platform news', error);
    return [];
  }
}

/**
 * Récupère les mises à jour de projets pour un utilisateur
 */
async function getProjectUpdatesForUser(user: UserDocument, sinceDate: Date): Promise<any[]> {
  try {
    let relevantProjectIds: string[] = [];

    // Déterminer les projets pertinents selon le type d'utilisateur
    if (user.userType === 'creator') {
      const createdProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
        'projects',
        [['creatorUid', '==', user.uid]],
        { limit: 10 }
      );
      relevantProjectIds = createdProjects.map(p => p.id);

    } else if (user.userType === 'contributor') {
      const contributions = await firestoreHelper.queryDocuments<any>(
        'contributions',
        [
          ['contributorUid', '==', user.uid],
          ['status', '==', 'confirmed']
        ]
      );
      relevantProjectIds = [...new Set(contributions.map(c => c.projectId))];
    }

    if (relevantProjectIds.length === 0) {
      return [];
    }

    // Récupérer les événements récents
    const projectEvents = await firestoreHelper.queryDocuments<any>(
      'project_events',
      [
        ['projectId', 'in', relevantProjectIds.slice(0, 10)],
        ['createdAt', '>=', sinceDate]
      ],
      {
        limit: 20,
        orderBy: [{ field: 'createdAt', direction: 'desc' }]
      }
    );

    // Enrichir avec les données de projet
    const enrichedUpdates = await Promise.all(
      projectEvents.map(async (event) => {
        try {
          const project = await firestoreHelper.getDocument<ProjectDocument>('projects', event.projectId);
          return {
            eventType: event.type,
            projectTitle: project.title,
            projectSlug: project.slug,
            eventTitle: event.title,
            eventDescription: event.description,
            createdAt: event.createdAt,
            currentFunding: project.currentFunding,
            fundingGoal: project.fundingGoal
          };
        } catch (error) {
          logger.error('Failed to enrich project event for digest', error, {
            eventId: event.id,
            projectId: event.projectId
          });
          return null;
        }
      })
    );

    return enrichedUpdates.filter(update => update !== null);

  } catch (error) {
    logger.error('Failed to get project updates for user', error, {
      userId: user.uid,
      userType: user.userType
    });
    return [];
  }
}

/**
 * Génère et envoie le digest email
 */
async function sendDigestEmail(digestData: DigestData): Promise<boolean> {
  try {
    // Déterminer le template selon le type de digest et utilisateur
    const templateMap = {
      daily: {
        creator: 'daily_digest_creator',
        contributor: 'daily_digest_contributor',
        auditor: 'daily_digest_auditor'
      },
      weekly: {
        creator: 'weekly_digest_creator',
        contributor: 'weekly_digest_contributor',
        auditor: 'weekly_digest_auditor'
      },
      monthly: {
        creator: 'monthly_digest_creator',
        contributor: 'monthly_digest_contributor',
        auditor: 'monthly_digest_auditor'
      }
    };

    const templateId = templateMap[digestData.digestType][digestData.userType];

    // Préparer les données du template
    const templateData = {
      userName: `${digestData.firstName} ${digestData.lastName}`,
      digestType: digestData.digestType,
      
      // Notifications
      unreadCount: digestData.unreadNotifications.length,
      priorityNotifications: digestData.unreadNotifications
        .filter(n => n.priority === 'high' || n.priority === 'urgent')
        .slice(0, 3)
        .map(n => ({
          title: n.title,
          message: n.message,
          actionUrl: n.actionUrl,
          priority: n.priority
        })),

      // Mises à jour de projets
      projectUpdatesCount: digestData.projectUpdates.length,
      recentUpdates: digestData.projectUpdates.slice(0, 5),

      // Résumé des contributions (pour contributeurs)
      contributionSummary: digestData.contributionSummary,

      // Recommandations personnalisées
      recommendationsCount: digestData.personalizedRecommendations.length,
      recommendations: digestData.personalizedRecommendations.slice(0, 3),

      // Actualités de la plateforme
      platformNews: digestData.platformNews,

      // URLs utiles
      dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
      notificationsUrl: `${process.env.FRONTEND_URL}/notifications`,
      settingsUrl: `${process.env.FRONTEND_URL}/settings/notifications`,
      unsubscribeUrl: `${process.env.FRONTEND_URL}/settings/notifications?section=digest`,

      // Métadonnées
      digestDate: new Date().toLocaleDateString('fr-FR'),
      year: new Date().getFullYear()
    };

    // Envoyer l'email
    await emailService.sendEmail({
      to: digestData.email,
      templateId,
      dynamicTemplateData: templateData
    });

    // Mettre à jour l'historique des digests de l'utilisateur
    await firestoreHelper.updateDocument('users', digestData.userId, {
      [`emailDigests.${digestData.digestType}.lastSent`]: new Date(),
      [`emailDigests.${digestData.digestType}.totalSent`]: firestoreHelper.increment(1),
      [`emailDigests.${digestData.digestType}.lastContent`]: {
        unreadCount: digestData.unreadNotifications.length,
        projectUpdatesCount: digestData.projectUpdates.length,
        recommendationsCount: digestData.personalizedRecommendations.length
      }
    });

    logger.info('Digest email sent successfully', {
      userId: digestData.userId,
      email: digestData.email,
      digestType: digestData.digestType,
      userType: digestData.userType,
      templateId,
      unreadCount: digestData.unreadNotifications.length,
      projectUpdatesCount: digestData.projectUpdates.length
    });

    return true;

  } catch (error) {
    logger.error('Failed to send digest email', error, {
      userId: digestData.userId,
      email: digestData.email,
      digestType: digestData.digestType,
      userType: digestData.userType
    });
    return false;
  }
}

/**
 * Traite l'envoi de digests par lots
 */
async function processBatchDigests(
  users: UserDocument[],
  digestType: 'daily' | 'weekly' | 'monthly'
): Promise<DigestResults> {
  const results: DigestResults = {
    totalUsers: users.length,
    digestsSent: 0,
    errors: 0,
    byType: { daily: 0, weekly: 0, monthly: 0 },
    byUserType: { creator: 0, contributor: 0, auditor: 0 },
    executionTime: 0
  };

  const startTime = Date.now();

  try {
    // Traiter par lots pour éviter les timeouts
    const batchSize = EMAIL_CONFIG.DIGEST_BATCH_SIZE;

    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      // Traiter chaque utilisateur du lot
      const batchPromises = batch.map(async (user) => {
        try {
          // Vérifier si l'utilisateur a suffisamment d'activité pour justifier un digest
          const hasActivity = await checkUserActivityForDigest(user, digestType);
          
          if (!hasActivity) {
            logger.info('Skipping digest for inactive user', {
              userId: user.uid,
              digestType
            });
            return false;
          }

          // Collecter les données de digest
          const digestData = await collectUserDigestData(user, digestType);

          // Vérifier s'il y a assez de contenu pour justifier l'envoi
          const hasContent = digestData.unreadNotifications.length > 0 || 
                           digestData.projectUpdates.length > 0 ||
                           digestData.personalizedRecommendations.length > 0;

          if (!hasContent) {
            logger.info('Skipping digest - no significant content', {
              userId: user.uid,
              digestType
            });
            return false;
          }

          // Envoyer le digest
          const success = await sendDigestEmail(digestData);

          if (success) {
            results.digestsSent++;
            results.byType[digestType]++;
            results.byUserType[user.userType]++;
          } else {
            results.errors++;
          }

          return success;

        } catch (error) {
          logger.error('Failed to process digest for user', error, {
            userId: user.uid,
            digestType
          });
          results.errors++;
          return false;
        }
      });

      // Attendre que le lot se termine
      await Promise.allSettled(batchPromises);

      // Pause entre les lots pour éviter la surcharge
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 secondes
      }
    }

    results.executionTime = Date.now() - startTime;

    logger.info('Batch digest processing completed', {
      ...results,
      successRate: results.digestsSent / results.totalUsers
    });

  } catch (error) {
    logger.error('Failed to process batch digests', error, { digestType });
    results.errors++;
  }

  return results;
}

/**
 * Vérifie si l'utilisateur a suffisamment d'activité pour un digest
 */
async function checkUserActivityForDigest(
  user: UserDocument,
  digestType: 'daily' | 'weekly' | 'monthly'
): Promise<boolean> {
  try {
    const now = new Date();
    const timeRanges = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const sinceDate = new Date(now.getTime() - timeRanges[digestType]);

    // Vérifier l'activité récente
    const [unreadNotifications, recentActivity] = await Promise.all([
      firestoreHelper.queryDocuments<NotificationDocument>(
        'notifications',
        [
          ['recipientUid', '==', user.uid],
          ['read', '==', false],
          ['createdAt', '>=', sinceDate]
        ],
        { limit: 1 }
      ),
      
      // Vérifier la dernière activité utilisateur
      user.stats?.lastActivity ? Promise.resolve([{ lastActivity: user.stats.lastActivity }]) : Promise.resolve([])
    ]);

    // Critères d'activité
    const hasUnreadNotifications = unreadNotifications.length > 0;
    const hasRecentActivity = recentActivity.length > 0 && 
      user.stats?.lastActivity && 
      (now.getTime() - user.stats.lastActivity.getTime()) < timeRanges[digestType] * 2; // Dans les 2x la période

    return hasUnreadNotifications || hasRecentActivity;

  } catch (error) {
    logger.error('Failed to check user activity for digest', error, {
      userId: user.uid,
      digestType
    });
    return false; // En cas d'erreur, ne pas envoyer de digest
  }
}

/**
 * Met à jour les métriques de digest
 */
async function updateDigestMetrics(results: DigestResults, digestType: string): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      [`email.digests.${digestType}.sent`]: results.digestsSent,
      [`email.digests.${digestType}.errors`]: results.errors,
      'email.digests.totalSent': results.digestsSent,
      'email.digests.lastRun': new Date()
    });

    // Statistiques par type d'utilisateur
    for (const [userType, count] of Object.entries(results.byUserType)) {
      if (count > 0) {
        await firestoreHelper.incrementDocument('platform_stats', 'global', {
          [`email.digests.byUserType.${userType}`]: count
        });
      }
    }

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      [`email.digests.${digestType}`]: results.digestsSent,
      'email.digests.total': results.digestsSent
    });

    logger.info('Digest metrics updated', {
      digestType,
      ...results,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update digest metrics', error, { digestType });
  }
}

/**
 * Fonction Cloud Scheduler - Envoi de digests quotidiens
 */
export const sendDigestEmails = pubsub
  .schedule('0 8 * * *') // Tous les jours à 8h du matin UTC (9h Paris)
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('digest_exec');
    const startTime = Date.now();

    try {
      const digestType = getDigestType();

      logger.info('Send digest emails scheduled function started', {
        executionId,
        digestType,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Récupérer les utilisateurs éligibles
      const eligibleUsers = await getEligibleUsers(digestType);

      if (eligibleUsers.length === 0) {
        logger.info('No eligible users for digest emails', { digestType });
        return;
      }

      // Traiter l'envoi des digests
      const results = await processBatchDigests(eligibleUsers, digestType);

      // Mettre à jour les métriques
      await updateDigestMetrics(results, digestType);

      // Log business
      logger.business('Digest emails sent', 'email', {
        executionId,
        digestType,
        scheduledAt: context.timestamp,
        results,
        successRate: results.digestsSent / results.totalUsers,
        timestamp: new Date().toISOString()
      });

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'sendDigestEmails',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        digestType,
        results,
        nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Send digest emails scheduled function completed successfully', {
        executionId,
        digestType,
        duration: Date.now() - startTime,
        digestsSent: results.digestsSent,
        errors: results.errors
      });

    } catch (error) {
      logger.error('Send digest emails scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'sendDigestEmails',
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
        logger.error('Failed to log digest execution failure', logError, { executionId });
      }

      throw error;
    }
  });