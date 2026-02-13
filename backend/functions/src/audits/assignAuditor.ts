/**
 * Assign Auditor Firebase Function
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
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG, LIMITS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  auditorUid: Joi.string().required(),
  specializations: Joi.array().items(Joi.string().valid(
    'financial', 'technical', 'environmental', 'social', 'legal', 'compliance'
  )).min(1).required(),
  deadline: Joi.string().isoDate().required(),
  compensation: Joi.number().min(AUDIT_CONFIG.COMPENSATION.BASE_AMOUNT).max(LIMITS.PROJECT.MAX_FUNDING_GOAL).optional(),
  priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
  assignmentNotes: Joi.string().max(1000).optional(),
}).required();

/**
 * Valide les permissions pour assigner un auditeur
 */
async function validateAuditorAssignmentPermissions(
  uid: string,
  projectId: string
): Promise<{ user: UserDocument; project: ProjectDocument; hasAdminAccess: boolean }> {
  try {
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);

    const hasAdminAccess = user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS) ||
                          user.permissions.includes(USER_PERMISSIONS.ASSIGN_AUDITORS);

    // Vérifier les permissions d'assignation
    if (!hasAdminAccess) {
      throw new https.HttpsError('permission-denied', 'Admin access required to assign auditors');
    }

    // Vérifier que le projet nécessite un audit
    if (project.status !== STATUS.PROJECT.APPROVED && project.status !== STATUS.PROJECT.ACTIVE) {
      throw new https.HttpsError('failed-precondition', 'Project must be approved or active to assign auditor');
    }

    return { user, project, hasAdminAccess };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate auditor assignment permissions', error, { uid, projectId });
    throw new https.HttpsError('internal', 'Unable to validate assignment permissions');
  }
}

/**
 * Valide l'éligibilité de l'auditeur
 */
async function validateAuditorEligibility(
  auditorUid: string,
  specializations: string[],
  projectCategory: string,
  compensation?: number
): Promise<UserDocument> {
  try {
    const auditor = await firestoreHelper.getDocument<UserDocument>('users', auditorUid);

    // Vérifier que l'utilisateur est auditeur
    if (!auditor.permissions.includes(USER_PERMISSIONS.AUDIT_PROJECT)) {
      throw new https.HttpsError('invalid-argument', 'User is not qualified as an auditor');
    }

    // Vérifier le statut de l'auditeur
    if (auditor.status !== 'active') {
      throw new https.HttpsError('failed-precondition', 'Auditor account is not active');
    }

    // Vérifier les spécialisations
    const auditorSpecializations = auditor.auditor?.specializations || [];
    const hasRequiredSpecializations = specializations.every(spec => 
      auditorSpecializations.includes(spec)
    );

    if (!hasRequiredSpecializations) {
      throw new https.HttpsError('invalid-argument', 
        `Auditor does not have required specializations: ${specializations.join(', ')}`);
    }

    // Vérifier la certification pour la catégorie
    const certifications = auditor.auditor?.certifications || [];
    const categoryRequiresCertification = ['finance', 'healthcare', 'legal'].includes(projectCategory);
    
    if (categoryRequiresCertification) {
      const hasCategoryCertification = certifications.some(cert => 
        cert.category === projectCategory && cert.status === 'active'
      );
      
      if (!hasCategoryCertification) {
        throw new https.HttpsError('failed-precondition', 
          `Auditor lacks required certification for category: ${projectCategory}`);
      }
    }

    // Vérifier la disponibilité
    const currentAudits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['status', 'in', [STATUS.AUDIT.ASSIGNED, STATUS.AUDIT.IN_PROGRESS]]
      ]
    );

    const maxConcurrentAudits = auditor.auditor?.maxConcurrentAudits || AUDIT_CONFIG.DEFAULT_MAX_CONCURRENT;
    if (currentAudits.data.length >= maxConcurrentAudits) {
      throw new https.HttpsError('failed-precondition',
        `Auditor has reached maximum concurrent audits limit (${maxConcurrentAudits})`);
    }

    // Vérifier les critères de compensation
    if (compensation) {
      const minRate = auditor.auditor?.minHourlyRate || 0;
      const estimatedHours = AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[projectCategory] ||
                           AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS;
      const minCompensation = minRate * estimatedHours;

      if (compensation < minCompensation) {
        throw new https.HttpsError('invalid-argument',
          `Compensation below auditor's minimum rate. Required: €${minCompensation}`);
      }
    }

    logger.info('Auditor eligibility validated', {
      auditorUid,
      specializations,
      projectCategory,
      currentAudits: currentAudits.data.length,
      maxConcurrent: maxConcurrentAudits,
    });

    return auditor;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate auditor eligibility', error, { auditorUid, specializations });
    throw new https.HttpsError('internal', 'Unable to validate auditor eligibility');
  }
}

