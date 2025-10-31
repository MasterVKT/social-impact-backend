/**
 * Submit Audit Report Firebase Function
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
import { stripeService } from '../integrations/stripe/stripeService';
import { AuditsAPI } from '../types/api';
import { ProjectDocument, UserDocument, AuditDocument, MilestoneDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  auditId: Joi.string().required(),
  milestoneId: Joi.string().required(),
  decision: Joi.string().valid('approved', 'rejected', 'needs_revision').required(),
  score: Joi.number().min(0).max(100).required(),
  
  criteria: Joi.array().items(
    Joi.object({
      name: Joi.string().required(),
      met: Joi.boolean().required(),
      score: Joi.number().min(0).max(100).required(),
      comments: Joi.string().max(500).optional(),
      evidence: Joi.array().items(Joi.string()).optional(),
    })
  ).min(1).required(),

  report: Joi.object({
    summary: Joi.string().min(50).max(2000).required(),
    strengths: Joi.array().items(Joi.string().min(10).max(200)).min(1).required(),
    weaknesses: Joi.array().items(Joi.string().min(10).max(200)).optional(),
    recommendations: Joi.array().items(Joi.string().min(10).max(300)).required(),
    riskAssessment: Joi.string().valid('low', 'medium', 'high').required(),
    confidenceLevel: Joi.number().min(70).max(100).default(90),
    timeSpent: Joi.number().min(1).max(200).required(), // Heures passées
  }).required(),

  evidence: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('document', 'image', 'video', 'screenshot', 'financial_data').required(),
      name: Joi.string().required(),
      description: Joi.string().max(300).optional(),
      content: Joi.string().required(), // URL ou base64
      sensitive: Joi.boolean().default(false),
    })
  ).optional(),

  followUpRequired: Joi.boolean().default(false),
  followUpDeadline: Joi.string().isoDate().when('followUpRequired', { is: true, then: Joi.required() }),
  additionalNotes: Joi.string().max(1000).optional(),
}).required();

/**
 * Valide que l'auditeur peut soumettre ce rapport
 */
async function validateReportSubmissionPermissions(
  uid: string,
  auditId: string,
  milestoneId: string
): Promise<{ auditor: UserDocument; audit: AuditDocument; project: ProjectDocument; milestone: any }> {
  try {
    const audit = await firestoreHelper.getDocument<AuditDocument>('audits', auditId);

    // Vérifier que c'est bien l'auditeur assigné
    if (audit.auditorUid !== uid) {
      throw new https.HttpsError('permission-denied', 'You are not the assigned auditor for this audit');
    }

    // Vérifier le statut de l'audit
    if (audit.status !== STATUS.AUDIT.IN_PROGRESS) {
      throw new https.HttpsError('failed-precondition', 
        `Cannot submit report for audit in status: ${audit.status}`);
    }

    // Vérifier que l'audit n'a pas expiré
    const deadline = new Date(audit.deadline);
    if (deadline < new Date()) {
      logger.warn('Audit report submitted after deadline', {
        auditId,
        deadline: deadline.toISOString(),
        submittedAt: new Date().toISOString(),
      });
    }

    // Récupérer l'auditeur et le projet
    const [auditor, project] = await Promise.all([
      firestoreHelper.getDocument<UserDocument>('users', uid),
      firestoreHelper.getDocument<ProjectDocument>('projects', audit.projectId)
    ]);

    // Vérifier que le milestone existe
    const milestone = project.milestones.find(m => m.id === milestoneId);
    if (!milestone) {
      throw new https.HttpsError('not-found', 'Milestone not found in project');
    }

    // Vérifier que le milestone est éligible pour audit
    if (milestone.status !== STATUS.MILESTONE.COMPLETED && milestone.status !== STATUS.MILESTONE.SUBMITTED) {
      throw new https.HttpsError('failed-precondition', 
        `Milestone must be completed or submitted for audit. Current status: ${milestone.status}`);
    }

    return { auditor, audit, project, milestone };

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate report submission permissions', error, { uid, auditId, milestoneId });
    throw new https.HttpsError('internal', 'Unable to validate report submission permissions');
  }
}

/**
 * Valide la qualité du rapport d'audit
 */
