/**
 * Accept Audit Firebase Function
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
import { AuditsAPI } from '../types/api';
import { ProjectDocument, UserDocument, AuditDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  auditId: Joi.string().required(),
  acceptanceNote: Joi.string().max(500).optional(),
  estimatedCompletionDate: Joi.string().isoDate().required(),
  proposedTimeline: Joi.array().items(
    Joi.object({
      phase: Joi.string().required(),
      description: Joi.string().required(),
      estimatedDays: Joi.number().min(1).max(30).required(),
    })
  ).optional(),
  requestedResources: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('document', 'meeting', 'site_visit', 'financial_data').required(),
      description: Joi.string().required(),
      required: Joi.boolean().default(true),
    })
  ).optional(),
}).required();

/**
 * Valide que l'auditeur peut accepter cet audit
 */
async function validateAuditAcceptancePermissions(
  uid: string,
  auditId: string
): Promise<{ auditor: UserDocument; audit: AuditDocument; project: ProjectDocument }> {
  try {
    const audit = await firestoreHelper.getDocument<AuditDocument>('audits', auditId);

    // Vérifier que c'est bien l'auditeur assigné
    if (audit.auditorUid !== uid) {
      throw new https.HttpsError('permission-denied', 'You are not the assigned auditor for this audit');
    }

    // Vérifier le statut de l'audit
    if (audit.status !== STATUS.AUDIT.ASSIGNED) {
      throw new https.HttpsError('failed-precondition', 
        `Audit cannot be accepted in current status: ${audit.status}`);
    }

    // Vérifier que l'audit n'a pas expiré
    const deadline = new Date(audit.deadline);
    if (deadline < new Date()) {
      throw new https.HttpsError('failed-precondition', 'Audit assignment has expired');
    }

    // Récupérer l'auditeur et le projet
    const [auditor, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', audit.projectId)
    ]);

    // Vérifier que l'auditeur est toujours actif et qualifié
    if (!auditor.permissions.includes(USER_PERMISSIONS.AUDIT_PROJECT)) {
      throw new https.HttpsError('permission-denied', 'Auditor permissions have been revoked');
    }

    if (auditor.status !== 'active') {
      throw new https.HttpsError('failed-precondition', 'Auditor account is not active');
    }

    return { auditor, audit, project };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate audit acceptance permissions', error, { uid, auditId });
    throw new https.HttpsError('internal', 'Unable to validate audit acceptance permissions');
  }
}

/**
 * Valide la timeline proposée par l'auditeur
 */
