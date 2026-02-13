/**
 * Update Project Milestone Firebase Function
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
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PROJECT_CONFIG, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  milestoneId: Joi.string().required(),
  action: Joi.string().valid('update_progress', 'complete', 'add_evidence', 'modify_details').required(),
  
  // Pour update_progress
  progressData: Joi.object({
    current: Joi.number().min(0).required(),
    description: Joi.string().max(500).optional(),
  }).when('action', { is: 'update_progress', then: Joi.required() }),

  // Pour complete
  completionData: Joi.object({
    completedDate: Joi.date().max('now').optional(),
    evidence: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('document', 'image', 'video', 'link', 'report').required(),
        url: Joi.string().uri().required(),
        title: Joi.string().max(100).required(),
        description: Joi.string().max(500).optional(),
        verifiedBy: Joi.string().optional(),
      })
    ).min(1).max(10).required(),
    impactMetrics: Joi.object().pattern(
      Joi.string(),
      Joi.number().min(0)
    ).optional(),
    summary: Joi.string().min(10).max(1000).required(),
  }).when('action', { is: 'complete', then: Joi.required() }),

  // Pour add_evidence
  evidenceData: Joi.object({
    evidence: Joi.object({
      type: Joi.string().valid('document', 'image', 'video', 'link', 'report').required(),
      url: Joi.string().uri().required(),
      title: Joi.string().max(100).required(),
      description: Joi.string().max(500).optional(),
    }).required(),
  }).when('action', { is: 'add_evidence', then: Joi.required() }),

  // Pour modify_details
  detailsData: Joi.object({
    title: Joi.string().min(3).max(100).optional(),
    description: Joi.string().min(10).max(500).optional(),
    targetDate: Joi.date().min('now').optional(),
    deliverables: Joi.array().items(Joi.string().max(200)).min(1).max(10).optional(),
  }).min(1).when('action', { is: 'modify_details', then: Joi.required() }),
}).required();

/**
 * Valide que l'utilisateur peut modifier le milestone
 */
async function validateUserCanUpdateMilestone(
  uid: string,
  projectId: string,
  milestoneId: string
): Promise<{ user: UserDocument; project: ProjectDocument; milestone: any }> {
  try {
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);
    
    // Trouver le milestone
    const milestone = project.milestones.find(m => m.id === milestoneId);
    if (!milestone) {
      throw new https.HttpsError('not-found', 'Milestone not found');
    }

    // Vérifier les permissions
    const canModify = 
      project.creatorUid === uid || // Créateur du projet
      user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS) || // Admin
      (milestone.auditAssignedTo === uid && user.permissions.includes(USER_PERMISSIONS.AUDIT_PROJECT)); // Auditeur assigné

    if (!canModify) {
      throw new https.HttpsError('permission-denied', 'Insufficient permissions to modify this milestone');
    }

    // Vérifier le statut du projet
    const modifiableStatuses = [
      STATUS.PROJECT.ACTIVE,
      STATUS.PROJECT.FUNDING,
      STATUS.PROJECT.IN_PROGRESS
    ];

    if (!modifiableStatuses.includes(project.status)) {
      throw new https.HttpsError(
        'failed-precondition',
        `Cannot modify milestones for project in status: ${project.status}`
      );
    }

    // Vérifications spécifiques selon l'action
    return { user, project, milestone };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate milestone update permissions', error, { uid, projectId, milestoneId });
    throw new https.HttpsError('internal', 'Unable to validate milestone update permissions');
  }
}

/**
 * Met à jour le progrès d'un milestone
 */
async function updateMilestoneProgress(
  project: ProjectDocument,
  milestoneId: string,
  progressData: any,
  uid: string
): Promise<Partial<ProjectDocument>> {
  const milestone = project.milestones.find(m => m.id === milestoneId)!;
  
  // Calculer le nouveau pourcentage
  const targetMetric = project.impactGoals.metrics[0]; // Prendre la première métrique comme référence
  const percentage = Math.min(Math.round((progressData.current / targetMetric.target) * 100), 100);

  // Mettre à jour le milestone
  const updatedMilestones = project.milestones.map(m => {
    if (m.id === milestoneId) {
      return {
        ...m,
        progress: {
          current: progressData.current,
          percentage,
          lastUpdatedAt: new Date(),
          lastUpdatedBy: uid,
          description: progressData.description,
        }
      };
    }
    return m;
  });

  // Mettre à jour les métriques d'impact correspondantes
  const updatedMetrics = project.impactGoals.metrics.map(metric => {
    if (metric.id === targetMetric.id) {
      return {
        ...metric,
        current: progressData.current,
        percentage,
        lastUpdatedAt: new Date(),
      };
    }
    return metric;
  });

  return {
    milestones: updatedMilestones,
    'impactGoals.metrics': updatedMetrics,
    currentMilestoneProgress: percentage,
    updatedAt: new Date(),
    version: project.version + 1,
  };
}

