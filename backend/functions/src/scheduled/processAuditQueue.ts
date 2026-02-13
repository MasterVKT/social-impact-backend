/**
 * Process Audit Queue Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument } from '../types/firestore';
import { STATUS, AUDIT_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour une demande d'audit en attente
 */
interface PendingAuditRequest {
  id: string;
  projectId: string;
  projectTitle: string;
  category: string;
  complexity: 'simple' | 'standard' | 'complex';
  estimatedAmount: number;
  requiredQualifications: string[];
  preferredSpecializations?: string[];
  deadline: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending_assignment' | 'pending_acceptance' | 'assigned' | 'in_progress';
  createdAt: Date;
  assignedAuditorUid?: string;
  assignmentDeadline?: Date;
  metadata: any;
}

/**
 * Interface pour les résultats de traitement de la queue
 */
interface QueueProcessingResults {
  totalPendingAudits: number;
  auditsAssigned: number;
  auditsEscalated: number;
  auditorsNotified: number;
  remindersSet: number;
  errors: number;
  processingTime: number;
  batchId: string;
  assignmentSuccess: {
    simple: number;
    standard: number;
    complex: number;
  };
  escalationReasons: Record<string, number>;
}

/**
 * Récupère les demandes d'audit en attente
 */
async function getPendingAuditRequests(): Promise<PendingAuditRequest[]> {
  try {
    const now = new Date();
    
    // Récupérer les demandes en attente d'assignation
    const pendingRequests = await firestoreHelper.queryDocuments<PendingAuditRequest>(
      'audit_requests',
      [
        ['status', 'in', ['pending_assignment', 'pending_acceptance']],
        ['deadline', '>', new Date(now.getTime() + 24 * 60 * 60 * 1000)] // Au moins 24h avant deadline
      ],
      { 
        limit: AUDIT_CONFIG.MAX_BATCH_SIZE,
        orderBy: [
          { field: 'priority', direction: 'desc' },
          { field: 'createdAt', direction: 'asc' }
        ]
      }
    );

    logger.info('Pending audit requests retrieved', {
      totalFound: pendingRequests.data.length,
      byStatus: pendingRequests.data.reduce((counts, req) => {
        counts[req.status] = (counts[req.status] || 0) + 1;
        return counts;
      }, {} as Record<string, number>)
    });

    return pendingRequests.data;

  } catch (error) {
    logger.error('Failed to get pending audit requests', error);
    throw error;
  }
}

/**
 * Trouve des auditeurs qualifiés pour une demande d'audit
 */
