/**
 * Release Escrow Firebase Function
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
import { stripeService } from '../integrations/stripe/stripeService';
import { emailService } from '../integrations/sendgrid/emailService';
import { PaymentsAPI } from '../types/api';
import { ProjectDocument, UserDocument, ContributionDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, PAYMENT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  releaseType: Joi.string().valid('milestone_completion', 'project_completion', 'emergency_release', 'admin_override').required(),
  
  // Pour libération par milestone
  projectId: Joi.string().required(),
  milestoneId: Joi.string().when('releaseType', { is: 'milestone_completion', then: Joi.required() }),
  
  // Pour libération d'urgence ou override admin
  releaseReason: Joi.string().min(10).max(500).when('releaseType', { 
    is: Joi.string().valid('emergency_release', 'admin_override'), 
    then: Joi.required() 
  }),
  
  // Paramètres de contrôle
  releasePercentage: Joi.number().min(1).max(100).optional(), // Pourcentage à libérer
  notifyContributors: Joi.boolean().default(true),
  notifyCreator: Joi.boolean().default(true),
  bypassSafetyChecks: Joi.boolean().default(false), // Admin seulement
}).required();

/**
 * Valide les permissions pour la libération d'escrow
 */
async function validateEscrowReleasePermissions(
  uid: string,
  releaseType: string,
  projectId: string
): Promise<{ user: UserDocument; project: ProjectDocument; hasAdminAccess: boolean }> {
  try {
    const [user, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', projectId)
    ]);

    const hasAdminAccess = user.permissions.includes(USER_PERMISSIONS.MODERATE_PROJECTS) ||
                          user.permissions.includes(USER_PERMISSIONS.RELEASE_ESCROW);

    // Valider selon le type de libération
    switch (releaseType) {
      case 'milestone_completion':
        // Créateur ou auditeur assigné peuvent libérer pour les milestones
        const canReleaseMilestone = 
          project.creatorUid === uid ||
          hasAdminAccess ||
          user.permissions.includes(USER_PERMISSIONS.AUDIT_PROJECT);
          
        if (!canReleaseMilestone) {
          throw new https.HttpsError('permission-denied', 'Insufficient permissions for milestone escrow release');
        }
        break;

      case 'project_completion':
        // Créateur ou admin peuvent libérer à la completion
        if (project.creatorUid !== uid && !hasAdminAccess) {
          throw new https.HttpsError('permission-denied', 'Only project creator or admins can release escrow on completion');
        }
        break;

      case 'emergency_release':
      case 'admin_override':
        // Seuls les admins peuvent faire des libérations d'urgence
        if (!hasAdminAccess) {
          throw new https.HttpsError('permission-denied', 'Admin access required for emergency escrow release');
        }
        break;

      default:
        throw new https.HttpsError('invalid-argument', `Unsupported release type: ${releaseType}`);
    }

    return { user, project, hasAdminAccess };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate escrow release permissions', error, { uid, releaseType, projectId });
    throw new https.HttpsError('internal', 'Unable to validate escrow release permissions');
  }
}

/**
 * Valide les conditions de libération
 */
function validateReleaseConditions(
  project: ProjectDocument,
  releaseType: string,
  milestoneId?: string,
  bypassSafetyChecks?: boolean
): { milestone?: any; releaseAmount: number } {
  let releaseAmount = 0;
  let milestone;

  switch (releaseType) {
    case 'milestone_completion':
      if (!milestoneId) {
        throw new https.HttpsError('invalid-argument', 'Milestone ID required for milestone release');
      }
      
      milestone = project.milestones.find(m => m.id === milestoneId);
      if (!milestone) {
        throw new https.HttpsError('not-found', 'Milestone not found');
      }
      
      if (milestone.status !== STATUS.MILESTONE.COMPLETED) {
        throw new https.HttpsError('failed-precondition', 'Milestone must be completed before escrow release');
      }
      
      if (milestone.auditRequired && milestone.auditStatus !== STATUS.AUDIT.APPROVED && !bypassSafetyChecks) {
        throw new https.HttpsError('failed-precondition', 'Milestone audit must be approved before escrow release');
      }
      
      // Calculer le montant à libérer pour ce milestone
      releaseAmount = Math.round(project.funding.raised * milestone.fundingPercentage / 100);
      break;

    case 'project_completion':
      if (project.status !== STATUS.PROJECT.COMPLETED && !bypassSafetyChecks) {
        throw new https.HttpsError('failed-precondition', 'Project must be completed before full escrow release');
      }
      
      // Vérifier que tous les milestones sont complétés
      const incompleteMilestones = project.milestones.filter(m => m.status !== STATUS.MILESTONE.COMPLETED);
      if (incompleteMilestones.length > 0 && !bypassSafetyChecks) {
        throw new https.HttpsError('failed-precondition', 'All milestones must be completed before full escrow release');
      }
      
      releaseAmount = project.funding.raised;
      break;

    case 'emergency_release':
    case 'admin_override':
      // Pas de validation stricte pour les cas d'urgence
      releaseAmount = project.funding.raised;
      break;
  }

  return { milestone, releaseAmount };
}