function validateProposedTimeline(
  estimatedCompletionDate: string,
  deadline: Date,
  proposedTimeline?: any[]
): void {
  const completionDate = new Date(estimatedCompletionDate);
  
  // Vérifier que la date de completion est avant la deadline
  if (completionDate >= deadline) {
    throw new https.HttpsError('invalid-argument', 
      'Estimated completion date must be before the audit deadline');
  }

  // Vérifier que la completion n'est pas trop éloignée
  const maxDaysFromNow = Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) - 1;
  const daysFromNow = Math.ceil((completionDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  
  if (daysFromNow > maxDaysFromNow) {
    throw new https.HttpsError('invalid-argument', 
      `Completion date cannot be more than ${maxDaysFromNow} days from now`);
  }

  // Valider la timeline proposée si fournie
  if (proposedTimeline && proposedTimeline.length > 0) {
    const totalDays = proposedTimeline.reduce((sum, phase) => sum + phase.estimatedDays, 0);
    
    if (totalDays > daysFromNow) {
      throw new https.HttpsError('invalid-argument', 
        'Proposed timeline exceeds estimated completion date');
    }

    // Vérifier que toutes les phases obligatoires sont présentes
    const requiredPhases = ['initial_review', 'detailed_analysis', 'final_report'];
    const proposedPhases = proposedTimeline.map(p => p.phase);
    
    const missingPhases = requiredPhases.filter(phase => !proposedPhases.includes(phase));
    if (missingPhases.length > 0) {
      throw new https.HttpsError('invalid-argument', 
        `Missing required phases: ${missingPhases.join(', ')}`);
    }
  }
}

/**
 * Met à jour le statut de l'audit après acceptation
 */
async function updateAuditStatusToAccepted(
  audit: AuditDocument,
  auditor: UserDocument,
  data: AuditsAPI.AcceptAuditRequest,
  uid: string
): Promise<void> {
  try {
    const now = new Date();
    const estimatedCompletion = new Date(data.estimatedCompletionDate);

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour l'audit principal
      const auditRef = firestoreHelper.getDocumentRef('audits', audit.id);
      transaction.update(auditRef, {
        status: STATUS.AUDIT.IN_PROGRESS,
        acceptedAt: now,
        acceptanceNote: data.acceptanceNote || '',
        estimatedCompletion,
        proposedTimeline: data.proposedTimeline || [],
        requestedResources: data.requestedResources || [],
        startedAt: now,
        
        // Mise à jour du workflow
        workflow: {
          assigned: { completedAt: audit.assignedAt, by: audit.assignedBy },
          accepted: { completedAt: now, by: uid },
          inProgress: { startedAt: now },
        },
        
        updatedAt: now,
        version: audit.version + 1,
      });

      // Mettre à jour le projet
      const projectRef = firestoreHelper.getDocumentRef('projects', audit.projectId);
      transaction.update(projectRef, {
        'audit.status': STATUS.AUDIT.IN_PROGRESS,
        'audit.acceptedAt': now,
        'audit.estimatedCompletion': estimatedCompletion,
        updatedAt: now,
      });

      // Mettre à jour la référence auditeur
      const auditorAuditRef = firestoreHelper.getDocumentRef(
        `users/${uid}/audits`,
        audit.id
      );
      
      transaction.update(auditorAuditRef, {
        status: STATUS.AUDIT.IN_PROGRESS,
        acceptedAt: now,
        estimatedCompletion,
        proposedTimeline: data.proposedTimeline?.length || 0,
        updatedAt: now,
      });
    });

    logger.info('Audit status updated to accepted', {
      auditId: audit.id,
      projectId: audit.projectId,
      auditorUid: uid,
      estimatedCompletion: estimatedCompletion.toISOString(),
      hasTimeline: !!(data.proposedTimeline && data.proposedTimeline.length > 0),
    });

  } catch (error) {
    logger.error('Failed to update audit status', error, {
      auditId: audit.id,
      auditorUid: uid,
    });
    throw new https.HttpsError('internal', 'Unable to update audit status');
  }
}

/**
 * Envoie les notifications d'acceptation d'audit
 */
async function sendAuditAcceptanceNotifications(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  estimatedCompletion: Date
): Promise<void> {
  try {
    const promises: Promise<void>[] = [];

    // Notification au créateur du projet
    promises.push(notifyProjectCreatorOfAcceptance(audit, project, auditor, estimatedCompletion));

    // Notification aux admins
    promises.push(notifyAdminsOfAuditAcceptance(audit, project, auditor));

    // Notification de confirmation à l'auditeur
    promises.push(sendAuditorAcceptanceConfirmation(audit, project, auditor, estimatedCompletion));

    await Promise.all(promises);

  } catch (error) {
    logger.error('Failed to send audit acceptance notifications', error, {
      auditId: audit.id,
    });
    // Ne pas faire échouer l'acceptation pour les notifications
  }
}

/**
 * Notifie le créateur de l'acceptation de l'audit
 */
