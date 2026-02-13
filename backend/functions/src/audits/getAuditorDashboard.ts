/**
 * Get Auditor Dashboard Firebase Function
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
import { AuditsAPI } from '../types/api';
import { UserDocument, AuditDocument, ProjectDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  period: Joi.string().valid('week', 'month', 'quarter', 'year', 'all').default('month'),
  includeStats: Joi.boolean().default(true),
  includeHistory: Joi.boolean().default(true),
  limit: Joi.number().min(1).max(100).default(20),
}).optional();

/**
 * Valide que l'utilisateur est un auditeur autorisé
 */
async function validateAuditorAccess(uid: string): Promise<UserDocument> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);

    // Vérifier que l'utilisateur a les permissions d'auditeur
    if (!user.permissions.includes(USER_PERMISSIONS.AUDIT_PROJECT)) {
      throw new https.HttpsError('permission-denied', 'Auditor access required');
    }

    // Vérifier que le compte auditeur est actif
    if (user.status !== 'active') {
      throw new https.HttpsError('failed-precondition', 'Auditor account is not active');
    }

    return user;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate auditor access', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate auditor access');
  }
}

/**
 * Calcule les statistiques de performance de l'auditeur
 */
async function calculateAuditorStats(
  auditorUid: string,
  period: string
): Promise<AuditsAPI.AuditorDashboardResponse['stats']> {
  try {
    // Définir la période de calcul
    const now = new Date();
    let startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(now.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'all':
        startDate = new Date(0); // Beginning of time
        break;
    }

    // Récupérer tous les audits de l'auditeur dans la période
    const audits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['createdAt', '>=', startDate]
      ]
    );

    // Récupérer les audits complétés ce mois-ci
    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);
    thisMonthStart.setHours(0, 0, 0, 0);

    const thisMonthAudits = audits.data.filter(audit =>
      audit.completedAt && new Date(audit.completedAt) >= thisMonthStart
    );

    // Calculer les statistiques
    const completedAudits = audits.data.filter(audit => audit.status === STATUS.AUDIT.COMPLETED);
    const approvedAudits = completedAudits.filter(audit => audit.finalDecision === 'approved');

    const totalProcessingTimes = completedAudits
      .filter(audit => audit.completionTime)
      .map(audit => audit.completionTime!);

    const averageProcessingTime = totalProcessingTimes.length > 0
      ? Math.round(totalProcessingTimes.reduce((sum, time) => sum + time, 0) / totalProcessingTimes.length)
      : 0;

    const approvalRate = completedAudits.length > 0
      ? Math.round((approvedAudits.length / completedAudits.length) * 100)
      : 0;

    // Calculer les gains totaux
    const totalEarnings = completedAudits.reduce((sum, audit) => {
      return sum + (audit.compensation?.finalAmount || audit.compensation?.amount || 0);
    }, 0);

    // Calculer les gains ce mois-ci
    const thisMonthEarnings = thisMonthAudits.reduce((sum, audit) => {
      return sum + (audit.compensation?.finalAmount || audit.compensation?.amount || 0);
    }, 0);

    return {
      totalAudits: audits.data.length,
      completedAudits: completedAudits.length,
      activeAudits: audits.data.filter(audit =>
        [STATUS.AUDIT.ASSIGNED, STATUS.AUDIT.IN_PROGRESS].includes(audit.status)
      ).length,
      completedThisMonth: thisMonthAudits.length,
      averageProcessingTime,
      approvalRate,
      totalEarnings,
      thisMonthEarnings,
      averageScore: completedAudits.length > 0 
        ? Math.round(completedAudits.reduce((sum, audit) => sum + (audit.finalScore || 0), 0) / completedAudits.length)
        : 0,
      specializations: [], // Will be filled from user profile
      rating: 0, // Will be calculated from feedback
    };

  } catch (error) {
    logger.error('Failed to calculate auditor stats', error, { auditorUid, period });
    throw new https.HttpsError('internal', 'Unable to calculate auditor statistics');
  }
}

/**
 * Récupère les audits assignés en cours
 */
