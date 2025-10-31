/**
 * Cleanup Expired Data Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { NotificationDocument, UserDocument } from '../types/firestore';
import { CLEANUP_CONFIG, RETENTION_POLICY } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les résultats de nettoyage
 */
interface CleanupResults {
  notifications: CleanupStats;
  sessions: CleanupStats;
  tempFiles: CleanupStats;
  analytics: CleanupStats;
  logs: CleanupStats;
  executionTime: number;
  batchId: string;
}

/**
 * Interface pour les statistiques de nettoyage
 */
interface CleanupStats {
  itemsProcessed: number;
  itemsDeleted: number;
  itemsArchived: number;
  errors: number;
  dataSize: number; // en bytes
}

/**
 * Nettoie les notifications expirées
 */
async function cleanupExpiredNotifications(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const expirationThreshold = new Date(now.getTime() - RETENTION_POLICY.NOTIFICATIONS.EXPIRED_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // Récupérer les notifications expirées
    const expiredNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['expiresAt', '<', now],
        ['expired', '!=', true]
      ],
      { limit: CLEANUP_CONFIG.BATCH_SIZE }
    );

    stats.itemsProcessed = expiredNotifications.length;

    if (expiredNotifications.length === 0) {
      return stats;
    }

    // Traitement par lots
    const batchSize = 25;
    for (let i = 0; i < expiredNotifications.length; i += batchSize) {
      const batch = expiredNotifications.slice(i, i + batchSize);

      try {
        await firestoreHelper.runTransaction(async (transaction) => {
          batch.forEach(notification => {
            const notificationRef = firestoreHelper.getDocumentRef('notifications', notification.id);
            
            // Marquer comme expiré plutôt que supprimer (pour audit)
            transaction.update(notificationRef, {
              expired: true,
              expiredAt: now,
              read: true, // Marquer comme lu pour ne plus compter
              readAt: now,
              updatedAt: now
            });

            // Mettre à jour le compteur utilisateur
            const userRef = firestoreHelper.getDocumentRef('users', notification.recipientUid);
            transaction.update(userRef, {
              'notificationCounters.unread': firestoreHelper.increment(-1),
              'notificationCounters.expired': firestoreHelper.increment(1)
            });
          });
        });

        stats.itemsDeleted += batch.length;

      } catch (error) {
        logger.error('Failed to process notification batch', error, {
          batchStart: i,
          batchSize: batch.length
        });
        stats.errors += batch.length;
      }
    }

    // Nettoyer les très anciennes notifications (archivage)
    const archiveThreshold = new Date(now.getTime() - RETENTION_POLICY.NOTIFICATIONS.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    await archiveOldNotifications(archiveThreshold, stats);

    logger.info('Expired notifications cleanup completed', {
      processed: stats.itemsProcessed,
      deleted: stats.itemsDeleted,
      archived: stats.itemsArchived,
      errors: stats.errors
    });

  } catch (error) {
    logger.error('Failed to cleanup expired notifications', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Archive les très anciennes notifications
 */
async function archiveOldNotifications(
  archiveThreshold: Date,
  stats: CleanupStats
): Promise<void> {
  try {
    const oldNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['createdAt', '<', archiveThreshold],
        ['archived', '!=', true]
      ],
      { limit: 100 }
    );

    if (oldNotifications.length === 0) {
      return;
    }

    // Archiver par lots
    const archivePromises = oldNotifications.map(async (notification) => {
      try {
        // Créer copie d'archive
        const archiveId = helpers.string.generateId('archive');
        await firestoreHelper.setDocument(`archives/notifications/${archiveId}`, 'data', {
          originalId: notification.id,
          ...notification,
          archivedAt: new Date(),
          archivedBy: 'system',
          retentionPeriod: RETENTION_POLICY.ARCHIVES.KEEP_FOR_YEARS
        });

        // Marquer l'original comme archivé
        await firestoreHelper.updateDocument('notifications', notification.id, {
          archived: true,
          archivedAt: new Date(),
          archiveId
        });

        stats.itemsArchived++;
        stats.dataSize += JSON.stringify(notification).length;

      } catch (error) {
        logger.error('Failed to archive notification', error, {
          notificationId: notification.id
        });
        stats.errors++;
      }
    });

    await Promise.allSettled(archivePromises);

  } catch (error) {
    logger.error('Failed to archive old notifications', error);
    stats.errors++;
  }
}

/**
 * Nettoie les sessions expirées
 */