async function findQualifiedAuditors(auditRequest: PendingAuditRequest): Promise<UserDocument[]> {
  try {
    // Critères de base pour les auditeurs
    const baseQuery = [
      ['userType', '==', 'auditor'],
      ['status', '==', 'active'],
      ['kycStatus', '==', 'approved'],
      ['auditingEnabled', '==', true]
    ];

    // Récupérer tous les auditeurs actifs
    const allAuditors = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      baseQuery,
      { limit: 100 }
    );

    if (allAuditors.data.length === 0) {
      return [];
    }

    // Filtrer par qualifications requises
    const qualifiedAuditors = allAuditors.data.filter(auditor => {
      const auditorQualifications = auditor.qualifications || [];
      const hasRequiredQualifications = auditRequest.requiredQualifications.every(qual =>
        auditorQualifications.includes(qual)
      );

      if (!hasRequiredQualifications) {
        return false;
      }

      // Vérifier la capacité (nombre d'audits en cours)
      const maxConcurrentAudits = auditor.maxConcurrentAudits || AUDIT_CONFIG.DEFAULT_MAX_CONCURRENT;
      const currentAudits = auditor.stats?.currentAudits || 0;
      
      if (currentAudits >= maxConcurrentAudits) {
        return false;
      }

      // Vérifier la gamme de compensation
      const minFee = auditor.minAuditFee || 0;
      const maxFee = auditor.maxAuditFee || Infinity;
      
      if (auditRequest.estimatedAmount < minFee || auditRequest.estimatedAmount > maxFee) {
        return false;
      }

      // Vérifier la complexité préférée
      if (auditor.preferredComplexity && 
          auditor.preferredComplexity !== 'any' && 
          auditor.preferredComplexity !== auditRequest.complexity) {
        return false;
      }

      return true;
    });

    // Trier par pertinence (spécialisations, historique, disponibilité)
    const scoredAuditors = qualifiedAuditors.map(auditor => {
      let score = 0;

      // Score pour spécialisations correspondantes
      const matchingSpecializations = (auditRequest.preferredSpecializations || [])
        .filter(spec => (auditor.specializations || []).includes(spec));
      score += matchingSpecializations.length * 10;

      // Score pour l'historique de performance
      if (auditor.auditStats?.averageScore >= 90) score += 20;
      else if (auditor.auditStats?.averageScore >= 80) score += 10;

      // Score pour la rapidité de completion
      if (auditor.auditStats?.averageCompletionDays <= 7) score += 15;
      else if (auditor.auditStats?.averageCompletionDays <= 14) score += 10;

      // Score pour la disponibilité
      const utilizationRate = (auditor.stats?.currentAudits || 0) / (auditor.maxConcurrentAudits || AUDIT_CONFIG.DEFAULT_MAX_CONCURRENT);
      score += Math.round((1 - utilizationRate) * 15);

      // Score pour l'expérience dans la catégorie
      const categoryExperience = auditor.categoryExperience?.[auditRequest.category] || 0;
      score += Math.min(categoryExperience, 10);

      return { auditor, score };
    });

    // Retourner les meilleurs auditeurs
    return scoredAuditors
      .sort((a, b) => b.score - a.score)
      .slice(0, AUDIT_CONFIG.MAX_AUDITORS_PER_REQUEST)
      .map(scored => scored.auditor);

  } catch (error) {
    logger.error('Failed to find qualified auditors', error, {
      auditRequestId: auditRequest.id,
      requiredQualifications: auditRequest.requiredQualifications
    });
    return [];
  }
}

/**
 * Assigne un audit à un auditeur
 */
async function assignAuditToAuditor(
  auditRequest: PendingAuditRequest,
  auditor: UserDocument
): Promise<{ success: boolean; assignmentId?: string; error?: string }> {
  try {
    const assignmentId = helpers.string.generateId('assignment');
    const now = new Date();
    const acceptanceDeadline = new Date(now.getTime() + AUDIT_CONFIG.ASSIGNMENT_ACCEPTANCE_HOURS * 60 * 60 * 1000);

    await firestoreHelper.runTransaction(async (transaction) => {
      // Créer l'assignation
      const assignmentRef = firestoreHelper.getDocumentRef('audit_assignments', assignmentId);
      transaction.set(assignmentRef, {
        id: assignmentId,
        auditRequestId: auditRequest.id,
        auditorUid: auditor.uid,
        projectId: auditRequest.projectId,
        status: 'pending_acceptance',
        assignedAt: now,
        acceptanceDeadline,
        estimatedAmount: auditRequest.estimatedAmount,
        complexity: auditRequest.complexity,
        createdAt: now,
        metadata: {
          autoAssigned: true,
          assignmentReason: 'qualified_match',
          auditorScore: auditor.auditStats?.averageScore || 0,
          auditorExperience: auditor.auditStats?.completedAudits || 0
        }
      });

      // Mettre à jour la demande d'audit
      const auditRequestRef = firestoreHelper.getDocumentRef('audit_requests', auditRequest.id);
      transaction.update(auditRequestRef, {
        status: 'assigned',
        assignedAuditorUid: auditor.uid,
        assignmentId,
        assignedAt: now,
        assignmentDeadline: acceptanceDeadline,
        updatedAt: now
      });

      // Mettre à jour les statistiques de l'auditeur
      const auditorRef = firestoreHelper.getDocumentRef('users', auditor.uid);
      transaction.update(auditorRef, {
        'stats.pendingAssignments': firestoreHelper.increment(1),
        'stats.lastAssignment': now
      });
    });

    logger.info('Audit assigned to auditor', {
      assignmentId,
      auditRequestId: auditRequest.id,
      auditorUid: auditor.uid,
      estimatedAmount: auditRequest.estimatedAmount,
      acceptanceDeadline: acceptanceDeadline.toISOString()
    });

    return { success: true, assignmentId };

  } catch (error) {
    logger.error('Failed to assign audit to auditor', error, {
      auditRequestId: auditRequest.id,
      auditorUid: auditor.uid
    });

    return { success: false, error: error instanceof Error ? error.message : 'Assignment failed' };
  }
}