function validateReportQuality(
  data: AuditsAPI.SubmitReportRequest,
  milestone: any,
  audit: AuditDocument
): void {
  // Vérifier la cohérence du score global avec les critères
  const criteriaScores = data.criteria.map(c => c.score);
  const averageScore = criteriaScores.reduce((sum, score) => sum + score, 0) / criteriaScores.length;
  
  const scoreDifference = Math.abs(data.score - averageScore);
  if (scoreDifference > AUDIT_CONFIG.MAX_SCORE_VARIANCE) {
    throw new https.HttpsError('invalid-argument', 
      `Overall score (${data.score}) is inconsistent with criteria average (${averageScore.toFixed(1)})`);
  }

  // Vérifier que tous les critères obligatoires sont évalués
  const requiredCriteria = audit.criteria.filter(c => c.required);
  const submittedCriteria = data.criteria.map(c => c.name);
  
  const missingCriteria = requiredCriteria.filter(rc => 
    !submittedCriteria.includes(rc.name)
  );
  
  if (missingCriteria.length > 0) {
    throw new https.HttpsError('invalid-argument', 
      `Missing required criteria evaluations: ${missingCriteria.map(c => c.name).join(', ')}`);
  }

  // Valider la cohérence décision/score
  if (data.decision === 'approved' && data.score < AUDIT_CONFIG.MIN_APPROVAL_SCORE) {
    throw new https.HttpsError('invalid-argument', 
      `Score too low for approval. Minimum required: ${AUDIT_CONFIG.MIN_APPROVAL_SCORE}`);
  }

  if (data.decision === 'rejected' && data.score > AUDIT_CONFIG.MAX_REJECTION_SCORE) {
    throw new https.HttpsError('invalid-argument', 
      `Score too high for rejection. Maximum for rejection: ${AUDIT_CONFIG.MAX_REJECTION_SCORE}`);
  }

  // Vérifier que les faiblesses sont documentées pour les scores bas
  if (data.score < 75 && (!data.report.weaknesses || data.report.weaknesses.length === 0)) {
    throw new https.HttpsError('invalid-argument', 
      'Weaknesses must be documented for scores below 75');
  }

  // Vérifier que les recommandations sont appropriées
  if (data.decision === 'needs_revision' && data.report.recommendations.length < 2) {
    throw new https.HttpsError('invalid-argument', 
      'At least 2 recommendations required when requesting revisions');
  }
}

/**
 * Met à jour le statut du milestone après audit
 */
async function updateMilestoneAfterAudit(
  project: ProjectDocument,
  milestone: any,
  auditDecision: string,
  auditScore: number,
  reportId: string,
  uid: string
): Promise<boolean> {
  try {
    let newMilestoneStatus = milestone.status;
    let fundsReleased = false;

    // Déterminer le nouveau statut selon la décision
    switch (auditDecision) {
      case 'approved':
        newMilestoneStatus = STATUS.MILESTONE.APPROVED;
        fundsReleased = true;
        break;
      case 'rejected':
        newMilestoneStatus = STATUS.MILESTONE.REJECTED;
        break;
      case 'needs_revision':
        newMilestoneStatus = STATUS.MILESTONE.NEEDS_REVISION;
        break;
    }

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour le projet avec le nouveau statut du milestone
      const projectRef = firestoreHelper.getDocumentRef('projects', project.uid);
      const projectDoc = await transaction.get(projectRef);
      
      if (projectDoc.exists) {
        const projectData = projectDoc.data()!;
        const updatedMilestones = projectData.milestones.map((m: any) => {
          if (m.id === milestone.id) {
            return {
              ...m,
              status: newMilestoneStatus,
              auditScore,
              auditDecision,
              auditCompletedAt: new Date(),
              auditReportId: reportId,
              auditedBy: uid,
            };
          }
          return m;
        });

        transaction.update(projectRef, {
          milestones: updatedMilestones,
          'audit.lastMilestoneAudit': {
            milestoneId: milestone.id,
            decision: auditDecision,
            score: auditScore,
            completedAt: new Date(),
          },
          updatedAt: new Date(),
        });
      }
    });

    logger.info('Milestone updated after audit', {
      projectId: project.uid,
      milestoneId: milestone.id,
      newStatus: newMilestoneStatus,
      auditScore,
      auditDecision,
      fundsReleased,
    });

    return fundsReleased;

  } catch (error) {
    logger.error('Failed to update milestone after audit', error, {
      projectId: project.uid,
      milestoneId: milestone.id,
      auditDecision,
    });
    throw error;
  }
}