async function getAssignedAudits(
  auditorUid: string,
  limit: number
): Promise<AuditsAPI.AuditorDashboardResponse['assigned']> {
  try {
    const assignedAudits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['status', 'in', [STATUS.AUDIT.ASSIGNED, STATUS.AUDIT.IN_PROGRESS]]
      ],
      {
        orderBy: [{ field: 'deadline', direction: 'asc' }],
        limit
      }
    );

    // Enrichir avec les informations des projets
    const assignedWithDetails = await Promise.all(
      assignedAudits.data.map(async (audit) => {
        try {
          const project = await firestoreHelper.getDocument<ProjectDocument>('projects', audit.projectId);
          
          // Trouver le milestone en cours d'audit
          const currentMilestone = project.milestones.find(m => 
            m.id === audit.currentMilestone || 
            m.status === STATUS.MILESTONE.COMPLETED ||
            m.status === STATUS.MILESTONE.SUBMITTED
          );

          // Calculer la priorité basée sur la deadline et l'importance
          const daysUntilDeadline = Math.ceil((new Date(audit.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
          let priority: 'high' | 'medium' | 'low' = 'medium';
          
          if (daysUntilDeadline <= 2) {
            priority = 'high';
          } else if (daysUntilDeadline <= 7) {
            priority = 'medium';
          } else {
            priority = 'low';
          }

          return {
            auditId: audit.id,
            projectId: project.uid,
            projectTitle: project.title,
            projectCategory: project.category,
            milestoneTitle: currentMilestone?.title || 'General Audit',
            milestoneId: currentMilestone?.id || '',
            assignedAt: audit.assignedAt.toISOString(),
            acceptedAt: audit.acceptedAt?.toISOString() || '',
            deadline: audit.deadline,
            priority,
            status: audit.status,
            progress: {
              documentsReviewed: 0, // Will be calculated from workspace
              criteriaCompleted: 0, // Will be calculated from workspace
              estimatedTimeRemaining: Math.max(0, audit.estimatedHours - (audit.timeSpent || 0)),
            },
            compensation: audit.compensation.amount,
            workspaceUrl: `${process.env.FRONTEND_URL}/auditor/workspace/${audit.id}`,
            nextAction: audit.status === STATUS.AUDIT.ASSIGNED ? 'accept_audit' : 'continue_review',
          };

        } catch (error) {
          logger.error('Failed to enrich audit details', error, { auditId: audit.id });
          return {
            auditId: audit.id,
            projectId: audit.projectId,
            projectTitle: 'Unknown Project',
            projectCategory: 'unknown',
            milestoneTitle: 'Unknown Milestone',
            milestoneId: '',
            assignedAt: audit.assignedAt.toISOString(),
            acceptedAt: audit.acceptedAt?.toISOString() || '',
            deadline: audit.deadline,
            priority: 'medium' as const,
            status: audit.status,
            progress: { documentsReviewed: 0, criteriaCompleted: 0, estimatedTimeRemaining: 0 },
            compensation: audit.compensation.amount,
            workspaceUrl: '',
            nextAction: 'review_details',
          };
        }
      })
    );

    return assignedWithDetails;

  } catch (error) {
    logger.error('Failed to get assigned audits', error, { auditorUid });
    throw new https.HttpsError('internal', 'Unable to retrieve assigned audits');
  }
}

/**
 * Récupère l'historique des audits complétés
 */
async function getAuditHistory(
  auditorUid: string,
  period: string,
  limit: number
): Promise<AuditsAPI.AuditorDashboardResponse['completed']> {
  try {
    // Définir la période
    const startDate = new Date();
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'all':
        startDate.setTime(0);
        break;
    }

    const completedAudits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['status', '==', STATUS.AUDIT.COMPLETED],
        ['completedAt', '>=', startDate]
      ],
      {
        orderBy: [{ field: 'completedAt', direction: 'desc' }],
        limit
      }
    );

    // Enrichir avec les détails et le feedback
    const historyWithDetails = await Promise.all(
      completedAudits.data.map(async (audit) => {
        try {
          // Récupérer le projet pour le titre
          const project = await firestoreHelper.getDocument<ProjectDocument>('projects', audit.projectId);
          
          // Récupérer le feedback du créateur s'il existe
          const feedback = await firestoreHelper.queryDocuments<any>(
            'audit_feedback',
            [
              ['auditId', '==', audit.id],
              ['fromCreator', '==', true]
            ],
            { limit: 1 }
          );

          const creatorFeedback = feedback.data.length > 0 ? feedback.data[0] : null;

          return {
            auditId: audit.id,
            projectId: project.uid,
            projectTitle: project.title,
            projectCategory: project.category,
            milestoneTitle: audit.currentMilestone || 'General Audit',
            completedAt: audit.completedAt!.toISOString(),
            submittedAt: audit.completedAt!.toISOString(),
            decision: audit.finalDecision!,
            score: audit.finalScore!,
            timeSpent: audit.timeSpent || audit.estimatedHours,
            compensation: {
              amount: audit.compensation.finalAmount || audit.compensation.amount,
              status: audit.compensation.status,
              paidAt: audit.compensation.paidAt?.toISOString() || '',
            },
            feedback: creatorFeedback ? {
              creatorRating: creatorFeedback.rating,
              creatorComment: creatorFeedback.comment,
              wouldRecommend: creatorFeedback.wouldRecommend,
              submittedAt: creatorFeedback.createdAt.toISOString(),
            } : undefined,
            reportUrl: `${process.env.FRONTEND_URL}/auditor/reports/${audit.reportId}`,
          };

        } catch (error) {
          logger.error('Failed to enrich completed audit details', error, { auditId: audit.id });
          return {
            auditId: audit.id,
            projectId: audit.projectId,
            projectTitle: 'Unknown Project',
            projectCategory: 'unknown',
            milestoneTitle: 'Unknown',
            completedAt: audit.completedAt!.toISOString(),
            submittedAt: audit.completedAt!.toISOString(),
            decision: audit.finalDecision!,
            score: audit.finalScore!,
            timeSpent: audit.timeSpent || 0,
            compensation: {
              amount: audit.compensation.amount,
              status: audit.compensation.status,
              paidAt: '',
            },
            feedback: undefined,
            reportUrl: '',
          };
        }
      })
    );

    return historyWithDetails;

  } catch (error) {
    logger.error('Failed to get audit history', error, { auditorUid, period });
    throw new https.HttpsError('internal', 'Unable to retrieve audit history');
  }
}

