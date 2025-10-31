/**
 * Audit Complete Trigger Firebase Function
 * Social Finance Impact Platform
 */

import { firestore } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { stripeService } from '../integrations/stripe/stripeService';
import { UserDocument, ProjectDocument, AuditDocument, NotificationDocument } from '../types/firestore';
import { STATUS, AUDIT_CONFIG, ESCROW_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les résultats d'audit traités
 */
interface ProcessedAuditResults {
  auditId: string;
  projectId: string;
  auditorUid: string;
  creatorUid: string;
  decision: 'approved' | 'rejected' | 'conditional';
  score: number;
  findings: string[];
  recommendations: string[];
  escrowReleaseAmount: number;
  auditorCompensation: number;
  nextActions: string[];
}

/**
 * Valide et traite les résultats d'audit
 */
async function processAuditResults(auditData: AuditDocument): Promise<ProcessedAuditResults> {
  try {
    // Récupérer les données du projet
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', auditData.projectId);

    // Valider que l'audit est bien terminé
    if (auditData.status !== STATUS.AUDIT.COMPLETED) {
      throw new Error(`Audit ${auditData.id} is not in completed status`);
    }

    // Analyser les résultats
    const decision = determineAuditDecision(auditData);
    const escrowReleaseAmount = calculateEscrowRelease(project, decision, auditData.score);
    const auditorCompensation = calculateAuditorCompensation(auditData, decision);
    const nextActions = determineNextActions(decision, auditData.score);

    const processedResults: ProcessedAuditResults = {
      auditId: auditData.id,
      projectId: auditData.projectId,
      auditorUid: auditData.auditorUid,
      creatorUid: project.creatorUid,
      decision,
      score: auditData.score,
      findings: auditData.findings || [],
      recommendations: auditData.recommendations || [],
      escrowReleaseAmount,
      auditorCompensation,
      nextActions
    };

    logger.info('Audit results processed', {
      auditId: auditData.id,
      projectId: auditData.projectId,
      decision,
      score: auditData.score,
      escrowReleaseAmount,
      auditorCompensation
    });

    return processedResults;

  } catch (error) {
    logger.error('Failed to process audit results', error, {
      auditId: auditData.id,
      projectId: auditData.projectId,
      auditorUid: auditData.auditorUid
    });
    throw error;
  }
}

/**
 * Détermine la décision d'audit basée sur le score et les critères
 */
function determineAuditDecision(audit: AuditDocument): 'approved' | 'rejected' | 'conditional' {
  const score = audit.score;
  const criticalIssues = audit.findings?.filter(finding => 
    finding.includes('critical') || finding.includes('blocking')
  ).length || 0;

  // Rejet automatique
  if (score < AUDIT_CONFIG.MIN_APPROVAL_SCORE || criticalIssues > 0) {
    return 'rejected';
  }

  // Approbation conditionnelle
  if (score < AUDIT_CONFIG.FULL_APPROVAL_SCORE) {
    return 'conditional';
  }

  // Approbation complète
  return 'approved';
}

/**
 * Calcule le montant d'escrow à libérer
 */
function calculateEscrowRelease(
  project: ProjectDocument, 
  decision: string, 
  score: number
): number {
  const totalEscrow = project.escrow?.totalHeld || 0;

  switch (decision) {
    case 'approved':
      return totalEscrow; // Libération complète
    case 'conditional':
      // Libération partielle basée sur le score
      const releasePercentage = Math.max(0.5, score / 100);
      return Math.round(totalEscrow * releasePercentage);
    case 'rejected':
      return 0; // Aucune libération
    default:
      return 0;
  }
}

/**
 * Calcule la compensation de l'auditeur
 */
function calculateAuditorCompensation(
  audit: AuditDocument,
  decision: string
): number {
  const baseCompensation = audit.estimatedCompensation || AUDIT_CONFIG.DEFAULT_COMPENSATION;
  
  // Bonus/malus selon la décision et qualité
  let multiplier = 1.0;

  switch (decision) {
    case 'approved':
      multiplier = 1.1; // Bonus 10% pour audit approuvé
      break;
    case 'conditional':
      multiplier = 1.0; // Compensation normale
      break;
    case 'rejected':
      multiplier = 0.9; // Réduction 10% pour rejet (travail supplémentaire requis)
      break;
  }

  // Bonus qualité basé sur le score
  if (audit.score >= 95) {
    multiplier += 0.1; // Bonus 10% pour excellence
  } else if (audit.score >= 90) {
    multiplier += 0.05; // Bonus 5% pour haute qualité
  }

  return Math.round(baseCompensation * multiplier);
}

/**
 * Détermine les actions suivantes selon les résultats
 */
function determineNextActions(decision: string, score: number): string[] {
  const actions: string[] = [];

  switch (decision) {
    case 'approved':
      actions.push('release_escrow_funds');
      actions.push('mark_project_validated');
      actions.push('process_auditor_payment');
      actions.push('notify_stakeholders');
      break;

    case 'conditional':
      actions.push('partial_escrow_release');
      actions.push('create_improvement_plan');
      actions.push('schedule_follow_up_audit');
      actions.push('process_auditor_payment');
      actions.push('notify_conditional_approval');
      break;

    case 'rejected':
      actions.push('initiate_refund_process');
      actions.push('suspend_project_temporarily');
      actions.push('create_remediation_plan');
      actions.push('process_auditor_payment');
      actions.push('notify_rejection_reason');
      break;
  }

  return actions;
}

/**
 * Met à jour le statut du projet selon les résultats d'audit
 */
async function updateProjectStatus(results: ProcessedAuditResults): Promise<void> {
  try {
    const statusUpdate: Partial<ProjectDocument> = {
      auditStatus: 'completed',
      auditScore: results.score,
      auditDecision: results.decision,
      auditCompletedAt: new Date(),
      lastAuditId: results.auditId,
      updatedAt: new Date()
    };

    // Mettre à jour le statut selon la décision
    switch (results.decision) {
      case 'approved':
        statusUpdate.status = STATUS.PROJECT.VALIDATED;
        statusUpdate.validatedAt = new Date();
        break;
        
      case 'conditional':
        statusUpdate.status = STATUS.PROJECT.CONDITIONAL_APPROVAL;
        statusUpdate.conditionalApprovalAt = new Date();
        break;
        
      case 'rejected':
        statusUpdate.status = STATUS.PROJECT.AUDIT_FAILED;
        statusUpdate.auditFailedAt = new Date();
        statusUpdate.acceptingContributions = false;
        break;
    }

    await firestoreHelper.updateDocument('projects', results.projectId, statusUpdate);

    logger.info('Project status updated after audit', {
      projectId: results.projectId,
      auditId: results.auditId,
      decision: results.decision,
      newStatus: statusUpdate.status,
      auditScore: results.score
    });

  } catch (error) {
    logger.error('Failed to update project status', error, {
      projectId: results.projectId,
      auditId: results.auditId,
      decision: results.decision
    });
    throw error;
  }
}

/**
 * Traite la libération des fonds d'escrow
 */
async function processEscrowRelease(results: ProcessedAuditResults): Promise<void> {
  try {
    if (results.escrowReleaseAmount <= 0) {
      logger.info('No escrow release required', {
        auditId: results.auditId,
        projectId: results.projectId,
        decision: results.decision
      });
      return;
    }

    // Créer demande de libération d'escrow
    const releaseRequestId = helpers.string.generateId('escrow_rel');
    
    await firestoreHelper.setDocument('escrow_releases', releaseRequestId, {
      id: releaseRequestId,
      projectId: results.projectId,
      auditId: results.auditId,
      amount: results.escrowReleaseAmount,
      currency: 'EUR',
      recipientUid: results.creatorUid,
      releaseType: results.decision === 'approved' ? 'full_release' : 'partial_release',
      status: 'pending_processing',
      auditDecision: results.decision,
      auditScore: results.score,
      approvedBy: results.auditorUid,
      processingPriority: results.decision === 'approved' ? 'high' : 'medium',
      estimatedProcessingTime: '2-5 business days',
      createdAt: new Date(),
      scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h delay for security
    });

    // Mettre à jour les enregistrements d'escrow
    const escrowRecords = await firestoreHelper.queryDocuments<any>(
      'escrow_records',
      [
        ['projectId', '==', results.projectId],
        ['status', '==', 'held']
      ]
    );

    const releasePromises = escrowRecords.map(async (record) => {
      const releaseAmount = Math.round(
        (record.amount / (record.totalProjectEscrow || record.amount)) * results.escrowReleaseAmount
      );

      return firestoreHelper.updateDocument('escrow_records', record.id, {
        status: results.decision === 'approved' ? 'released' : 'partially_released',
        releaseAmount,
        releaseRequestId,
        releasedAt: new Date(),
        releaseReason: `audit_${results.decision}`,
        auditId: results.auditId
      });
    });

    await Promise.all(releasePromises);

    // Mettre à jour le projet
    await firestoreHelper.updateDocument('projects', results.projectId, {
      'escrow.totalReleased': firestoreHelper.increment(results.escrowReleaseAmount),
      'escrow.lastReleaseAt': new Date(),
      'escrow.releaseRequestId': releaseRequestId
    });

    logger.info('Escrow release processed', {
      releaseRequestId,
      projectId: results.projectId,
      auditId: results.auditId,
      releaseAmount: results.escrowReleaseAmount,
      escrowRecordsUpdated: escrowRecords.length
    });

  } catch (error) {
    logger.error('Failed to process escrow release', error, {
      projectId: results.projectId,
      auditId: results.auditId,
      releaseAmount: results.escrowReleaseAmount
    });
    throw error;
  }
}

/**
 * Traite la compensation de l'auditeur
 */
async function processAuditorCompensation(results: ProcessedAuditResults): Promise<void> {
  try {
    // Créer enregistrement de compensation
    const compensationId = helpers.string.generateId('comp');
    
    await firestoreHelper.setDocument('auditor_compensations', compensationId, {
      id: compensationId,
      auditId: results.auditId,
      auditorUid: results.auditorUid,
      projectId: results.projectId,
      amount: results.auditorCompensation,
      currency: 'EUR',
      status: 'pending_payment',
      auditDecision: results.decision,
      auditScore: results.score,
      compensationType: 'audit_completion',
      paymentMethod: 'stripe_transfer', // ou 'manual' selon config
      scheduledPaymentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 jours
      createdAt: new Date()
    });

    // Notifier l'auditeur
    const notificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', notificationId, {
      id: notificationId,
      recipientUid: results.auditorUid,
      senderUid: 'system',
      type: 'payment_processed',
      title: 'Compensation d\'audit confirmée',
      message: `Votre compensation de €${(results.auditorCompensation / 100).toFixed(2)} pour l'audit du projet sera versée sous 3 jours ouvrés.`,
      data: {
        auditId: results.auditId,
        projectId: results.projectId,
        compensationId,
        amount: results.auditorCompensation,
        auditScore: results.score,
        auditDecision: results.decision,
        paymentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      },
      priority: 'medium',
      actionUrl: `${process.env.FRONTEND_URL}/auditor/compensations`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as NotificationDocument);

    await firestoreHelper.updateDocument('users', results.auditorUid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1),
      'stats.totalEarned': firestoreHelper.increment(results.auditorCompensation),
      'stats.auditsCompleted': firestoreHelper.increment(1),
      'stats.lastCompensation': new Date()
    });

    logger.info('Auditor compensation processed', {
      compensationId,
      auditId: results.auditId,
      auditorUid: results.auditorUid,
      amount: results.auditorCompensation,
      paymentScheduled: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    });

  } catch (error) {
    logger.error('Failed to process auditor compensation', error, {
      auditId: results.auditId,
      auditorUid: results.auditorUid,
      compensationAmount: results.auditorCompensation
    });
  }
}

