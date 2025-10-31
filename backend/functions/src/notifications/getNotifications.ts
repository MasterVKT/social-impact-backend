/**
 * Get Notifications Firebase Function
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
import { NotificationsAPI } from '../types/api';
import { UserDocument, NotificationDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, NOTIFICATION_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  limit: Joi.number().min(1).max(100).default(20),
  offset: Joi.number().min(0).default(0),
  unreadOnly: Joi.boolean().default(false),
  types: Joi.array().items(Joi.string().valid(
    'project_update', 'contribution_received', 'audit_assigned', 'audit_completed',
    'payment_processed', 'milestone_approved', 'kyc_status', 'system_announcement',
    'deadline_reminder', 'fund_released', 'dispute_opened', 'message_received'
  )).optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent').optional(),
  startDate: Joi.string().isoDate().optional(),
  endDate: Joi.string().isoDate().optional(),
  includeExpired: Joi.boolean().default(false),
}).optional();

/**
 * Valide l'accès aux notifications
 */
async function validateNotificationAccess(uid: string): Promise<UserDocument> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);

    // Vérifier que l'utilisateur est actif
    if (user.status !== 'active') {
      throw new https.HttpsError('failed-precondition', 'User account is not active');
    }

    return user;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate notification access', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate notification access');
  }
}

/**
 * Construit les filtres de requête pour les notifications
 */
function buildNotificationFilters(
  uid: string,
  data: any
): Array<[string, any, any?]> {
  const filters: Array<[string, any, any?]> = [
    ['recipientUid', '==', uid]
  ];

  // Filtre par statut de lecture
  if (data.unreadOnly) {
    filters.push(['read', '==', false]);
  }

  // Filtre par types
  if (data.types && data.types.length > 0) {
    filters.push(['type', 'in', data.types]);
  }

  // Filtre par priorité
  if (data.priority) {
    filters.push(['priority', '==', data.priority]);
  }

  // Filtre par date de début
  if (data.startDate) {
    filters.push(['createdAt', '>=', new Date(data.startDate)]);
  }

  // Filtre par date de fin
  if (data.endDate) {
    filters.push(['createdAt', '<=', new Date(data.endDate)]);
  }

  // Exclure les notifications expirées par défaut
  if (!data.includeExpired) {
    filters.push(['expiresAt', '>', new Date()]);
    // Ou notifications sans expiration
    filters.push(['expiresAt', '==', null]);
  }

  // Exclure les notifications remplacées
  filters.push(['superseded', '!=', true]);

  return filters;
}

/**
 * Enrichit les notifications avec des données additionnelles
 */