async function cleanupExpiredSessions(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const sessionExpiration = new Date(now.getTime() - RETENTION_POLICY.SESSIONS.EXPIRED_AFTER_HOURS * 60 * 60 * 1000);

    // Nettoyer les sessions utilisateur expirées
    const users = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [['status', '==', 'active']],
      { limit: 100 }
    );

    for (const user of users) {
      try {
        const expiredSessions = await firestoreHelper.queryDocuments<any>(
          `users/${user.uid}/sessions`,
          [
            ['lastActivity', '<', sessionExpiration],
            ['active', '==', true]
          ]
        );

        stats.itemsProcessed += expiredSessions.length;

        if (expiredSessions.length > 0) {
          // Marquer comme inactives et archiver
          const updatePromises = expiredSessions.map(async (session) => {
            try {
              await firestoreHelper.updateDocument(`users/${user.uid}/sessions`, session.id, {
                active: false,
                expiredAt: now,
                expiredBy: 'system_cleanup'
              });

              stats.itemsDeleted++;

            } catch (error) {
              logger.error('Failed to expire session', error, {
                userId: user.uid,
                sessionId: session.id
              });
              stats.errors++;
            }
          });

          await Promise.allSettled(updatePromises);
        }

      } catch (error) {
        logger.error('Failed to process user sessions', error, { userId: user.uid });
        stats.errors++;
      }
    }

    logger.info('Expired sessions cleanup completed', stats);

  } catch (error) {
    logger.error('Failed to cleanup expired sessions', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Nettoie les fichiers temporaires
 */
async function cleanupTempFiles(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const tempFileExpiration = new Date(now.getTime() - RETENTION_POLICY.TEMP_FILES.EXPIRED_AFTER_HOURS * 60 * 60 * 1000);

    // Nettoyer les uploads temporaires
    const tempUploads = await firestoreHelper.queryDocuments<any>(
      'temp_uploads',
      [
        ['createdAt', '<', tempFileExpiration],
        ['status', '!=', 'cleaned']
      ],
      { limit: CLEANUP_CONFIG.BATCH_SIZE }
    );

    stats.itemsProcessed = tempUploads.length;

    for (const upload of tempUploads) {
      try {
        // Marquer comme nettoyé (le nettoyage Storage sera fait séparément)
        await firestoreHelper.updateDocument('temp_uploads', upload.id, {
          status: 'cleaned',
          cleanedAt: now,
          cleanedBy: 'system'
        });

        stats.itemsDeleted++;
        stats.dataSize += upload.fileSize || 0;

      } catch (error) {
        logger.error('Failed to cleanup temp upload', error, {
          uploadId: upload.id,
          fileName: upload.fileName
        });
        stats.errors++;
      }
    }

    // Nettoyer les caches temporaires
    const tempCaches = await firestoreHelper.queryDocuments<any>(
      'temp_cache',
      [
        ['expiresAt', '<', now]
      ],
      { limit: CLEANUP_CONFIG.BATCH_SIZE }
    );

    for (const cache of tempCaches) {
      try {
        await firestoreHelper.deleteDocument('temp_cache', cache.id);
        stats.itemsDeleted++;

      } catch (error) {
        logger.error('Failed to delete temp cache', error, { cacheId: cache.id });
        stats.errors++;
      }
    }

    logger.info('Temp files cleanup completed', stats);

  } catch (error) {
    logger.error('Failed to cleanup temp files', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Archive les anciennes données d'analytics
 */
async function archiveOldAnalytics(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const archiveThreshold = new Date(now.getTime() - RETENTION_POLICY.ANALYTICS.ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // Archives les événements d'analytics anciens
    const oldAnalytics = await firestoreHelper.queryDocuments<any>(
      'analytics/events/daily',
      [
        ['date', '<', archiveThreshold.toISOString().slice(0, 10)]
      ],
      { limit: CLEANUP_CONFIG.BATCH_SIZE }
    );

    stats.itemsProcessed = oldAnalytics.length;

    for (const analytics of oldAnalytics) {
      try {
        // Créer archive
        const archiveId = helpers.string.generateId('analytics_archive');
        await firestoreHelper.setDocument(`archives/analytics/${archiveId}`, 'data', {
          originalId: analytics.id,
          ...analytics,
          archivedAt: now,
          archivedBy: 'system'
        });

        // Supprimer l'original
        await firestoreHelper.deleteDocument('analytics/events/daily', analytics.id);

        stats.itemsArchived++;
        stats.dataSize += JSON.stringify(analytics).length;

      } catch (error) {
        logger.error('Failed to archive analytics data', error, {
          analyticsId: analytics.id,
          date: analytics.date
        });
        stats.errors++;
      }
    }

    logger.info('Old analytics data archived', stats);

  } catch (error) {
    logger.error('Failed to archive old analytics', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Nettoie les anciens logs
 */
async function cleanupOldLogs(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const logRetentionThreshold = new Date(now.getTime() - RETENTION_POLICY.LOGS.KEEP_FOR_DAYS * 24 * 60 * 60 * 1000);

    // Types de logs à nettoyer
    const logCollections = [
      'function_logs',
      'error_logs',
      'performance_logs',
      'audit_logs'
    ];

    for (const collection of logCollections) {
      try {
        const oldLogs = await firestoreHelper.queryDocuments<any>(
          collection,
          [
            ['timestamp', '<', logRetentionThreshold]
          ],
          { limit: 200 }
        );

        stats.itemsProcessed += oldLogs.length;

        // Supprimer les anciens logs par lots
        const deletePromises = oldLogs.map(async (log) => {
          try {
            await firestoreHelper.deleteDocument(collection, log.id);
            stats.itemsDeleted++;
            stats.dataSize += JSON.stringify(log).length;

          } catch (error) {
            logger.error('Failed to delete old log', error, {
              collection,
              logId: log.id
            });
            stats.errors++;
          }
        });

        await Promise.allSettled(deletePromises);

      } catch (error) {
        logger.error('Failed to cleanup log collection', error, { collection });
        stats.errors++;
      }
    }

    logger.info('Old logs cleanup completed', {
      ...stats,
      collectionsProcessed: logCollections.length
    });

  } catch (error) {
    logger.error('Failed to cleanup old logs', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Nettoie les données KYC expirées
 */
async function cleanupExpiredKYCData(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const kycRetentionThreshold = new Date(now.getTime() - RETENTION_POLICY.KYC.FAILED_SESSIONS_DAYS * 24 * 60 * 60 * 1000);

    // Récupérer les sessions KYC échouées anciennes
    const users = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['kycStatus', 'in', ['failed', 'expired', 'cancelled']]
      ],
      { limit: 50 }
    );

    for (const user of users) {
      try {
        const expiredKYCSessions = await firestoreHelper.queryDocuments<any>(
          `users/${user.uid}/kyc_sessions`,
          [
            ['status', 'in', ['failed', 'expired', 'cancelled']],
            ['completedAt', '<', kycRetentionThreshold]
          ]
        );

        stats.itemsProcessed += expiredKYCSessions.length;

        for (const session of expiredKYCSessions) {
          try {
            // Archiver les données sensibles
            const archiveId = helpers.string.generateId('kyc_archive');
            const sanitizedSession = {
              ...session,
              // Supprimer les données sensibles avant archivage
              documents: undefined,
              personalInfo: undefined,
              verificationData: undefined,
              archivedAt: now,
              archivedBy: 'system',
              retentionNote: 'Regulatory compliance archive'
            };

            await firestoreHelper.setDocument(`archives/kyc_sessions/${archiveId}`, 'data', sanitizedSession);

            // Supprimer la session originale
            await firestoreHelper.deleteDocument(`users/${user.uid}/kyc_sessions`, session.id);

            stats.itemsArchived++;
            stats.dataSize += JSON.stringify(session).length;

          } catch (error) {
            logger.error('Failed to archive KYC session', error, {
              userId: user.uid,
              sessionId: session.id
            });
            stats.errors++;
          }
        }

      } catch (error) {
        logger.error('Failed to process user KYC sessions', error, { userId: user.uid });
        stats.errors++;
      }
    }

    logger.info('Expired KYC data cleanup completed', stats);

  } catch (error) {
    logger.error('Failed to cleanup expired KYC data', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Nettoie les tokens d'authentification expirés
 */
async function cleanupExpiredTokens(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const tokenExpiration = new Date(now.getTime() - RETENTION_POLICY.TOKENS.EXPIRED_AFTER_HOURS * 60 * 60 * 1000);

    // Types de tokens à nettoyer
    const tokenTypes = [
      'email_verification_tokens',
      'password_reset_tokens',
      'api_access_tokens',
      'refresh_tokens'
    ];

    for (const tokenType of tokenTypes) {
      try {
        const expiredTokens = await firestoreHelper.queryDocuments<any>(
          tokenType,
          [
            ['expiresAt', '<', now],
            ['status', '!=', 'revoked']
          ],
          { limit: 500 }
        );

        stats.itemsProcessed += expiredTokens.length;

        // Supprimer les tokens expirés
        const deletePromises = expiredTokens.map(async (token) => {
          try {
            await firestoreHelper.updateDocument(tokenType, token.id, {
              status: 'expired',
              expiredAt: now,
              revokedBy: 'system_cleanup'
            });

            stats.itemsDeleted++;

          } catch (error) {
            logger.error('Failed to expire token', error, {
              tokenType,
              tokenId: token.id
            });
            stats.errors++;
          }
        });

        await Promise.allSettled(deletePromises);

      } catch (error) {
        logger.error('Failed to cleanup token type', error, { tokenType });
        stats.errors++;
      }
    }

    logger.info('Expired tokens cleanup completed', {
      ...stats,
      tokenTypesProcessed: tokenTypes.length
    });

  } catch (error) {
    logger.error('Failed to cleanup expired tokens', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Optimise les index de base de données
 */
async function optimizeDatabaseIndexes(): Promise<void> {
  try {
    // Analyser l'utilisation des index sur les dernières 24h
    const indexUsageStats = await firestoreHelper.getDocument('platform_stats', 'database_usage');
    
    if (!indexUsageStats) {
      logger.info('No database usage stats available for index optimization');
      return;
    }

    // Identifier les queries lentes récurrentes
    const slowQueries = indexUsageStats.slowQueries || [];
    const frequentQueries = indexUsageStats.frequentQueries || [];

    // Log recommendations pour optimisation manuelle
    if (slowQueries.length > 0 || frequentQueries.length > 0) {
      logger.info('Database optimization recommendations', {
        slowQueriesCount: slowQueries.length,
        frequentQueriesCount: frequentQueries.length,
        topSlowQueries: slowQueries.slice(0, 5),
        topFrequentQueries: frequentQueries.slice(0, 5),
        optimizationSuggestions: [
          'Consider adding composite indexes for frequent query patterns',
          'Review and optimize slow queries',
          'Consider data denormalization for read-heavy operations'
        ]
      });
    }

    // Nettoyer les stats d'utilisation anciennes
    await firestoreHelper.updateDocument('platform_stats', 'database_usage', {
      lastOptimizationCheck: new Date(),
      previousSlowQueries: slowQueries,
      slowQueries: [], // Reset pour nouvelle collecte
      frequentQueries: [] // Reset pour nouvelle collecte
    });

  } catch (error) {
    logger.error('Failed to optimize database indexes', error);
  }
}

/**
 * Nettoie les données de cache expirées
 */
async function cleanupExpiredCache(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();

    // Nettoyer le cache de recommandations
    const expiredRecommendations = await firestoreHelper.queryDocuments<any>(
      'recommendation_cache',
      [
        ['expiresAt', '<', now]
      ],
      { limit: 200 }
    );

    stats.itemsProcessed += expiredRecommendations.length;

    const deletePromises = expiredRecommendations.map(async (recommendation) => {
      try {
        await firestoreHelper.deleteDocument('recommendation_cache', recommendation.id);
        stats.itemsDeleted++;
        stats.dataSize += JSON.stringify(recommendation).length;

      } catch (error) {
        logger.error('Failed to delete expired recommendation cache', error, {
          recommendationId: recommendation.id
        });
        stats.errors++;
      }
    });

    await Promise.allSettled(deletePromises);

    // Nettoyer le cache de recherche
    const expiredSearchCache = await firestoreHelper.queryDocuments<any>(
      'search_cache',
      [
        ['lastAccessed', '<', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)] // 7 jours
      ],
      { limit: 200 }
    );

    const searchDeletePromises = expiredSearchCache.map(async (searchItem) => {
      try {
        await firestoreHelper.deleteDocument('search_cache', searchItem.id);
        stats.itemsDeleted++;

      } catch (error) {
        logger.error('Failed to delete expired search cache', error, {
          searchId: searchItem.id
        });
        stats.errors++;
      }
    });

    await Promise.allSettled(searchDeletePromises);

    logger.info('Expired cache cleanup completed', {
      ...stats,
      recommendationsCleaned: expiredRecommendations.length,
      searchCachesCleaned: expiredSearchCache.length
    });

  } catch (error) {
    logger.error('Failed to cleanup expired cache', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Nettoie les données de rate limiting anciennes
 */
async function cleanupRateLimitData(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    itemsProcessed: 0,
    itemsDeleted: 0,
    itemsArchived: 0,
    errors: 0,
    dataSize: 0
  };

  try {
    const now = new Date();
    const rateLimitExpiration = new Date(now.getTime() - RETENTION_POLICY.RATE_LIMITS.EXPIRED_AFTER_HOURS * 60 * 60 * 1000);

    // Nettoyer les compteurs de rate limiting
    const expiredRateLimits = await firestoreHelper.queryDocuments<any>(
      'rate_limits',
      [
        ['resetAt', '<', now]
      ],
      { limit: 1000 }
    );

    stats.itemsProcessed = expiredRateLimits.length;

    // Supprimer par lots
    const batchSize = 50;
    for (let i = 0; i < expiredRateLimits.length; i += batchSize) {
      const batch = expiredRateLimits.slice(i, i + batchSize);

      try {
        const deletePromises = batch.map(rateLimit =>
          firestoreHelper.deleteDocument('rate_limits', rateLimit.id)
        );

        await Promise.all(deletePromises);
        stats.itemsDeleted += batch.length;

      } catch (error) {
        logger.error('Failed to delete rate limit batch', error, {
          batchStart: i,
          batchSize: batch.length
        });
        stats.errors += batch.length;
      }
    }

    logger.info('Rate limit data cleanup completed', stats);

  } catch (error) {
    logger.error('Failed to cleanup rate limit data', error);
    stats.errors++;
  }

  return stats;
}

/**
 * Met à jour les métriques de nettoyage
 */
async function updateCleanupMetrics(results: CleanupResults): Promise<void> {
  try {
    const totalItemsProcessed = Object.values(results).reduce((sum, stats) => {
      return typeof stats === 'object' && 'itemsProcessed' in stats 
        ? sum + stats.itemsProcessed 
        : sum;
    }, 0);

    const totalItemsDeleted = Object.values(results).reduce((sum, stats) => {
      return typeof stats === 'object' && 'itemsDeleted' in stats 
        ? sum + stats.itemsDeleted 
        : sum;
    }, 0);

    const totalDataSize = Object.values(results).reduce((sum, stats) => {
      return typeof stats === 'object' && 'dataSize' in stats 
        ? sum + stats.dataSize 
        : sum;
    }, 0);

    // Mettre à jour les statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'cleanup.totalItemsProcessed': totalItemsProcessed,
      'cleanup.totalItemsDeleted': totalItemsDeleted,
      'cleanup.totalDataCleaned': totalDataSize,
      'cleanup.lastRun': new Date(),
      'cleanup.executionsCount': 1
    });

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.setDocument('platform_stats', `cleanup_${monthKey}`, {
      month: monthKey,
      itemsProcessed: totalItemsProcessed,
      itemsDeleted: totalItemsDeleted,
      dataCleaned: totalDataSize,
      executionTime: results.executionTime,
      batchId: results.batchId,
      breakdown: {
        notifications: results.notifications,
        sessions: results.sessions,
        tempFiles: results.tempFiles,
        analytics: results.analytics,
        logs: results.logs
      },
      updatedAt: new Date()
    });

    logger.info('Cleanup metrics updated', {
      totalItemsProcessed,
      totalItemsDeleted,
      totalDataSize,
      executionTime: results.executionTime,
      monthKey
    });

  } catch (error) {
    logger.error('Failed to update cleanup metrics', error);
  }
}

/**
 * Vérifie l'état de santé du système après nettoyage
 */
async function performHealthCheck(): Promise<void> {
  try {
    // Vérifier les collections principales
    const healthChecks = await Promise.allSettled([
      // Vérifier les utilisateurs actifs
      firestoreHelper.queryDocuments('users', [['status', '==', 'active']], { limit: 1 }),
      
      // Vérifier les projets actifs
      firestoreHelper.queryDocuments('projects', [['status', '==', 'active']], { limit: 1 }),
      
      // Vérifier les notifications récentes
      firestoreHelper.queryDocuments('notifications', [
        ['createdAt', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)]
      ], { limit: 1 }),
      
      // Vérifier les statistiques
      firestoreHelper.getDocument('platform_stats', 'global')
    ]);

    const healthStatus = {
      usersCollection: healthChecks[0].status === 'fulfilled',
      projectsCollection: healthChecks[1].status === 'fulfilled',
      notificationsCollection: healthChecks[2].status === 'fulfilled',
      statisticsCollection: healthChecks[3].status === 'fulfilled',
      overallHealth: healthChecks.every(check => check.status === 'fulfilled')
    };

    // Log de santé du système
    logger.info('System health check completed', {
      ...healthStatus,
      timestamp: new Date().toISOString()
    });

    // Alerter si problème détecté
    if (!healthStatus.overallHealth) {
      logger.security('System health issue detected after cleanup', 'high', {
        healthStatus,
        failedChecks: healthChecks
          .map((check, index) => ({ index, status: check.status }))
          .filter(check => check.status === 'rejected'),
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    logger.error('Failed to perform health check', error);
  }
}

/**
 * Fonction principale de nettoyage
 */
async function executeCleanupProcess(): Promise<CleanupResults> {
  const batchId = helpers.string.generateId('cleanup');
  const startTime = Date.now();

  try {
    logger.info('Starting comprehensive data cleanup', { batchId });

    // Exécuter les nettoyages en parallèle (non critiques)
    const [
      notificationsStats,
      sessionsStats,
      tempFilesStats,
      analyticsStats,
      logsStats
    ] = await Promise.allSettled([
      cleanupExpiredNotifications(),
      cleanupExpiredSessions(),
      cleanupTempFiles(),
      archiveOldAnalytics(),
      cleanupOldLogs()
    ]);

    // Exécution séquentielle pour les tâches sensibles
    await cleanupExpiredKYCData();
    await cleanupRateLimitData();
    await optimizeDatabaseIndexes();

    const results: CleanupResults = {
      notifications: notificationsStats.status === 'fulfilled' ? notificationsStats.value : { itemsProcessed: 0, itemsDeleted: 0, itemsArchived: 0, errors: 1, dataSize: 0 },
      sessions: sessionsStats.status === 'fulfilled' ? sessionsStats.value : { itemsProcessed: 0, itemsDeleted: 0, itemsArchived: 0, errors: 1, dataSize: 0 },
      tempFiles: tempFilesStats.status === 'fulfilled' ? tempFilesStats.value : { itemsProcessed: 0, itemsDeleted: 0, itemsArchived: 0, errors: 1, dataSize: 0 },
      analytics: analyticsStats.status === 'fulfilled' ? analyticsStats.value : { itemsProcessed: 0, itemsDeleted: 0, itemsArchived: 0, errors: 1, dataSize: 0 },
      logs: logsStats.status === 'fulfilled' ? logsStats.value : { itemsProcessed: 0, itemsDeleted: 0, itemsArchived: 0, errors: 1, dataSize: 0 },
      executionTime: Date.now() - startTime,
      batchId
    };

    // Mettre à jour les métriques
    await updateCleanupMetrics(results);

    // Vérification de santé post-nettoyage
    await performHealthCheck();

    return results;

  } catch (error) {
    logger.error('Failed to execute cleanup process', error, { batchId });
    throw error;
  }
}

/**
 * Fonction Cloud Scheduler - Nettoyage quotidien
 */
export const cleanupExpiredData = pubsub
  .schedule('0 3 * * *') // Tous les jours à 3h du matin UTC
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('cleanup_exec');
    const startTime = Date.now();

    try {
      logger.info('Cleanup expired data scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter le processus de nettoyage
      const results = await executeCleanupProcess();

      // Log business
      logger.business('Daily data cleanup completed', 'maintenance', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalItemsProcessed: Object.values(results).reduce((sum, stats) => {
          return typeof stats === 'object' && 'itemsProcessed' in stats 
            ? sum + stats.itemsProcessed 
            : sum;
        }, 0),
        totalItemsDeleted: Object.values(results).reduce((sum, stats) => {
          return typeof stats === 'object' && 'itemsDeleted' in stats 
            ? sum + stats.itemsDeleted 
            : sum;
        }, 0),
        totalDataCleaned: Object.values(results).reduce((sum, stats) => {
          return typeof stats === 'object' && 'dataSize' in stats 
            ? sum + stats.dataSize 
            : sum;
        }, 0),
        executionTime: results.executionTime,
        timestamp: new Date().toISOString()
      });

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'cleanupExpiredData',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 24 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Cleanup expired data scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        itemsProcessed: Object.values(results).reduce((sum, stats) => {
          return typeof stats === 'object' && 'itemsProcessed' in stats 
            ? sum + stats.itemsProcessed 
            : sum;
        }, 0)
      });

    } catch (error) {
      logger.error('Cleanup expired data scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'cleanupExpiredData',
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
        logger.error('Failed to log cleanup execution failure', logError, { executionId });
      }

      throw error;
    }
  });