/**
 * Envoie les notifications aux parties prenantes
 */
async function notifyStakeholders(results: ProcessedAuditResults): Promise<void> {
  try {
    const [project, auditor] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', results.projectId),
      firestoreHelper.getDocument<UserDocument>('users', results.auditorUid)
    ]);

    // Notification au créateur du projet
    const creatorNotificationId = helpers.string.generateId('notif');
    await sendCreatorNotification(results, project, auditor, creatorNotificationId);

    // Notifications aux contributeurs
    if (project.contributors && project.contributors.length > 0) {
      await sendContributorNotifications(results, project, auditor);
    }

    // Notification aux modérateurs si rejeté
    if (results.decision === 'rejected') {
      await notifyModeratorsOfRejection(results, project);
    }

    logger.info('Stakeholder notifications sent', {
      auditId: results.auditId,
      projectId: results.projectId,
      decision: results.decision,
      contributorsNotified: project.contributors?.length || 0
    });

  } catch (error) {
    logger.error('Failed to notify stakeholders', error, {
      auditId: results.auditId,
      projectId: results.projectId,
      decision: results.decision
    });
  }
}

/**
 * Envoie notification au créateur
 */
async function sendCreatorNotification(
  results: ProcessedAuditResults,
  project: ProjectDocument,
  auditor: UserDocument,
  notificationId: string
): Promise<void> {
  let title = '';
  let message = '';
  let priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium';

  switch (results.decision) {
    case 'approved':
      title = 'Audit approuvé ! 🎉';
      message = `Félicitations ! Votre projet "${project.title}" a passé l'audit avec succès (score: ${results.score}/100). Les fonds vont être libérés.`;
      priority = 'high';
      break;
      
    case 'conditional':
      title = 'Audit partiellement approuvé';
      message = `Votre projet "${project.title}" a obtenu une approbation conditionnelle (score: ${results.score}/100). Consultez les recommandations.`;
      priority = 'high';
      break;
      
    case 'rejected':
      title = 'Audit non approuvé';
      message = `Votre projet "${project.title}" nécessite des améliorations (score: ${results.score}/100). Consultez le rapport détaillé.`;
      priority = 'urgent';
      break;
  }

  await firestoreHelper.setDocument('notifications', notificationId, {
    id: notificationId,
    recipientUid: results.creatorUid,
    senderUid: results.auditorUid,
    type: 'audit_completed',
    title,
    message,
    data: {
      auditId: results.auditId,
      projectId: results.projectId,
      projectTitle: project.title,
      auditorName: `${auditor.firstName} ${auditor.lastName}`,
      auditScore: results.score,
      auditDecision: results.decision,
      escrowReleaseAmount: results.escrowReleaseAmount,
      findingsCount: results.findings.length,
      recommendationsCount: results.recommendations.length,
      nextActions: results.nextActions
    },
    priority,
    actionUrl: `${process.env.FRONTEND_URL}/audits/${results.auditId}/report`,
    read: false,
    readAt: null,
    delivered: true,
    deliveredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 1
  } as NotificationDocument);

  await firestoreHelper.updateDocument('users', results.creatorUid, {
    'notificationCounters.unread': firestoreHelper.increment(1),
    'notificationCounters.total': firestoreHelper.increment(1)
  });
}