/**
 * Vérifie les conflits d'intérêts potentiels
 */
async function checkConflictsOfInterest(
  auditorUid: string,
  project: ProjectDocument
): Promise<void> {
  try {
    // Vérifier si l'auditeur a contribué au projet
    const auditorContributions = await firestoreHelper.queryDocuments<any>(
      `projects/${project.uid}/contributions`,
      [['contributorUid', '==', auditorUid]],
      { limit: 1 }
    );

    if (auditorContributions.data.length > 0) {
      throw new https.HttpsError('failed-precondition',
        'Auditor cannot audit a project they have contributed to');
    }

    // Vérifier les relations avec le créateur
    const auditor = await firestoreHelper.getDocument<UserDocument>('users', auditorUid);

    // Vérifier si l'auditeur et le créateur ont des projets en commun
    const sharedProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['$or', [
          { creatorUid: auditorUid, collaborators: { arrayContains: project.creatorUid } },
          { creatorUid: project.creatorUid, collaborators: { arrayContains: auditorUid } }
        ]]
      ],
      { limit: 1 }
    );

    if (sharedProjects.data.length > 0) {
      logger.warn('Potential conflict of interest detected', {
        auditorUid,
        creatorUid: project.creatorUid,
        sharedProjectsCount: sharedProjects.data.length,
      });

      // Log but don't block - à évaluer au cas par cas
    }

    // Vérifier l'historique d'audit entre ces parties
    const previousAudits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['projectCreatorUid', '==', project.creatorUid]
      ],
      { limit: 5 }
    );

    if (previousAudits.data.length >= AUDIT_CONFIG.MAX_AUDITS_SAME_CREATOR) {
      throw new https.HttpsError('failed-precondition',
        `Auditor has already audited ${AUDIT_CONFIG.MAX_AUDITS_SAME_CREATOR} projects from this creator`);
    }

    logger.info('Conflict of interest check completed', {
      auditorUid,
      projectId: project.uid,
      previousAudits: previousAudits.data.length,
      hasContributed: auditorContributions.data.length > 0,
    });

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to check conflicts of interest', error, { auditorUid, projectId: project.uid });
    throw new https.HttpsError('internal', 'Unable to verify conflict of interest status');
  }
}

/**
 * Calcule la compensation automatique si non spécifiée
 */
function calculateAuditCompensation(
  auditor: UserDocument,
  project: ProjectDocument,
  specializations: string[],
  requestedCompensation?: number
): number {
  if (requestedCompensation) {
    return requestedCompensation;
  }

  const baseRate = auditor.auditor?.hourlyRate || AUDIT_CONFIG.DEFAULT_HOURLY_RATE;
  const categoryMultiplier = AUDIT_CONFIG.COMPLEXITY_MULTIPLIERS[project.category] || 1.0;
  const specializationBonus = specializations.length > 1 ? AUDIT_CONFIG.MULTI_SPEC_BONUS : 1.0;
  const projectSizeMultiplier = project.funding.goal > 100000 ? 1.2 : 1.0;

  const estimatedHours = AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                        AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS;

  const calculatedCompensation = Math.round(
    baseRate * estimatedHours * categoryMultiplier * specializationBonus * projectSizeMultiplier
  );

  return Math.min(calculatedCompensation, AUDIT_CONFIG.MAX_COMPENSATION);
}

/**
 * Crée l'audit et assigne l'auditeur
 */