async function notifyProjectCreatorOfAcceptance(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  estimatedCompletion: Date
): Promise<void> {
  try {
    const creator = await firestoreHelper.getDocument<UserDocument>('users', project.creatorUid);

    const emailData = {
      to: creator.email,
      templateId: 'audit_accepted_creator',
      dynamicTemplateData: {
        creatorName: `${creator.firstName} ${creator.lastName}`,
        projectTitle: project.title,
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        auditorSpecializations: audit.specializations.join(', '),
        estimatedCompletion: estimatedCompletion.toLocaleDateString('fr-FR'),
        deadline: new Date(audit.deadline).toLocaleDateString('fr-FR'),
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        auditDashboardUrl: `${process.env.FRONTEND_URL}/creator/audits/${audit.id}`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Project creator notified of audit acceptance', {
      auditId: audit.id,
      creatorEmail: creator.email,
      auditorUid: auditor.uid,
    });

  } catch (error) {
    logger.error('Failed to notify project creator of audit acceptance', error, {
      auditId: audit.id,
      projectId: project.uid,
    });
  }
}

/**
 * Notifie les admins de l'acceptation de l'audit
 */
async function notifyAdminsOfAuditAcceptance(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument
): Promise<void> {
  try {
    // Récupérer les admins qui suivent les audits
    const adminUsers = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['permissions', 'array-contains', USER_PERMISSIONS.MODERATE_PROJECTS],
        ['preferences.notifications.auditUpdates', '==', true]
      ]
    );

    if (adminUsers.length === 0) {
      return;
    }

    const notificationPromises = adminUsers.map(admin => {
      const emailData = {
        to: admin.email,
        templateId: 'audit_accepted_admin',
        dynamicTemplateData: {
          adminName: `${admin.firstName} ${admin.lastName}`,
          projectTitle: project.title,
          auditorName: `${auditor.firstName} ${auditor.lastName}`,
          acceptedAt: new Date().toLocaleDateString('fr-FR'),
          deadline: new Date(audit.deadline).toLocaleDateString('fr-FR'),
          compensation: (audit.compensation.amount / 100).toFixed(2),
          adminDashboardUrl: `${process.env.FRONTEND_URL}/admin/audits`,
          auditDetailsUrl: `${process.env.FRONTEND_URL}/admin/audits/${audit.id}`,
        },
      };

      return emailService.sendEmail(emailData);
    });

    await Promise.allSettled(notificationPromises);

    logger.info('Admins notified of audit acceptance', {
      auditId: audit.id,
      adminsNotified: adminUsers.length,
    });

  } catch (error) {
    logger.error('Failed to notify admins of audit acceptance', error, {
      auditId: audit.id,
    });
  }
}

/**
 * Envoie la confirmation d'acceptation à l'auditeur
 */
async function sendAuditorAcceptanceConfirmation(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  estimatedCompletion: Date
): Promise<void> {
  try {
    const emailData = {
      to: auditor.email,
      templateId: 'audit_acceptance_confirmation',
      dynamicTemplateData: {
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        projectTitle: project.title,
        acceptedAt: new Date().toLocaleDateString('fr-FR'),
        estimatedCompletion: estimatedCompletion.toLocaleDateString('fr-FR'),
        deadline: new Date(audit.deadline).toLocaleDateString('fr-FR'),
        compensation: (audit.compensation.amount / 100).toFixed(2),
        specializations: audit.specializations.join(', '),
        auditWorkspaceUrl: `${process.env.FRONTEND_URL}/auditor/workspace/${audit.id}`,
        guidelinesUrl: `${process.env.FRONTEND_URL}/auditor/guidelines`,
        supportUrl: `${process.env.FRONTEND_URL}/auditor/support`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Auditor acceptance confirmation sent', {
      auditId: audit.id,
      auditorEmail: auditor.email,
    });

  } catch (error) {
    logger.error('Failed to send auditor acceptance confirmation', error, {
      auditId: audit.id,
      auditorUid: auditor.uid,
    });
  }
}

/**
 * Met à jour les statistiques d'audit
 */