/**
 * Envoie notifications aux contributeurs
 */
async function sendContributorNotifications(
  results: ProcessedAuditResults,
  project: ProjectDocument,
  auditor: UserDocument
): Promise<void> {
  const notificationPromises = project.contributors!.map(async (contributorUid) => {
    try {
      let title = '';
      let message = '';

      switch (results.decision) {
        case 'approved':
          title = 'Projet validé par audit';
          message = `Le projet "${project.title}" que vous soutenez a passé son audit avec succès !`;
          break;
          
        case 'conditional':
          title = 'Audit du projet en cours';
          message = `Le projet "${project.title}" a reçu une approbation conditionnelle suite à son audit.`;
          break;
          
        case 'rejected':
          title = 'Audit du projet - Actions requises';
          message = `Le projet "${project.title}" nécessite des améliorations suite à son audit. Vos fonds sont sécurisés.`;
          break;
      }

      const contributorNotificationId = helpers.string.generateId('notif');
      await firestoreHelper.setDocument('notifications', contributorNotificationId, {
        id: contributorNotificationId,
        recipientUid: contributorUid,
        senderUid: 'system',
        type: 'audit_completed',
        title,
        message,
        data: {
          auditId: results.auditId,
          projectId: results.projectId,
          projectTitle: project.title,
          auditScore: results.score,
          auditDecision: results.decision,
          fundsSecure: true,
          nextSteps: results.decision === 'rejected' ? 'improvement_required' : 'funds_release_processing'
        },
        priority: results.decision === 'rejected' ? 'high' : 'medium',
        actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        groupKey: `audit_results_${results.projectId}`,
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      } as NotificationDocument);

      await firestoreHelper.updateDocument('users', contributorUid, {
        'notificationCounters.unread': firestoreHelper.increment(1),
        'notificationCounters.total': firestoreHelper.increment(1)
      });

      return contributorNotificationId;

    } catch (error) {
      logger.error('Failed to send notification to contributor', error, {
        contributorUid,
        auditId: results.auditId,
        projectId: results.projectId
      });
      return null;
    }
  });

  await Promise.allSettled(notificationPromises);
}