/**
 * Notifie un auditeur d'une nouvelle assignation
 */
async function notifyAuditorAssignment(
  auditor: UserDocument,
  auditRequest: PendingAuditRequest,
  assignmentId: string
): Promise<boolean> {
  try {
    // Créer notification in-app
    const notificationId = helpers.string.generateId('notif');
    await firestoreHelper.setDocument('notifications', notificationId, {
      id: notificationId,
      recipientUid: auditor.uid,
      senderUid: 'system',
      type: 'audit_assignment',
      title: 'Nouvelle opportunité d\'audit',
      message: `Un audit ${auditRequest.complexity} vous a été assigné pour le projet "${auditRequest.projectTitle}". Compensation estimée: €${Math.round(auditRequest.estimatedAmount / 100)}.`,
      data: {
        auditRequestId: auditRequest.id,
        assignmentId,
        projectId: auditRequest.projectId,
        projectTitle: auditRequest.projectTitle,
        category: auditRequest.category,
        complexity: auditRequest.complexity,
        estimatedAmount: auditRequest.estimatedAmount,
        deadline: auditRequest.deadline.toISOString(),
        acceptanceDeadline: auditRequest.assignmentDeadline?.toISOString(),
        requiredQualifications: auditRequest.requiredQualifications
      },
      priority: 'high',
      actionUrl: `${process.env.FRONTEND_URL}/auditor/assignments/${assignmentId}`,
      read: false,
      readAt: null,
      delivered: true,
      deliveredAt: new Date(),
      expiresAt: auditRequest.assignmentDeadline,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    });

    // Mettre à jour le compteur de notifications
    await firestoreHelper.updateDocument('users', auditor.uid, {
      'notificationCounters.unread': firestoreHelper.increment(1),
      'notificationCounters.total': firestoreHelper.increment(1)
    });

    // Envoyer email si les préférences le permettent
    if (auditor.preferences?.notifications?.email) {
      await emailService.sendEmail({
        to: auditor.email,
        templateId: 'audit_assignment_notification',
        dynamicTemplateData: {
          auditorName: `${auditor.firstName} ${auditor.lastName}`,
          projectTitle: auditRequest.projectTitle,
          category: auditRequest.category,
          complexity: auditRequest.complexity,
          estimatedAmount: (auditRequest.estimatedAmount / 100).toFixed(2),
          deadline: auditRequest.deadline.toLocaleDateString('fr-FR'),
          acceptanceDeadline: auditRequest.assignmentDeadline?.toLocaleDateString('fr-FR'),
          requiredQualifications: auditRequest.requiredQualifications.join(', '),
          assignmentUrl: `${process.env.FRONTEND_URL}/auditor/assignments/${assignmentId}`,
          dashboardUrl: `${process.env.FRONTEND_URL}/auditor/dashboard`
        }
      });
    }

    logger.info('Auditor notified of assignment', {
      auditorUid: auditor.uid,
      assignmentId,
      auditRequestId: auditRequest.id,
      emailSent: !!auditor.preferences?.notifications?.email
    });

    return true;

  } catch (error) {
    logger.error('Failed to notify auditor of assignment', error, {
      auditorUid: auditor.uid,
      assignmentId,
      auditRequestId: auditRequest.id
    });
    return false;
  }
}

/**
 * Escalade une demande d'audit non assignée
 */
