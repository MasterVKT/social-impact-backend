/**
 * Mark Notification as Read Firebase Function
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
  notificationIds: Joi.array().items(Joi.string()).min(1).max(50).when('markAll', {
    is: true,
    then: Joi.optional(),
    otherwise: Joi.required()
  }),
  markAll: Joi.boolean().default(false),
  types: Joi.array().items(Joi.string().valid(
    'project_update', 'contribution_received', 'audit_assigned', 'audit_completed',
    'payment_processed', 'milestone_approved', 'kyc_status', 'system_announcement',
    'deadline_reminder', 'fund_released', 'dispute_opened', 'message_received'
  )).when('markAll', { is: true, then: Joi.optional() }),
  olderThan: Joi.string().isoDate().when('markAll', { is: true, then: Joi.optional() }),
}).required();

/**
 * Valide l'accès aux notifications
 */
async function validateNotificationReadAccess(uid: string): Promise<UserDocument> {
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
    logger.error('Failed to validate notification read access', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate notification access');
  }
}

/**
 * Valide que l'utilisateur peut marquer ces notifications comme lues
 */
async function validateNotificationOwnership(
  uid: string,
  notificationIds: string[]
): Promise<NotificationDocument[]> {
  try {
    const notifications = await Promise.all(
      notificationIds.map(id => 
        firestoreHelper.getDocument<NotificationDocument>('notifications', id)
      )
    );

    // Vérifier que toutes les notifications appartiennent à l'utilisateur
    const invalidNotifications = notifications.filter(notification => 
      notification.recipientUid !== uid
    );

    if (invalidNotifications.length > 0) {
      throw new https.HttpsError('permission-denied', 
        `Cannot mark notifications that don't belong to you: ${invalidNotifications.map(n => n.id).join(', ')}`);
    }

    // Filtrer les notifications déjà lues
    const unreadNotifications = notifications.filter(notification => !notification.read);

    return unreadNotifications;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate notification ownership', error, { uid, notificationIds });
    throw new https.HttpsError('internal', 'Unable to validate notification ownership');
  }
}

/**
 * Marque des notifications spécifiques comme lues
 */
async function markSpecificNotificationsAsRead(
  uid: string,
  notificationIds: string[]
): Promise<{ marked: number; readAt: string }> {
  try {
    if (notificationIds.length === 0) {
      return { marked: 0, readAt: new Date().toISOString() };
    }

    // Valider la propriété des notifications
    const unreadNotifications = await validateNotificationOwnership(uid, notificationIds);

    if (unreadNotifications.length === 0) {
      logger.info('No unread notifications to mark', { uid, requestedIds: notificationIds });
      return { marked: 0, readAt: new Date().toISOString() };
    }

    const now = new Date();

    // Marquer comme lues en transaction pour maintenir la cohérence
    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour chaque notification
      unreadNotifications.forEach(notification => {
        const notificationRef = firestoreHelper.getDocumentRef('notifications', notification.id);
        transaction.update(notificationRef, {
          read: true,
          readAt: now,
          updatedAt: now,
        });
      });

      // Mettre à jour le compteur utilisateur
      const userRef = firestoreHelper.getDocumentRef('users', uid);
      transaction.update(userRef, {
        'notificationCounters.unread': firestoreHelper.increment(-unreadNotifications.length),
        'notificationCounters.lastReadAt': now,
        updatedAt: now,
      });
    });

    logger.info('Specific notifications marked as read', {
      uid,
      markedCount: unreadNotifications.length,
      notificationIds: unreadNotifications.map(n => n.id),
      readAt: now.toISOString(),
    });

    return {
      marked: unreadNotifications.length,
      readAt: now.toISOString(),
    };

  } catch (error) {
    logger.error('Failed to mark specific notifications as read', error, { uid, notificationIds });
    throw new https.HttpsError('internal', 'Unable to mark notifications as read');
  }
}

/**
 * Marque toutes les notifications comme lues avec filtres optionnels
 */