/**
 * Calcule les montants à libérer par contribution
 */
async function calculateEscrowReleases(
  projectId: string,
  releaseType: string,
  milestoneId?: string,
  releasePercentage?: number
): Promise<{ contribution: ContributionDocument; releaseAmount: number }[]> {
  try {
    // Récupérer toutes les contributions confirmées avec escrow
    const contributionsResult = await firestoreHelper.queryDocuments<ContributionDocument>(
      `projects/${projectId}/contributions`,
      [
        ['status', '==', 'confirmed'],
        ['escrow.held', '==', true]
      ]
    );

    const contributions = contributionsResult.data;

    if (contributions.length === 0) {
      logger.info('No contributions with held escrow found', { projectId, releaseType });
      return [];
    }

    // Calculer les montants à libérer pour chaque contribution
    const releases = contributions.map(contribution => {
      let releaseAmount = 0;

      if (releaseType === 'milestone_completion' && milestoneId) {
        // Libérer uniquement la part de ce milestone
        const milestoneSchedule = contribution.escrow.releaseSchedule.find(
          schedule => schedule.milestoneId === milestoneId
        );
        if (milestoneSchedule && !milestoneSchedule.released) {
          releaseAmount = milestoneSchedule.amount;
        }
      } else {
        // Libérer tout l'escrow restant ou un pourcentage
        const totalHeld = contribution.escrow.heldAmount;
        const alreadyReleased = contribution.escrow.releaseSchedule
          .filter(s => s.released)
          .reduce((sum, s) => sum + s.amount, 0);
        
        const remainingEscrow = totalHeld - alreadyReleased;
        
        if (releasePercentage) {
          releaseAmount = Math.round(remainingEscrow * releasePercentage / 100);
        } else {
          releaseAmount = remainingEscrow;
        }
      }

      return { contribution, releaseAmount };
    }).filter(release => release.releaseAmount > 0);

    logger.info('Escrow releases calculated', {
      projectId,
      releaseType,
      totalContributions: contributions.length,
      contributionsToRelease: releases.length,
      totalReleaseAmount: releases.reduce((sum, r) => sum + r.releaseAmount, 0),
    });

    return releases;

  } catch (error) {
    logger.error('Failed to calculate escrow releases', error, { projectId, releaseType, milestoneId });
    throw new https.HttpsError('internal', 'Unable to calculate escrow releases');
  }
}

/**
 * Effectue les transferts Stripe vers le créateur
 */
async function executeStripeTransfers(
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  project: ProjectDocument,
  releaseType: string
): Promise<any[]> {
  const transferResults: any[] = [];

  try {
    // Traiter les transferts par lots
    const batchSize = 5;
    for (let i = 0; i < releases.length; i += batchSize) {
      const batch = releases.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(async ({ contribution, releaseAmount }) => {
          try {
            const transferData = {
              amount: releaseAmount,
              currency: contribution.amount.currency.toLowerCase(),
              destination: project.stripeConnectAccountId || process.env.STRIPE_CREATOR_ACCOUNT_ID,
              description: `Escrow release: ${project.title} - ${releaseType}`,
              metadata: {
                contributionId: contribution.id,
                projectId: project.uid,
                releaseType,
                milestoneId: releaseType === 'milestone_completion' ? contribution.escrow.releaseSchedule[0]?.milestoneId : '',
                creatorUid: project.creatorUid,
                contributorUid: contribution.contributorUid,
              },
            };

            const transfer = await stripeService.createTransfer(transferData);

            logger.info('Stripe transfer created for escrow release', {
              transferId: transfer.id,
              contributionId: contribution.id,
              releaseAmount,
              destination: transfer.destination,
            });

            return {
              contributionId: contribution.id,
              transferId: transfer.id,
              releaseAmount,
              status: transfer.status || 'pending',
              success: true,
            };

          } catch (error) {
            logger.error('Failed to create Stripe transfer', error, {
              contributionId: contribution.id,
              releaseAmount,
            });
            
            return {
              contributionId: contribution.id,
              releaseAmount,
              error: error instanceof Error ? error.message : 'Transfer failed',
              success: false,
            };
          }
        })
      );

      // Collecter les résultats
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          transferResults.push(result.value);
        } else {
          transferResults.push({
            error: result.reason,
            success: false,
          });
        }
      });
    }

    return transferResults;

  } catch (error) {
    logger.error('Failed to execute Stripe transfers', error, { releaseType, projectId: project.uid });
    throw error;
  }
}

