/**
 * Update Project Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi, commonSchemas } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { ProjectsAPI } from '../types/api';
import { ProjectDocument, UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, PROJECT_CONFIG, USER_PERMISSIONS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  projectId: Joi.string().required(),
  
  // Champs modifiables
  title: Joi.string().min(3).max(100).optional(),
  description: Joi.string().min(10).max(2000).optional(),
  shortDescription: Joi.string().min(10).max(200).optional(),
  tags: Joi.array().items(Joi.string().max(30)).min(1).max(10).optional(),
  
  // Impact goals (modifications limitées)
  impactGoals: Joi.object({
    primary: Joi.string().min(10).max(500).optional(),
    secondary: Joi.array().items(Joi.string().max(200)).max(5).optional(),
    metrics: Joi.array().items(
      Joi.object({
        id: Joi.string().optional(), // Pour modification existante
        name: Joi.string().max(50).required(),
        target: Joi.number().positive().required(),
        unit: Joi.string().max(20).required(),
        description: Joi.string().max(200).optional(),
        current: Joi.number().min(0).optional(),
      })
    ).max(10).optional(),
  }).optional(),

  // Médias
  media: Joi.object({
    coverImage: Joi.string().uri().optional(),
    gallery: Joi.array().items(Joi.string().uri()).max(20).optional(),
    video: Joi.string().uri().optional(),
    documents: Joi.array().items(
      Joi.object({
        id: Joi.string().optional(), // Pour modification existante
        name: Joi.string().max(100).required(),
        url: Joi.string().uri().required(),
        type: Joi.string().valid('pdf', 'doc', 'image', 'other').required(),
        size: Joi.number().max(10485760).optional(),
      })
    ).max(10).optional(),
  }).optional(),

  // Équipe (ajouts/modifications uniquement)
  team: Joi.object({
    add: Joi.array().items(
      Joi.object({
        name: Joi.string().min(2).max(100).required(),
        role: Joi.string().min(2).max(50).required(),
        bio: Joi.string().max(300).optional(),
        avatar: Joi.string().uri().optional(),
        linkedin: Joi.string().uri().optional(),
      })
    ).max(10).optional(),
    update: Joi.array().items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().min(2).max(100).optional(),
        role: Joi.string().min(2).max(50).optional(),
        bio: Joi.string().max(300).optional(),
        avatar: Joi.string().uri().optional(),
        linkedin: Joi.string().uri().optional(),
      })
    ).optional(),
    remove: Joi.array().items(Joi.string()).optional(),
  }).optional(),

  // Paramètres
  settings: Joi.object({
    allowPublicComments: Joi.boolean().optional(),
    requireIdentityVerification: Joi.boolean().optional(),
    notifyOnMilestone: Joi.boolean().optional(),
  }).optional(),
}).min(2).required(); // projectId + au moins un champ à modifier

/**
 * Valide que l'utilisateur peut modifier le projet
 */
async function validateUserCanUpdateProject(
  uid: string,
  projectId: string
): Promise<{ user: UserDocument; project: ProjectDocument }> {
  try {
    // Récupérer l'utilisateur et le projet en parallèle
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);
    
    // Vérifier que l'utilisateur est le créateur
    if (project.creatorUid !== uid) {
      // Vérifier si l'utilisateur a des permissions d'admin
      if (!user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS)) {
        throw new https.HttpsError('permission-denied', 'Only the project creator can modify this project');
      }
    }

    // Vérifier le statut du projet
    const modifiableStatuses = [
      STATUS.PROJECT.DRAFT,
      STATUS.PROJECT.UNDER_REVIEW,
      STATUS.PROJECT.ACTIVE,
      STATUS.PROJECT.FUNDING
    ];

    if (!modifiableStatuses.includes(project.status)) {
      throw new https.HttpsError(
        'failed-precondition',
        `Cannot modify project in status: ${project.status}`
      );
    }

    // Vérifier les restrictions temporelles
    if (project.status === STATUS.PROJECT.FUNDING) {
      const now = new Date();
      const fundingEnd = new Date(project.funding.deadline);
      
      // Empêcher les modifications dans les dernières 24h de financement
      const hoursUntilDeadline = helpers.date.differenceInHours(fundingEnd, now);
      if (hoursUntilDeadline < 24 && hoursUntilDeadline > 0) {
        throw new https.HttpsError(
          'failed-precondition',
          'Project cannot be modified in the last 24 hours of funding'
        );
      }
    }

    return { user, project };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate user for project update', error, { uid, projectId });
    throw new https.HttpsError('internal', 'Unable to validate project update permissions');
  }
}