async function createAuditAssignment(
  project: ProjectDocument,
  auditor: UserDocument,
  data: AuditsAPI.AssignAuditorRequest,
  compensation: number,
  assignedBy: string
): Promise<string> {
  try {
    const auditId = helpers.string.generateId('audit');
    const deadline = new Date(data.deadline);
    const now = new Date();

    const auditDocument: AuditDocument = {
      id: auditId,
      projectId: project.uid,
      projectTitle: project.title,
      projectCategory: project.category,
      projectCreatorUid: project.creatorUid,
      auditorUid: data.auditorUid,
      auditorName: `${auditor.firstName} ${auditor.lastName}`,
      auditorEmail: auditor.email,
      
      // Configuration de l'audit
      specializations: data.specializations,
      priority: data.priority || 'medium',
      estimatedHours: AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                     AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS,
      
      // Timeline
      assignedAt: now,
      deadline,
      estimatedCompletion: new Date(deadline.getTime() - 24 * 60 * 60 * 1000), // 1 day before deadline
      
      // Status et workflow
      status: STATUS.AUDIT.ASSIGNED,
      currentMilestone: project.milestones.find(m => m.status === STATUS.MILESTONE.COMPLETED)?.id || 
                       project.milestones[0]?.id,
      
      // Compensation
      compensation: {
        amount: compensation,
        currency: 'EUR',
        status: 'pending',
        terms: 'payment_on_completion',
      },
      
      // Configuration d'audit
      criteria: AUDIT_CONFIG.DEFAULT_CRITERIA[project.category] || AUDIT_CONFIG.DEFAULT_CRITERIA.general,
      requiredDocuments: AUDIT_CONFIG.REQUIRED_DOCUMENTS[project.category] || [],
      
      // Métadonnées
      assignedBy,
      assignmentNotes: data.assignmentNotes || '',
      autoAssigned: false,
      
      // Tracking
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    // Transaction pour créer l'audit et mettre à jour le projet
    await firestoreHelper.runTransaction(async (transaction) => {
      // Créer l'audit
      const auditRef = firestoreHelper.getDocumentRef('audits', auditId);
      transaction.set(auditRef, auditDocument);

      // Mettre à jour le projet
      const projectRef = firestoreHelper.getDocumentRef('projects', project.uid);
      transaction.update(projectRef, {
        'audit.auditorUid': data.auditorUid,
        'audit.auditorName': `${auditor.firstName} ${auditor.lastName}`,
        'audit.assignedAt': now,
        'audit.deadline': deadline,
        'audit.status': STATUS.AUDIT.ASSIGNED,
        'audit.auditId': auditId,
        updatedAt: now,
        version: project.version + 1,
      });

      // Ajouter à la liste des audits de l'auditeur
      const auditorAuditRef = firestoreHelper.getDocumentRef(
        `users/${data.auditorUid}/audits`, 
        auditId
      );
      
      transaction.set(auditorAuditRef, {
        id: auditId,
        projectId: project.uid,
        projectTitle: project.title,
        assignedAt: now,
        deadline,
        status: STATUS.AUDIT.ASSIGNED,
        compensation: compensation,
        priority: data.priority || 'medium',
        specializations: data.specializations,
      });
    });

    logger.info('Audit assignment created successfully', {
      auditId,
      projectId: project.uid,
      auditorUid: data.auditorUid,
      deadline: deadline.toISOString(),
      compensation,
      specializations: data.specializations,
    });

    return auditId;

  } catch (error) {
    logger.error('Failed to create audit assignment', error, {
      projectId: project.uid,
      auditorUid: data.auditorUid,
    });
    throw new https.HttpsError('internal', 'Unable to create audit assignment');
  }
}

/**
 * Envoie la notification d'assignation à l'auditeur
 */
async function sendAuditorAssignmentNotification(
  auditor: UserDocument,
  project: ProjectDocument,
  auditId: string,
  deadline: Date,
  compensation: number,
  specializations: string[]
): Promise<void> {
  try {
    const emailData = {
      to: auditor.email,
      templateId: 'auditor_assignment',
      dynamicTemplateData: {
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        projectTitle: project.title,
        projectCategory: project.category,
        projectCreator: project.creatorName || 'Creator',
        deadline: deadline.toLocaleDateString('fr-FR'),
        compensation: (compensation / 100).toFixed(2),
        currency: 'EUR',
        specializations: specializations.join(', '),
        estimatedHours: AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                       AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        auditDashboardUrl: `${process.env.FRONTEND_URL}/auditor/dashboard`,
        acceptUrl: `${process.env.FRONTEND_URL}/auditor/assignments/${auditId}/accept`,
        daysUntilDeadline: Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Auditor assignment notification sent', {
      auditId,
      auditorEmail: auditor.email,
      projectId: project.uid,
    });

  } catch (error) {
    logger.error('Failed to send auditor assignment notification', error, {
      auditId,
      auditorUid: auditor.uid,
      projectId: project.uid,
    });
    // Ne pas faire échouer l'assignation pour l'envoi d'email
  }
}

/**
 * Met à jour les statistiques d'audit
 */
async function updateAuditStats(
  auditor: UserDocument,
  project: ProjectDocument,
  specializations: string[]
): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'audits.totalAssigned': 1,
      'audits.activeAudits': 1,
      [`categories.${project.category}.auditsAssigned`]: 1,
      'auditors.activeCount': 1,
    });

    // Statistiques de l'auditeur
    await firestoreHelper.incrementDocument('users', auditor.uid, {
      'auditor.stats.totalAssigned': 1,
      'auditor.stats.activeAudits': 1,
      'auditor.stats.monthlyAssignments': 1,
    });

    // Statistiques par spécialisation
    for (const specialization of specializations) {
      await firestoreHelper.incrementDocument('audit_stats', 'specializations', {
        [`${specialization}.assigned`]: 1,
        [`${specialization}.active`]: 1,
      });
    }

    logger.info('Audit statistics updated', {
      auditorUid: auditor.uid,
      projectCategory: project.category,
      specializations,
    });

  } catch (error) {
    logger.error('Failed to update audit statistics', error, {
      auditorUid: auditor.uid,
      projectId: project.uid,
    });
    // Ne pas faire échouer l'assignation pour les stats
  }
}