/**
 * Notifie les modérateurs en cas de rejet
 */
async function notifyModeratorsOfRejection(
  results: ProcessedAuditResults,
  project: ProjectDocument
): Promise<void> {
  try {
    // Récupérer les modérateurs actifs
    const moderators = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['permissions', 'array-contains', 'moderate_projects'],
        ['status', '==', 'active']
      ]
    );

    const moderatorNotificationPromises = moderators.map(async (moderator) => {
      const notificationId = helpers.string.generateId('notif');
      
      return firestoreHelper.setDocument('notifications', notificationId, {
        id: notificationId,
        recipientUid: moderator.uid,
        senderUid: 'system',
        type: 'audit_completed',
        title: 'Projet rejeté par audit - Action requise',
        message: `Le projet "${project.title}" a été rejeté suite à l'audit. Intervention de modération requise.`,
        data: {
          auditId: results.auditId,
          projectId: results.projectId,
          projectTitle: project.title,
          creatorUid: results.creatorUid,
          auditScore: results.score,
          auditDecision: results.decision,
          findingsCount: results.findings.length,
          moderationRequired: true,
          urgency: 'high'
        },
        priority: 'urgent',
        actionUrl: `${process.env.FRONTEND_URL}/admin/projects/${results.projectId}/moderate`,
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      });
    });

    await Promise.allSettled(moderatorNotificationPromises);

    logger.info('Moderators notified of project rejection', {
      auditId: results.auditId,
      projectId: results.projectId,
      moderatorsNotified: moderators.length
    });

  } catch (error) {
    logger.error('Failed to notify moderators of rejection', error, {
      auditId: results.auditId,
      projectId: results.projectId
    });
  }
}