/**
 * Récupère les opportunités d'audit disponibles
 */
async function getAvailableOpportunities(
  auditor: UserDocument,
  limit: number = 10
): Promise<any[]> {
  try {
    // Récupérer les audits non assignés qui correspondent aux spécialisations
    const auditorSpecializations = auditor.auditor?.specializations || [];
    
    if (auditorSpecializations.length === 0) {
      return [];
    }

    // Récupérer les projets nécessitant un audit
    const projectsNeedingAudit = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['status', 'in', [STATUS.PROJECT.APPROVED, STATUS.PROJECT.ACTIVE]],
        ['audit.status', 'in', [STATUS.AUDIT.PENDING, STATUS.AUDIT.UNASSIGNED]]
      ],
      { limit: limit * 2 } // Plus large pour filtrer ensuite
    );

    // Filtrer par spécialisations et disponibilité
    const opportunities = projectsNeedingAudit.data
      .filter(project => {
        // Vérifier la correspondance de spécialisation
        const projectRequirements = AUDIT_CONFIG.SPECIALIZATION_REQUIREMENTS[project.category] || [];
        const hasMatchingSpec = projectRequirements.some(req => 
          auditorSpecializations.includes(req)
        );

        // Vérifier la certification si nécessaire
        const certifications = auditor.auditor?.certifications || [];
        const requiresCertification = ['finance', 'healthcare', 'legal'].includes(project.category);
        
        if (requiresCertification) {
          const hasCertification = certifications.some(cert => 
            cert.category === project.category && cert.status === 'active'
          );
          return hasMatchingSpec && hasCertification;
        }

        return hasMatchingSpec;
      })
      .slice(0, limit)
      .map(project => {
        const estimatedCompensation = calculateEstimatedCompensation(auditor, project);
        const estimatedHours = AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                              AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS;

        return {
          projectId: project.uid,
          projectTitle: project.title,
          projectCategory: project.category,
          creatorName: project.creatorName || 'Project Creator',
          fundingGoal: project.funding.goal,
          currentFunding: project.funding.raised,
          urgency: calculateUrgency(project),
          estimatedHours,
          estimatedCompensation,
          requiredSpecializations: AUDIT_CONFIG.SPECIALIZATION_REQUIREMENTS[project.category] || [],
          deadline: calculateEstimatedDeadline(project),
          applyUrl: `${process.env.FRONTEND_URL}/auditor/opportunities/${project.uid}/apply`,
        };
      });

    return opportunities;

  } catch (error) {
    logger.error('Failed to get available opportunities', error, { auditorUid });
    return [];
  }
}

