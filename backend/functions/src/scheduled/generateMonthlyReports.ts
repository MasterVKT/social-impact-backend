/**
 * Generate Monthly Reports Scheduled Firebase Function
 * Social Finance Impact Platform
 */

import { pubsub } from 'firebase-functions';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';
import { emailService } from '../integrations/sendgrid/emailService';
import { UserDocument, ProjectDocument, ContributionDocument, RefundDocument } from '../types/firestore';
import { STATUS, REPORTS_CONFIG } from '../utils/constants';
import { helpers } from '../utils/helpers';

/**
 * Interface pour les données de rapport mensuel
 */
interface MonthlyReportData {
  month: string;
  period: {
    startDate: Date;
    endDate: Date;
    totalDays: number;
  };
  users: {
    totalRegistered: number;
    newRegistrations: number;
    activeUsers: number;
    kycCompletions: number;
    byType: {
      creators: number;
      contributors: number;
      auditors: number;
    };
  };
  projects: {
    totalActive: number;
    newProjects: number;
    completedProjects: number;
    cancelledProjects: number;
    totalFunding: number;
    averageFunding: number;
    byCategory: Record<string, {
      count: number;
      funding: number;
      avgFunding: number;
      successRate: number;
    }>;
    topPerforming: Array<{
      projectId: string;
      title: string;
      category: string;
      funding: number;
      contributorsCount: number;
      auditScore?: number;
    }>;
  };
  contributions: {
    totalCount: number;
    totalAmount: number;
    averageAmount: number;
    uniqueContributors: number;
    byRange: Record<string, number>;
    dailyAverage: number;
    growthRate: number;
  };
  financial: {
    totalVolume: number;
    escrowHeld: number;
    interestAccrued: number;
    refundsProcessed: number;
    refundAmount: number;
    platformFees: number;
    netRevenue: number;
  };
  audits: {
    totalCompleted: number;
    averageScore: number;
    auditorsActive: number;
    averageCompensation: number;
    completionTime: number; // En jours
    byComplexity: Record<string, number>;
  };
  performance: {
    apiResponseTime: number;
    errorRate: number;
    uptime: number;
    dataProcessed: number;
    functionsExecuted: number;
  };
  impact: {
    projectsImpacted: number;
    beneficiariesReached: number;
    impactScore: number;
    sustainabilityMetrics: Record<string, number>;
  };
}

/**
 * Interface pour les résultats de génération de rapport
 */
interface ReportGenerationResults {
  reportsGenerated: number;
  recipientsSent: number;
  errors: number;
  processingTime: number;
  batchId: string;
  reportData: MonthlyReportData;
  emailsSent: {
    admins: number;
    stakeholders: number;
    investors: number;
  };
}

/**
 * Collecte les données utilisateurs pour le rapport mensuel
 */