/**
 * Envoie les emails de résultats d'audit
 */
async function sendAuditResultEmails(results: ProcessedAuditResults): Promise<void> {
  try {
    const [project, creator, auditor] = await Promise.all([
      firestoreHelper.getDocument<ProjectDocument>('projects', results.projectId),
      firestoreHelper.getDocument<UserDocument>('users', results.creatorUid),
      firestoreHelper.getDocument<UserDocument>('users', results.auditorUid)
    ]);

    // Email au créateur
    const creatorEmailTemplate = {
      approved: 'audit_approved_creator',
      conditional: 'audit_conditional_creator',
      rejected: 'audit_rejected_creator'
    };

    const creatorEmailPromise = emailService.sendEmail({
      to: creator.email,
      templateId: creatorEmailTemplate[results.decision],
      dynamicTemplateData: {
        creatorName: `${creator.firstName} ${creator.lastName}`,
        projectTitle: project.title,
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        auditScore: results.score,
        auditDecision: results.decision,
        escrowReleaseAmount: results.escrowReleaseAmount > 0 ? `€${(results.escrowReleaseAmount / 100).toFixed(2)}` : '€0.00',
        reportUrl: `${process.env.FRONTEND_URL}/audits/${results.auditId}/report`,
        projectUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}`,
        dashboardUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/dashboard`,
        supportUrl: `${process.env.FRONTEND_URL}/support`,
        findingsCount: results.findings.length,
        recommendationsCount: results.recommendations.length,
        nextActions: results.nextActions,
        date: new Date().toLocaleDateString('fr-FR')
      }
    });

    // Email à l'auditeur
    const auditorEmailPromise = emailService.sendEmail({
      to: auditor.email,
      templateId: 'audit_completion_auditor',
      dynamicTemplateData: {
        auditorName: `${auditor.firstName} ${auditor.lastName}`,
        projectTitle: project.title,
        creatorName: `${creator.firstName} ${creator.lastName}`,
        auditScore: results.score,
        auditDecision: results.decision,
        compensationAmount: `€${(results.auditorCompensation / 100).toFixed(2)}`,
        reportUrl: `${process.env.FRONTEND_URL}/audits/${results.auditId}/report`,
        dashboardUrl: `${process.env.FRONTEND_URL}/auditor/dashboard`,
        paymentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR'),
        date: new Date().toLocaleDateString('fr-FR')
      }
    });

    // Envoyer emails en parallèle
    const emailResults = await Promise.allSettled([
      creatorEmailPromise,
      auditorEmailPromise
    ]);

    const successfulEmails = emailResults.filter(result => result.status === 'fulfilled').length;

    logger.info('Audit result emails sent', {
      auditId: results.auditId,
      successfulEmails,
      creatorEmail: creator.email,
      auditorEmail: auditor.email
    });

  } catch (error) {
    logger.error('Failed to send audit result emails', error, {
      auditId: results.auditId,
      projectId: results.projectId
    });
  }
}

