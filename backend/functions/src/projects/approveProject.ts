/**
 * Approve/Reject Project Firebase Function
 * Social Finance Impact Platform
 *
 * Permet aux admins d'approuver ou rejeter un projet en review
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { ProjectDocument, UserDocument } from '../types/firestore';
import { STATUS } from '../utils/constants';
import admin from 'firebase-admin';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  action: Joi.string().valid('approve', 'reject').required(),
  comments: Joi.string().min(10).max(2000).when('action', {
    is: 'reject',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  publishImmediately: Joi.boolean().default(true), // Si true, publie directement après approbation
}).required();

/**
 * Envoie une notification au créateur
 */
async function notifyCreator(
  creatorUid: string,
  projectId: string,
  projectTitle: string,
  action: 'approved' | 'rejected',
  comments?: string
): Promise<void> {
  try {
    const notificationData = {
      userId: creatorUid,
      type: action === 'approved' ? 'project_approved' : 'project_rejected',
      title: action === 'approved' ? 'Projet approuvé !' : 'Projet refusé',
      message:
        action === 'approved'
          ? `Félicitations ! Votre projet "${projectTitle}" a été approuvé et est maintenant en ligne.`
          : `Votre projet "${projectTitle}" a été refusé. ${comments ? `Raison : ${comments}` : ''}`,
      data: {
        projectId,
        action: 'view_project',
        comments,
      },
      priority: action === 'approved' ? 'high' : 'normal',
      category: 'project',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await admin
      .firestore()
      .collection('notifications')
      .add(notificationData);

    logger.info('Creator notified of project decision', {
      creatorUid,
      projectId,
      action,
    });
  } catch (error) {
    logger.error('Error notifying creator', {
      error,
      creatorUid,
      projectId,
    });
  }
}

/**
 * Log l'action admin pour audit trail
 */
async function logAdminAction(
  adminUid: string,
  projectId: string,
  action: 'approve' | 'reject',
  comments?: string
): Promise<void> {
  try {
    const auditLogData = {
      type: 'project_moderation',
      action,
      performedBy: adminUid,
      targetType: 'project',
      targetId: projectId,
      details: {
        action,
        comments: comments || null,
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: null, // TODO: Capturer l'IP depuis context si disponible
    };

    await admin
      .firestore()
      .collection('audit_logs')
      .add(auditLogData);

    logger.info('Admin action logged', {
      adminUid,
      projectId,
      action,
    });
  } catch (error) {
    logger.error('Error logging admin action', {
      error,
      adminUid,
      projectId,
    });
  }
}

/**
 * Firebase Function principale
 */
export const approveProject = https.onCall(
  withErrorHandling(async (data: any, context: CallableContext) => {
    // ÉTAPE 1 : Vérifier authentification
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;

    // ÉTAPE 2 : Vérifier que l'utilisateur est admin
    const user = await firestoreHelper.getDocument<UserDocument>('users', userId);

    if (!user) {
      throw new https.HttpsError('not-found', 'User not found');
    }

    if (user.userType !== 'admin') {
      throw new https.HttpsError(
        'permission-denied',
        'Only administrators can approve or reject projects'
      );
    }

    // ÉTAPE 3 : Valider les données d'entrée
    const validatedData = await validateWithJoi(data, requestSchema);
    const { projectId, action, comments, publishImmediately } = validatedData;

    logger.info('Processing project moderation', {
      userId,
      projectId,
      action,
    });

    // ÉTAPE 4 : Récupérer le projet
    const project = await firestoreHelper.getDocument<ProjectDocument>(
      'projects',
      projectId
    );

    if (!project) {
      throw new https.HttpsError('not-found', `Project ${projectId} not found`);
    }

    // ÉTAPE 5 : Vérifier le statut actuel
    if (
      project.status !== STATUS.PROJECT.UNDER_REVIEW &&
      project.status !== 'under_review'
    ) {
      throw new https.HttpsError(
        'failed-precondition',
        `Project must be under review to be moderated. Current status: ${project.status}`
      );
    }

    // ÉTAPE 6 : Préparer les données de mise à jour selon l'action
    const now = admin.firestore.FieldValue.serverTimestamp();
    let updateData: any;

    if (action === 'approve') {
      // Approbation : passer le projet en 'live' (ou 'approved' selon workflow)
      const newStatus =
        publishImmediately && STATUS.PROJECT.LIVE
          ? STATUS.PROJECT.LIVE
          : STATUS.PROJECT.APPROVED || 'approved';

      updateData = {
        status: newStatus,
        'timeline.approvedAt': now,
        'timeline.publishedAt': publishImmediately ? now : null,
        'moderation.status': 'approved',
        'moderation.reviewedBy': userId,
        'moderation.reviewedAt': now,
        'moderation.comments': comments || null,
        updatedAt: now,
        version: admin.firestore.FieldValue.increment(1),
      };

      // Si publié, initialiser certaines métriques
      if (publishImmediately) {
        updateData['analytics.views'] = 0;
        updateData['analytics.totalViews'] = 0;
        updateData['analytics.saves'] = 0;
        updateData['analytics.shares'] = 0;
      }
    } else {
      // Rejet : remettre le projet en 'draft'
      updateData = {
        status: STATUS.PROJECT.DRAFT || 'draft',
        'moderation.status': 'rejected',
        'moderation.reviewedBy': userId,
        'moderation.reviewedAt': now,
        'moderation.rejectionReason': comments,
        'moderation.comments': comments,
        updatedAt: now,
        version: admin.firestore.FieldValue.increment(1),
      };
    }

    // ÉTAPE 7 : Mettre à jour le projet
    await admin
      .firestore()
      .collection('projects')
      .doc(projectId)
      .update(updateData);

    // ÉTAPE 8 : Notifier le créateur
    const creatorUid = project.creatorUid || project.creator?.uid;
    if (creatorUid) {
      await notifyCreator(
        creatorUid,
        projectId,
        project.title,
        action === 'approve' ? 'approved' : 'rejected',
        comments
      );
    }

    // ÉTAPE 9 : Logger l'action admin (audit trail)
    await logAdminAction(userId, projectId, action, comments);

    // ÉTAPE 10 : Si approuvé et publié, incrémenter stats créateur
    if (action === 'approve' && publishImmediately && creatorUid) {
      try {
        await admin
          .firestore()
          .collection('users')
          .doc(creatorUid)
          .update({
            'stats.projectsCreated': admin.firestore.FieldValue.increment(1),
            'stats.lastProjectAt': now,
            updatedAt: now,
          });
      } catch (error) {
        // Non-bloquant
        logger.error('Error updating creator stats', {
          error,
          creatorUid,
        });
      }
    }

    logger.info('Project moderation completed', {
      projectId,
      action,
      newStatus: updateData.status,
      reviewedBy: userId,
    });

    return {
      success: true,
      projectId,
      action,
      newStatus: updateData.status,
      message:
        action === 'approve'
          ? publishImmediately
            ? 'Project approved and published successfully'
            : 'Project approved successfully'
          : 'Project rejected and returned to draft',
    };
  })
);