async function escalateUnassignedAudit(
  auditRequest: PendingAuditRequest,
  reason: string
): Promise<void> {
  try {
    const escalationId = helpers.string.generateId('escalation');
    
    // Créer l'enregistrement d'escalade
    await firestoreHelper.setDocument('audit_escalations', escalationId, {
      id: escalationId,
      auditRequestId: auditRequest.id,
      projectId: auditRequest.projectId,
      reason,
      escalatedAt: new Date(),
      status: 'pending_review',
      priority: 'high',
      suggestedActions: getSuggestedEscalationActions(reason, auditRequest),
      metadata: {
        originalPriority: auditRequest.priority,
        complexity: auditRequest.complexity,
        estimatedAmount: auditRequest.estimatedAmount,
        daysSinceCreation: Math.floor((Date.now() - auditRequest.createdAt.getTime()) / (24 * 60 * 60 * 1000))
      },
      createdAt: new Date()
    });

    // Mettre à jour la demande d'audit
    await firestoreHelper.updateDocument('audit_requests', auditRequest.id, {
      status: 'escalated',
      escalationId,
      escalatedAt: new Date(),
      escalationReason: reason
    });

    // Notifier les administrateurs
    const admins = await firestoreHelper.queryDocuments<UserDocument>('users', [
      ['role', 'array-contains', 'admin'],
      ['preferences.alerts.audit', '==', true]
    ]);

    const adminNotificationPromises = admins.data.map(async (admin) => {
      const notificationId = helpers.string.generateId('notif');
      
      return firestoreHelper.setDocument('notifications', notificationId, {
        id: notificationId,
        recipientUid: admin.uid,
        senderUid: 'system',
        type: 'audit_escalation',
        title: '🚨 Escalade d\'audit requise',
        message: `Le projet "${auditRequest.projectTitle}" nécessite une intervention manuelle pour l'assignation d'audit. Raison: ${reason}`,
        data: {
          escalationId,
          auditRequestId: auditRequest.id,
          projectId: auditRequest.projectId,
          reason,
          complexity: auditRequest.complexity,
          estimatedAmount: auditRequest.estimatedAmount,
          deadline: auditRequest.deadline.toISOString()
        },
        priority: 'urgent',
        actionUrl: `${process.env.FRONTEND_URL}/admin/audits/escalations/${escalationId}`,
        read: false,
        readAt: null,
        delivered: true,
        deliveredAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      });
    });

    await Promise.allSettled(adminNotificationPromises);

    logger.info('Audit escalated successfully', {
      escalationId,
      auditRequestId: auditRequest.id,
      reason,
      adminsNotified: admins.data.length
    });

  } catch (error) {
    logger.error('Failed to escalate unassigned audit', error, {
      auditRequestId: auditRequest.id,
      reason
    });
  }
}

/**
 * Génère des actions suggérées pour une escalade
 */
function getSuggestedEscalationActions(reason: string, auditRequest: PendingAuditRequest): string[] {
  const actions = [];

  switch (reason) {
    case 'no_qualified_auditors':
      actions.push('Recruter des auditeurs avec les qualifications requises');
      actions.push('Réviser les qualifications requises pour l\'audit');
      actions.push('Considérer la formation d\'auditeurs existants');
      break;

    case 'auditors_at_capacity':
      actions.push('Augmenter la compensation pour attirer plus d\'auditeurs');
      actions.push('Étendre la deadline si possible');
      actions.push('Recruter des auditeurs supplémentaires');
      break;

    case 'repeated_rejections':
      actions.push('Réviser la description et les exigences de l\'audit');
      actions.push('Augmenter la compensation proposée');
      actions.push('Vérifier la complexité estimée du projet');
      break;

    case 'urgent_priority':
      actions.push('Assignation manuelle prioritaire requise');
      actions.push('Contacter directement les auditeurs disponibles');
      actions.push('Considérer un bonus d\'urgence');
      break;

    default:
      actions.push('Révision manuelle requise');
      actions.push('Vérifier les paramètres de la demande d\'audit');
  }

  return actions;
}

/**
 * Vérifie les assignations en attente d'acceptation
 */