/**
 * Met à jour les métriques d'audit
 */
async function updateAuditMetrics(results: ProcessedAuditResults): Promise<void> {
  try {
    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', results.projectId);

    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'audits.totalCompleted': 1,
      [`audits.byDecision.${results.decision}`]: 1,
      [`audits.byCategory.${project.category}`]: 1,
      'audits.totalCompensation': results.auditorCompensation,
      'audits.averageScore': results.score,
      'escrow.totalReleased': results.escrowReleaseAmount
    });

    // Statistiques mensuelles
    const monthKey = new Date().toISOString().slice(0, 7);
    await firestoreHelper.incrementDocument('platform_stats', `monthly_${monthKey}`, {
      'audits.completed': 1,
      [`audits.decisions.${results.decision}`]: 1,
      'audits.compensation': results.auditorCompensation,
      'escrow.released': results.escrowReleaseAmount
    });

    // Métriques par score
    const scoreRange = getScoreRange(results.score);
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      [`audits.scoreDistribution.${scoreRange}`]: 1
    });

    logger.info('Audit metrics updated', {
      auditId: results.auditId,
      decision: results.decision,
      score: results.score,
      scoreRange,
      compensationAmount: results.auditorCompensation,
      releaseAmount: results.escrowReleaseAmount
    });

  } catch (error) {
    logger.error('Failed to update audit metrics', error, {
      auditId: results.auditId,
      projectId: results.projectId
    });
  }
}

/**
 * Détermine la tranche de score pour les métriques
 */
function getScoreRange(score: number): string {
  if (score >= 90) return '90-100';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  if (score >= 60) return '60-69';
  if (score >= 50) return '50-59';
  return '0-49';
}

/**
 * Crée les plans d'amélioration pour approbations conditionnelles
 */
