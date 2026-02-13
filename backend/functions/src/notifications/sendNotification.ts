/**
 * Send Notification Firebase Function
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
import { emailService } from '../integrations/sendgrid/emailService';
import { NotificationsAPI } from '../types/api';
import { UserDocument, NotificationDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, NOTIFICATION_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  recipientUid: Joi.string().required(),
  type: Joi.string().valid(
    'project_update', 'contribution_received', 'audit_assigned', 'audit_completed',
    'payment_processed', 'milestone_approved', 'kyc_status', 'system_announcement',
    'deadline_reminder', 'fund_released', 'dispute_opened', 'message_received'
  ).required(),
  title: Joi.string().min(5).max(100).required(),
  message: Joi.string().min(10).max(500).required(),
  data: Joi.object().default({}),
  channels: Joi.object({
    inApp: Joi.boolean().default(true),
    email: Joi.boolean().default(false),
    push: Joi.boolean().default(false),
  }).default({ inApp: true, email: false, push: false }),
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
  scheduledFor: Joi.string().isoDate().optional(),
  expiresAt: Joi.string().isoDate().optional(),
  actionUrl: Joi.string().uri().optional(),
  groupKey: Joi.string().max(100).optional(), // Pour grouper les notifications similaires
}).required();

/**
 * Valide les permissions d'envoi de notification
 */
async function validateNotificationPermissions(
  senderUid: string,
  recipientUid: string,
  notificationType: string
): Promise<{ sender: UserDocument; recipient: UserDocument }> {
  try {
    const [sender, recipient] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', senderUid),
      firestoreHelper.getDocument<UserDocument>('users', recipientUid)
    ]);

    // Vérifier que le destinataire existe et est actif
    if (recipient.status !== 'active') {
      throw new https.HttpsError('failed-precondition', 'Recipient account is not active');
    }

    // Vérifier les permissions selon le type de notification
    const systemNotifications = ['system_announcement', 'kyc_status', 'payment_processed'];
    const adminNotifications = ['audit_assigned', 'project_approved', 'dispute_opened'];

    if (systemNotifications.includes(notificationType)) {
      // Notifications système - besoin de permissions admin
      if (!sender.permissions.includes(USER_PERMISSIONS.SYSTEM_ADMIN)) {
        throw new https.HttpsError('permission-denied', 'System admin access required for system notifications');
      }
    } else if (adminNotifications.includes(notificationType)) {
      // Notifications admin - besoin de permissions modération
      if (!sender.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS) &&
          !sender.permissions.includes(USER_PERMISSIONS.SYSTEM_ADMIN)) {
        throw new https.HttpsError('permission-denied', 'Admin access required for this notification type');
      }
    } else {
      // Notifications normales - vérifier la relation entre sender et recipient
      const canSendToUser = await validateUserRelationship(sender, recipient, notificationType);
      if (!canSendToUser) {
        throw new https.HttpsError('permission-denied', 'Cannot send notification to this user');
      }
    }

    return { sender, recipient };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate notification permissions', error, { senderUid, recipientUid, notificationType });
    throw new https.HttpsError('internal', 'Unable to validate notification permissions');
  }
}

/**
 * Valide la relation entre deux utilisateurs pour l'envoi de notifications
 */
async function validateUserRelationship(
  sender: UserDocument,
  recipient: UserDocument,
  notificationType: string
): Promise<boolean> {
  try {
    // Les créateurs peuvent notifier leurs contributeurs
    if (notificationType === 'project_update') {
      const sharedProjects = await firestoreHelper.queryDocuments<any>(
        'projects',
        [
          ['creatorUid', '==', sender.uid],
          ['contributors', 'array-contains', recipient.uid]
        ],
        { limit: 1 }
      );
      return sharedProjects.data.length > 0;
    }

    // Les auditeurs peuvent notifier les créateurs de leurs projets audités
    if (notificationType === 'audit_completed') {
      const auditedProjects = await firestoreHelper.queryDocuments<any>(
        'audits',
        [
          ['auditorUid', '==', sender.uid],
          ['projectCreatorUid', '==', recipient.uid],
          ['status', '==', STATUS.AUDIT.COMPLETED]
        ],
        { limit: 1 }
      );
      return auditedProjects.data.length > 0;
    }

    // Messages directs entre utilisateurs connectés
    if (notificationType === 'message_received') {
      return true; // Permettre les messages directs pour l'instant
    }

    return false;

  } catch (error) {
    logger.error('Failed to validate user relationship', error, {
      senderUid: sender.uid,
      recipientUid: recipient.uid,
      notificationType
    });
    return false;
  }
}