/**
 * Traite la libération automatique des fonds si approuvé
 */
async function processAutomaticFundRelease(
  project: ProjectDocument,
  milestone: any,
  audit: AuditDocument
): Promise<number> {
  try {
    // Vérifier si la libération automatique est configurée
    if (!project.settings?.autoReleaseOnAuditApproval) {
      logger.info('Automatic fund release disabled for project', {
        projectId: project.uid,
        milestoneId: milestone.id,
      });
      return 0;
    }

    // Calculer le montant à libérer
    const releaseAmount = Math.round(project.funding.raised * milestone.fundingPercentage / 100);

    // Récupérer les contributions avec escrow pour ce milestone
    const contributions = await firestoreHelper.queryDocuments<any>(
      `projects/${project.uid}/contributions`,
      [
        ['status', '==', 'confirmed'],
        ['escrow.held', '==', true]
      ]
    );

    let totalReleased = 0;

    // Traiter les libérations par lots
    const batchSize = 5;
    for (let i = 0; i < contributions.length; i += batchSize) {
      const batch = contributions.slice(i, i + batchSize);
      
      const releasePromises = batch.map(async (contribution) => {
        try {
          const milestoneSchedule = contribution.escrow.releaseSchedule.find(
            (schedule: any) => schedule.milestoneId === milestone.id && !schedule.released
          );

          if (!milestoneSchedule) {
            return 0;
          }

          // Créer le transfert Stripe
          const transferData = {
            amount: milestoneSchedule.amount,
            currency: contribution.amount.currency.toLowerCase(),
            destination: project.stripeConnectAccountId || process.env.STRIPE_CREATOR_ACCOUNT_ID,
            description: `Automatic escrow release: ${project.title} - Milestone: ${milestone.title}`,
            metadata: {
              contributionId: contribution.id,
              projectId: project.uid,
              milestoneId: milestone.id,
              auditId: audit.id,
              autoRelease: 'true',
            },
          };

          const transfer = await stripeService.createTransfer(transferData);

          // Marquer comme libéré dans la contribution
          await firestoreHelper.updateDocument(
            `projects/${project.uid}/contributions`,
            contribution.id,
            {
              [`escrow.releaseSchedule.${milestoneSchedule.index}.released`]: true,
              [`escrow.releaseSchedule.${milestoneSchedule.index}.releasedAt`]: new Date(),
              [`escrow.releaseSchedule.${milestoneSchedule.index}.transferId`]: transfer.id,
              [`escrow.releaseSchedule.${milestoneSchedule.index}.releasedBy`]: audit.auditorUid,
              [`escrow.releaseSchedule.${milestoneSchedule.index}.releaseReason`]: 'audit_approval',
              updatedAt: new Date(),
            }
          );

          return milestoneSchedule.amount;

        } catch (error) {
          logger.error('Failed to process automatic fund release for contribution', error, {
            contributionId: contribution.id,
            milestoneId: milestone.id,
          });
          return 0;
        }
      });

      const batchResults = await Promise.allSettled(releasePromises);
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          totalReleased += result.value;
        }
      });
    }

    logger.info('Automatic fund release processed', {
      projectId: project.uid,
      milestoneId: milestone.id,
      auditId: audit.id,
      contributionsProcessed: contributions.length,
      totalReleased,
    });

    return totalReleased;

  } catch (error) {
    logger.error('Failed to process automatic fund release', error, {
      projectId: project.uid,
      milestoneId: milestone.id,
    });
    return 0;
  }
}

/**
 * Calcule et traite la compensation de l'auditeur
 */