/**
 * Valide les modifications par rapport aux restrictions
 */
function validateProjectChanges(
  project: ProjectDocument,
  updateData: Partial<ProjectsAPI.UpdateProjectRequest>
): void {
  // Empêcher certaines modifications en fonction du statut
  if (project.status === STATUS.PROJECT.FUNDING) {
    // En cours de financement, modifications très limitées
    const restrictedFields = ['impactGoals'];
    
    for (const field of restrictedFields) {
      if (updateData[field as keyof typeof updateData] !== undefined) {
        throw new https.HttpsError(
          'failed-precondition',
          `Cannot modify ${field} during active funding period`
        );
      }
    }
  }

  // Validation des nouvelles métriques d'impact
  if (updateData.impactGoals?.metrics) {
    const existingMetricIds = project.impactGoals.metrics.map(m => m.id);
    const newMetrics = updateData.impactGoals.metrics.filter(m => !m.id || !existingMetricIds.includes(m.id));
    
    if (newMetrics.length > 0 && project.status === STATUS.PROJECT.FUNDING) {
      throw new https.HttpsError(
        'failed-precondition',
        'Cannot add new impact metrics during funding period'
      );
    }
  }

  // Validation de l'équipe
  if (updateData.team?.remove) {
    const teamLeadId = project.team.find(member => member.isLead)?.id;
    if (updateData.team.remove.includes(teamLeadId!)) {
      throw new https.HttpsError(
        'invalid-argument',
        'Cannot remove the team lead. Transfer leadership first.'
      );
    }
    
    const remainingTeamSize = project.team.length - updateData.team.remove.length + (updateData.team.add?.length || 0);
    if (remainingTeamSize < 1) {
      throw new https.HttpsError('invalid-argument', 'Project must have at least one team member');
    }
  }
}

/**
 * Prépare les données de mise à jour
 */