/**
 * Crée l'activité dans le feed du projet
 */
async function createAuditAssignmentActivity(
  project: ProjectDocument,
  auditor: UserDocument,
  auditId: string,
  assignedBy: string
): Promise<void> {
  try {
    const feedEntry = {
      id: helpers.string.generateId('feed'),
      type: 'auditor_assigned',
      projectId: project.uid,
      auditId,
      auditorUid: auditor.uid,
      auditorName: `${auditor.firstName} ${auditor.lastName}`,
      assignedBy,
      createdAt: new Date(),
      visibility: 'project_team',
      data: {
        specializations: [], // Filled by caller
        compensation: 0, // Filled by caller
      },
    };

    await firestoreHelper.addDocument('activity_feed', feedEntry);

    logger.info('Audit assignment activity created', {
      auditId,
      feedEntryId: feedEntry.id,
      projectId: project.uid,
    });

  } catch (error) {
    logger.error('Failed to create audit assignment activity', error, {
      auditId,
      projectId: project.uid,
    });
    // Ne pas faire échouer l'assignation pour l'activité
  }
}

/**
 * Exécute l'assignation d'auditeur
 */
async function executeAssignAuditor(
  data: AuditsAPI.AssignAuditorRequest,
  context: CallableContext
): Promise<AuditsAPI.AssignAuditorResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions et récupération du projet
  const { user, project, hasAdminAccess } = await validateAuditorAssignmentPermissions(uid, data.projectId);
  
  // Validation de l'auditeur
  const auditor = await validateAuditorEligibility(
    data.auditorUid,
    data.specializations,
    project.category,
    data.compensation
  );
  
  // Vérification des conflits d'intérêts
  await checkConflictsOfInterest(data.auditorUid, project);
  
  // Calcul de la compensation
  const finalCompensation = calculateAuditCompensation(
    auditor,
    project,
    data.specializations,
    data.compensation
  );
  
  // Création de l'assignation d'audit
  const auditId = await createAuditAssignment(
    project,
    auditor,
    data,
    finalCompensation,
    uid
  );
  
  // Processus post-assignation en parallèle
  await Promise.all([
    sendAuditorAssignmentNotification(
      auditor,
      project,
      auditId,
      new Date(data.deadline),
      finalCompensation,
      data.specializations
    ),
    updateAuditStats(auditor, project, data.specializations),
    createAuditAssignmentActivity(project, auditor, auditId, uid),
  ]);

  // Log business
  logger.business('Auditor assigned to project', 'audits', {
    auditId,
    projectId: data.projectId,
    auditorUid: data.auditorUid,
    assignedBy: uid,
    specializations: data.specializations,
    compensation: finalCompensation,
    deadline: data.deadline,
    priority: data.priority,
    autoCalculatedCompensation: !data.compensation,
  });

  // Log security pour audit trail
  logger.security('Audit assignment created', 'medium', {
    auditId,
    projectId: data.projectId,
    auditorUid: data.auditorUid,
    assignedBy: uid,
    hasAdminAccess,
    compensation: finalCompensation,
    conflictCheckPassed: true,
  });

  return {
    auditId,
    assignedAt: new Date().toISOString(),
    deadline: data.deadline,
    status: STATUS.AUDIT.ASSIGNED,
    compensation: finalCompensation,
    estimatedHours: AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                   AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS,
    notificationSent: true,
    specializations: data.specializations,
    nextStep: 'awaiting_auditor_acceptance',
  };
}

/**
 * Firebase Function principale
 */
export const assignAuditor = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuditsAPI.AssignAuditorResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<AuditsAPI.AssignAuditorRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Assigning auditor to project', {
      functionName: 'assignAuditor',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      auditorUid: validatedData.auditorUid,
      specializations: validatedData.specializations,
      deadline: validatedData.deadline,
      requestedCompensation: validatedData.compensation,
    });

    // Exécution
    const result = await executeAssignAuditor(validatedData, context);

    // Logging de succès
    logger.info('Auditor assigned successfully', {
      functionName: 'assignAuditor',
      uid: context.auth.uid,
      auditId: result.auditId,
      projectId: validatedData.projectId,
      auditorUid: validatedData.auditorUid,
      finalCompensation: result.compensation,
      assignedAt: result.assignedAt,
      deadline: result.deadline,
      success: true,
    });

    return result;
  })
);