/**
 * Complète un milestone
 */
async function completeMilestone(
  project: ProjectDocument,
  milestoneId: string,
  completionData: any,
  uid: string
): Promise<Partial<ProjectDocument>> {
  const milestone = project.milestones.find(m => m.id === milestoneId)!;
  
  // Vérifier que le milestone peut être complété
  if (milestone.status === STATUS.MILESTONE.COMPLETED) {
    throw new https.HttpsError('failed-precondition', 'Milestone is already completed');
  }

  const completionDate = completionData.completedDate || new Date();

  // Préparer les preuves d'accomplissement
  const evidence = completionData.evidence.map((e: any) => ({
    id: helpers.string.generateId('evidence'),
    type: e.type,
    url: e.url,
    title: e.title.trim(),
    description: e.description?.trim(),
    verifiedBy: e.verifiedBy,
    submittedAt: new Date(),
    submittedBy: uid,
  }));

  // Mettre à jour le milestone
  const updatedMilestones = project.milestones.map(m => {
    if (m.id === milestoneId) {
      return {
        ...m,
        status: STATUS.MILESTONE.COMPLETED,
        completedAt: completionDate,
        evidence,
        completionSummary: completionData.summary.trim(),
        completedBy: uid,
        // Audit requis si milestone important
        auditStatus: m.auditRequired ? STATUS.AUDIT.PENDING : STATUS.AUDIT.NOT_REQUIRED,
      };
    }
    return m;
  });

  // Mettre à jour les métriques d'impact si fournies
  let updatedMetrics = project.impactGoals.metrics;
  if (completionData.impactMetrics) {
    updatedMetrics = project.impactGoals.metrics.map(metric => {
      if (completionData.impactMetrics[metric.name] !== undefined) {
        const newValue = completionData.impactMetrics[metric.name];
        return {
          ...metric,
          current: newValue,
          percentage: Math.min(Math.round((newValue / metric.target) * 100), 100),
          lastUpdatedAt: completionDate,
        };
      }
      return metric;
    });
  }

  // Vérifier si c'est le dernier milestone
  const completedMilestones = updatedMilestones.filter(m => m.status === STATUS.MILESTONE.COMPLETED);
  const allMilestonesCompleted = completedMilestones.length === updatedMilestones.length;

  // Calculer le progrès global du projet
  const totalProgress = updatedMilestones.reduce((sum, m) => {
    const progress = m.status === STATUS.MILESTONE.COMPLETED ? 100 : (m.progress?.percentage || 0);
    return sum + (progress * m.fundingPercentage / 100);
  }, 0);

  const updateData: Partial<ProjectDocument> = {
    milestones: updatedMilestones,
    'impactGoals.metrics': updatedMetrics,
    projectProgress: Math.round(totalProgress),
    currentMilestoneIndex: allMilestonesCompleted ? 
      updatedMilestones.length : 
      updatedMilestones.findIndex(m => m.status !== STATUS.MILESTONE.COMPLETED),
    updatedAt: new Date(),
    version: project.version + 1,
  };

  // Si tous les milestones sont complétés, marquer le projet comme terminé
  if (allMilestonesCompleted) {
    updateData.status = STATUS.PROJECT.COMPLETED;
    updateData.completedAt = completionDate;
  }

  return updateData;
}

/**
 * Ajoute une preuve à un milestone
 */
async function addMilestoneEvidence(
  project: ProjectDocument,
  milestoneId: string,
  evidenceData: any,
  uid: string
): Promise<Partial<ProjectDocument>> {
  const milestone = project.milestones.find(m => m.id === milestoneId)!;

  const newEvidence = {
    id: helpers.string.generateId('evidence'),
    type: evidenceData.evidence.type,
    url: evidenceData.evidence.url,
    title: evidenceData.evidence.title.trim(),
    description: evidenceData.evidence.description?.trim(),
    submittedAt: new Date(),
    submittedBy: uid,
    verified: false,
  };

  const updatedMilestones = project.milestones.map(m => {
    if (m.id === milestoneId) {
      return {
        ...m,
        evidence: [...(m.evidence || []), newEvidence]
      };
    }
    return m;
  });

  return {
    milestones: updatedMilestones,
    updatedAt: new Date(),
    version: project.version + 1,
  };
}

/**
 * Modifie les détails d'un milestone
 */