function prepareUpdateData(
  project: ProjectDocument,
  requestData: Partial<ProjectsAPI.UpdateProjectRequest>
): Partial<ProjectDocument> {
  const updateData: any = {
    updatedAt: new Date(),
    version: project.version + 1,
  };

  // Champs directs
  if (requestData.title !== undefined) {
    updateData.title = requestData.title.trim();
  }
  
  if (requestData.description !== undefined) {
    updateData.description = requestData.description.trim();
  }

  if (requestData.shortDescription !== undefined) {
    updateData.shortDescription = requestData.shortDescription.trim();
  }

  if (requestData.tags !== undefined) {
    updateData.tags = requestData.tags.map(tag => tag.trim().toLowerCase());
  }

  // Impact Goals - merge avec l'existant
  if (requestData.impactGoals) {
    updateData.impactGoals = {
      ...project.impactGoals,
      ...requestData.impactGoals
    };

    // Gestion spéciale des métriques
    if (requestData.impactGoals.metrics) {
      const existingMetrics = new Map(project.impactGoals.metrics.map(m => [m.id, m]));
      const updatedMetrics = [];

      for (const metric of requestData.impactGoals.metrics) {
        if (metric.id && existingMetrics.has(metric.id)) {
          // Mise à jour d'une métrique existante
          updatedMetrics.push({
            ...existingMetrics.get(metric.id)!,
            ...metric,
            lastUpdatedAt: new Date(),
          });
          existingMetrics.delete(metric.id);
        } else {
          // Nouvelle métrique
          updatedMetrics.push({
            id: helpers.string.generateId('metric'),
            name: metric.name.trim(),
            target: metric.target,
            unit: metric.unit.trim(),
            description: metric.description?.trim(),
            current: metric.current || 0,
            percentage: Math.round(((metric.current || 0) / metric.target) * 100),
            lastUpdatedAt: new Date(),
          });
        }
      }

      // Ajouter les métriques non modifiées
      existingMetrics.forEach(metric => {
        updatedMetrics.push(metric);
      });

      updateData.impactGoals.metrics = updatedMetrics;
    }
  }

  // Médias - merge avec l'existant
  if (requestData.media) {
    updateData.media = {
      ...project.media,
      ...requestData.media
    };

    // Gestion spéciale des documents
    if (requestData.media.documents) {
      const existingDocs = new Map(project.media.documents.map(d => [d.id, d]));
      const updatedDocs = [];

      for (const doc of requestData.media.documents) {
        if (doc.id && existingDocs.has(doc.id)) {
          // Mise à jour d'un document existant
          updatedDocs.push({
            ...existingDocs.get(doc.id)!,
            ...doc,
          });
          existingDocs.delete(doc.id);
        } else {
          // Nouveau document
          updatedDocs.push({
            id: helpers.string.generateId('doc'),
            name: doc.name.trim(),
            url: doc.url,
            type: doc.type,
            size: doc.size,
            uploadedAt: new Date(),
          });
        }
      }

      // Ajouter les documents non modifiés
      existingDocs.forEach(doc => {
        updatedDocs.push(doc);
      });

      updateData.media.documents = updatedDocs;
    }
  }

  // Équipe - gestion des ajouts/suppressions/modifications
  if (requestData.team) {
    let updatedTeam = [...project.team];

    // Suppressions
    if (requestData.team.remove && requestData.team.remove.length > 0) {
      updatedTeam = updatedTeam.filter(member => !requestData.team.remove!.includes(member.id));
    }

    // Modifications
    if (requestData.team.update && requestData.team.update.length > 0) {
      updatedTeam = updatedTeam.map(member => {
        const update = requestData.team.update!.find(u => u.id === member.id);
        if (update) {
          return {
            ...member,
            ...update,
            name: update.name?.trim() || member.name,
            role: update.role?.trim() || member.role,
            bio: update.bio?.trim() || member.bio,
          };
        }
        return member;
      });
    }

    // Ajouts
    if (requestData.team.add && requestData.team.add.length > 0) {
      for (const newMember of requestData.team.add) {
        updatedTeam.push({
          id: helpers.string.generateId('team'),
          name: newMember.name.trim(),
          role: newMember.role.trim(),
          bio: newMember.bio?.trim(),
          avatar: newMember.avatar,
          linkedin: newMember.linkedin,
          isLead: false,
          joinedAt: new Date(),
        });
      }
    }

    updateData.team = updatedTeam;
  }

  // Paramètres - merge avec l'existant
  if (requestData.settings) {
    updateData.settings = {
      ...project.settings,
      ...requestData.settings,
    };
  }

  return updateData;
}

/**
 * Détermine si le projet nécessite une nouvelle review
 */
function requiresNewReview(
  project: ProjectDocument,
  updateData: Partial<ProjectDocument>
): boolean {
  // Changements qui nécessitent une review
  const sensitiveFields = ['title', 'description', 'impactGoals', 'funding'];
  
  for (const field of sensitiveFields) {
    if (updateData[field as keyof typeof updateData] !== undefined) {
      return true;
    }
  }

  // Changements d'équipe significatifs
  if (updateData.team && project.team.length !== updateData.team.length) {
    return true;
  }

  return false;
}

/**
 * Met à jour le statut de compliance si nécessaire
 */
function updateComplianceStatus(
  project: ProjectDocument,
  updateData: Partial<ProjectDocument>
): void {
  if (requiresNewReview(project, updateData)) {
    updateData.complianceChecks = {
      ...project.complianceChecks,
      contentModeration: STATUS.MODERATION.PENDING,
    };

    // Si changements majeurs, remettre en draft
    if (updateData.title || updateData.description || updateData.impactGoals) {
      updateData.status = STATUS.PROJECT.UNDER_REVIEW;
    }
  }
}

/**
 * Envoie les notifications de mise à jour
 */
async function notifyProjectUpdate(
  project: ProjectDocument,
  updateData: Partial<ProjectDocument>,
  modifiedFields: string[]
): Promise<void> {
  try {
    // Déterminer si c'est une mise à jour significative pour les contributeurs
    const significantFields = ['description', 'impactGoals', 'milestones', 'media'];
    const isSignificantUpdate = modifiedFields.some(field => significantFields.includes(field));

    if (isSignificantUpdate && project.status === STATUS.PROJECT.FUNDING) {
      logger.info('Significant project update notifications would be sent', {
        projectId: project.uid,
        modifiedFields,
        contributorsToNotify: project.funding.contributorsCount
      });

      // TODO: Implémenter les notifications aux contributeurs
      // - Email aux contributeurs existants
      // - Notification dans l'app
      // - Mise à jour du feed d'activité
    }

    logger.info('Project update notifications processed', {
      projectId: project.uid,
      isSignificantUpdate,
      modifiedFields
    });

  } catch (error) {
    logger.error('Failed to send project update notifications', error, {
      projectId: project.uid,
      modifiedFields
    });
    // Ne pas faire échouer la mise à jour pour les notifications
  }
}

