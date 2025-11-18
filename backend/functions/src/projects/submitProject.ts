/**
 * Submit Project for Review Firebase Function
 * Social Finance Impact Platform
 *
 * Permet au créateur de soumettre un projet draft pour review admin
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
}).required();

/**
 * Valide la complétude du projet avant soumission
 */
function validateProjectCompleteness(project: ProjectDocument): void {
  const errors: string[] = [];

  // Vérifier titre et descriptions
  if (!project.title || project.title.length < 10) {
    errors.push('Title must be at least 10 characters');
  }

  if (!project.description || project.description.length < 100) {
    errors.push('Description must be at least 100 characters');
  }

  if (!project.shortDescription || project.shortDescription.length < 50) {
    errors.push('Short description must be at least 50 characters');
  }

  // Vérifier catégorie
  if (!project.category) {
    errors.push('Category is required');
  }

  // Vérifier financement
  if (!project.funding || !project.funding.goal) {
    errors.push('Funding goal is required');
  } else {
    if (project.funding.goal < 100000) { // 1000 EUR en centimes
      errors.push('Funding goal must be at least €1,000');
    }
    if (project.funding.goal > 5000000) { // 50000 EUR en centimes
      errors.push('Funding goal must not exceed €50,000');
    }
  }

  if (!project.funding?.deadline) {
    errors.push('Funding deadline is required');
  }

  // Vérifier milestones
  if (!project.milestones || project.milestones.length === 0) {
    errors.push('At least one milestone is required');
  } else {
    // Vérifier chaque milestone
    project.milestones.forEach((milestone: any, index: number) => {
      if (!milestone.title) {
        errors.push(`Milestone ${index + 1}: Title is required`);
      }
      if (!milestone.description) {
        errors.push(`Milestone ${index + 1}: Description is required`);
      }
      if (!milestone.fundingPercentage || milestone.fundingPercentage <= 0) {
        errors.push(`Milestone ${index + 1}: Funding percentage must be greater than 0`);
      }
    });

    // Vérifier que la somme des pourcentages = 100%
    const totalPercentage = project.milestones.reduce(
      (sum: number, m: any) => sum + (m.fundingPercentage || 0),
      0
    );
    if (Math.abs(totalPercentage - 100) > 0.1) {
      errors.push(
        `Sum of milestone funding percentages (${totalPercentage}%) must equal 100%`
      );
    }
  }

  // Vérifier média
  if (!project.media?.coverImage) {
    errors.push('Cover image is required');
  }

  // Vérifier localisation
  if (!project.location || !project.location.country) {
    errors.push('Project location is required');
  }

  // Vérifier équipe
  if (!project.team || project.team.length === 0) {
    errors.push('At least one team member is required');
  }

  // Vérifier objectifs d'impact
  if (!project.impactGoals || !project.impactGoals.primary) {
    errors.push('Primary impact goal is required');
  }

  // Si erreurs, rejeter
  if (errors.length > 0) {
    throw new https.HttpsError(
      'failed-precondition',
      `Project validation failed: ${errors.join('; ')}`
    );
  }
}

/**
 * Notifie tous les admins qu'un nouveau projet est en attente de review
 */