/**
 * Met à jour les documents après libération d'escrow
 */
async function updateDocumentsAfterRelease(
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  transferResults: any[],
  releaseType: string,
  milestoneId: string | undefined,
  uid: string
): Promise<void> {
  try {
    const now = new Date();

    // Traiter chaque contribution
    for (let i = 0; i < releases.length; i++) {
      const { contribution, releaseAmount } = releases[i];
      const transferResult = transferResults[i];

      if (!transferResult.success) {
        continue; // Skip les transferts échoués
      }

      await firestoreHelper.runTransaction(async (transaction) => {
        // Mettre à jour la contribution
        const contributionRef = firestoreHelper.getDocumentRef(
          `projects/${contribution.projectId}/contributions`,
          contribution.id
        );

        const updates: any = {
          updatedAt: now,
          version: contribution.version + 1,
        };

        if (releaseType === 'milestone_completion' && milestoneId) {
          // Marquer le milestone comme libéré dans le planning
          const updatedSchedule = contribution.escrow.releaseSchedule.map(schedule => {
            if (schedule.milestoneId === milestoneId) {
              return {
                ...schedule,
                released: true,
                releasedAt: now,
                transferId: transferResult.transferId,
                releasedBy: uid,
              };
            }
            return schedule;
          });

          updates['escrow.releaseSchedule'] = updatedSchedule;
          
          // Vérifier si tout l'escrow est maintenant libéré
          const totalReleased = updatedSchedule
            .filter(s => s.released)
            .reduce((sum, s) => sum + s.amount, 0);
            
          if (totalReleased >= contribution.escrow.heldAmount) {
            updates['escrow.held'] = false;
            updates['escrow.fullyReleasedAt'] = now;
          }
        } else {
          // Libération complète
          updates['escrow.held'] = false;
          updates['escrow.fullyReleasedAt'] = now;
          updates['escrow.releaseReason'] = releaseType;
          updates['escrow.releasedBy'] = uid;
        }

        transaction.update(contributionRef, updates);

        // Créer l'entrée dans le ledger des libérations
        const releaseEntry = {
          id: helpers.string.generateId('release'),
          type: 'escrow_release',
          contributionId: contribution.id,
          projectId: contribution.projectId,
          releaseType,
          milestoneId: milestoneId || '',
          amount: releaseAmount,
          transferId: transferResult.transferId,
          contributorUid: contribution.contributorUid,
          creatorUid: contribution.projectId, // Will be updated with actual creator UID
          releasedBy: uid,
          createdAt: now,
          processedAt: now,
        };

        const releaseRef = firestoreHelper.getDocumentRef('escrow_releases', releaseEntry.id);
        transaction.set(releaseRef, releaseEntry);
      });
    }

    logger.info('Documents updated after escrow release', {
      contributionsProcessed: releases.length,
      successfulTransfers: transferResults.filter(r => r.success).length,
      releaseType,
      milestoneId,
    });

  } catch (error) {
    logger.error('Failed to update documents after escrow release', error, {
      releaseType,
      milestoneId,
      contributionsCount: releases.length,
    });
    throw error;
  }
}

/**
 * Envoie les notifications de libération d'escrow
 */
async function sendEscrowReleaseNotifications(
  project: ProjectDocument,
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  releaseType: string,
  notifyContributors: boolean,
  notifyCreator: boolean,
  milestone?: any
): Promise<void> {
  try {
    const promises: Promise<void>[] = [];

    // Notification au créateur
    if (notifyCreator) {
      promises.push(notifyCreatorOfEscrowRelease(project, releases, releaseType, milestone));
    }

    // Notifications aux contributeurs
    if (notifyContributors) {
      promises.push(notifyContributorsOfEscrowRelease(project, releases, releaseType, milestone));
    }

    await Promise.all(promises);

  } catch (error) {
    logger.error('Failed to send escrow release notifications', error, {
      projectId: project.uid,
      releaseType,
    });
    // Ne pas faire échouer la libération pour les notifications
  }
}