/**
 * Met à jour les données d'audit si nécessaire
 */
function updateAuditRequirements(
  project: ProjectDocument,
  updateData: Partial<ProjectDocument>
): void {
  // Si changements significatifs et audit en cours
  if (project.auditRequired && project.auditStatus === STATUS.AUDIT.IN_PROGRESS) {
    const significantChanges = updateData.impactGoals || updateData.description;
    
    if (significantChanges) {
      updateData.auditStatus = STATUS.AUDIT.PENDING;
      updateData.auditAssignedTo = undefined;
      
      logger.info('Project audit reset due to significant changes', {
        projectId: project.uid,
        previousAuditStatus: project.auditStatus
      });
    }
  }
}

/**
 * Exécute la mise à jour du projet
 */
async function executeUpdateProject(
  data: Partial<ProjectsAPI.UpdateProjectRequest>,
  context: CallableContext
): Promise<ProjectsAPI.UpdateProjectResponse> {
  const uid = context.auth!.uid;
  const projectId = data.projectId!;
  
  // Validation des permissions et récupération des données
  const { user, project } = await validateUserCanUpdateProject(uid, projectId);
  
  // Validation des changements
  validateProjectChanges(project, data);
  
  // Préparer les données de mise à jour
  const updateData = prepareUpdateData(project, data);
  
  // Mettre à jour le statut de compliance si nécessaire
  updateComplianceStatus(project, updateData);
  
  // Mettre à jour les exigences d'audit
  updateAuditRequirements(project, updateData);
  
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
    const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
    
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

  // Déterminer les champs modifiés pour le logging et notifications
  const modifiedFields = Object.keys(data).filter(key => 
    key !== 'projectId' && data[key as keyof typeof data] !== undefined
  );

  // Envoyer les notifications (en parallèle)
  await notifyProjectUpdate(project, updateData, modifiedFields);

  // Log business
  logger.business('Project updated', 'projects', {
    projectId,
    creatorUid: project.creatorUid,
    modifiedBy: uid,
    modifiedFields,
    title: updateData.title || project.title,
    status: updateData.status || project.status,
    version: updateData.version,
    requiresNewReview: requiresNewReview(project, updateData),
  });

  // Log d'audit pour modifications sensibles
  const sensitiveChanges = modifiedFields.filter(field => 
    ['title', 'description', 'impactGoals', 'team'].includes(field)
  );

  if (sensitiveChanges.length > 0) {
    logger.security('Sensitive project data modified', 'medium', {
      projectId,
      modifiedBy: uid,
      modifiedFields: sensitiveChanges,
      projectStatus: project.status,
      ipAddress: context.rawRequest.ip,
      userAgent: context.rawRequest.headers['user-agent'],
    });
  }

  return {
    projectId,
    success: true,
    modifiedFields,
    version: updateData.version as number,
    status: (updateData.status || project.status) as string,
    requiresReview: requiresNewReview(project, updateData),
  };
}

/**
 * Firebase Function principale
 */
export const updateProject = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<ProjectsAPI.UpdateProjectResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<Partial<ProjectsAPI.UpdateProjectRequest>>(requestSchema, data);

    // Logging de démarrage
    logger.info('Updating project', {
      functionName: 'updateProject',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      fieldsToUpdate: Object.keys(validatedData).filter(key => key !== 'projectId'),
    });

    // Exécution
    const result = await executeUpdateProject(validatedData, context);

    // Logging de succès
    logger.info('Project updated successfully', {
      functionName: 'updateProject',
      uid: context.auth.uid,
      projectId: result.projectId,
      modifiedFields: result.modifiedFields,
      version: result.version,
      requiresReview: result.requiresReview,
      success: true,
    });

    return result;
  })
);