async function modifyMilestoneDetails(
  project: ProjectDocument,
  milestoneId: string,
  detailsData: any,
  uid: string
): Promise<Partial<ProjectDocument>> {
  const milestone = project.milestones.find(m => m.id === milestoneId)!;
  
  // Vérifier que le milestone peut être modifié
  if (milestone.status === STATUS.MILESTONE.COMPLETED) {
    throw new https.HttpsError('failed-precondition', 'Cannot modify completed milestone details');
  }

  // Si changement de date, vérifier la cohérence
  if (detailsData.targetDate) {
    const newDate = new Date(detailsData.targetDate);
    const fundingDeadline = new Date(project.funding.deadline);
    
    if (newDate > fundingDeadline) {
      throw new https.HttpsError(
        'invalid-argument',
        'Milestone target date cannot be after funding deadline'
      );
    }
  }

  const updatedMilestones = project.milestones.map(m => {
    if (m.id === milestoneId) {
      return {
        ...m,
        title: detailsData.title?.trim() || m.title,
        description: detailsData.description?.trim() || m.description,
        targetDate: detailsData.targetDate ? new Date(detailsData.targetDate) : m.targetDate,
        deliverables: detailsData.deliverables || m.deliverables,
        lastModifiedAt: new Date(),
        lastModifiedBy: uid,
      };
    }
    return m;
  });

  return {
    milestones: updatedMilestones,
    updatedAt: new Date(),
    version: project.version + 1,
  };
}

/**
 * Envoie les notifications de mise à jour de milestone
 */
async function notifyMilestoneUpdate(
  project: ProjectDocument,
  milestone: any,
  action: string,
  user: UserDocument
): Promise<void> {
  try {
    if (action === 'complete' && project.settings.notifyOnMilestone) {
      // Récupérer les contributeurs à notifier
      const contributorsQuery = await firestoreHelper.queryDocuments<ContributionDocument>(
        `projects/${project.uid}/contributions`,
        [
          ['status', '==', 'confirmed'],
          ['notificationsEnabled', '==', true]
        ]
      );

      const uniqueContributors = new Set(contributorsQuery.data.map(c => c.contributorUid));

      logger.info('Milestone completion notifications would be sent', {
        projectId: project.uid,
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        contributorsToNotify: uniqueContributors.size,
        creatorUid: project.creatorUid
      });

      // TODO: Implémenter les notifications complètes
      // - Email aux contributeurs
      // - Notification push
      // - Mise à jour du feed d'activité
      // - Certificat d'impact si applicable

      // Créer une entrée dans le feed d'activité
      const feedEntry = {
        id: helpers.string.generateId('feed'),
        type: 'milestone_completed',
        projectId: project.uid,
        projectTitle: project.title,
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        creatorUid: project.creatorUid,
        creatorName: project.creatorDisplayName,
        completedAt: new Date(),
        fundingPercentage: milestone.fundingPercentage,
        visibility: 'public',
      };

      await firestoreHelper.addDocument('activity_feed', feedEntry);
    }

  } catch (error) {
    logger.error('Failed to send milestone update notifications', error, {
      projectId: project.uid,
      milestoneId: milestone.id,
      action
    });
    // Ne pas faire échouer la mise à jour pour les notifications
  }
}

/**
 * Met à jour les statistiques du projet
 */
async function updateProjectStats(
  projectId: string,
  action: string,
  milestone: any
): Promise<void> {
  try {
    if (action === 'complete') {
      await firestoreHelper.incrementDocument('projects', projectId, {
        'stats.completedMilestones': 1,
        'stats.lastMilestoneCompletedAt': new Date(),
      });
    }

    // Mise à jour de la dernière activité
    await firestoreHelper.updateDocument('projects', projectId, {
      lastActivityAt: new Date(),
    });

  } catch (error) {
    logger.error('Failed to update project stats', error, { projectId, action });
    // Ne pas faire échouer la fonction pour les stats
  }
}

/**
 * Valide les données de completion selon le type de milestone
 */
function validateCompletionData(milestone: any, completionData: any): void {
  // Vérifier que les preuves sont suffisantes pour les milestones critiques
  if (milestone.fundingPercentage >= PROJECT_CONFIG.CRITICAL_MILESTONE_THRESHOLD) {
    if (!completionData.evidence || completionData.evidence.length === 0) {
      throw new https.HttpsError(
        'invalid-argument',
        'Critical milestones require evidence of completion'
      );
    }

    if (!completionData.summary || completionData.summary.length < 50) {
      throw new https.HttpsError(
        'invalid-argument',
        'Critical milestones require detailed completion summary (min 50 characters)'
      );
    }
  }

  // Vérifier la cohérence des métriques d'impact
  if (completionData.impactMetrics) {
    Object.values(completionData.impactMetrics).forEach((value: any) => {
      if (typeof value !== 'number' || value < 0) {
        throw new https.HttpsError('invalid-argument', 'Impact metrics must be positive numbers');
      }
    });
  }
}