async function processAuditorCompensation(
  audit: AuditDocument,
  timeSpent: number,
  auditQuality: number
): Promise<{ amount: number; processed: boolean }> {
  try {
    const baseCompensation = audit.compensation.amount;
    
    // Calculer les bonus/malus basés sur la qualité et le timing
    let qualityMultiplier = 1.0;
    if (auditQuality >= 90) {
      qualityMultiplier = 1.1; // Bonus 10% pour excellente qualité
    } else if (auditQuality < 75) {
      qualityMultiplier = 0.9; // Malus 10% pour qualité insuffisante
    }

    // Bonus pour completion avant deadline
    const deadline = new Date(audit.deadline);
    const daysEarly = Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    let timingMultiplier = 1.0;
    
    if (daysEarly > 2) {
      timingMultiplier = 1.05; // Bonus 5% pour anticipation
    }

    const finalCompensation = Math.round(baseCompensation * qualityMultiplier * timingMultiplier);

    // Créer le paiement de compensation
    const compensationId = helpers.string.generateId('comp');
    
    await firestoreHelper.addDocument('auditor_compensations', {
      id: compensationId,
      auditId: audit.id,
      auditorUid: audit.auditorUid,
      projectId: audit.projectId,
      baseAmount: baseCompensation,
      finalAmount: finalCompensation,
      qualityBonus: qualityMultiplier - 1.0,
      timingBonus: timingMultiplier - 1.0,
      timeSpent,
      hourlyRate: Math.round(finalCompensation / timeSpent),
      status: 'pending_payment',
      createdAt: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
    });

    // Mettre à jour l'audit avec la compensation
    await firestoreHelper.updateDocument('audits', audit.id, {
      'compensation.finalAmount': finalCompensation,
      'compensation.status': 'calculated',
      'compensation.calculatedAt': new Date(),
      'compensation.timeSpent': timeSpent,
      'compensation.qualityMultiplier': qualityMultiplier,
      'compensation.timingMultiplier': timingMultiplier,
    });

    logger.info('Auditor compensation calculated', {
      auditId: audit.id,
      auditorUid: audit.auditorUid,
      baseAmount: baseCompensation,
      finalAmount: finalCompensation,
      timeSpent,
      qualityMultiplier,
      timingMultiplier,
    });

    return { amount: finalCompensation, processed: true };

  } catch (error) {
    logger.error('Failed to process auditor compensation', error, {
      auditId: audit.id,
      timeSpent,
    });
    return { amount: audit.compensation.amount, processed: false };
  }
}

/**
 * Crée et stocke le rapport d'audit complet
 */
async function createAuditReport(
  audit: AuditDocument,
  project: ProjectDocument,
  milestone: any,
  data: AuditsAPI.SubmitReportRequest,
  uid: string
): Promise<string> {
  try {
    const reportId = helpers.string.generateId('report');
    const now = new Date();

    const auditReport = {
      id: reportId,
      auditId: audit.id,
      projectId: project.uid,
      milestoneId: data.milestoneId,
      auditorUid: uid,
      
      // Résultats de l'audit
      decision: data.decision,
      overallScore: data.score,
      criteria: data.criteria,
      
      // Rapport détaillé
      report: {
        ...data.report,
        submittedAt: now,
        auditDuration: data.report.timeSpent,
        effectiveHourlyRate: audit.compensation.amount / data.report.timeSpent,
      },
      
      // Evidence et documentation
      evidence: data.evidence || [],
      
      // Suivi
      followUpRequired: data.followUpRequired,
      followUpDeadline: data.followUpDeadline ? new Date(data.followUpDeadline) : null,
      additionalNotes: data.additionalNotes || '',
      
      // Métadonnées
      createdAt: now,
      submittedAt: now,
      reviewStatus: 'pending_review',
      version: 1,
    };

    await firestoreHelper.addDocument('audit_reports', auditReport);

    logger.info('Audit report created', {
      reportId,
      auditId: audit.id,
      milestoneId: data.milestoneId,
      decision: data.decision,
      score: data.score,
      timeSpent: data.report.timeSpent,
      evidenceCount: data.evidence?.length || 0,
    });

    return reportId;

  } catch (error) {
    logger.error('Failed to create audit report', error, {
      auditId: audit.id,
      milestoneId: data.milestoneId,
    });
    throw new https.HttpsError('internal', 'Unable to create audit report');
  }
}

/**
 * Met à jour le statut de l'audit après soumission du rapport
 */