async function createImprovementPlan(results: ProcessedAuditResults): Promise<void> {
  try {
    if (results.decision !== 'conditional') {
      return;
    }

    const improvementPlanId = helpers.string.generateId('improvement');
    
    // Analyser les recommandations pour créer un plan structuré
    const improvementTasks = results.recommendations.map((recommendation, index) => ({
      id: helpers.string.generateId('task'),
      title: `Amélioration ${index + 1}`,
      description: recommendation,
      priority: index < 3 ? 'high' : 'medium', // Les 3 premières sont prioritaires
      status: 'pending',
      estimatedDuration: '7-14 days',
      assignedTo: results.creatorUid,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 2 semaines
      createdAt: new Date()
    }));

    await firestoreHelper.setDocument('improvement_plans', improvementPlanId, {
      id: improvementPlanId,
      projectId: results.projectId,
      auditId: results.auditId,
      creatorUid: results.creatorUid,
      status: 'active',
      tasks: improvementTasks,
      totalTasks: improvementTasks.length,
      completedTasks: 0,
      targetCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
      followUpAuditScheduled: false,
      createdAt: new Date(),
      createdBy: results.auditorUid
    });

    // Notifier le créateur du plan d'amélioration
    const notificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', notificationId, {
      id: notificationId,
      recipientUid: results.creatorUid,
      senderUid: 'system',
      type: 'improvement_plan_created',
      title: 'Plan d\'amélioration créé',
      message: `Un plan d'amélioration a été créé pour votre projet "${project.title}" suite à l'audit.`,
      data: {
        improvementPlanId,
        auditId: results.auditId,
        projectId: results.projectId,
        tasksCount: improvementTasks.length,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/projects/${project.slug}/improvements`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    });

    await firestoreHelper.updateDocument('users', results.creatorUid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    logger.info('Improvement plan created', {
      improvementPlanId,
      auditId: results.auditId,
      projectId: results.projectId,
      tasksCount: improvementTasks.length
    });

  } catch (error) {
    logger.error('Failed to create improvement plan', error, {
      auditId: results.auditId,
      projectId: results.projectId
    });
  }
}

/**
 * Initie le processus de remboursement en cas de rejet
 */
async function initiateRefundProcess(results: ProcessedAuditResults): Promise<void> {
  try {
    if (results.decision !== 'rejected') {
      return;
    }

    const project = await firestoreHelper.getDocument<ProjectDocument>('projects', results.projectId);

    // Créer demande de remboursement globale
    const refundRequestId = helpers.string.generateId('refund_req');
    
    await firestoreHelper.setDocument('refund_requests', refundRequestId, {
      id: refundRequestId,
      projectId: results.projectId,
      auditId: results.auditId,
      reason: 'audit_rejection',
      totalAmount: project.currentFunding,
      currency: 'EUR',
      contributorCount: project.contributors?.length || 0,
      status: 'pending_review',
      priority: 'high',
      auditScore: results.score,
      auditFindings: results.findings,
      requestedBy: 'system',
      approvalRequired: true,
      estimatedProcessingTime: '5-10 business days',
      createdAt: new Date(),
      reviewDeadline: new Date(Date.now() + 48 * 60 * 60 * 1000) // 48h pour révision
    });

    // Marquer toutes les contributions comme remboursables
    if (project.contributors) {
      const contributionUpdatePromises = project.contributors.map(contributorUid =>
        firestoreHelper.updateDocument(`projects/${results.projectId}/contributions`, contributorUid, {
          refundStatus: 'pending_approval',
          refundRequestId,
          refundReason: 'audit_rejection',
          refundRequestedAt: new Date()
        })
      );

      await Promise.allSettled(contributionUpdatePromises);
    }

    logger.info('Refund process initiated for rejected project', {
      refundRequestId,
      auditId: results.auditId,
      projectId: results.projectId,
      totalAmount: project.currentFunding,
      contributorCount: project.contributors?.length || 0
    });

  } catch (error) {
    logger.error('Failed to initiate refund process', error, {
      auditId: results.auditId,
      projectId: results.projectId
    });
  }
}

/**
 * Met à jour le profil et les statistiques de l'auditeur
 */
async function updateAuditorProfile(results: ProcessedAuditResults): Promise<void> {
  try {
    // Mettre à jour les statistiques de l'auditeur
    await firestoreHelper.incrementDocument('users', results.auditorUid, {
      'stats.auditsCompleted': 1,
      [`stats.auditDecisions.${results.decision}`]: 1,
      'stats.averageAuditScore': results.score,
      'stats.totalCompensation': results.auditorCompensation,
      'stats.lastAuditCompletion': new Date()
    });

    // Mettre à jour la réputation de l'auditeur
    const reputationUpdate = calculateReputationUpdate(results);
    if (reputationUpdate !== 0) {
      await firestoreHelper.incrementDocument('users', results.auditorUid, {
        'reputation.score': reputationUpdate,
        'reputation.lastUpdate': new Date()
      });
    }

    logger.info('Auditor profile updated', {
      auditorUid: results.auditorUid,
      auditId: results.auditId,
      compensationAmount: results.auditorCompensation,
      reputationChange: reputationUpdate
    });

  } catch (error) {
    logger.error('Failed to update auditor profile', error, {
      auditorUid: results.auditorUid,
      auditId: results.auditId
    });
  }
}

/**
 * Calcule la mise à jour de réputation pour l'auditeur
 */
function calculateReputationUpdate(results: ProcessedAuditResults): number {
  let reputationChange = 0;

  // Base selon la décision
  switch (results.decision) {
    case 'approved':
      reputationChange += 5; // +5 points pour approbation
      break;
    case 'conditional':
      reputationChange += 3; // +3 points pour approbation conditionnelle
      break;
    case 'rejected':
      reputationChange += 1; // +1 point pour audit complet (même rejet)
      break;
  }

  // Bonus qualité basé sur le score
  if (results.score >= 95) {
    reputationChange += 3; // Bonus excellence
  } else if (results.score >= 90) {
    reputationChange += 2; // Bonus haute qualité
  } else if (results.score >= 80) {
    reputationChange += 1; // Bonus qualité
  }

  // Bonus pour recommendations utiles
  if (results.recommendations.length >= 5) {
    reputationChange += 2; // Bonus pour audit détaillé
  }

  return reputationChange;
}

/**
 * Trigger principal - Completion d'audit
 */
export const onAuditComplete = firestore
  .document('audits/{auditId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() as AuditDocument;
    const afterData = change.after.data() as AuditDocument;
    const auditId = context.params.auditId;

    // Vérifier que c'est bien un passage à 'completed'
    if (beforeData.status === STATUS.AUDIT.COMPLETED || afterData.status !== STATUS.AUDIT.COMPLETED) {
      return; // Pas une completion ou déjà traité
    }

    try {
      logger.info('Audit completion trigger started', {
        auditId,
        projectId: afterData.projectId,
        auditorUid: afterData.auditorUid,
        score: afterData.score
      });

      // Traiter les résultats d'audit
      const results = await processAuditResults(afterData);

      // Exécution séquentielle des tâches critiques
      await updateProjectStatus(results);
      await processEscrowRelease(results);

      // Exécution en parallèle des tâches secondaires
      await Promise.allSettled([
        processAuditorCompensation(results),
        notifyStakeholders(results),
        sendAuditResultEmails(results),
        updateAuditMetrics(results),
        updateAuditorProfile(results)
      ]);

      // Actions spéciales selon la décision
      if (results.decision === 'conditional') {
        await createImprovementPlan(results);
      } else if (results.decision === 'rejected') {
        await initiateRefundProcess(results);
      }

      // Log business
      logger.business('Audit completed and processed', 'audits', {
        auditId,
        projectId: results.projectId,
        auditorUid: results.auditorUid,
        creatorUid: results.creatorUid,
        decision: results.decision,
        score: results.score,
        escrowReleaseAmount: results.escrowReleaseAmount,
        auditorCompensation: results.auditorCompensation,
        findingsCount: results.findings.length,
        recommendationsCount: results.recommendations.length,
        timestamp: new Date().toISOString()
      });

      // Log financial pour les mouvements de fonds
      if (results.escrowReleaseAmount > 0 || results.auditorCompensation > 0) {
        logger.financial('Funds movement triggered by audit completion', {
          auditId,
          projectId: results.projectId,
          escrowReleased: results.escrowReleaseAmount,
          auditorCompensation: results.auditorCompensation,
          decision: results.decision,
          currency: 'EUR',
          timestamp: new Date().toISOString()
        });
      }

      // Log security pour audits rejetés
      if (results.decision === 'rejected') {
        logger.security('Project audit rejected - funds secured', 'medium', {
          auditId,
          projectId: results.projectId,
          creatorUid: results.creatorUid,
          auditorUid: results.auditorUid,
          score: results.score,
          findingsCount: results.findings.length,
          securedAmount: project.currentFunding,
          refundProcessInitiated: true
        });
      }

      logger.info('Audit completion trigger completed successfully', {
        auditId,
        projectId: results.projectId,
        decision: results.decision,
        processingTime: Date.now() - new Date(afterData.updatedAt).getTime()
      });

    } catch (error) {
      logger.error('Audit completion trigger failed', error, {
        auditId,
        projectId: afterData.projectId,
        auditorUid: afterData.auditorUid,
        score: afterData.score
      });

      // Marquer l'audit comme ayant échoué le post-traitement
      try {
        await firestoreHelper.updateDocument('audits', auditId, {
          processingStatus: 'failed',
          processingError: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date(),
            retryCount: 0
          },
          updatedAt: new Date()
        });
      } catch (updateError) {
        logger.error('Failed to mark audit processing as failed', updateError, { auditId });
      }

      throw error;
    }
  });