async function updateAuditAcceptanceStats(
  audit: AuditDocument,
  auditor: UserDocument,
  project: ProjectDocument
): Promise<void> {
  try {
    const acceptanceTime = Date.now() - new Date(audit.assignedAt).getTime();
    const acceptanceHours = Math.round(acceptanceTime / (60 * 60 * 1000));

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'audits.totalAccepted': 1,
      'audits.acceptanceTimeHours': acceptanceHours,
      [`categories.${project.category}.auditsAccepted`]: 1,
    });

    // Statistiques de l'auditeur
    await firestoreHelper.incrementDocument('users', auditor.uid, {
      'auditor.stats.totalAccepted': 1,
      'auditor.stats.averageAcceptanceTime': acceptanceHours,
      'auditor.stats.activeAudits': 1,
    });

    // Mettre à jour les métriques de performance
    await firestoreHelper.updateDocument('audit_performance', auditor.uid, {
      lastAcceptanceTime: acceptanceHours,
      acceptanceRate: 'calculated_in_scheduled_function',
      avgTimeToAccept: 'calculated_in_scheduled_function',
      updatedAt: new Date(),
    });

    logger.info('Audit acceptance statistics updated', {
      auditId: audit.id,
      auditorUid: auditor.uid,
      acceptanceTimeHours,
      projectCategory: project.category,
    });

  } catch (error) {
    logger.error('Failed to update audit acceptance statistics', error, {
      auditId: audit.id,
      auditorUid: auditor.uid,
    });
    // Ne pas faire échouer l'acceptation pour les stats
  }
}

/**
 * Crée l'activité d'acceptation d'audit
 */
async function createAuditAcceptanceActivity(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  estimatedCompletion: Date
): Promise<void> {
  try {
    const feedEntry = {
      id: helpers.string.generateId('feed'),
      type: 'audit_accepted',
      auditId: audit.id,
      projectId: project.uid,
      auditorUid: auditor.uid,
      auditorName: `${auditor.firstName} ${auditor.lastName}`,
      acceptedAt: new Date(),
      estimatedCompletion,
      specializations: audit.specializations,
      createdAt: new Date(),
      visibility: 'project_team',
    };

    await firestoreHelper.addDocument('activity_feed', feedEntry);

    logger.info('Audit acceptance activity created', {
      auditId: audit.id,
      feedEntryId: feedEntry.id,
      projectId: project.uid,
    });

  } catch (error) {
    logger.error('Failed to create audit acceptance activity', error, {
      auditId: audit.id,
    });
    // Ne pas faire échouer l'acceptation pour l'activité
  }
}

/**
 * Initialise l'espace de travail de l'audit
 */