async function markAllNotificationsAsRead(
  uid: string,
  filters: { types?: string[]; olderThan?: string }
): Promise<{ marked: number; readAt: string }> {
  try {
    const now = new Date();

    // Construire les filtres de requête
    const queryFilters: Array<[string, any, any?]> = [
      ['recipientUid', '==', uid],
      ['read', '==', false],
      ['superseded', '!=', true], // Exclure les notifications remplacées
    ];

    // Filtre par types
    if (filters.types && filters.types.length > 0) {
      queryFilters.push(['type', 'in', filters.types]);
    }

    // Filtre par date
    if (filters.olderThan) {
      queryFilters.push(['createdAt', '<', new Date(filters.olderThan)]);
    }

    // Récupérer les notifications non lues
    const unreadNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      queryFilters,
      { limit: NOTIFICATION_CONFIG.MAX_BULK_READ_OPERATIONS }
    );

    if (unreadNotifications.length === 0) {
      logger.info('No unread notifications found to mark as read', { uid, filters });
      return { marked: 0, readAt: now.toISOString() };
    }

    // Traitement par lots pour éviter les timeouts
    const batchSize = 25;
    let totalMarked = 0;

    for (let i = 0; i < unreadNotifications.length; i += batchSize) {
      const batch = unreadNotifications.slice(i, i + batchSize);
      
      try {
        await firestoreHelper.runTransaction(async (transaction) => {
          // Marquer chaque notification du lot
          batch.forEach(notification => {
            const notificationRef = firestoreHelper.getDocumentRef('notifications', notification.id);
            transaction.update(notificationRef, {
              read: true,
              readAt: now,
              updatedAt: now,
            });
          });

          // Mettre à jour le compteur utilisateur pour ce lot
          const userRef = firestoreHelper.getDocumentRef('users', uid);
          transaction.update(userRef, {
            'notificationCounters.unread': firestoreHelper.increment(-batch.length),
            'notificationCounters.lastReadAt': now,
            'notificationCounters.lastBulkRead': {
              count: batch.length,
              timestamp: now,
              filters,
            },
            updatedAt: now,
          });
        });

        totalMarked += batch.length;

        logger.info('Notification batch marked as read', {
          uid,
          batchSize: batch.length,
          batchNumber: Math.floor(i / batchSize) + 1,
          totalProcessed: totalMarked,
        });

      } catch (error) {
        logger.error('Failed to process notification batch', error, {
          uid,
          batchStart: i,
          batchSize: batch.length,
        });
        
        // Continuer avec le lot suivant en cas d'erreur
        continue;
      }
    }

    // Si on a atteint la limite, signaler qu'il pourrait y en avoir plus
    if (unreadNotifications.length === NOTIFICATION_CONFIG.MAX_BULK_READ_OPERATIONS) {
      logger.warn('Maximum bulk read limit reached, some notifications may remain unread', {
        uid,
        processedCount: totalMarked,
        maxLimit: NOTIFICATION_CONFIG.MAX_BULK_READ_OPERATIONS,
      });
    }

    logger.info('All notifications marked as read', {
      uid,
      totalMarked,
      filters,
      readAt: now.toISOString(),
    });

    return {
      marked: totalMarked,
      readAt: now.toISOString(),
    };

  } catch (error) {
    logger.error('Failed to mark all notifications as read', error, { uid, filters });
    throw new https.HttpsError('internal', 'Unable to mark all notifications as read');
  }
}

/**
 * Met à jour les métriques de lecture des notifications
 */
async function updateReadMetrics(
  uid: string,
  markedCount: number,
  isMarkAll: boolean,
  types?: string[]
): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'notifications.totalRead': markedCount,
      'notifications.bulkReadOperations': isMarkAll ? 1 : 0,
      'notifications.individualReadOperations': isMarkAll ? 0 : 1,
    });

    // Statistiques par type si fourni
    if (types && types.length > 0) {
      for (const type of types) {
        await firestoreHelper.incrementDocument('platform_stats', 'global', {
          [`notifications.readByType.${type}`]: markedCount,
        });
      }
    }

    // Métriques utilisateur
    await firestoreHelper.incrementDocument('users', uid, {
      'stats.notificationsRead': markedCount,
      'stats.lastReadActivity': new Date(),
    });

    logger.info('Read metrics updated', {
      uid,
      markedCount,
      isMarkAll,
      types,
    });

  } catch (error) {
    logger.error('Failed to update read metrics', error, { uid, markedCount });
    // Ne pas faire échouer l'opération pour les métriques
  }
}

/**
 * Exécute le marquage comme lu
 */
async function executeMarkAsRead(
  data: any,
  context: CallableContext
): Promise<NotificationsAPI.MarkNotificationReadResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'accès
  const user = await validateNotificationAccess(uid);
  
  let result: { marked: number; readAt: string };
  
  if (data.markAll) {
    // Marquer toutes les notifications avec filtres optionnels
    result = await markAllNotificationsAsRead(uid, {
      types: data.types,
      olderThan: data.olderThan,
    });
  } else {
    // Marquer des notifications spécifiques
    result = await markSpecificNotificationsAsRead(uid, data.notificationIds);
  }
  
  // Mise à jour des métriques
  await updateReadMetrics(uid, result.marked, data.markAll, data.types);
  
  // Log business
  logger.business('Notifications marked as read', 'notifications', {
    recipientUid: uid,
    markedCount: result.marked,
    isMarkAll: data.markAll,
    types: data.types,
    olderThan: data.olderThan,
    specificIds: data.notificationIds,
    readAt: result.readAt,
  });

  return {
    marked: result.marked > 0,
    readAt: result.readAt,
    count: result.marked,
    operation: data.markAll ? 'mark_all' : 'mark_specific',
    filters: data.markAll ? {
      types: data.types,
      olderThan: data.olderThan,
    } : undefined,
  };
}

/**
 * Firebase Function principale
 */
export const markAsRead = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<NotificationsAPI.MarkNotificationReadResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<any>(requestSchema, data);

    // Logging de démarrage
    logger.info('Marking notifications as read', {
      functionName: 'markAsRead',
      uid: context.auth.uid,
      markAll: validatedData.markAll,
      notificationIds: validatedData.notificationIds,
      types: validatedData.types,
      olderThan: validatedData.olderThan,
    });

    // Exécution
    const result = await executeMarkAsRead(validatedData, context);

    // Logging de succès
    logger.info('Notifications marked as read successfully', {
      functionName: 'markAsRead',
      uid: context.auth.uid,
      markedCount: result.count,
      operation: result.operation,
      success: true,
    });

    return result;
  })
);