async function notifyAdmins(
  projectId: string,
  projectTitle: string,
  creatorUid: string
): Promise<void> {
  try {
    // Récupérer tous les admins
    const adminsSnapshot = await admin
      .firestore()
      .collection('users')
      .where('userType', '==', 'admin')
      .where('accountStatus', '==', STATUS.USER.ACTIVE)
      .get();

    if (adminsSnapshot.empty) {
      logger.warn('No active admins found to notify', { projectId });
      return;
    }

    // Créer une notification pour chaque admin
    const notificationPromises = adminsSnapshot.docs.map(async (adminDoc) => {
      const notificationData = {
        userId: adminDoc.id,
        type: 'project_pending_review',
        title: 'Nouveau projet à reviewer',
        message: `Le projet "${projectTitle}" a été soumis et attend votre review.`,
        data: {
          projectId,
          creatorUid,
          action: 'review_project',
        },
        priority: 'high',
        category: 'admin',
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await admin
        .firestore()
        .collection('notifications')
        .add(notificationData);
    });

    await Promise.all(notificationPromises);

    logger.info('Admins notified of new project submission', {
      projectId,
      adminCount: adminsSnapshot.size,
    });
  } catch (error) {
    // Log mais ne pas faire échouer la soumission si notifications échouent
    logger.error('Error notifying admins', {
      error,
      projectId,
    });
  }
}

/**
 * Envoie une notification de confirmation au créateur
 */
async function notifyCreator(
  creatorUid: string,
  projectId: string,
  projectTitle: string
): Promise<void> {
  try {
    const notificationData = {
      userId: creatorUid,
      type: 'project_submitted',
      title: 'Projet soumis pour review',
      message: `Votre projet "${projectTitle}" a été soumis avec succès et est en attente de review par notre équipe.`,
      data: {
        projectId,
        action: 'view_project',
      },
      priority: 'normal',
      category: 'project',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await admin
      .firestore()
      .collection('notifications')
      .add(notificationData);

    logger.info('Creator notified of project submission', {
      creatorUid,
      projectId,
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
 * Firebase Function principale
 */
export const submitProject = https.onCall(
  withErrorHandling(async (data: any, context: CallableContext) => {
    // ÉTAPE 1 : Vérifier authentification
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userId = context.auth.uid;

    // ÉTAPE 2 : Valider les données d'entrée
    const validatedData = await validateWithJoi(data, requestSchema);
    const { projectId } = validatedData;

    logger.info('Submitting project for review', { userId, projectId });

    // ÉTAPE 3 : Récupérer le projet
    const project = await firestoreHelper.getDocument<ProjectDocument>(
      'projects',
      projectId
    );

    if (!project) {
      throw new https.HttpsError('not-found', `Project ${projectId} not found`);
    }

    // ÉTAPE 4 : Vérifier que l'utilisateur est le créateur
    if (project.creatorUid !== userId && project.creator?.uid !== userId) {
      throw new https.HttpsError(
        'permission-denied',
        'Only the project creator can submit the project'
      );
    }

    // ÉTAPE 5 : Vérifier le statut actuel
    if (project.status !== STATUS.PROJECT.DRAFT && project.status !== 'draft') {
      throw new https.HttpsError(
        'failed-precondition',
        `Project must be in draft status to be submitted. Current status: ${project.status}`
      );
    }

    // ÉTAPE 6 : Récupérer l'utilisateur pour vérifier KYC
    const user = await firestoreHelper.getDocument<UserDocument>('users', userId);

    if (!user) {
      throw new https.HttpsError('not-found', 'User not found');
    }

    // ÉTAPE 7 : Vérifier que le créateur a KYC approuvé
    if (user.kyc?.status !== STATUS.KYC.APPROVED && user.kyc?.status !== 'approved') {
      throw new https.HttpsError(
        'failed-precondition',
        `KYC verification must be approved before submitting a project. Current KYC status: ${user.kyc?.status || 'none'}`
      );
    }

    // ÉTAPE 8 : Valider que le projet est complet
    validateProjectCompleteness(project);

    // ÉTAPE 9 : Mettre à jour le statut du projet
    const now = admin.firestore.FieldValue.serverTimestamp();
    const updateData = {
      status: STATUS.PROJECT.UNDER_REVIEW || 'under_review',
      'timeline.submittedAt': now,
      'moderation.status': 'pending',
      'moderation.submittedAt': now,
      updatedAt: now,
      version: admin.firestore.FieldValue.increment(1),
    };

    await admin
      .firestore()
      .collection('projects')
      .doc(projectId)
      .update(updateData);

    // ÉTAPE 10 : Notifier les admins
    await notifyAdmins(projectId, project.title, userId);

    // ÉTAPE 11 : Notifier le créateur
    await notifyCreator(userId, projectId, project.title);

    logger.info('Project submitted successfully', {
      projectId,
      userId,
      status: 'under_review',
    });

    return {
      success: true,
      projectId,
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      message: 'Project submitted successfully and is awaiting review',
    };
  })
);