async function enrichNotifications(
  notifications: NotificationDocument[]
): Promise<NotificationsAPI.NotificationItem[]> {
  try {
    const enrichedNotifications = await Promise.all(
      notifications.map(async (notification) => {
        try {
          let enrichedData = { ...notification.data };

          // Enrichir selon le type de notification
          switch (notification.type) {
            case 'project_update':
            case 'contribution_received':
            case 'milestone_approved':
              if (notification.data.projectId) {
                try {
                  const project = await firestoreHelper.getDocument('projects', notification.data.projectId);
                  enrichedData.projectTitle = project.title;
                  enrichedData.projectSlug = project.slug;
                } catch (error) {
                  logger.warn('Failed to enrich project data for notification', { 
                    notificationId: notification.id,
                    projectId: notification.data.projectId 
                  });
                }
              }
              break;

            case 'audit_assigned':
            case 'audit_completed':
              if (notification.data.auditId) {
                try {
                  const audit = await firestoreHelper.getDocument('audits', notification.data.auditId);
                  enrichedData.projectTitle = audit.projectTitle;
                  enrichedData.auditorName = audit.auditorName;
                } catch (error) {
                  logger.warn('Failed to enrich audit data for notification', { 
                    notificationId: notification.id,
                    auditId: notification.data.auditId 
                  });
                }
              }
              break;

            case 'payment_processed':
            case 'fund_released':
              if (notification.data.amount) {
                enrichedData.formattedAmount = `€${(notification.data.amount / 100).toFixed(2)}`;
              }
              break;

            case 'message_received':
              if (notification.senderUid && notification.senderUid !== 'system') {
                try {
                  const sender = await firestoreHelper.getDocument<UserDocument>('users', notification.senderUid);
                  enrichedData.senderName = `${sender.firstName} ${sender.lastName}`;
                  enrichedData.senderProfilePicture = sender.profilePicture;
                } catch (error) {
                  logger.warn('Failed to enrich sender data for notification', { 
                    notificationId: notification.id,
                    senderUid: notification.senderUid 
                  });
                }
              }
              break;
          }

          return {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: enrichedData,
            read: notification.read,
            createdAt: notification.createdAt.toISOString(),
            priority: notification.priority,
            actionUrl: notification.actionUrl,
            expiresAt: notification.expiresAt?.toISOString(),
            readAt: notification.readAt?.toISOString(),
          } as NotificationsAPI.NotificationItem;

        } catch (error) {
          logger.error('Failed to enrich individual notification', error, { 
            notificationId: notification.id 
          });
          
          // Retourner la notification de base en cas d'erreur d'enrichissement
          return {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: notification.data,
            read: notification.read,
            createdAt: notification.createdAt.toISOString(),
            priority: notification.priority,
            actionUrl: notification.actionUrl,
            expiresAt: notification.expiresAt?.toISOString(),
            readAt: notification.readAt?.toISOString(),
          } as NotificationsAPI.NotificationItem;
        }
      })
    );

    return enrichedNotifications;

  } catch (error) {
    logger.error('Failed to enrich notifications', error);
    throw new https.HttpsError('internal', 'Unable to enrich notification data');
  }
}

/**
 * Calcule le nombre de notifications non lues
 */
async function getUnreadCount(uid: string, filters?: any): Promise<number> {
  try {
    // Construire les filtres pour les non lues uniquement
    const unreadFilters = buildNotificationFilters(uid, { ...filters, unreadOnly: true });

    const unreadNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      unreadFilters,
      { limit: NOTIFICATION_CONFIG.MAX_UNREAD_COUNT }
    );

    return Math.min(unreadNotifications.length, NOTIFICATION_CONFIG.MAX_UNREAD_COUNT);

  } catch (error) {
    logger.error('Failed to get unread count', error, { uid });
    return 0; // Retourner 0 en cas d'erreur
  }
}

/**
 * Met à jour les métriques d'engagement des notifications
 */
async function updateNotificationEngagementMetrics(
  uid: string,
  notificationsReturned: number,
  unreadCount: number
): Promise<void> {
  try {
    const now = new Date();

    // Mettre à jour les métriques utilisateur
    await firestoreHelper.updateDocument('users', uid, {
      'notificationCounters.lastAccess': now,
      'notificationCounters.totalAccesses': firestoreHelper.increment(1),
      updatedAt: now,
    });

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'notifications.accessCount': 1,
      'notifications.averageUnreadCount': unreadCount,
    });

    logger.info('Notification engagement metrics updated', {
      uid,
      notificationsReturned,
      unreadCount,
      accessTime: now.toISOString(),
    });

  } catch (error) {
    logger.error('Failed to update notification engagement metrics', error, { uid });
    // Ne pas faire échouer la récupération pour les métriques
  }
}

/**
 * Nettoie les anciennes notifications expirées
 */