/**
 * Notifie le créateur de la libération d'escrow
 */
async function notifyCreatorOfEscrowRelease(
  project: ProjectDocument,
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  releaseType: string,
  milestone?: any
): Promise<void> {
  try {
    const creator = await firestoreHelper.getDocument<UserDocument>('users', project.creatorUid);
    const totalReleased = releases.reduce((sum, r) => sum + r.releaseAmount, 0);

    const emailData = {
      to: creator.email,
      templateId: 'escrow_release_creator',
      dynamicTemplateData: {
        creatorName: `${creator.firstName} ${creator.lastName}`,
        projectTitle: project.title,
        releaseType,
        milestoneTitle: milestone?.title || '',
        totalReleased: (totalReleased / 100).toFixed(2),
        currency: project.funding.currency,
        contributionsCount: releases.length,
        releaseDate: new Date().toLocaleDateString('fr-FR'),
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard/projects/${project.uid}`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Creator escrow release notification sent', {
      projectId: project.uid,
      creatorEmail: creator.email,
      totalReleased,
      releaseType,
    });

  } catch (error) {
    logger.error('Failed to notify creator of escrow release', error, {
      projectId: project.uid,
      releaseType,
    });
  }
}

/**
 * Notifie les contributeurs de la libération d'escrow
 */
async function notifyContributorsOfEscrowRelease(
  project: ProjectDocument,
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  releaseType: string,
  milestone?: any
): Promise<void> {
  try {
    // Grouper les notifications par contributeur
    const contributorReleases = new Map<string, { contributions: ContributionDocument[]; totalReleased: number }>();

    releases.forEach(({ contribution, releaseAmount }) => {
      if (contribution.anonymous) return; // Pas de notification pour les anonymes
      
      const contributorUid = contribution.contributorUid;
      if (!contributorReleases.has(contributorUid)) {
        contributorReleases.set(contributorUid, { contributions: [], totalReleased: 0 });
      }
      
      const data = contributorReleases.get(contributorUid)!;
      data.contributions.push(contribution);
      data.totalReleased += releaseAmount;
    });

    // Envoyer les notifications
    const notificationPromises = Array.from(contributorReleases.entries()).map(
      async ([contributorUid, { contributions, totalReleased }]) => {
        try {
          const contributor = await firestoreHelper.getDocument<UserDocument>('users', contributorUid);

          const emailData = {
            to: contributor.email,
            templateId: 'escrow_release_contributor',
            dynamicTemplateData: {
              contributorName: `${contributor.firstName} ${contributor.lastName}`,
              projectTitle: project.title,
              releaseType,
              milestoneTitle: milestone?.title || '',
              contributionsCount: contributions.length,
              totalReleased: (totalReleased / 100).toFixed(2),
              currency: project.funding.currency,
              releaseDate: new Date().toLocaleDateString('fr-FR'),
              projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
            },
          };

          await emailService.sendEmail(emailData);

        } catch (error) {
          logger.error('Failed to notify individual contributor', error, {
            contributorUid,
            projectId: project.uid,
          });
        }
      }
    );

    await Promise.allSettled(notificationPromises);

    logger.info('Contributor escrow release notifications sent', {
      projectId: project.uid,
      contributorsNotified: contributorReleases.size,
      releaseType,
    });

  } catch (error) {
    logger.error('Failed to notify contributors of escrow release', error, {
      projectId: project.uid,
      releaseType,
    });
  }
}

/**
 * Met à jour les statistiques de plateforme
 */
async function updateEscrowStats(
  releases: { contribution: ContributionDocument; releaseAmount: number }[],
  releaseType: string,
  project: ProjectDocument
): Promise<void> {
  try {
    const totalReleased = releases.reduce((sum, r) => sum + r.releaseAmount, 0);
    const contributorsCount = new Set(releases.map(r => r.contribution.contributorUid)).size;

    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'escrow.totalReleased': totalReleased,
      'escrow.releasesCount': releases.length,
      'escrow.uniqueContributors': contributorsCount,
      [`escrow.byType.${releaseType}`]: releases.length,
      [`categories.${project.category}.escrowReleased`]: totalReleased,
    });

    logger.info('Escrow statistics updated', {
      releaseType,
      totalReleased,
      releasesCount: releases.length,
      contributorsCount,
    });

  } catch (error) {
    logger.error('Failed to update escrow statistics', error, {
      releaseType,
      releasesCount: releases.length,
    });
  }
}

/**
 * Exécute la libération d'escrow
 */
async function executeReleaseEscrow(
  data: PaymentsAPI.ReleaseEscrowRequest,
  context: CallableContext
): Promise<PaymentsAPI.ReleaseEscrowResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  const { user, project, hasAdminAccess } = await validateEscrowReleasePermissions(
    uid,
    data.releaseType,
    data.projectId
  );

  // Validation des conditions de libération
  const { milestone, releaseAmount } = validateReleaseConditions(
    project,
    data.releaseType,
    data.milestoneId,
    data.bypassSafetyChecks && hasAdminAccess
  );

  // Calculer les libérations par contribution
  const releases = await calculateEscrowReleases(
    data.projectId,
    data.releaseType,
    data.milestoneId,
    data.releasePercentage
  );

  if (releases.length === 0) {
    return {
      releaseType: data.releaseType,
      projectId: data.projectId,
      milestoneId: data.milestoneId,
      totalReleased: 0,
      contributionsProcessed: 0,
      successful: 0,
      failed: 0,
      results: [],
      processedAt: new Date().toISOString(),
      success: true,
    };
  }

  // Exécuter les transferts Stripe
  const transferResults = await executeStripeTransfers(releases, project, data.releaseType);

  // Mettre à jour les documents
  await updateDocumentsAfterRelease(
    releases,
    transferResults,
    data.releaseType,
    data.milestoneId,
    uid
  );

  // Envoyer les notifications
  await sendEscrowReleaseNotifications(
    project,
    releases,
    data.releaseType,
    data.notifyContributors,
    data.notifyCreator,
    milestone
  );

  // Mettre à jour les statistiques
  const successfulReleases = releases.filter((_, i) => transferResults[i]?.success);
  await updateEscrowStats(successfulReleases, data.releaseType, project);

  // Calculer les résultats
  const successful = transferResults.filter(r => r.success);
  const failed = transferResults.filter(r => !r.success);
  const totalReleased = successful.reduce((sum, r) => sum + (r.releaseAmount || 0), 0);

  // Log business
  logger.business('Escrow released', 'escrow', {
    projectId: data.projectId,
    releaseType: data.releaseType,
    milestoneId: data.milestoneId,
    releasedBy: uid,
    totalReleased,
    contributionsProcessed: releases.length,
    successful: successful.length,
    failed: failed.length,
    isAdminRelease: hasAdminAccess,
  });

  // Log financial pour audit
  logger.financial('Escrow funds released', {
    projectId: data.projectId,
    releaseType: data.releaseType,
    totalReleased,
    transfersCreated: successful.length,
    releasedBy: uid,
    milestoneId: data.milestoneId,
    bypassedSafetyChecks: data.bypassSafetyChecks,
  });

  return {
    releaseType: data.releaseType,
    projectId: data.projectId,
    milestoneId: data.milestoneId,
    totalReleased,
    contributionsProcessed: releases.length,
    successful: successful.length,
    failed: failed.length,
    results: transferResults,
    processedAt: new Date().toISOString(),
    success: true,
  };
}

/**
 * Firebase Function principale
 */
export const releaseEscrow = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<PaymentsAPI.ReleaseEscrowResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<PaymentsAPI.ReleaseEscrowRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Releasing escrow', {
      functionName: 'releaseEscrow',
      uid: context.auth.uid,
      projectId: validatedData.projectId,
      releaseType: validatedData.releaseType,
      milestoneId: validatedData.milestoneId,
      releasePercentage: validatedData.releasePercentage,
      bypassSafetyChecks: validatedData.bypassSafetyChecks,
    });

    // Exécution
    const result = await executeReleaseEscrow(validatedData, context);

    // Logging de succès
    logger.info('Escrow released successfully', {
      functionName: 'releaseEscrow',
      uid: context.auth.uid,
      projectId: result.projectId,
      releaseType: result.releaseType,
      totalReleased: result.totalReleased,
      contributionsProcessed: result.contributionsProcessed,
      successful: result.successful,
      failed: result.failed,
      success: true,
    });

    return result;
  })
);