async function initializeAuditWorkspace(
  audit: AuditDocument,
  project: ProjectDocument,
  requestedResources?: any[]
): Promise<void> {
  try {
    const workspaceId = helpers.string.generateId('workspace');

    const workspace = {
      id: workspaceId,
      auditId: audit.id,
      projectId: project.uid,
      auditorUid: audit.auditorUid,
      
      // Documents et ressources
      documents: {
        required: audit.requiredDocuments,
        requested: requestedResources || [],
        uploaded: [],
        pendingReview: [],
      },
      
      // Communication
      messages: [],
      meetingNotes: [],
      
      // Progress tracking
      milestones: project.milestones.map(milestone => ({
        milestoneId: milestone.id,
        title: milestone.title,
        reviewStatus: 'pending',
        documents: [],
        notes: '',
      })),
      
      // Checklist de l'audit
      checklist: audit.criteria.map(criterion => ({
        criterionId: criterion.id,
        name: criterion.name,
        completed: false,
        score: null,
        notes: '',
      })),
      
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await firestoreHelper.addDocument('audit_workspaces', workspace);

    logger.info('Audit workspace initialized', {
      auditId: audit.id,
      workspaceId,
      requiredDocuments: audit.requiredDocuments.length,
      requestedResources: requestedResources?.length || 0,
    });

  } catch (error) {
    logger.error('Failed to initialize audit workspace', error, {
      auditId: audit.id,
    });
    // Ne pas faire échouer l'acceptation pour l'espace de travail
  }
}

/**
 * Exécute l'acceptation d'audit
 */
async function executeAcceptAudit(
  data: AuditsAPI.AcceptAuditRequest,
  context: CallableContext
): Promise<AuditsAPI.AcceptAuditResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions et récupération des données
  const { auditor, audit, project } = await validateAuditAcceptancePermissions(uid, data.auditId);
  
  // Validation de la timeline proposée
  validateProposedTimeline(
    data.estimatedCompletionDate,
    new Date(audit.deadline),
    data.proposedTimeline
  );
  
  // Mise à jour du statut d'audit
  await updateAuditStatusToAccepted(audit, auditor, data, uid);
  
  // Processus post-acceptation en parallèle
  await Promise.all([
    sendAuditAcceptanceNotifications(
      audit,
      project,
      auditor,
      new Date(data.estimatedCompletionDate)
    ),
    updateAuditAcceptanceStats(audit, auditor, project),
    createAuditAcceptanceActivity(audit, project, auditor, new Date(data.estimatedCompletionDate)),
    initializeAuditWorkspace(audit, project, data.requestedResources),
  ]);

  // Log business
  logger.business('Audit accepted by auditor', 'audits', {
    auditId: data.auditId,
    projectId: audit.projectId,
    auditorUid: uid,
    acceptedAt: new Date().toISOString(),
    estimatedCompletion: data.estimatedCompletionDate,
    deadline: audit.deadline,
    compensation: audit.compensation.amount,
    specializations: audit.specializations,
    hasProposedTimeline: !!(data.proposedTimeline && data.proposedTimeline.length > 0),
    requestedResourcesCount: data.requestedResources?.length || 0,
  });

  return {
    status: STATUS.AUDIT.IN_PROGRESS,
    acceptedAt: new Date().toISOString(),
    deadline: audit.deadline,
    estimatedCompletion: data.estimatedCompletionDate,
    project: {
      id: project.uid,
      title: project.title,
      creator: project.creatorName || 'Project Creator',
      category: project.category,
      milestones: project.milestones.map(m => ({
        id: m.id,
        title: m.title,
        status: m.status,
        dueDate: m.targetDate || '',
        fundingPercentage: m.fundingPercentage,
      })),
    },
    compensation: {
      amount: audit.compensation.amount,
      currency: audit.compensation.currency,
      terms: audit.compensation.terms,
    },
    workspace: {
      url: `${process.env.FRONTEND_URL}/auditor/workspace/${audit.id}`,
      documentsRequired: audit.requiredDocuments.length,
      milestonesToReview: project.milestones.length,
    },
    nextSteps: [
      'Review project documentation and milestones',
      'Set up audit workspace and timeline',
      'Begin initial project assessment',
      'Request additional resources if needed',
    ],
  };
}

/**
 * Firebase Function principale
 */
export const acceptAudit = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuditsAPI.AcceptAuditResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<AuditsAPI.AcceptAuditRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Accepting audit assignment', {
      functionName: 'acceptAudit',
      uid: context.auth.uid,
      auditId: validatedData.auditId,
      estimatedCompletionDate: validatedData.estimatedCompletionDate,
      hasAcceptanceNote: !!validatedData.acceptanceNote,
      hasProposedTimeline: !!(validatedData.proposedTimeline && validatedData.proposedTimeline.length > 0),
    });

    // Exécution
    const result = await executeAcceptAudit(validatedData, context);

    // Logging de succès
    logger.info('Audit accepted successfully', {
      functionName: 'acceptAudit',
      uid: context.auth.uid,
      auditId: validatedData.auditId,
      acceptedAt: result.acceptedAt,
      estimatedCompletion: result.estimatedCompletion,
      status: result.status,
      compensation: result.compensation.amount,
      success: true,
    });

    return result;
  })
);