/**
 * Vérifie les préférences de notification du destinataire
 */
function checkRecipientPreferences(
  recipient: UserDocument,
  channels: any,
  notificationType: string
): { inApp: boolean; email: boolean; push: boolean } {
  const preferences = recipient.preferences?.notifications || {};
  
  // Préférences par défaut
  const defaultPrefs = {
    inApp: true,
    email: true,
    push: false
  };

  // Préférences spécifiques par type
  const typePreferences = preferences[notificationType] || {};

  return {
    inApp: channels.inApp && (typePreferences.inApp ?? preferences.inApp ?? defaultPrefs.inApp),
    email: channels.email && (typePreferences.email ?? preferences.email ?? defaultPrefs.email),
    push: channels.push && (typePreferences.push ?? preferences.push ?? defaultPrefs.push)
  };
}

/**
 * Crée la notification in-app
 */
async function createInAppNotification(
  recipient: UserDocument,
  data: NotificationsAPI.SendNotificationRequest,
  notificationId: string
): Promise<void> {
  try {
    const notification: NotificationDocument = {
      id: notificationId,
      recipientUid: recipient.uid,
      senderUid: data.senderUid || 'system',
      type: data.type,
      title: data.title,
      message: data.message,
      data: data.data || {},
      
      // Paramètres
      priority: data.priority || 'medium',
      actionUrl: data.actionUrl,
      groupKey: data.groupKey,
      
      // État
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      
      // Planification
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : new Date(),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      
      // Métadonnées
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    // Transaction pour créer la notification et mettre à jour les compteurs
    await firestoreHelper.runTransaction(async (transaction) => {
      // Créer la notification
      const notificationRef = firestoreHelper.getDocumentRef('notifications', notificationId);
      transaction.set(notificationRef, notification);

      // Mettre à jour le compteur de notifications non lues
      const userRef = firestoreHelper.getDocumentRef('users', recipient.uid);
      transaction.update(userRef, {
        'notificationCounters.unread': firestoreHelper.increment(1),
        'notificationCounters.lastNotificationAt': new Date(),
        updatedAt: new Date(),
      });
    });

    logger.info('In-app notification created', {
      notificationId,
      recipientUid: recipient.uid,
      type: data.type,
      priority: data.priority,
    });

  } catch (error) {
    logger.error('Failed to create in-app notification', error, {
      notificationId,
      recipientUid: recipient.uid,
      type: data.type,
    });
    throw error;
  }
}

/**
 * Envoie la notification par email
 */
async function sendEmailNotification(
  recipient: UserDocument,
  data: NotificationsAPI.SendNotificationRequest
): Promise<boolean> {
  try {
    // Déterminer le template email selon le type
    const templateMap: Record<string, string> = {
      'project_update': 'project_update_notification',
      'contribution_received': 'contribution_received',
      'audit_assigned': 'audit_assignment',
      'audit_completed': 'audit_completed_notification',
      'payment_processed': 'payment_confirmation',
      'milestone_approved': 'milestone_approved',
      'kyc_status': 'kyc_status_update',
      'system_announcement': 'system_announcement',
      'deadline_reminder': 'deadline_reminder',
      'fund_released': 'fund_release_notification',
      'dispute_opened': 'dispute_notification',
      'message_received': 'direct_message',
    };

    const templateId = templateMap[data.type] || 'generic_notification';

    const emailData = {
      to: recipient.email,
      templateId,
      dynamicTemplateData: {
        recipientName: `${recipient.firstName} ${recipient.lastName}`,
        notificationTitle: data.title,
        notificationMessage: data.message,
        actionUrl: data.actionUrl,
        priority: data.priority,
        type: data.type,
        unsubscribeUrl: `${process.env.FRONTEND_URL}/settings/notifications`,
        timestamp: new Date().toLocaleDateString('fr-FR'),
        ...data.data, // Données spécifiques au type
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Email notification sent', {
      recipientEmail: recipient.email,
      templateId,
      type: data.type,
      priority: data.priority,
    });

    return true;

  } catch (error) {
    logger.error('Failed to send email notification', error, {
      recipientUid: recipient.uid,
      type: data.type,
      templateId: templateMap[data.type] || 'generic_notification',
    });
    return false;
  }
}

/**
 * Envoie la notification push (placeholder pour future implémentation)
 */
async function sendPushNotification(
  recipient: UserDocument,
  data: NotificationsAPI.SendNotificationRequest
): Promise<boolean> {
  try {
    // Récupérer les tokens de l'appareil du destinataire
    const deviceTokens = await firestoreHelper.queryDocuments<any>(
      `users/${recipient.uid}/devices`,
      [
        ['active', '==', true],
        ['pushEnabled', '==', true]
      ]
    );

    if (deviceTokens.data.length === 0) {
      logger.info('No active push tokens for user', { recipientUid: recipient.uid });
      return false;
    }

    // TODO: Implémenter l'envoi de notifications push via FCM
    // Pour l'instant, on log seulement
    logger.info('Push notification would be sent', {
      recipientUid: recipient.uid,
      type: data.type,
      title: data.title,
      deviceCount: deviceTokens.data.length,
    });

    return true;

  } catch (error) {
    logger.error('Failed to send push notification', error, {
      recipientUid: recipient.uid,
      type: data.type,
    });
    return false;
  }
}

/**
 * Gère le groupement de notifications similaires
 */
async function handleNotificationGrouping(
  recipient: UserDocument,
  data: NotificationsAPI.SendNotificationRequest
): Promise<void> {
  try {
    if (!data.groupKey) {
      return; // Pas de groupement
    }

    // Marquer les anciennes notifications du même groupe comme remplacées
    const similarNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['recipientUid', '==', recipient.uid],
        ['groupKey', '==', data.groupKey],
        ['read', '==', false]
      ]
    );

    if (similarNotifications.data.length > 0) {
      const updatePromises = similarNotifications.data.map(notification =>
        firestoreHelper.updateDocument('notifications', notification.id, {
          superseded: true,
          supersededAt: new Date(),
          supersededBy: data.type,
        })
      );

      await Promise.all(updatePromises);

      logger.info('Grouped notifications superseded', {
        recipientUid: recipient.uid,
        groupKey: data.groupKey,
        supersededCount: similarNotifications.data.length,
      });
    }

  } catch (error) {
    logger.error('Failed to handle notification grouping', error, {
      recipientUid: recipient.uid,
      groupKey: data.groupKey,
    });
    // Ne pas faire échouer l'envoi pour le groupement
  }
}