/**
 * Calcule la compensation estimée pour un projet
 */
function calculateEstimatedCompensation(auditor: UserDocument, project: ProjectDocument): number {
  const baseRate = auditor.auditor?.hourlyRate || AUDIT_CONFIG.DEFAULT_HOURLY_RATE;
  const categoryMultiplier = AUDIT_CONFIG.COMPLEXITY_MULTIPLIERS[project.category] || 1.0;
  const projectSizeMultiplier = project.funding.goal > 100000 ? 1.2 : 1.0;
  const estimatedHours = AUDIT_CONFIG.ESTIMATED_HOURS_BY_CATEGORY[project.category] || 
                        AUDIT_CONFIG.DEFAULT_ESTIMATED_HOURS;

  return Math.round(baseRate * estimatedHours * categoryMultiplier * projectSizeMultiplier);
}

/**
 * Calcule l'urgence d'un projet
 */
function calculateUrgency(project: ProjectDocument): 'high' | 'medium' | 'low' {
  const endDate = new Date(project.timeline.endDate);
  const daysUntilEnd = Math.ceil((endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  
  if (daysUntilEnd <= 7) return 'high';
  if (daysUntilEnd <= 30) return 'medium';
  return 'low';
}

/**
 * Calcule la deadline estimée pour un audit
 */
function calculateEstimatedDeadline(project: ProjectDocument): string {
  const endDate = new Date(project.timeline.endDate);
  const auditBuffer = 14; // 14 jours avant la fin du projet
  const auditDeadline = new Date(endDate.getTime() - auditBuffer * 24 * 60 * 60 * 1000);
  
  return auditDeadline.toISOString();
}

/**
 * Récupère les alertes et notifications pour l'auditeur
 */
async function getAuditorAlerts(auditorUid: string): Promise<any[]> {
  try {
    const alerts: any[] = [];

    // Vérifier les audits proches de la deadline
    const assignedAudits = await firestoreHelper.queryDocuments<AuditDocument>(
      'audits',
      [
        ['auditorUid', '==', auditorUid],
        ['status', 'in', [STATUS.AUDIT.ASSIGNED, STATUS.AUDIT.IN_PROGRESS]]
      ]
    );

    assignedAudits.data.forEach(audit => {
      const deadline = new Date(audit.deadline);
      const daysUntilDeadline = Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000));

      if (daysUntilDeadline <= 3) {
        alerts.push({
          type: 'deadline_approaching',
          priority: daysUntilDeadline <= 1 ? 'urgent' : 'high',
          message: `Audit deadline in ${daysUntilDeadline} day(s)`,
          auditId: audit.id,
          projectTitle: audit.projectTitle,
          deadline: audit.deadline,
          actionUrl: `${process.env.FRONTEND_URL}/auditor/workspace/${audit.id}`,
        });
      }

      // Vérifier si l'audit n'a pas été accepté depuis trop longtemps
      if (audit.status === STATUS.AUDIT.ASSIGNED) {
        const assignedDays = Math.ceil((Date.now() - new Date(audit.assignedAt).getTime()) / (24 * 60 * 60 * 1000));
        if (assignedDays >= 3) {
          alerts.push({
            type: 'acceptance_overdue',
            priority: 'medium',
            message: `Audit assignment pending acceptance for ${assignedDays} days`,
            auditId: audit.id,
            projectTitle: audit.projectTitle,
            assignedAt: audit.assignedAt.toISOString(),
            actionUrl: `${process.env.FRONTEND_URL}/auditor/assignments/${audit.id}`,
          });
        }
      }
    });

    // Vérifier les paiements en retard
    const overduePayments = await firestoreHelper.queryDocuments<any>(
      'auditor_compensations',
      [
        ['auditorUid', '==', auditorUid],
        ['status', '==', 'pending_payment'],
        ['dueDate', '<', new Date()]
      ]
    );

    overduePayments.data.forEach(payment => {
      alerts.push({
        type: 'payment_overdue',
        priority: 'high',
        message: `Payment overdue: €${(payment.finalAmount / 100).toFixed(2)}`,
        auditId: payment.auditId,
        amount: payment.finalAmount,
        dueDate: payment.dueDate,
        actionUrl: `${process.env.FRONTEND_URL}/auditor/payments`,
      });
    });

    return alerts.sort((a, b) => {
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

  } catch (error) {
    logger.error('Failed to get auditor alerts', error, { auditorUid });
    return [];
  }
}

/**
 * Exécute la récupération du dashboard auditeur
 */
async function executeGetAuditorDashboard(
  data: any,
  context: CallableContext
): Promise<AuditsAPI.AuditorDashboardResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'accès auditeur
  const auditor = await validateAuditorAccess(uid);
  
  // Récupération des données en parallèle
  const [stats, assignedAudits, completedAudits, opportunities, alerts] = await Promise.all([
    data.includeStats ? calculateAuditorStats(uid, data.period) : Promise.resolve({} as any),
    getAssignedAudits(uid, data.limit),
    data.includeHistory ? getAuditHistory(uid, data.period, data.limit) : Promise.resolve([]),
    getAvailableOpportunities(auditor, 5),
    getAuditorAlerts(uid),
  ]);

  // Enrichir les stats avec les données de profil
  if (data.includeStats && stats) {
    stats.specializations = auditor.auditor?.specializations || [];
    
    // Calculer le rating moyen depuis les feedbacks
    const feedbacks = await firestoreHelper.queryDocuments<any>(
      'audit_feedback',
      [
        ['toAuditorUid', '==', uid],
        ['rating', '>', 0]
      ],
      { limit: 100 }
    );

    const averageRating = feedbacks.data.length > 0
      ? Math.round((feedbacks.data.reduce((sum, f) => sum + f.rating, 0) / feedbacks.data.length) * 10) / 10
      : 0;
    
    stats.rating = averageRating;
  }

  // Log business
  logger.business('Auditor dashboard accessed', 'audits', {
    auditorUid: uid,
    period: data.period,
    activeAudits: assignedAudits.length,
    completedAudits: completedAudits.length,
    availableOpportunities: opportunities.length,
    alertsCount: alerts.length,
    includeStats: data.includeStats,
    includeHistory: data.includeHistory,
  });

  return {
    stats,
    assigned: assignedAudits,
    completed: completedAudits,
    opportunities,
    alerts,
    profile: {
      specializations: auditor.auditor?.specializations || [],
      certifications: auditor.auditor?.certifications || [],
      hourlyRate: auditor.auditor?.hourlyRate || 0,
      maxConcurrentAudits: auditor.auditor?.maxConcurrentAudits || AUDIT_CONFIG.DEFAULT_MAX_CONCURRENT,
      availability: auditor.auditor?.availability || 'available',
      languages: auditor.auditor?.languages || ['fr'],
    },
    performance: {
      thisMonth: {
        auditsCompleted: completedAudits.filter(audit => {
          const thisMonth = new Date();
          thisMonth.setDate(1);
          return new Date(audit.completedAt) >= thisMonth;
        }).length,
        averageScore: stats.averageScore || 0,
        earnings: stats.thisMonthEarnings || 0,
      },
      trends: {
        improving: stats.averageScore > 80,
        consistent: Math.abs((stats.averageScore || 0) - 75) < 10,
        needsImprovement: (stats.averageScore || 0) < 70,
      },
    },
    nextActions: [
      assignedAudits.length > 0 ? 'Complete assigned audits' : 'Look for new opportunities',
      alerts.length > 0 ? 'Address urgent alerts' : 'Review performance metrics',
      'Update availability status',
      'Check for new certification requirements',
    ],
  };
}

/**
 * Firebase Function principale
 */
export const getAuditorDashboard = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuditsAPI.AuditorDashboardResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données (optionnelles)
    const validatedData = validateWithJoi<any>(requestSchema, data || {});

    // Logging de démarrage
    logger.info('Getting auditor dashboard', {
      functionName: 'getAuditorDashboard',
      uid: context.auth.uid,
      period: validatedData.period,
      includeStats: validatedData.includeStats,
      includeHistory: validatedData.includeHistory,
      limit: validatedData.limit,
    });

    // Exécution
    const result = await executeGetAuditorDashboard(validatedData, context);

    // Logging de succès
    logger.info('Auditor dashboard retrieved successfully', {
      functionName: 'getAuditorDashboard',
      uid: context.auth.uid,
      period: validatedData.period,
      totalAudits: result.stats?.totalAudits || 0,
      activeAudits: result.assigned.length,
      completedAudits: result.completed.length,
      opportunitiesCount: result.opportunities?.length || 0,
      alertsCount: result.alerts?.length || 0,
      success: true,
    });

    return result;
  })
);