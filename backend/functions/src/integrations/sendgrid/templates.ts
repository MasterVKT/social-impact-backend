/**
 * SendGrid Email Templates Management
 * Social Finance Impact Platform
 */

import { logger } from '../../utils/logger';
import { emailService } from './emailService';
import { SendGridTypes } from '../../types/external';
import { NOTIFICATIONS } from '../../utils/constants';
import { helpers } from '../../utils/helpers';

/**
 * Types pour les données de templates
 */
export interface TemplateDataBase {
  recipientName: string;
  platformName: string;
  platformUrl: string;
  supportEmail: string;
  unsubscribeUrl?: string;
}

export interface WelcomeTemplateData extends TemplateDataBase {
  userType: 'contributor' | 'creator';
  profileUrl: string;
  kycRequired: boolean;
  nextSteps: string[];
}

export interface KYCTemplateData extends TemplateDataBase {
  status: 'approved' | 'rejected' | 'requires_action';
  rejectionReason?: string;
  nextSteps?: string;
  kycUrl?: string;
  supportUrl: string;
}

export interface ContributionTemplateData extends TemplateDataBase {
  projectTitle: string;
  amount: number;
  currency: string;
  contributionDate: string;
  receiptNumber: string;
  projectUrl: string;
  receiptUrl: string;
  impactEstimate?: string;
}

export interface ProjectUpdateTemplateData extends TemplateDataBase {
  projectTitle: string;
  creatorName: string;
  updateTitle: string;
  updateMessage: string;
  projectUrl: string;
  updateDate: string;
}

export interface MilestoneTemplateData extends TemplateDataBase {
  projectTitle: string;
  milestoneTitle: string;
  completionDate: string;
  impactMetrics: {
    beneficiariesReached?: number;
    environmentalImpact?: string;
    socialImpact?: string;
    [key: string]: any;
  };
  projectUrl: string;
  certificateUrl?: string;
}

export interface AuditTemplateData extends TemplateDataBase {
  projectTitle: string;
  creatorName: string;
  deadline: string;
  compensation: number;
  auditUrl: string;
  projectCategory: string;
  projectDescription: string;
}

/**
 * Service de gestion des templates email
 */
export class EmailTemplateService {
  