/**
 * Met à jour les statistiques de notification
 */
async function updateNotificationStats(
  data: NotificationsAPI.SendNotificationRequest,
  channels: { inApp: boolean; email: boolean; push: boolean },
  results: { inApp: boolean; email: boolean; push: boolean }
): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'notifications.totalSent': 1,
      [`notifications.byType.${data.type}`]: 1,
      [`notifications.byPriority.${data.priority}`]: 1,
      'notifications.inAppSent': results.inApp ? 1 : 0,
      'notifications.emailSent': results.email ? 1 : 0,
      'notifications.pushSent': results.push ? 1 : 0,
    });

    // Statistiques de l'expéditeur si ce n'est pas système
    if (data.senderUid && data.senderUid !== 'system') {
      await firestoreHelper.incrementDocument('users', data.senderUid, {
        'stats.notificationsSent': 1,
        [`stats.notificationsByType.${data.type}`]: 1,
      });
    }

    logger.info('Notification statistics updated', {
      type: data.type,
      priority: data.priority,
      channels: Object.keys(channels).filter(key => channels[key as keyof typeof channels]),
      results: Object.keys(results).filter(key => results[key as keyof typeof results]),
    });

  } catch (error) {
    logger.error('Failed to update notification statistics', error, {
      type: data.type,
      senderUid: data.senderUid,
    });
    // Ne pas faire échouer l'envoi pour les stats
  }
}