async function updateAuditAfterReportSubmission(
  audit: AuditDocument,
  reportId: string,
  decision: string,
  score: number,
  followUpRequired: boolean,
  uid: string
): Promise<void> {
  try {
    const now = new Date();
    const completionTime = now.getTime() - new Date(audit.startedAt || audit.acceptedAt).getTime();
    const completionHours = Math.round(completionTime / (60 * 60 * 1000));

    let newAuditStatus = STATUS.AUDIT.COMPLETED;
    if (followUpRequired) {
      newAuditStatus = STATUS.AUDIT.PENDING_FOLLOW_UP;
    }

    await firestoreHelper.runTransaction(async (transaction) => {
      // Mettre à jour l'audit principal
      const auditRef = firestoreHelper.getDocumentRef('audits', audit.id);
      transaction.update(auditRef, {
        status: newAuditStatus,
        completedAt: now,
        reportId,
        finalDecision: decision,
        finalScore: score,
        completionTime: completionHours,
        followUpRequired,
        
        // Mise à jour du workflow
        'workflow.completed': { completedAt: now, by: uid },
        
        updatedAt: now,
        version: audit.version + 1,
      });

      // Mettre à jour la référence auditeur
      const auditorAuditRef = firestoreHelper.getDocumentRef(
        `users/${uid}/audits`,
        audit.id
      );
      
      transaction.update(auditorAuditRef, {
        status: newAuditStatus,
        completedAt: now,
        finalDecision: decision,
        finalScore: score,
        updatedAt: now,
      });
    });

    logger.info('Audit status updated after report submission', {
      auditId: audit.id,
      newStatus: newAuditStatus,
      decision,
      score,
      completionHours,
    });

  } catch (error) {
    logger.error('Failed to update audit after report submission', error, {
      auditId: audit.id,
    });
    throw error;
  }
}

/**
 * Envoie les notifications de soumission de rapport
 */
async function sendReportSubmissionNotifications(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  reportId: string,
  decision: string,
  score: number
): Promise<void> {
  try {
    const promises: Promise<void>[] = [];

    // Notification au créateur
    promises.push(notifyCreatorOfReportSubmission(audit, project, auditor, decision, score));

    // Notification aux admins
    promises.push(notifyAdminsOfReportSubmission(audit, project, auditor, reportId, decision, score));

    // Confirmation à l'auditeur
    promises.push(sendAuditorReportConfirmation(audit, project, auditor, reportId));

    await Promise.all(promises);

  } catch (error) {
    logger.error('Failed to send report submission notifications', error, {
      auditId: audit.id,
      reportId,
    });
  }
}

/**
 * Notifie le créateur de la soumission du rapport
 */
async function notifyCreatorOfReportSubmission(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  decision: string,
  score: number
): Promise<void> {
  try {
    const creator = await firestoreHelper.getDocument<UserDocument>('users', project.creatorUid);

    const emailData = {
      to: creator.email,
      templateId: 'audit_report_submitted_creator',
      dynamicTemplateData: {
        creatorName: `${creator.firstName} ${creator.lastName}`,
        projectTitle: project.title,
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        decision: decision,
        score: score,
        submittedAt: new Date().toLocaleDateString('fr-FR'),
        milestoneTitle: audit.currentMilestone || 'Milestone',
        fundsReleased: decision === 'approved',
        reportUrl: `${process.env.FRONTEND_URL}/creator/audits/${audit.id}/report`,
        projectDashboardUrl: `${process.env.FRONTEND_URL}/creator/projects/${project.uid}`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Creator notified of report submission', {
      auditId: audit.id,
      creatorEmail: creator.email,
      decision,
      score,
    });

  } catch (error) {
    logger.error('Failed to notify creator of report submission', error, {
      auditId: audit.id,
    });
  }
}

/**
 * Notifie les admins de la soumission du rapport
 */