async function checkPendingAcceptances(): Promise<{
  remindersSet: number;
  assignmentsExpired: number;
  errors: number;
}> {
  try {
    const now = new Date();
    const reminderThreshold = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12h avant expiration
    
    const results = { remindersSet: 0, assignmentsExpired: 0, errors: 0 };

    // Récupérer les assignations en attente
    const pendingAssignments = await firestoreHelper.queryDocuments<any>(
      'audit_assignments',
      [
        ['status', '==', 'pending_acceptance']
      ],
      { limit: 100 }
    );

    for (const assignment of pendingAssignments) {
      try {
        // Vérifier si l'acceptation a expiré
        if (assignment.acceptanceDeadline < now) {
          // Expirer l'assignation
          await firestoreHelper.updateDocument('audit_assignments', assignment.id, {
            status: 'expired',
            expiredAt: now,
            expiredReason: 'acceptance_timeout'
          });

          // Remettre la demande d'audit en pending_assignment
          await firestoreHelper.updateDocument('audit_requests', assignment.auditRequestId, {
            status: 'pending_assignment',
            assignedAuditorUid: null,
            assignmentId: null,
            assignedAt: null,
            assignmentDeadline: null,
            updatedAt: now
          });

          // Mettre à jour les stats de l'auditeur
          await firestoreHelper.updateDocument('users', assignment.auditorUid, {
            'stats.pendingAssignments': firestoreHelper.increment(-1),
            'stats.expiredAssignments': firestoreHelper.increment(1)
          });

          results.assignmentsExpired++;

        } else if (assignment.acceptanceDeadline < reminderThreshold) {
          // Envoyer un rappel si pas déjà envoyé
          if (!assignment.reminderSent) {
            const auditor = await firestoreHelper.getDocument<UserDocument>('users', assignment.auditorUid);
            
            if (auditor) {
              // Créer notification de rappel
              const notificationId = helpers.string.generateId('notif');
              await firestoreHelper.setDocument('notifications', notificationId, {
                id: notificationId,
                recipientUid: auditor.uid,
                senderUid: 'system',
                type: 'audit_assignment_reminder',
                title: '⏰ Rappel: Assignation d\'audit en attente',
                message: `Vous avez une assignation d'audit qui expire bientôt. Veuillez répondre avant ${assignment.acceptanceDeadline.toLocaleString('fr-FR')}.`,
                data: {
                  assignmentId: assignment.id,
                  auditRequestId: assignment.auditRequestId,
                  projectId: assignment.projectId,
                  acceptanceDeadline: assignment.acceptanceDeadline.toISOString(),
                  estimatedAmount: assignment.estimatedAmount
                },
                priority: 'high',
                actionUrl: `${process.env.FRONTEND_URL}/auditor/assignments/${assignment.id}`,
                read: false,
                readAt: null,
                delivered: true,
                deliveredAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                version: 1
              });

              // Marquer le rappel comme envoyé
              await firestoreHelper.updateDocument('audit_assignments', assignment.id, {
                reminderSent: true,
                reminderSentAt: now
              });

              results.remindersSet++;
            }
          }
        }

      } catch (error) {
        logger.error('Failed to process pending assignment', error, {
          assignmentId: assignment.id,
          auditorUid: assignment.auditorUid
        });
        results.errors++;
      }
    }

    return results;

  } catch (error) {
    logger.error('Failed to check pending acceptances', error);
    return { remindersSet: 0, assignmentsExpired: 0, errors: 1 };
  }
}

/**
 * Traite la queue d'audit
 */