async function collectUserData(startDate: Date, endDate: Date): Promise<MonthlyReportData['users']> {
  try {
    const [
      totalUsers,
      newUsers,
      activeUsers,
      kycCompletions
    ] = await Promise.all([
      // Total des utilisateurs inscrits
      firestoreHelper.queryDocuments<UserDocument>('users', [['status', '!=', 'deleted']]),
      
      // Nouveaux utilisateurs du mois
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['createdAt', '>=', startDate],
        ['createdAt', '<', endDate]
      ]),
      
      // Utilisateurs actifs (activité dans le mois)
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['stats.lastActivity', '>=', startDate],
        ['status', '==', 'active']
      ]),
      
      // Completions KYC du mois
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['kycCompletedAt', '>=', startDate],
        ['kycCompletedAt', '<', endDate],
        ['kycStatus', '==', 'approved']
      ])
    ]);

    // Compter par type d'utilisateur (nouveaux)
    const byType = newUsers.data.reduce((counts, user) => {
      counts[user.userType]++;
      return counts;
    }, { creators: 0, contributors: 0, auditors: 0 });

    return {
      totalRegistered: totalUsers.data.length,
      newRegistrations: newUsers.data.length,
      activeUsers: activeUsers.data.length,
      kycCompletions: kycCompletions.data.length,
      byType
    };

  } catch (error) {
    logger.error('Failed to collect user data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données projets pour le rapport mensuel
 */
async function collectProjectData(startDate: Date, endDate: Date): Promise<MonthlyReportData['projects']> {
  try {
    const [
      allActiveProjects,
      newProjects,
      completedProjects,
      cancelledProjects
    ] = await Promise.all([
      // Projets actifs
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['status', '==', STATUS.PROJECT.ACTIVE]
      ]),
      
      // Nouveaux projets du mois
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['createdAt', '>=', startDate],
        ['createdAt', '<', endDate]
      ]),
      
      // Projets complétés du mois
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['completedAt', '>=', startDate],
        ['completedAt', '<', endDate],
        ['status', '==', STATUS.PROJECT.COMPLETED]
      ]),
      
      // Projets annulés du mois
      firestoreHelper.queryDocuments<ProjectDocument>('projects', [
        ['updatedAt', '>=', startDate],
        ['updatedAt', '<', endDate],
        ['status', '==', STATUS.PROJECT.CANCELLED]
      ])
    ]);

    // Calculer les métriques financières
    const totalFunding = allActiveProjects.data.reduce((sum, project) => sum + project.currentFunding, 0);
    const averageFunding = allActiveProjects.data.length > 0 ? totalFunding / allActiveProjects.data.length : 0;

    // Analyser par catégorie
    const categoryAnalysis = new Map<string, {
      projects: ProjectDocument[];
      funding: number;
      completed: number;
    }>();

    allActiveProjects.data.forEach(project => {
      if (!categoryAnalysis.has(project.category)) {
        categoryAnalysis.set(project.category, { projects: [], funding: 0, completed: 0 });
      }
      const category = categoryAnalysis.get(project.category)!;
      category.projects.push(project);
      category.funding += project.currentFunding;
    });

    completedProjects.data.forEach(project => {
      if (categoryAnalysis.has(project.category)) {
        categoryAnalysis.get(project.category)!.completed++;
      }
    });

    const byCategory = Object.fromEntries(
      Array.from(categoryAnalysis.entries()).map(([category, data]) => [
        category,
        {
          count: data.projects.length,
          funding: data.funding,
          avgFunding: data.projects.length > 0 ? data.funding / data.projects.length : 0,
          successRate: data.projects.length > 0 ? data.completed / data.projects.length : 0
        }
      ])
    );

    // Identifier les projets les plus performants du mois
    const topPerforming = newProjects.data
      .filter(project => project.currentFunding > 0)
      .sort((a, b) => b.currentFunding - a.currentFunding)
      .slice(0, 10)
      .map(project => ({
        projectId: project.id,
        title: project.title,
        category: project.category,
        funding: project.currentFunding,
        contributorsCount: project.stats?.contributorsCount || 0,
        auditScore: project.auditScore
      }));

    return {
      totalActive: allActiveProjects.data.length,
      newProjects: newProjects.data.length,
      completedProjects: completedProjects.data.length,
      cancelledProjects: cancelledProjects.data.length,
      totalFunding,
      averageFunding,
      byCategory,
      topPerforming
    };

  } catch (error) {
    logger.error('Failed to collect project data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données contributions pour le rapport mensuel
 */
async function collectContributionData(startDate: Date, endDate: Date): Promise<MonthlyReportData['contributions']> {
  try {
    // Contributions du mois
    const monthContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      'contributions',
      [
        ['confirmedAt', '>=', startDate],
        ['confirmedAt', '<', endDate],
        ['status', '==', 'confirmed']
      ]
    );

    // Contributions du mois précédent pour calculer la croissance
    const previousMonthStart = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previousMonthContributions = await firestoreHelper.queryDocuments<ContributionDocument>(
      'contributions',
      [
        ['confirmedAt', '>=', previousMonthStart],
        ['confirmedAt', '<', startDate],
        ['status', '==', 'confirmed']
      ]
    );

    const totalCount = monthContributions.data.length;
    const totalAmount = monthContributions.data.reduce((sum, contrib) => sum + contrib.amount, 0);
    const averageAmount = totalCount > 0 ? totalAmount / totalCount : 0;
    const uniqueContributors = new Set(monthContributions.data.map(contrib => contrib.contributorUid)).size;

    // Calculer la moyenne quotidienne
    const daysInMonth = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const dailyAverage = totalAmount / daysInMonth;

    // Calculer le taux de croissance
    const previousAmount = previousMonthContributions.data.reduce((sum, contrib) => sum + contrib.amount, 0);
    const growthRate = previousAmount > 0 ? ((totalAmount - previousAmount) / previousAmount) * 100 : 0;

    // Analyser les gammes de contribution
    const ranges = {
      'small': 0,     // €1-€50
      'medium': 0,    // €51-€200
      'large': 0,     // €201-€500
      'major': 0      // €500+
    };

    monthContributions.data.forEach(contrib => {
      const amountEur = contrib.amount / 100;
      if (amountEur <= 50) ranges.small++;
      else if (amountEur <= 200) ranges.medium++;
      else if (amountEur <= 500) ranges.large++;
      else ranges.major++;
    });

    return {
      totalCount,
      totalAmount,
      averageAmount,
      uniqueContributors,
      byRange: ranges,
      dailyAverage,
      growthRate
    };

  } catch (error) {
    logger.error('Failed to collect contribution data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données financières pour le rapport mensuel
 */
async function collectFinancialData(startDate: Date, endDate: Date): Promise<MonthlyReportData['financial']> {
  try {
    const [
      monthlyStats,
      escrowRecords,
      refunds,
      interestCalculations
    ] = await Promise.all([
      // Statistiques mensuelles
      firestoreHelper.getDocument('platform_stats', `monthly_${startDate.toISOString().slice(0, 7)}`),
      
      // Enregistrements d'escrow actifs
      firestoreHelper.queryDocuments<any>('escrow_records', [['status', '==', 'held']]),
      
      // Remboursements du mois
      firestoreHelper.queryDocuments<RefundDocument>('refunds', [
        ['processedAt', '>=', startDate],
        ['processedAt', '<', endDate],
        ['status', '==', 'completed']
      ]),
      
      // Calculs d'intérêts du mois
      firestoreHelper.queryDocuments<any>('interest_calculations', [
        ['calculationDate', '>=', startDate],
        ['calculationDate', '<', endDate]
      ])
    ]);

    const totalVolume = monthlyStats?.contributions?.totalAmount || 0;
    const escrowHeld = escrowRecords.data.reduce((sum, record) => sum + record.amount + (record.accruedInterest || 0), 0);
    const interestAccrued = interestCalculations.data.reduce((sum, calc) => sum + calc.interestEarned, 0);
    const refundAmount = refunds.data.reduce((sum, refund) => sum + refund.refundAmount, 0);
    
    // Calculer les frais de plateforme (estimation basée sur les contributions)
    const platformFees = Math.round(totalVolume * REPORTS_CONFIG.PLATFORM_FEE_RATE);
    const netRevenue = platformFees - Math.round(totalVolume * REPORTS_CONFIG.PROCESSING_FEE_RATE);

    return {
      totalVolume,
      escrowHeld,
      interestAccrued,
      refundsProcessed: refunds.data.length,
      refundAmount,
      platformFees,
      netRevenue
    };

  } catch (error) {
    logger.error('Failed to collect financial data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données d'audit pour le rapport mensuel
 */
async function collectAuditData(startDate: Date, endDate: Date): Promise<MonthlyReportData['audits']> {
  try {
    // Audits complétés du mois
    const completedAudits = await firestoreHelper.queryDocuments<any>(
      'audits',
      [
        ['completedAt', '>=', startDate],
        ['completedAt', '<', endDate],
        ['status', '==', 'completed']
      ]
    );

    // Auditeurs actifs du mois
    const activeAuditors = await firestoreHelper.queryDocuments<UserDocument>(
      'users',
      [
        ['userType', '==', 'auditor'],
        ['stats.lastActivity', '>=', startDate],
        ['status', '==', 'active']
      ]
    );

    const totalCompleted = completedAudits.data.length;
    const averageScore = totalCompleted > 0 ?
      completedAudits.data.reduce((sum, audit) => sum + audit.score, 0) / totalCompleted : 0;

    const averageCompensation = totalCompleted > 0 ?
      completedAudits.data.reduce((sum, audit) => sum + audit.compensation, 0) / totalCompleted : 0;

    // Calculer le temps moyen de completion
    const completionTimes = completedAudits.data
      .filter(audit => audit.startedAt && audit.completedAt)
      .map(audit => Math.floor((audit.completedAt.getTime() - audit.startedAt.getTime()) / (24 * 60 * 60 * 1000)));

    const averageCompletionTime = completionTimes.length > 0 ?
      completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length : 0;

    // Analyser par complexité
    const byComplexity = completedAudits.data.reduce((counts, audit) => {
      const complexity = audit.complexity || 'standard';
      counts[complexity] = (counts[complexity] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return {
      totalCompleted,
      averageScore,
      auditorsActive: activeAuditors.data.length,
      averageCompensation,
      completionTime: averageCompletionTime,
      byComplexity
    };

  } catch (error) {
    logger.error('Failed to collect audit data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données de performance pour le rapport mensuel
 */
async function collectPerformanceData(startDate: Date, endDate: Date): Promise<MonthlyReportData['performance']> {
  try {
    // Récupérer les statistiques de performance du mois
    const performanceStats = await firestoreHelper.getDocument('platform_stats', `performance_${startDate.toISOString().slice(0, 7)}`);
    
    // Récupérer les logs d'erreur du mois
    const errorLogs = await firestoreHelper.queryDocuments<any>(
      'error_logs',
      [
        ['timestamp', '>=', startDate],
        ['timestamp', '<', endDate]
      ],
      { limit: 1000 }
    );

    // Récupérer les exécutions de fonctions du mois
    const functionExecutions = await firestoreHelper.queryDocuments<any>(
      'scheduled_executions',
      [
        ['executionTime', '>=', startDate],
        ['executionTime', '<', endDate]
      ]
    );

    const apiResponseTime = performanceStats?.averageResponseTime || 0;
    const totalRequests = performanceStats?.totalRequests || 1;
    const errorRate = (errorLogs.data.length / totalRequests) * 100;

    // Calculer l'uptime basé sur les erreurs critiques
    const criticalErrors = errorLogs.data.filter(log => log.severity === 'critical').length;
    const uptime = Math.max(0, 100 - (criticalErrors / Math.max(totalRequests / 100, 1)));

    return {
      apiResponseTime,
      errorRate,
      uptime,
      dataProcessed: performanceStats?.dataProcessed || 0,
      functionsExecuted: functionExecutions.data.length
    };

  } catch (error) {
    logger.error('Failed to collect performance data for monthly report', error);
    throw error;
  }
}

/**
 * Collecte les données d'impact pour le rapport mensuel
 */
async function collectImpactData(startDate: Date, endDate: Date): Promise<MonthlyReportData['impact']> {
  try {
    // Récupérer les projets avec impact documenté
    const impactfulProjects = await firestoreHelper.queryDocuments<ProjectDocument>(
      'projects',
      [
        ['status', 'in', [STATUS.PROJECT.COMPLETED, STATUS.PROJECT.ACTIVE]],
        ['impactMetrics.beneficiariesReached', '>', 0]
      ]
    );

    // Calculer les métriques d'impact agrégées
    const projectsImpacted = impactfulProjects.data.length;
    const beneficiariesReached = impactfulProjects.data.reduce(
      (sum, project) => sum + (project.impactMetrics?.beneficiariesReached || 0),
      0
    );

    // Calculer un score d'impact global
    const impactScores = impactfulProjects.data
      .map(project => project.impactMetrics?.impactScore || 0)
      .filter(score => score > 0);

    const impactScore = impactScores.length > 0 ?
      impactScores.reduce((sum, score) => sum + score, 0) / impactScores.length : 0;

    // Métriques de durabilité par catégorie
    const sustainabilityMetrics = impactfulProjects.data.reduce((metrics, project) => {
      const category = project.category;
      if (!metrics[category]) {
        metrics[category] = 0;
      }
      metrics[category] += project.impactMetrics?.sustainabilityScore || 0;
      return metrics;
    }, {} as Record<string, number>);

    // Moyenne par catégorie
    Object.keys(sustainabilityMetrics).forEach(category => {
      const categoryProjects = impactfulProjects.data.filter(p => p.category === category);
      sustainabilityMetrics[category] = categoryProjects.length > 0 ?
        sustainabilityMetrics[category] / categoryProjects.length : 0;
    });

    return {
      projectsImpacted,
      beneficiariesReached,
      impactScore,
      sustainabilityMetrics
    };

  } catch (error) {
    logger.error('Failed to collect impact data for monthly report', error);
    throw error;
  }
}

/**
 * Génère le rapport mensuel complet
 */
async function generateMonthlyReport(reportMonth: string): Promise<MonthlyReportData> {
  try {
    // Déterminer la période du rapport
    const year = parseInt(reportMonth.substring(0, 4));
    const month = parseInt(reportMonth.substring(5, 7)) - 1; // JS Date months sont 0-indexed
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 1);
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

    logger.info('Generating monthly report', {
      reportMonth,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalDays
    });

    // Collecter toutes les données en parallèle
    const [
      userData,
      projectData,
      contributionData,
      financialData,
      auditData,
      performanceData,
      impactData
    ] = await Promise.all([
      collectUserData(startDate, endDate),
      collectProjectData(startDate, endDate),
      collectContributionData(startDate, endDate),
      collectFinancialData(startDate, endDate),
      collectAuditData(startDate, endDate),
      collectPerformanceData(startDate, endDate),
      collectImpactData(startDate, endDate)
    ]);

    const reportData: MonthlyReportData = {
      month: reportMonth,
      period: {
        startDate,
        endDate,
        totalDays
      },
      users: userData,
      projects: projectData,
      contributions: contributionData,
      financial: financialData,
      audits: auditData,
      performance: performanceData,
      impact: impactData
    };

    // Sauvegarder le rapport
    await firestoreHelper.setDocument('monthly_reports', reportMonth, {
      ...reportData,
      generatedAt: new Date(),
      generatedBy: 'system',
      version: 1
    });

    logger.info('Monthly report generated successfully', {
      reportMonth,
      totalUsers: userData.totalRegistered,
      newUsers: userData.newRegistrations,
      totalProjects: projectData.totalActive,
      totalContributions: contributionData.totalCount,
      totalVolume: financialData.totalVolume,
      impactScore: impactData.impactScore
    });

    return reportData;

  } catch (error) {
    logger.error('Failed to generate monthly report', error, { reportMonth });
    throw error;
  }
}

/**
 * Envoie le rapport mensuel par email
 */
async function sendMonthlyReportEmail(reportData: MonthlyReportData): Promise<{
  adminsSent: number;
  stakeholdersSent: number;
  investorsSent: number;
  errors: number;
}> {
  try {
    const results = { adminsSent: 0, stakeholdersSent: 0, investorsSent: 0, errors: 0 };

    // Récupérer les destinataires
    const [admins, stakeholders, investors] = await Promise.all([
      // Administrateurs
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['role', 'array-contains', 'admin'],
        ['preferences.reports.monthly', '==', true]
      ]),
      
      // Stakeholders
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['role', 'array-contains', 'stakeholder'],
        ['preferences.reports.monthly', '==', true]
      ]),
      
      // Investisseurs
      firestoreHelper.queryDocuments<UserDocument>('users', [
        ['role', 'array-contains', 'investor'],
        ['preferences.reports.monthly', '==', true]
      ])
    ]);

    // Préparer les données pour l'email
    const emailData = {
      reportMonth: reportData.month,
      reportPeriod: `${reportData.period.startDate.toLocaleDateString('fr-FR')} - ${reportData.period.endDate.toLocaleDateString('fr-FR')}`,
      
      // Métriques clés
      newUsers: reportData.users.newRegistrations,
      activeUsers: reportData.users.activeUsers,
      newProjects: reportData.projects.newProjects,
      totalFunding: (reportData.financial.totalVolume / 100).toFixed(2),
      contributionsCount: reportData.contributions.totalCount,
      interestAccrued: (reportData.financial.interestAccrued / 100).toFixed(2),
      
      // Évolution
      contributionGrowth: reportData.contributions.growthRate,
      platformRevenue: (reportData.financial.netRevenue / 100).toFixed(2),
      
      // Top performers
      topProjects: reportData.projects.topPerforming.slice(0, 5),
      
      // Catégories
      categoryBreakdown: Object.entries(reportData.projects.byCategory).map(([category, data]) => ({
        category,
        count: data.count,
        funding: (data.funding / 100).toFixed(2),
        successRate: (data.successRate * 100).toFixed(1)
      })),
      
      // Impact
      impactScore: reportData.impact.impactScore.toFixed(1),
      beneficiariesReached: reportData.impact.beneficiariesReached,
      
      // Performance
      uptime: reportData.performance.uptime.toFixed(1),
      errorRate: reportData.performance.errorRate.toFixed(2),
      
      // URLs
      dashboardUrl: `${process.env.FRONTEND_URL}/admin/dashboard`,
      reportUrl: `${process.env.FRONTEND_URL}/admin/reports/monthly/${reportData.month}`,
      
      // Métadonnées
      generatedAt: new Date().toLocaleDateString('fr-FR'),
      reportId: helpers.string.generateId('report')
    };

    // Envoyer aux administrateurs
    const adminPromises = admins.data.map(async (admin) => {
      try {
        await emailService.sendEmail({
          to: admin.email,
          templateId: 'monthly_report_admin',
          dynamicTemplateData: {
            ...emailData,
            userName: `${admin.firstName} ${admin.lastName}`,
            role: 'Administrateur'
          }
        });
        results.adminsSent++;
      } catch (error) {
        logger.error('Failed to send monthly report to admin', error, { adminUid: admin.uid });
        results.errors++;
      }
    });

    // Envoyer aux stakeholders
    const stakeholderPromises = stakeholders.data.map(async (stakeholder) => {
      try {
        await emailService.sendEmail({
          to: stakeholder.email,
          templateId: 'monthly_report_stakeholder',
          dynamicTemplateData: {
            ...emailData,
            userName: `${stakeholder.firstName} ${stakeholder.lastName}`,
            role: 'Stakeholder'
          }
        });
        results.stakeholdersSent++;
      } catch (error) {
        logger.error('Failed to send monthly report to stakeholder', error, { stakeholderUid: stakeholder.uid });
        results.errors++;
      }
    });

    // Envoyer aux investisseurs (version financière détaillée)
    const investorPromises = investors.data.map(async (investor) => {
      try {
        await emailService.sendEmail({
          to: investor.email,
          templateId: 'monthly_report_investor',
          dynamicTemplateData: {
            ...emailData,
            userName: `${investor.firstName} ${investor.lastName}`,
            role: 'Investisseur',
            // Données financières supplémentaires pour investisseurs
            escrowHeld: (reportData.financial.escrowHeld / 100).toFixed(2),
            refundsProcessed: reportData.financial.refundsProcessed,
            refundAmount: (reportData.financial.refundAmount / 100).toFixed(2),
            platformFees: (reportData.financial.platformFees / 100).toFixed(2)
          }
        });
        results.investorsSent++;
      } catch (error) {
        logger.error('Failed to send monthly report to investor', error, { investorUid: investor.uid });
        results.errors++;
      }
    });

    // Attendre tous les envois
    await Promise.allSettled([
      ...adminPromises,
      ...stakeholderPromises,
      ...investorPromises
    ]);

    logger.info('Monthly reports sent via email', {
      adminsSent: results.adminsSent,
      stakeholdersSent: results.stakeholdersSent,
      investorsSent: results.investorsSent,
      totalSent: results.adminsSent + results.stakeholdersSent + results.investorsSent,
      errors: results.errors
    });

    return results;

  } catch (error) {
    logger.error('Failed to send monthly report emails', error);
    return { adminsSent: 0, stakeholdersSent: 0, investorsSent: 0, errors: 1 };
  }
}

/**
 * Met à jour les métriques de rapport
 */
async function updateReportMetrics(results: ReportGenerationResults): Promise<void> {
  try {
    // Statistiques globales
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'reports.monthlyGenerated': 1,
      'reports.totalRecipients': results.recipientsSent,
      'reports.lastGeneration': new Date(),
      'reports.processingTime': results.processingTime
    });

    // Statistiques par type de destinataire
    await firestoreHelper.incrementDocument('platform_stats', 'global', {
      'reports.emailsSent.admins': results.emailsSent.admins,
      'reports.emailsSent.stakeholders': results.emailsSent.stakeholders,
      'reports.emailsSent.investors': results.emailsSent.investors,
      'reports.emailsSent.total': results.recipientsSent
    });

    logger.info('Report metrics updated', {
      reportsGenerated: results.reportsGenerated,
      recipientsSent: results.recipientsSent,
      errors: results.errors
    });

  } catch (error) {
    logger.error('Failed to update report metrics', error);
  }
}

/**
 * Fonction principale de génération de rapport mensuel
 */
async function executeMonthlyReportGeneration(): Promise<ReportGenerationResults> {
  const batchId = helpers.string.generateId('report_batch');
  const startTime = Date.now();

  try {
    // Déterminer le mois précédent
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const reportMonth = lastMonth.toISOString().slice(0, 7);

    logger.info('Starting monthly report generation', {
      batchId,
      reportMonth,
      generationTime: now.toISOString()
    });

    // Vérifier si le rapport existe déjà
    const existingReport = await firestoreHelper.getDocument('monthly_reports', reportMonth);
    if (existingReport) {
      logger.info('Monthly report already exists', { reportMonth });
      
      return {
        reportsGenerated: 0,
        recipientsSent: 0,
        errors: 0,
        processingTime: Date.now() - startTime,
        batchId,
        reportData: existingReport as MonthlyReportData,
        emailsSent: { admins: 0, stakeholders: 0, investors: 0 }
      };
    }

    // Générer le rapport
    const reportData = await generateMonthlyReport(reportMonth);

    // Envoyer par email
    const emailResults = await sendMonthlyReportEmail(reportData);

    const results: ReportGenerationResults = {
      reportsGenerated: 1,
      recipientsSent: emailResults.adminsSent + emailResults.stakeholdersSent + emailResults.investorsSent,
      errors: emailResults.errors,
      processingTime: Date.now() - startTime,
      batchId,
      reportData,
      emailsSent: {
        admins: emailResults.adminsSent,
        stakeholders: emailResults.stakeholdersSent,
        investors: emailResults.investorsSent
      }
    };

    // Mettre à jour les métriques
    await updateReportMetrics(results);

    logger.info('Monthly report generation completed successfully', results);

    return results;

  } catch (error) {
    logger.error('Failed to execute monthly report generation', error, { batchId });
    throw error;
  }
}

/**
 * Fonction Cloud Scheduler - Génération de rapports mensuels
 */
export const generateMonthlyReports = pubsub
  .schedule('0 6 1 * *') // Le 1er de chaque mois à 6h du matin UTC
  .timeZone('Europe/Paris')
  .onRun(async (context) => {
    const executionId = helpers.string.generateId('report_exec');
    const startTime = Date.now();

    try {
      logger.info('Generate monthly reports scheduled function started', {
        executionId,
        scheduledTime: context.timestamp,
        timezone: 'Europe/Paris'
      });

      // Exécuter la génération de rapport
      const results = await executeMonthlyReportGeneration();

      // Log business
      logger.business('Monthly reports generated and distributed', 'reporting', {
        executionId,
        scheduledAt: context.timestamp,
        results,
        reportMonth: results.reportData.month,
        reportsGenerated: results.reportsGenerated,
        recipientsSent: results.recipientsSent,
        totalUsers: results.reportData.users.totalRegistered,
        totalFunding: results.reportData.financial.totalVolume,
        impactScore: results.reportData.impact.impactScore,
        timestamp: new Date().toISOString()
      });

      // Log financial pour les données financières du rapport
      logger.financial('Monthly financial summary generated', {
        executionId,
        reportMonth: results.reportData.month,
        totalVolume: results.reportData.financial.totalVolume,
        escrowHeld: results.reportData.financial.escrowHeld,
        interestAccrued: results.reportData.financial.interestAccrued,
        platformRevenue: results.reportData.financial.netRevenue,
        refundsProcessed: results.reportData.financial.refundsProcessed,
        currency: 'EUR',
        reportDate: new Date().toISOString()
      });

      // Enregistrer l'exécution réussie
      await firestoreHelper.setDocument('scheduled_executions', executionId, {
        id: executionId,
        functionName: 'generateMonthlyReports',
        executionTime: new Date(),
        duration: Date.now() - startTime,
        status: 'completed',
        results,
        nextScheduledRun: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 6, 0, 0), // Prochain 1er du mois à 6h
        createdAt: new Date()
      });

      logger.info('Generate monthly reports scheduled function completed successfully', {
        executionId,
        duration: Date.now() - startTime,
        reportsGenerated: results.reportsGenerated,
        recipientsSent: results.recipientsSent
      });

    } catch (error) {
      logger.error('Generate monthly reports scheduled function failed', error, {
        executionId,
        scheduledTime: context.timestamp,
        duration: Date.now() - startTime
      });

      // Enregistrer l'échec
      try {
        await firestoreHelper.setDocument('scheduled_executions', executionId, {
          id: executionId,
          functionName: 'generateMonthlyReports',
          executionTime: new Date(),
          duration: Date.now() - startTime,
          status: 'failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date()
          },
          retryScheduled: new Date(Date.now() + 2 * 60 * 60 * 1000), // Retry dans 2h
          createdAt: new Date()
        });
      } catch (logError) {
        logger.error('Failed to log report execution failure', logError, { executionId });
      }

      throw error;
    }
  });