async function notifyAdminsOfReportSubmission(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  reportId: string,
  decision: string,
  score: number
): Promise<void> {
  try {
    const adminUsers = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['permissions', 'array-contains', USER_PERMISSIONS.MODERATE_PROJECTS],
        ['preferences.notifications.auditReports', '==', true]
      ]
    );

    if (adminUsers.length === 0) {
      return;
    }

    const notificationPromises = adminUsers.map(admin => {
      const emailData = {
        to: admin.email,
        templateId: 'audit_report_submitted_admin',
        dynamicTemplateData: {
          adminName: `${admin.firstName} ${admin.lastName}`,
          projectTitle: project.title,
          auditorName: `${auditor.firstName} ${auditor.lastName}`,
          decision,
          score,
          submittedAt: new Date().toLocaleDateString('fr-FR'),
          requiresReview: decision === 'rejected' || score < 70,
          reportReviewUrl: `${process.env.FRONTEND_URL}/admin/audits/${audit.id}/report/${reportId}`,
          adminDashboardUrl: `${process.env.FRONTEND_URL}/admin/audits`,
        },
      };

      return emailService.sendEmail(emailData);
    });

    await Promise.allSettled(notificationPromises);

    logger.info('Admins notified of report submission', {
      auditId: audit.id,
      reportId,
      adminsNotified: adminUsers.length,
    });

  } catch (error) {
    logger.error('Failed to notify admins of report submission', error, {
      auditId: audit.id,
      reportId,
    });
  }
}

/**
 * Envoie la confirmation de soumission à l'auditeur
 */
async function sendAuditorReportConfirmation(
  audit: AuditDocument,
  project: ProjectDocument,
  auditor: UserDocument,
  reportId: string
): Promise<void> {
  try {
    const emailData = {
      to: auditor.email,
      templateId: 'audit_report_confirmation',
      dynamicTemplateData: {
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        projectTitle: project.title,
        reportId: reportId.substring(0, 8).toUpperCase(),
        submittedAt: new Date().toLocaleDateString('fr-FR'),
        compensationAmount: (audit.compensation.finalAmount || audit.compensation.amount) / 100,
        compensationStatus: audit.compensation.status,
        auditHistoryUrl: `${process.env.FRONTEND_URL}/auditor/history`,
        reportUrl: `${process.env.FRONTEND_URL}/auditor/reports/${reportId}`,
      },
    };

    await emailService.sendEmail(emailData);

    logger.info('Auditor report confirmation sent', {
      auditId: audit.id,
      reportId,
      auditorEmail: auditor.email,
    });

  } catch (error) {
    logger.error('Failed to send auditor report confirmation', error, {
      auditId: audit.id,
      reportId,
    });
  }
}

/**
 * Met à jour les statistiques d'audit
 */
async function updateAuditReportStats(
  audit: AuditDocument,
  auditor: UserDocument,
  project: ProjectDocument,
  score: number,
  timeSpent: number
): Promise<void> {
  try {
    const completionTime = Date.now() - new Date(audit.acceptedAt).getTime();
    const completionHours = Math.round(completionTime / (60 * 60 * 1000));

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'audits.totalCompleted': 1,
      'audits.averageScore': score,
      'audits.averageCompletionTime': completionHours,
      [`categories.${project.category}.auditsCompleted`]: 1,
      [`categories.${project.category}.averageScore`]: score,
    });

    // Statistiques de l'auditeur
    await firestoreHelper.incrementDocument('users', auditor.uid, {
      'auditor.stats.totalCompleted': 1,
      'auditor.stats.averageScore': score,
      'auditor.stats.totalHours': timeSpent,
      'auditor.stats.averageCompletionTime': completionHours,
      'auditor.stats.activeAudits': -1, // Décrémenter
    });

    // Mettre à jour les métriques de performance détaillées
    await firestoreHelper.updateDocument('audit_performance', auditor.uid, {
      lastCompletionTime: completionHours,
      lastScore: score,
      completionRate: 'calculated_in_scheduled_function',
      averageScore: 'calculated_in_scheduled_function',
      updatedAt: new Date(),
    });

    logger.info('Audit report statistics updated', {
      auditId: audit.id,
      auditorUid: auditor.uid,
      score,
      timeSpent,
      completionHours,
    });

  } catch (error) {
    logger.error('Failed to update audit report statistics', error, {
      auditId: audit.id,
    });
  }
}

/**
 * Exécute la soumission du rapport d'audit
 */