/**
 * Vérifie les limites de taux d'envoi
 */
async function checkRateLimits(
  senderUid: string,
  recipientUid: string,
  notificationType: string
): Promise<void> {
  try {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Vérifier les limites par expéditeur
    const senderNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['senderUid', '==', senderUid],
        ['createdAt', '>=', hourAgo]
      ]
    );

    if (senderNotifications.data.length >= NOTIFICATION_CONFIG.MAX_PER_SENDER_PER_HOUR) {
      throw new https.HttpsError('resource-exhausted',
        `Sender rate limit exceeded: ${NOTIFICATION_CONFIG.MAX_PER_SENDER_PER_HOUR} notifications per hour`);
    }

    // Vérifier les limites par destinataire
    const recipientNotifications = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['recipientUid', '==', recipientUid],
        ['createdAt', '>=', hourAgo]
      ]
    );

    if (recipientNotifications.data.length >= NOTIFICATION_CONFIG.MAX_PER_RECIPIENT_PER_HOUR) {
      throw new https.HttpsError('resource-exhausted',
        `Recipient rate limit exceeded: ${NOTIFICATION_CONFIG.MAX_PER_RECIPIENT_PER_HOUR} notifications per hour`);
    }

    // Vérifier les limites par type
    const typeNotifications = senderNotifications.data.filter(n => n.type === notificationType);
    const maxPerType = NOTIFICATION_CONFIG.MAX_PER_TYPE_PER_HOUR[notificationType] ||
                      NOTIFICATION_CONFIG.DEFAULT_MAX_PER_TYPE_PER_HOUR;

    if (typeNotifications.length >= maxPerType) {
      throw new https.HttpsError('resource-exhausted',
        `Type rate limit exceeded: ${maxPerType} ${notificationType} notifications per hour`);
    }

    logger.info('Rate limits validated', {
      senderUid,
      recipientUid,
      notificationType,
      senderCount: senderNotifications.data.length,
      recipientCount: recipientNotifications.data.length,
      typeCount: typeNotifications.length,
    });

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to check rate limits', error, { senderUid, recipientUid, notificationType });
    // Ne pas faire échouer pour les vérifications de taux
  }
}

/**
 * Vérifie si la notification est en doublon récent
 */
async function checkForDuplicates(
  recipientUid: string,
  data: NotificationsAPI.SendNotificationRequest
): Promise<boolean> {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentSimilar = await firestoreHelper.queryDocuments<NotificationDocument>(
      'notifications',
      [
        ['recipientUid', '==', recipientUid],
        ['type', '==', data.type],
        ['title', '==', data.title],
        ['createdAt', '>=', fiveMinutesAgo]
      ],
      { limit: 1 }
    );

    if (recentSimilar.data.length > 0) {
      logger.info('Duplicate notification detected', {
        recipientUid,
        type: data.type,
        title: data.title,
        existingNotificationId: recentSimilar.data[0].id,
      });
      return true;
    }

    return false;

  } catch (error) {
    logger.error('Failed to check for duplicates', error, { recipientUid, type: data.type });
    return false; // En cas d'erreur, permettre l'envoi
  }
}

/**
 * Exécute l'envoi de notification
 */