async function processAuditQueue(): Promise<QueueProcessingResults> {
  const batchId = helpers.string.generateId('audit_queue');
  const startTime = Date.now();

  const results: QueueProcessingResults = {
    totalPendingAudits: 0,
    auditsAssigned: 0,
    auditsEscalated: 0,
    auditorsNotified: 0,
    remindersSet: 0,
    errors: 0,
    processingTime: 0,
    batchId,
    assignmentSuccess: { simple: 0, standard: 0, complex: 0 },
    escalationReasons: {}
  };

  try {
    logger.info('Starting audit queue processing', { batchId });

    // Récupérer les demandes en attente
    const pendingRequests = await getPendingAuditRequests();
    results.totalPendingAudits = pendingRequests.length;

    if (pendingRequests.length === 0) {
      logger.info('No pending audit requests to process');
      return results;
    }

    // Traiter chaque demande d'audit en attente d'assignation
    const pendingAssignments = pendingRequests.filter(req => req.status === 'pending_assignment');
    
    for (const auditRequest of pendingAssignments) {
      try {
        // Trouver des auditeurs qualifiés
        const qualifiedAuditors = await findQualifiedAuditors(auditRequest);

        if (qualifiedAuditors.length === 0) {
          // Escalader si aucun auditeur qualifié
          await escalateUnassignedAudit(auditRequest, 'no_qualified_auditors');
          results.auditsEscalated++;
          results.escalationReasons['no_qualified_auditors'] = (results.escalationReasons['no_qualified_auditors'] || 0) + 1;
          continue;
        }

        // Essayer d'assigner au meilleur auditeur disponible
        const topAuditor = qualifiedAuditors[0];
        const assignmentResult = await assignAuditToAuditor(auditRequest, topAuditor);

        if (assignmentResult.success) {
          // Notifier l'auditeur
          const notified = await notifyAuditorAssignment(
            topAuditor,
            auditRequest,
            assignmentResult.assignmentId!
          );

          if (notified) {
            results.auditorsNotified++;
          }

          results.auditsAssigned++;
          results.assignmentSuccess[auditRequest.complexity]++;

        } else {
          // Escalader en cas d'échec d'assignation
          await escalateUnassignedAudit(auditRequest, 'assignment_failed');
          results.auditsEscalated++;
          results.escalationReasons['assignment_failed'] = (results.escalationReasons['assignment_failed'] || 0) + 1;
        }

      } catch (error) {
        logger.error('Failed to process audit request', error, {
          auditRequestId: auditRequest.id,
          batchId
        });
        results.errors++;
      }
    }

    // Vérifier les assignations en attente d'acceptation
    const acceptanceResults = await checkPendingAcceptances();
    results.remindersSet += acceptanceResults.remindersSet;
    results.errors += acceptanceResults.errors;

    results.processingTime = Date.now() - startTime;

    logger.info('Audit queue processing completed', results);

    return results;

  } catch (error) {
    logger.error('Failed to process audit queue', error, { batchId });
    results.errors++;
    return results;
  }
}

/**
 * Met à jour les métriques de la queue d'audit
 */
async function updateAuditQueueMetrics(results: QueueProcessingResults): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'audits.queueProcessed': results.totalPendingAudits,
      'audits.assigned': results.auditsAssigned,
      'audits.escalated': results.auditsEscalated,
      'audits.lastQueueProcessing': new Date()
    });

    // Statistiques par complexité
    for (const [complexity, count] of Object.entries(results.assignmentSuccess)) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', {
        [`audits.assignmentsByComplexity.${complexity}`]: count
      });
    }

    // Statistiques d'escalade
    for (const [reason, count] of Object.entries(results.escalationReasons)) {
      await firestoreHelper.incrementDocument('platform_stats', 'global', {
        [`audits.escalationReasons.${reason}`]: count
      });
    }

    logger.info('Audit queue metrics updated', results);

  } catch (error) {
    logger.error('Failed to update audit queue metrics', error);
  }
}

/**
 * Fonction Cloud Scheduler - Traitement de la queue d'audit
 */
export const processAuditQueue = pubsub
  .schedule('0 */2 * * *') // Toutes les 2 heures
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('queue_exec');
    const startTime = Date.now();

    try {
      logger.info('Process audit queue scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      const results = await processAuditQueue();

      logger.business('Audit queue processed', 'audit', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        totalPendingAudits: results.totalPendingAudits,
        auditsAssigned: results.auditsAssigned,
        auditsEscalated: results.auditsEscalated,
        successRate: results.totalPendingAudits > 0 ? results.auditsAssigned / results.totalPendingAudits : 0,
        timestamp: new Date().toISOString()
      });

      await updateAuditQueueMetrics(results);

      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'processAuditQueue',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(Date.now() + 2 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      logger.info('Process audit queue scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        auditsAssigned: results.auditsAssigned
      });

    } catch (error) {
      logger.error('Process audit queue scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'processAuditQueue',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 30 * 60 * 1000),
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log audit queue execution failure', logError, { executionId });
      }

      throw error;
    }
  });