async function executeSubmitAuditReport(
  data: AuditsAPI.SubmitReportRequest,
  context: CallableContext
): Promise<AuditsAPI.SubmitReportResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions et récupération des données
  const { auditor, audit, project, milestone } = await validateReportSubmissionPermissions(
    uid,
    data.auditId,
    data.milestoneId
  );
  
  // Validation de la qualité du rapport
  validateReportQuality(data, milestone, audit);
  
  // Création du rapport d'audit
  const reportId = await createAuditReport(audit, project, milestone, data, uid);
  
  // Mise à jour du statut du milestone
  const fundsReleased = await updateMilestoneAfterAudit(
    project,
    milestone,
    data.decision,
    data.score,
    reportId,
    uid
  );
  
  // Traitement de la libération automatique des fonds si approuvé
  let releasedAmount = 0;
  if (data.decision === 'approved' && fundsReleased) {
    releasedAmount = await processAutomaticFundRelease(project, milestone, audit);
  }
  
  // Calcul et traitement de la compensation
  const compensation = await processAuditorCompensation(
    audit,
    data.report.timeSpent,
    data.score
  );
  
  // Mise à jour du statut de l'audit
  await updateAuditAfterReportSubmission(
    audit,
    reportId,
    data.decision,
    data.score,
    data.followUpRequired,
    uid
  );
  
  // Processus post-soumission en parallèle
  await Promise.all([
    sendReportSubmissionNotifications(audit, project, auditor, reportId, data.decision, data.score),
    updateAuditReportStats(audit, auditor, project, data.score, data.report.timeSpent),
  ]);

  // Log business
  logger.business('Audit report submitted', 'audits', {
    auditId: data.auditId,
    reportId,
    projectId: audit.projectId,
    milestoneId: data.milestoneId,
    auditorUid: uid,
    decision: data.decision,
    score: data.score,
    timeSpent: data.report.timeSpent,
    compensationAmount: compensation.amount,
    fundsReleased: releasedAmount > 0,
    releasedAmount,
    followUpRequired: data.followUpRequired,
  });

  // Log security pour audit trail
  logger.security('Milestone audit completed', 'medium', {
    auditId: data.auditId,
    reportId,
    projectId: audit.projectId,
    milestoneId: data.milestoneId,
    auditorUid: uid,
    decision: data.decision,
    score: data.score,
    riskAssessment: data.report.riskAssessment,
    evidenceCount: data.evidence?.length || 0,
  });

  // Déterminer le prochain milestone s'il y en a un
  const nextMilestone = project.milestones.find(m => 
    m.status === STATUS.MILESTONE.COMPLETED || m.status === STATUS.MILESTONE.SUBMITTED
  );

  return {
    reportId,
    submittedAt: new Date().toISOString(),
    decision: data.decision,
    score: data.score,
    fundsReleased: releasedAmount,
    nextMilestone: nextMilestone ? {
      id: nextMilestone.id,
      title: nextMilestone.title,
      dueDate: nextMilestone.targetDate || '',
      status: nextMilestone.status,
    } : undefined,
    compensation: {
      amount: compensation.amount,
      status: compensation.processed ? 'calculated' : 'pending',
      estimatedPayment: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    followUp: data.followUpRequired ? {
      required: true,
      deadline: data.followUpDeadline || '',
      type: 'milestone_revision',
    } : undefined,
    auditSummary: {
      timeSpent: data.report.timeSpent,
      criteriaEvaluated: data.criteria.length,
      evidenceProvided: data.evidence?.length || 0,
      riskLevel: data.report.riskAssessment,
      confidenceLevel: data.report.confidenceLevel,
    },
  };
}

/**
 * Firebase Function principale
 */
export const submitAuditReport = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuditsAPI.SubmitReportResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<AuditsAPI.SubmitReportRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Submitting audit report', {
      functionName: 'submitAuditReport',
      uid: context.auth.uid,
      auditId: validatedData.auditId,
      milestoneId: validatedData.milestoneId,
      decision: validatedData.decision,
      score: validatedData.score,
      timeSpent: validatedData.report.timeSpent,
      criteriaCount: validatedData.criteria.length,
      evidenceCount: validatedData.evidence?.length || 0,
    });

    // Exécution
    const result = await executeSubmitAuditReport(validatedData, context);

    // Logging de succès
    logger.info('Audit report submitted successfully', {
      functionName: 'submitAuditReport',
      uid: context.auth.uid,
      auditId: validatedData.auditId,
      reportId: result.reportId,
      decision: result.decision,
      score: result.score,
      fundsReleased: result.fundsReleased,
      compensationAmount: result.compensation.amount,
      hasFollowUp: !!result.followUp,
      success: true,
    });

    return result;
  })
);