async function executeSendNotification(
  data: NotificationsAPI.SendNotificationRequest,
  context: CallableContext
): Promise<void> {
  const senderUid = context.auth!.uid;
  
  // Validation des permissions
  const { sender, recipient } = await validateNotificationPermissions(
    senderUid,
    data.recipientUid,
    data.type
  );
  
  // Vérification des limites de taux
  await checkRateLimits(senderUid, data.recipientUid, data.type);
  
  // Vérification des doublons
  const isDuplicate = await checkForDuplicates(data.recipientUid, data);
  if (isDuplicate) {
    logger.info('Notification skipped due to recent duplicate', {
      recipientUid: data.recipientUid,
      type: data.type,
      title: data.title,
    });
    return;
  }
  
  // Vérifier les préférences du destinataire
  const effectiveChannels = checkRecipientPreferences(recipient, data.channels, data.type);
  
  // Si aucun canal n'est activé, on arrête
  if (!effectiveChannels.inApp && !effectiveChannels.email && !effectiveChannels.push) {
    logger.info('Notification skipped - all channels disabled by recipient', {
      recipientUid: data.recipientUid,
      type: data.type,
      preferences: effectiveChannels,
    });
    return;
  }
  
  // Gestion du groupement si nécessaire
  await handleNotificationGrouping(recipient, data);
  
  // Génération de l'ID de notification
  const notificationId = helpers.string.generateId('notif');
  
  // Envoi selon les canaux activés en parallèle
  const sendingResults = await Promise.allSettled([
    effectiveChannels.inApp ? createInAppNotification(recipient, { ...data, senderUid }, notificationId) : Promise.resolve(false),
    effectiveChannels.email ? sendEmailNotification(recipient, data) : Promise.resolve(false),
    effectiveChannels.push ? sendPushNotification(recipient, data) : Promise.resolve(false),
  ]);

  // Analyser les résultats
  const results = {
    inApp: sendingResults[0].status === 'fulfilled' && effectiveChannels.inApp,
    email: sendingResults[1].status === 'fulfilled' && sendingResults[1].value === true,
    push: sendingResults[2].status === 'fulfilled' && sendingResults[2].value === true,
  };

  // Mettre à jour les statistiques
  await updateNotificationStats(data, effectiveChannels, results);

  // Log business
  logger.business('Notification sent', 'notifications', {
    notificationId,
    senderUid,
    recipientUid: data.recipientUid,
    type: data.type,
    title: data.title,
    priority: data.priority,
    channels: effectiveChannels,
    results,
    groupKey: data.groupKey,
    hasActionUrl: !!data.actionUrl,
  });

  // Log security pour les notifications importantes
  if (data.priority === 'urgent' || ['system_announcement', 'dispute_opened'].includes(data.type)) {
    logger.security('High priority notification sent', 'low', {
      notificationId,
      senderUid,
      recipientUid: data.recipientUid,
      type: data.type,
      priority: data.priority,
      deliveryChannels: Object.keys(results).filter(key => results[key as keyof typeof results]),
    });
  }
}

/**
 * Firebase Function principale
 */
export const sendNotification = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<void> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<NotificationsAPI.SendNotificationRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Sending notification', {
      functionName: 'sendNotification',
      senderUid: context.auth.uid,
      recipientUid: validatedData.recipientUid,
      type: validatedData.type,
      title: validatedData.title,
      priority: validatedData.priority,
      channels: validatedData.channels,
      hasActionUrl: !!validatedData.actionUrl,
      hasGroupKey: !!validatedData.groupKey,
      isScheduled: !!validatedData.scheduledFor,
    });

    // Exécution
    await executeSendNotification(validatedData, context);

    // Logging de succès
    logger.info('Notification sent successfully', {
      functionName: 'sendNotification',
      senderUid: context.auth.uid,
      recipientUid: validatedData.recipientUid,
      type: validatedData.type,
      priority: validatedData.priority,
      success: true,
    });
  })
);