  /**
   * Données par défaut pour tous les templates
   */
  private getBaseTemplateData(): TemplateDataBase {
    return {
      recipientName: '', // À remplir par l'appelant
      platformName: 'Social Impact Platform',
      platformUrl: process.env.FRONTEND_URL || 'https://socialimpact.fr',
      supportEmail: 'support@socialimpact.fr',
    };
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(params: {
    to: string;
    firstName: string;
    userType: 'contributor' | 'creator';
    kycRequired: boolean;
  }): Promise<void> {
    try {
      const templateData: WelcomeTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.firstName,
        userType: params.userType,
        profileUrl: `${process.env.FRONTEND_URL}/profile`,
        kycRequired: params.kycRequired,
        nextSteps: this.getWelcomeNextSteps(params.userType, params.kycRequired),
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: NOTIFICATIONS.EMAIL_TEMPLATES.WELCOME,
        dynamicTemplateData: templateData,
        categories: ['welcome', 'onboarding'],
        customArgs: {
          userType: params.userType,
          kycRequired: params.kycRequired.toString(),
        },
      });

      logger.info('Welcome email sent', {
        to: params.to,
        userType: params.userType,
        kycRequired: params.kycRequired,
      });

    } catch (error) {
      logger.error('Failed to send welcome email', error, { to: params.to });
      throw error;
    }
  }

  /**
   * Envoie un email de statut KYC
   */
  async sendKYCStatusEmail(params: {
    to: string;
    firstName: string;
    status: 'approved' | 'rejected' | 'requires_action';
    rejectionReason?: string;
    nextSteps?: string;
  }): Promise<void> {
    try {
      const templateData: KYCTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.firstName,
        status: params.status,
        rejectionReason: params.rejectionReason,
        nextSteps: params.nextSteps || this.getKYCNextSteps(params.status),
        kycUrl: `${process.env.FRONTEND_URL}/kyc`,
        supportUrl: `${process.env.FRONTEND_URL}/support`,
      };

      const templateId = params.status === 'approved' 
        ? NOTIFICATIONS.EMAIL_TEMPLATES.KYC_APPROVED
        : NOTIFICATIONS.EMAIL_TEMPLATES.KYC_REJECTED;

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId,
        dynamicTemplateData: templateData,
        categories: ['kyc', 'verification'],
        customArgs: {
          kycStatus: params.status,
          hasRejectionReason: !!params.rejectionReason,
        },
      });

      logger.info('KYC status email sent', {
        to: params.to,
        status: params.status,
        hasRejectionReason: !!params.rejectionReason,
      });

    } catch (error) {
      logger.error('Failed to send KYC status email', error, {
        to: params.to,
        status: params.status,
      });
      throw error;
    }
  }

  /**
   * Envoie un reçu de contribution
   */
  async sendContributionReceipt(params: {
    to: string;
    contributorName: string;
    projectTitle: string;
    amount: number;
    contributionDate: string;
    receiptNumber: string;
    projectUrl: string;
    receiptUrl: string;
    impactEstimate?: string;
  }): Promise<void> {
    try {
      const templateData: ContributionTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.contributorName,
        projectTitle: params.projectTitle,
        amount: params.amount,
        currency: 'EUR',
        contributionDate: params.contributionDate,
        receiptNumber: params.receiptNumber,
        projectUrl: params.projectUrl,
        receiptUrl: params.receiptUrl,
        impactEstimate: params.impactEstimate || this.generateImpactEstimate(params.amount),
        unsubscribeUrl: this.generateUnsubscribeUrl(params.to, 'contribution'),
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: NOTIFICATIONS.EMAIL_TEMPLATES.CONTRIBUTION_RECEIPT,
        dynamicTemplateData: templateData,
        categories: ['contribution', 'receipt'],
        customArgs: {
          receiptNumber: params.receiptNumber,
          amount: params.amount.toString(),
        },
      });

      logger.info('Contribution receipt sent', {
        to: params.to,
        amount: params.amount,
        receiptNumber: params.receiptNumber,
      });

    } catch (error) {
      logger.error('Failed to send contribution receipt', error, {
        to: params.to,
        receiptNumber: params.receiptNumber,
      });
      throw error;
    }
  }

  /**
   * Envoie une mise à jour de projet
   */
  async sendProjectUpdate(params: {
    to: string;
    contributorName: string;
    projectTitle: string;
    creatorName: string;
    updateTitle: string;
    updateMessage: string;
    projectUrl: string;
  }): Promise<void> {
    try {
      const templateData: ProjectUpdateTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.contributorName,
        projectTitle: params.projectTitle,
        creatorName: params.creatorName,
        updateTitle: params.updateTitle,
        updateMessage: this.truncateMessage(params.updateMessage, 500),
        projectUrl: params.projectUrl,
        updateDate: helpers.date.formatFrench(new Date()),
        unsubscribeUrl: this.generateUnsubscribeUrl(params.to, 'project_updates'),
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: 'project-update-template', // À ajouter aux constantes
        dynamicTemplateData: templateData,
        categories: ['project_update', 'notification'],
        customArgs: {
          projectTitle: params.projectTitle,
          creatorName: params.creatorName,
        },
      });

      logger.info('Project update email sent', {
        to: params.to,
        projectTitle: params.projectTitle,
        updateTitle: params.updateTitle,
      });

    } catch (error) {
      logger.error('Failed to send project update email', error, {
        to: params.to,
        projectTitle: params.projectTitle,
      });
      throw error;
    }
  }

  /**
   * Envoie une notification de milestone complétée
   */
  async sendMilestoneCompleted(params: {
    to: string;
    contributorName: string;
    projectTitle: string;
    milestoneTitle: string;
    completionDate: string;
    impactMetrics: Record<string, any>;
    projectUrl: string;
    certificateUrl?: string;
  }): Promise<void> {
    try {
      const templateData: MilestoneTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.contributorName,
        projectTitle: params.projectTitle,
        milestoneTitle: params.milestoneTitle,
        completionDate: params.completionDate,
        impactMetrics: this.formatImpactMetrics(params.impactMetrics),
        projectUrl: params.projectUrl,
        certificateUrl: params.certificateUrl,
        unsubscribeUrl: this.generateUnsubscribeUrl(params.to, 'milestone_updates'),
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: NOTIFICATIONS.EMAIL_TEMPLATES.MILESTONE_COMPLETED,
        dynamicTemplateData: templateData,
        categories: ['milestone', 'impact'],
        customArgs: {
          projectTitle: params.projectTitle,
          milestoneTitle: params.milestoneTitle,
          hasCertificate: !!params.certificateUrl,
        },
      });

      logger.info('Milestone completed email sent', {
        to: params.to,
        projectTitle: params.projectTitle,
        milestoneTitle: params.milestoneTitle,
      });

    } catch (error) {
      logger.error('Failed to send milestone completed email', error, {
        to: params.to,
        projectTitle: params.projectTitle,
      });
      throw error;
    }
  }

  /**
   * Envoie une assignation d'audit
   */
  async sendAuditAssignment(params: {
    to: string;
    auditorName: string;
    projectTitle: string;
    creatorName: string;
    deadline: string;
    compensation: number;
    auditUrl: string;
    projectCategory: string;
    projectDescription: string;
  }): Promise<void> {
    try {
      const templateData: AuditTemplateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.auditorName,
        projectTitle: params.projectTitle,
        creatorName: params.creatorName,
        deadline: params.deadline,
        compensation: params.compensation,
        auditUrl: params.auditUrl,
        projectCategory: params.projectCategory,
        projectDescription: this.truncateMessage(params.projectDescription, 300),
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: NOTIFICATIONS.EMAIL_TEMPLATES.AUDIT_ASSIGNMENT,
        dynamicTemplateData: templateData,
        categories: ['audit', 'assignment'],
        customArgs: {
          projectTitle: params.projectTitle,
          compensation: params.compensation.toString(),
          projectCategory: params.projectCategory,
        },
      });

      logger.info('Audit assignment email sent', {
        to: params.to,
        projectTitle: params.projectTitle,
        compensation: params.compensation,
      });

    } catch (error) {
      logger.error('Failed to send audit assignment email', error, {
        to: params.to,
        projectTitle: params.projectTitle,
      });
      throw error;
    }
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   */
  async sendPasswordReset(params: {
    to: string;
    resetUrl: string;
    expirationHours: number;
  }): Promise<void> {
    try {
      const templateData = {
        ...this.getBaseTemplateData(),
        recipientName: 'Utilisateur', // Nom générique pour sécurité
        resetUrl: params.resetUrl,
        expirationTime: `${params.expirationHours} heures`,
        securityTip: 'Si vous n\'avez pas demandé cette réinitialisation, ignorez ce message.',
      };

      await emailService.sendTemplateEmail({
        to: params.to,
        templateId: NOTIFICATIONS.EMAIL_TEMPLATES.PASSWORD_RESET,
        dynamicTemplateData: templateData,
        categories: ['password_reset', 'security'],
        customArgs: {
          expirationHours: params.expirationHours.toString(),
        },
      });

      logger.info('Password reset email sent', { to: params.to });

    } catch (error) {
      logger.error('Failed to send password reset email', error, { to: params.to });
      throw error;
    }
  }

  /**
   * Envoie un email de notification système
   */
  async sendSystemNotification(params: {
    to: string;
    recipientName: string;
    subject: string;
    message: string;
    actionUrl?: string;
    actionText?: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
  }): Promise<void> {
    try {
      const templateData = {
        ...this.getBaseTemplateData(),
        recipientName: params.recipientName,
        subject: params.subject,
        message: params.message,
        actionUrl: params.actionUrl,
        actionText: params.actionText || 'Voir plus',
        priority: params.priority,
        priorityLabel: this.getPriorityLabel(params.priority),
      };

      await emailService.sendEmail({
        to: params.to,
        subject: params.subject,
        templateId: 'system-notification-template', // Template générique système
        dynamicTemplateData: templateData,
        categories: ['system', 'notification'],
        customArgs: {
          priority: params.priority,
          hasAction: !!params.actionUrl,
        },
      });

      logger.info('System notification sent', {
        to: params.to,
        subject: params.subject,
        priority: params.priority,
      });

    } catch (error) {
      logger.error('Failed to send system notification', error, {
        to: params.to,
        subject: params.subject,
      });
      throw error;
    }
  }

  /**
   * Obtient les prochaines étapes pour l'email de bienvenue
   */
  private getWelcomeNextSteps(userType: string, kycRequired: boolean): string[] {
    const steps: string[] = [];

    if (kycRequired) {
      steps.push('Complétez votre vérification d\'identité (KYC)');
    }

    if (userType === 'creator') {
      steps.push('Créez votre premier projet d\'impact');
      steps.push('Définissez vos objectifs de financement');
    } else {
      steps.push('Explorez les projets disponibles');
      steps.push('Faites votre première contribution');
    }

    steps.push('Personnalisez votre profil');
    
    return steps;
  }

  /**
   * Obtient les prochaines étapes selon le statut KYC
   */
  private getKYCNextSteps(status: string): string {
    switch (status) {
      case 'approved':
        return 'Votre compte est maintenant entièrement vérifié. Vous pouvez contribuer sans limite.';
      case 'rejected':
        return 'Veuillez soumettre de nouveaux documents ou contacter le support pour assistance.';
      case 'requires_action':
        return 'Des informations supplémentaires sont requises pour finaliser votre vérification.';
      default:
        return 'Votre vérification est en cours de traitement.';
    }
  }

  /**
   * Génère une estimation d'impact basée sur le montant
   */
  private generateImpactEstimate(amount: number): string {
    const euros = helpers.amount.centsToEuros(amount);
    
    if (euros >= 100) {
      return `Votre contribution de ${euros}€ peut aider directement plusieurs bénéficiaires.`;
    } else if (euros >= 50) {
      return `Avec ${euros}€, vous contribuez significativement à l'impact du projet.`;
    } else {
      return `Votre contribution de ${euros}€ fait partie d'un impact collectif important.`;
    }
  }

  /**
   * Formate les métriques d'impact pour l'affichage
   */
  private formatImpactMetrics(metrics: Record<string, any>): any {
    const formatted: any = {};

    if (metrics.beneficiariesReached) {
      formatted.beneficiariesReached = metrics.beneficiariesReached;
    }

    if (metrics.environmentalImpact) {
      formatted.environmentalImpact = metrics.environmentalImpact;
    }

    if (metrics.socialImpact) {
      formatted.socialImpact = metrics.socialImpact;
    }

    // Ajouter d'autres métriques formatées
    Object.keys(metrics).forEach(key => {
      if (!formatted[key] && metrics[key]) {
        formatted[key] = metrics[key];
      }
    });

    return formatted;
  }

  /**
   * Tronque un message pour l'email
   */
  private truncateMessage(message: string, maxLength: number): string {
    if (message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength - 3) + '...';
  }

  /**
   * Génère un URL de désabonnement
   */
  private generateUnsubscribeUrl(email: string, category: string): string {
    const baseUrl = process.env.FRONTEND_URL || 'https://socialimpact.fr';
    const token = helpers.security.generateSecureToken(16);
    return `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&category=${category}&token=${token}`;
  }

  /**
   * Obtient le label de priorité
   */
  private getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      'low': 'Information',
      'medium': 'Important',
      'high': 'Urgent',
      'urgent': 'Critique',
    };
    return labels[priority] || 'Information';
  }

  /**
   * Valide les données de template avant envoi
   */
  validateTemplateData<T extends TemplateDataBase>(
    templateType: string,
    data: T
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validations communes
    if (!data.recipientName?.trim()) {
      errors.push('recipientName is required');
    }

    if (!data.platformName?.trim()) {
      errors.push('platformName is required');
    }

    if (!data.platformUrl?.trim()) {
      errors.push('platformUrl is required');
    }

    // Validations spécifiques par type
    switch (templateType) {
      case 'welcome':
        const welcomeData = data as WelcomeTemplateData;
        if (!welcomeData.userType) {
          errors.push('userType is required for welcome template');
        }
        if (!welcomeData.profileUrl) {
          errors.push('profileUrl is required for welcome template');
        }
        break;

      case 'contribution':
        const contributionData = data as ContributionTemplateData;
        if (!contributionData.projectTitle) {
          errors.push('projectTitle is required for contribution template');
        }
        if (!contributionData.amount || contributionData.amount <= 0) {
          errors.push('valid amount is required for contribution template');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Instance globale du service de templates
 */
export const emailTemplateService = new EmailTemplateService();

/**
 * Utilitaires pour les templates
 */
export namespace TemplateUtils {
  /**
   * Formate un montant pour l'affichage dans les emails
   */
  export function formatCurrency(amount: number, currency: string = 'EUR'): string {
    return helpers.amount.formatEuros(amount);
  }

  /**
   * Formate une date pour l'affichage français dans les emails
   */
  export function formatDate(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return helpers.date.formatFrench(dateObj);
  }

  /**
   * Génère un ID de suivi pour les emails
   */
  export function generateTrackingId(prefix: string = 'email'): string {
    return helpers.string.generateId(prefix);
  }

  /**
   * Nettoie le contenu HTML pour éviter les injections
   */
  export function sanitizeHtmlContent(html: string): string {
    return helpers.string.escapeHtml(html);
  }

  /**
   * Génère des métadonnées pour le suivi des emails
   */
  export function generateEmailMetadata(params: {
    templateType: string;
    recipientId?: string;
    campaignId?: string;
    [key: string]: any;
  }): Record<string, string> {
    return {
      templateType: params.templateType,
      sentAt: new Date().toISOString(),
      platform: 'social-impact-platform',
      ...Object.fromEntries(
        Object.entries(params)
          .filter(([_, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)])
      ),
    };
  }
}