async function cleanupExpiredNotifications(uid: string): Promise<void> {
  try {
    const now = new Date();
    
    // Récupérer les notifications expirées
    const expiredNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['recipientUid', '==', uid],
        ['expiresAt', '<', now],
        ['read', '==', false]
      ],
      { limit: 50 }
    );

    if (expiredNotifications.length === 0) {
      return;
    }

    // Marquer comme expirées en lot
    const updatePromises = expiredNotifications.map(notification =>
      firestoreHelper.updateDocument('notifications', notification.id, {
        expired: true,
        expiredAt: now,
        read: true, // Marquer comme lu pour ne plus compter
        readAt: now,
      })
    );

    await Promise.all(updatePromises);

    // Mettre à jour le compteur utilisateur
    await firestoreHelper.updateDocument('users', uid, {
      'notificationCounters.unread': firestoreHelper.increment(-expiredNotifications.length),
      'notificationCounters.expired': firestoreHelper.increment(expiredNotifications.length),
    });

    logger.info('Expired notifications cleaned up', {
      uid,
      expiredCount: expiredNotifications.length,
    });

  } catch (error) {
    logger.error('Failed to cleanup expired notifications', error, { uid });
    // Ne pas faire échouer la récupération pour le nettoyage
  }
}

/**
 * Exécute la récupération des notifications
 */
async function executeGetNotifications(
  data: any,
  context: CallableContext
): Promise<NotificationsAPI.NotificationsListResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'accès
  const user = await validateNotificationAccess(uid);
  
  // Nettoyage préventif des notifications expirées
  await cleanupExpiredNotifications(uid);
  
  // Construction des filtres de requête
  const filters = buildNotificationFilters(uid, data);
  
  // Récupération des notifications en parallèle avec le compteur non lu
  const [notifications, unreadCount] = await Promise.all([
    firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      filters,
      {
        orderBy: [
          { field: 'priority', direction: 'desc' }, // Priorité d'abord
          { field: 'createdAt', direction: 'desc' }  // Puis par date
        ],
        limit: data.limit,
        offset: data.offset
      }
    ),
    getUnreadCount(uid, data)
  ]);
  
  // Enrichissement des notifications
  const enrichedNotifications = await enrichNotifications(notifications);
  
  // Mise à jour des métriques d'engagement
  await updateNotificationEngagementMetrics(uid, notifications.length, unreadCount);
  
  // Log business
  logger.business('Notifications retrieved', 'notifications', {
    recipientUid: uid,
    notificationsReturned: notifications.length,
    unreadCount,
    filters: {
      unreadOnly: data.unreadOnly,
      types: data.types,
      priority: data.priority,
      hasDateRange: !!(data.startDate || data.endDate),
    },
    pagination: {
      limit: data.limit,
      offset: data.offset,
    },
  });

  return {
    unreadCount,
    notifications: enrichedNotifications,
    hasMore: notifications.length === data.limit,
    totalCount: unreadCount + (data.unreadOnly ? 0 : notifications.length),
    filters: {
      unreadOnly: data.unreadOnly,
      types: data.types,
      priority: data.priority,
      dateRange: data.startDate || data.endDate ? {
        start: data.startDate,
        end: data.endDate
      } : null
    },
    pagination: {
      limit: data.limit,
      offset: data.offset,
      nextOffset: data.offset + notifications.length
    }
  };
}

/**
 * Firebase Function principale
 */
export const getNotifications = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<NotificationsAPI.NotificationsListResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données (optionnelles)
    const validatedData = validateWithJoi<any>(requestSchema, data || {});

    // Logging de démarrage
    logger.info('Getting user notifications', {
      functionName: 'getNotifications',
      uid: context.auth.uid,
      limit: validatedData.limit,
      offset: validatedData.offset,
      unreadOnly: validatedData.unreadOnly,
      types: validatedData.types,
      priority: validatedData.priority,
      hasDateRange: !!(validatedData.startDate || validatedData.endDate),
    });

    // Exécution
    const result = await executeGetNotifications(validatedData, context);

    // Logging de succès
    logger.info('Notifications retrieved successfully', {
      functionName: 'getNotifications',
      uid: context.auth.uid,
      notificationsReturned: result.notifications.length,
      unreadCount: result.unreadCount,
      hasMore: result.hasMore,
      success: true,
    });

    return result;
  })
);