/**
 * Exécute la mise à jour du milestone
 */
async function executeUpdateMilestone(
  data: ProjectsAPI.UpdateMilestoneRequest,
  context: CallableContext
): Promise<ProjectsAPI.UpdateMilestoneResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  const { user, project, milestone } = await validateUserCanUpdateMilestone(
    uid,
    data.projectId,
    data.milestoneId
  );

  let updateData: Partial<ProjectDocument>;
  
  // Traiter selon l'action
  switch (data.action) {
    case 'update_progress':
      updateData = await updateMilestoneProgress(project, data.milestoneId, data.progressData, uid);
      break;

    case 'complete':
      validateCompletionData(milestone, data.completionData);
      updateData = await completeMilestone(project, data.milestoneId, data.completionData, uid);
      break;

    case 'add_evidence':
      updateData = await addMilestoneEvidence(project, data.milestoneId, data.evidenceData, uid);
      break;

    case 'modify_details':
      updateData = await modifyMilestoneDetails(project, data.milestoneId, data.detailsData, uid);
      break;

    default:
      throw new https.HttpsError('invalid-argument', `Unsupported action: ${data.action}`);
  }

  // Ajouter les métadonnées de contexte
  updateData.lastModifiedBy = uid;
  if (context.rawRequest.ip) {
    updateData.ipAddress = context.rawRequest.ip;
  }
  if (context.rawRequest.headers['user-agent']) {
    updateData.userAgent = context.rawRequest.headers['user-agent'] as string;
  }

  // Transaction pour mettre à jour le projet
  await firestoreHelper.runTransaction(async (transaction) => {
    const projectRef = firestoreHelper.getDocumentRef('projects', data.projectId);
    
    // Vérifier la version pour éviter les conflits
    const currentDoc = await transaction.get(projectRef);
    if (!currentDoc.exists) {
      throw new https.HttpsError('not-found', 'Project not found');
    }

    const currentVersion = currentDoc.data()?.version || 0;
    if (project.version !== currentVersion) {
      throw new https.HttpsError('aborted', 'Project was modified by another operation. Please refresh and try again.');
    }

    // Appliquer la mise à jour
    transaction.update(projectRef, updateData);
  });

  // Notifications et stats en parallèle
  await Promise.all([
    notifyMilestoneUpdate(project, milestone, data.action, user),
    updateProjectStats(data.projectId, data.action, milestone),
  ]);

  // Log business
  logger.business('Milestone updated', 'milestones', {
    projectId: data.projectId,
    milestoneId: data.milestoneId,
    action: data.action,
    updatedBy: uid,
    milestoneTitle: milestone.title,
    projectStatus: project.status,
    fundingPercentage: milestone.fundingPercentage,
    isCompleted: data.action === 'complete',
    auditRequired: milestone.auditRequired,
  });

  // Log d'audit pour les completions importantes
  if (data.action === 'complete' && milestone.fundingPercentage >= PROJECT_CONFIG.CRITICAL_MILESTONE_THRESHOLD) {
    logger.security('Critical milestone completed', 'medium', {
      projectId: data.projectId,
      milestoneId: data.milestoneId,
      completedBy: uid,
      milestoneTitle: milestone.title,
      fundingPercentage: milestone.fundingPercentage,
      evidenceCount: data.completionData?.evidence?.length || 0,
      ipAddress: context.rawRequest.ip,
    });
  }

  return {
    projectId: data.projectId,
    milestoneId: data.milestoneId,
    success: true,
    action: data.action,
    milestoneStatus: data.action === 'complete' ? STATUS.MILESTONE.COMPLETED : milestone.status,
    version: updateData.version as number,
    requiresAudit: data.action === 'complete' && milestone.auditRequired,
  };
}

/**
 * Firebase Function principale
 */
export const updateMilestone = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.UpdateMilestoneResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<ProjectsAPI.UpdateMilestoneRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Updating milestone', {
      functionName: 'updateMilestone',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      milestoneId: validatedData.milestoneId,
      action: validatedData.action,
    });

    // Exécution
    const result = await executeUpdateMilestone(validatedData, context);

    // Logging de succès
    logger.info('Milestone updated successfully', {
      functionName: 'updateMilestone',
      uid: context.auth.uid,
      projectId: result.projectId,
      milestoneId: result.milestoneId,
      action: result.action,
      milestoneStatus: result.milestoneStatus,
      version: result.version,
      requiresAudit: result.requiresAudit,
      success: true,
    });

    return result;
  })
);