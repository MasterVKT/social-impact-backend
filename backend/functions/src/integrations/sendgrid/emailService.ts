/**
 * SendGrid Email Service
 * Social Finance Impact Platform
 */

import sgMail from '@sendgrid/mail';
import { logger } from '../../utils/logger';
import { ExternalServiceError, ValidationError } from '../../utils/errors';
import { withRetry } from '../../utils/errors';
import { SendGridTypes } from '../../types/external';
import { NOTIFICATIONS } from '../../utils/constants';
import { helpers } from '../../utils/helpers';

/**
 * Configuration SendGrid
 */
const SENDGRID_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
  defaultFrom: {
    email: process.env.SENDGRID_FROM_EMAIL || 'noreply@socialimpact.fr',
    name: 'Social Impact Platform',
  },
};

/**
 * Service principal SendGrid pour l'envoi d'emails
 */
export class EmailService {
  private initialized: boolean = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialise le service SendGrid
   */
  private initialize(): void {
    const apiKey = process.env.SENDGRID_API_KEY;

    if (!apiKey) {
      throw new Error('SENDGRID_API_KEY environment variable is required');
    }

    sgMail.setApiKey(apiKey);
    
    // Configuration des timeouts et retry
    sgMail.setTimeout(SENDGRID_CONFIG.timeout);

    this.initialized = true;

    logger.info('SendGrid email service initialized', {
      fromEmail: SENDGRID_CONFIG.defaultFrom.email,
      timeout: SENDGRID_CONFIG.timeout,
    });
  }

  /**
   * Envoie un email simple
   */
  async sendEmail(params: {
    to: string | SendGridTypes.EmailAddress;
    subject: string;
    text?: string;
    html?: string;
    from?: SendGridTypes.EmailAddress;
    replyTo?: SendGridTypes.EmailAddress;
    attachments?: SendGridTypes.Attachment[];
    categories?: string[];
    customArgs?: Record<string, string>;
    templateId?: string;
    dynamicTemplateData?: Record<string, any>;
  }): Promise<SendGridTypes.SendResponse> {
    try {
      this.validateInitialization();

      const emailRequest: SendGridTypes.EmailRequest = {
        to: params.to,
        from: params.from || SENDGRID_CONFIG.defaultFrom,
        subject: params.subject,
        text: params.text,
        html: params.html,
        replyTo: params.replyTo,
        attachments: params.attachments,
        categories: params.categories || ['platform'],
        customArgs: {
          platform: 'social-impact-platform',
          sentAt: new Date().toISOString(),
          ...params.customArgs,
        },
        trackingSettings: {
          clickTracking: { enable: true },
          openTracking: { enable: true },
        },
      };

      // Utilisation de template dynamique si spécifié
      if (params.templateId) {
        emailRequest.templateId = params.templateId;
        emailRequest.dynamicTemplateData = params.dynamicTemplateData;
        // Supprimer text/html lors de l'utilisation de templates
        delete emailRequest.text;
        delete emailRequest.html;
      }

      const response = await withRetry(
        () => sgMail.send(emailRequest),
        SENDGRID_CONFIG.maxRetries,
        1000
      );

      const sendResponse = response[0];

      logger.info('Email sent successfully', {
        to: typeof params.to === 'string' ? params.to : params.to.email,
        subject: params.subject,
        templateId: params.templateId,
        messageId: sendResponse.headers?.['x-message-id'],
        statusCode: sendResponse.statusCode,
      });

      return sendResponse;

    } catch (error) {
      logger.error('Failed to send email', error, {
        to: typeof params.to === 'string' ? params.to : params.to.email,
        subject: params.subject,
        templateId: params.templateId,
      });

      throw new ExternalServiceError('SendGrid', error);
    }
  }

  /**
   * Envoie un email avec template
   */
  async sendTemplateEmail(params: {
    to: string | SendGridTypes.EmailAddress;
    templateId: string;
    dynamicTemplateData: Record<string, any>;
    from?: SendGridTypes.EmailAddress;
    categories?: string[];
    customArgs?: Record<string, string>;
  }): Promise<SendGridTypes.SendResponse> {
    return this.sendEmail({
      ...params,
      subject: '', // Géré par le template
      templateId: params.templateId,
      dynamicTemplateData: params.dynamicTemplateData,
    });
  }

  /**
   * Envoie des emails en lot
   */
  async sendBulkEmails(
    emails: Array<{
      to: SendGridTypes.EmailAddress;
      subject: string;
      text?: string;
      html?: string;
      templateId?: string;
      dynamicTemplateData?: Record<string, any>;
      customArgs?: Record<string, string>;
    }>,
    globalSettings?: {
      from?: SendGridTypes.EmailAddress;
      categories?: string[];
      batchId?: string;
    }
  ): Promise<SendGridTypes.SendResponse[]> {
    try {
      this.validateInitialization();

      // Traitement par lots pour éviter les limites de taux
      const batchSize = 100;
      const results: SendGridTypes.SendResponse[] = [];

      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        
        const batchPromises = batch.map(email => {
          return this.sendEmail({
            ...email,
            from: globalSettings?.from,
            categories: globalSettings?.categories,
            customArgs: {
              batchId: globalSettings?.batchId || `batch_${Date.now()}`,
              ...email.customArgs,
            },
          });
        });

        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            logger.error('Failed to send bulk email', result.reason, {
              emailIndex: i + index,
              to: batch[index].to.email,
            });
          }
        });

        // Pause entre les lots pour respecter les limites
        if (i + batchSize < emails.length) {
          await helpers.async.delay(100);
        }
      }

      logger.info('Bulk emails sent', {
        totalEmails: emails.length,
        successfulSends: results.length,
        batchId: globalSettings?.batchId,
      });

      return results;

    } catch (error) {
      logger.error('Failed to send bulk emails', error, {
        emailCount: emails.length,
      });

      throw new ExternalServiceError('SendGrid', error);
    }
  }

  /**
   * Envoie un email de bienvenue
   */
  async sendWelcomeEmail(params: {
    to: string;
    firstName: string;
    userType: 'contributor' | 'creator';
    kycRequired: boolean;
    profileUrl: string;
  }): Promise<SendGridTypes.SendResponse> {
    const templateData: SendGridTypes.WelcomeEmailData = {
      firstName: params.firstName,
      userType: params.userType,
      kycRequired: params.kycRequired,
      profileUrl: params.profileUrl,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId: NOTIFICATIONS.EMAIL_TEMPLATES.WELCOME,
      dynamicTemplateData: templateData,
      categories: ['welcome', 'onboarding'],
      customArgs: {
        userType: params.userType,
        flow: 'registration',
      },
    });
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
    supportUrl: string;
  }): Promise<SendGridTypes.SendResponse> {
    const templateId = params.status === 'approved' 
      ? NOTIFICATIONS.EMAIL_TEMPLATES.KYC_APPROVED
      : NOTIFICATIONS.EMAIL_TEMPLATES.KYC_REJECTED;

    const templateData: SendGridTypes.KYCStatusEmailData = {
      firstName: params.firstName,
      status: params.status,
      rejectionReason: params.rejectionReason,
      nextSteps: params.nextSteps,
      supportUrl: params.supportUrl,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId,
      dynamicTemplateData: templateData,
      categories: ['kyc', 'verification'],
      customArgs: {
        kycStatus: params.status,
        flow: 'kyc_update',
      },
    });
  }

  /**
   * Envoie un reçu de contribution
   */
  async sendContributionReceipt(params: {
    to: string;
    contributorName: string;
    projectTitle: string;
    amount: number;
    currency: string;
    contributionDate: string;
    receiptNumber: string;
    projectUrl: string;
    receiptUrl: string;
  }): Promise<SendGridTypes.SendResponse> {
    const templateData: SendGridTypes.ContributionReceiptEmailData = {
      contributorName: params.contributorName,
      projectTitle: params.projectTitle,
      amount: params.amount,
      currency: params.currency,
      contributionDate: params.contributionDate,
      receiptNumber: params.receiptNumber,
      projectUrl: params.projectUrl,
      receiptUrl: params.receiptUrl,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId: NOTIFICATIONS.EMAIL_TEMPLATES.CONTRIBUTION_RECEIPT,
      dynamicTemplateData: templateData,
      categories: ['contribution', 'receipt'],
      customArgs: {
        receiptNumber: params.receiptNumber,
        flow: 'contribution_confirmation',
      },
    });
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
    unsubscribeUrl: string;
  }): Promise<SendGridTypes.SendResponse> {
    const templateData: SendGridTypes.ProjectUpdateEmailData = {
      contributorName: params.contributorName,
      projectTitle: params.projectTitle,
      creatorName: params.creatorName,
      updateTitle: params.updateTitle,
      updateMessage: params.updateMessage,
      projectUrl: params.projectUrl,
      unsubscribeUrl: params.unsubscribeUrl,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId: 'project-update-template', // À définir dans les constantes
      dynamicTemplateData: templateData,
      categories: ['project_update', 'notification'],
      customArgs: {
        projectUpdate: 'true',
        flow: 'project_communication',
      },
    });
  }

  /**
   * Envoie une notification de milestone complétée
   */
  async sendMilestoneCompletedEmail(params: {
    to: string;
    contributorName: string;
    projectTitle: string;
    milestoneTitle: string;
    completionDate: string;
    impactMetrics: Record<string, any>;
    projectUrl: string;
    certificateUrl?: string;
  }): Promise<SendGridTypes.SendResponse> {
    const templateData: SendGridTypes.MilestoneCompletedEmailData = {
      contributorName: params.contributorName,
      projectTitle: params.projectTitle,
      milestoneTitle: params.milestoneTitle,
      completionDate: params.completionDate,
      impactMetrics: params.impactMetrics,
      projectUrl: params.projectUrl,
      certificateUrl: params.certificateUrl,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId: NOTIFICATIONS.EMAIL_TEMPLATES.MILESTONE_COMPLETED,
      dynamicTemplateData: templateData,
      categories: ['milestone', 'impact'],
      customArgs: {
        milestoneCompleted: 'true',
        flow: 'impact_notification',
      },
    });
  }

  /**
   * Envoie une assignation d'audit
   */
  async sendAuditAssignmentEmail(params: {
    to: string;
    auditorName: string;
    projectTitle: string;
    creatorName: string;
    deadline: string;
    compensation: number;
    auditUrl: string;
    projectDetails: {
      category: string;
      fundingGoal: number;
      description: string;
    };
  }): Promise<SendGridTypes.SendResponse> {
    const templateData: SendGridTypes.AuditAssignmentEmailData = {
      auditorName: params.auditorName,
      projectTitle: params.projectTitle,
      creatorName: params.creatorName,
      deadline: params.deadline,
      compensation: params.compensation,
      auditUrl: params.auditUrl,
      projectDetails: params.projectDetails,
    };

    return this.sendTemplateEmail({
      to: params.to,
      templateId: NOTIFICATIONS.EMAIL_TEMPLATES.AUDIT_ASSIGNMENT,
      dynamicTemplateData: templateData,
      categories: ['audit', 'assignment'],
      customArgs: {
        auditAssignment: 'true',
        flow: 'audit_workflow',
      },
    });
  }

  /**
   * Envoie un email de réinitialisation de mot de passe
   */
  async sendPasswordResetEmail(params: {
    to: string;
    resetUrl: string;
    expirationTime: string;
  }): Promise<SendGridTypes.SendResponse> {
    return this.sendTemplateEmail({
      to: params.to,
      templateId: NOTIFICATIONS.EMAIL_TEMPLATES.PASSWORD_RESET,
      dynamicTemplateData: {
        resetUrl: params.resetUrl,
        expirationTime: params.expirationTime,
      },
      categories: ['password_reset', 'security'],
      customArgs: {
        passwordReset: 'true',
        flow: 'password_recovery',
      },
    });
  }

  /**
   * Valide une adresse email
   */
  validateEmail(email: string): boolean {
    return helpers.validation.isValidEmail(email);
  }

  /**
   * Traite un webhook SendGrid
   */
  parseWebhookEvents(payload: string): SendGridTypes.WebhookEvent[] {
    try {
      const events = JSON.parse(payload) as SendGridTypes.WebhookEvent[];
      
      if (!Array.isArray(events)) {
        throw new ValidationError('Invalid SendGrid webhook payload: expected array');
      }

      logger.debug('SendGrid webhook events parsed', {
        eventCount: events.length,
        eventTypes: [...new Set(events.map(e => e.event))],
      });

      return events;

    } catch (error) {
      logger.error('Failed to parse SendGrid webhook events', error);
      throw new ValidationError('Invalid SendGrid webhook payload');
    }
  }

  /**
   * Obtient les statistiques d'email
   */
  async getEmailStats(params: {
    startDate: string;
    endDate: string;
    categories?: string[];
  }): Promise<any> {
    try {
      // Note: SendGrid stats API nécessiterait une implémentation séparée
      // Cette méthode est un placeholder pour les futures statistiques
      
      logger.info('Email stats requested', {
        startDate: params.startDate,
        endDate: params.endDate,
        categories: params.categories,
      });

      return {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0,
      };

    } catch (error) {
      logger.error('Failed to get email stats', error, params);
      throw new ExternalServiceError('SendGrid', error);
    }
  }

  /**
   * Vérifie l'initialisation du service
   */
  private validateInitialization(): void {
    if (!this.initialized) {
      throw new Error('EmailService not properly initialized');
    }
  }
}

/**
 * Instance globale du service email
 */
export const emailService = new EmailService();

/**
 * Utilitaires pour SendGrid
 */
export namespace EmailUtils {
  /**
   * Formate une adresse email
   */
  export function formatEmailAddress(email: string, name?: string): SendGridTypes.EmailAddress {
    return { email, name };
  }

  /**
   * Génère un ID de batch unique
   */
  export function generateBatchId(prefix: string = 'batch'): string {
    return helpers.string.generateId(prefix);
  }

  /**
   * Extrait les catégories d'un type de notification
   */
  export function getCategoriesForNotificationType(type: string): string[] {
    const categoryMap: Record<string, string[]> = {
      'welcome': ['welcome', 'onboarding'],
      'kyc': ['kyc', 'verification'],
      'contribution': ['contribution', 'payment'],
      'project': ['project', 'update'],
      'audit': ['audit', 'workflow'],
      'system': ['system', 'notification'],
    };

    return categoryMap[type] || ['platform'];
  }

  /**
   * Valide les données de template
   */
  export function validateTemplateData(
    templateId: string,
    data: Record<string, any>
  ): { valid: boolean; missingFields: string[] } {
    const requiredFields: Record<string, string[]> = {
      [NOTIFICATIONS.EMAIL_TEMPLATES.WELCOME]: ['firstName', 'userType'],
      [NOTIFICATIONS.EMAIL_TEMPLATES.KYC_APPROVED]: ['firstName'],
      [NOTIFICATIONS.EMAIL_TEMPLATES.KYC_REJECTED]: ['firstName', 'rejectionReason'],
      [NOTIFICATIONS.EMAIL_TEMPLATES.CONTRIBUTION_RECEIPT]: [
        'contributorName', 'projectTitle', 'amount', 'receiptNumber'
      ],
    };

    const required = requiredFields[templateId] || [];
    const missingFields = required.filter(field => !data[field]);

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Nettoie les données HTML pour l'email
   */
  export function sanitizeHtmlContent(html: string): string {
    return helpers.string.escapeHtml(html);
  }

  /**
   * Génère un URL de désabonnement
   */
  export function generateUnsubscribeUrl(
    userEmail: string,
    category: string,
    baseUrl: string = process.env.FRONTEND_URL || 'https://socialimpact.fr'
  ): string {
    const token = helpers.security.generateSecureToken(16);
    return `${baseUrl}/unsubscribe?email=${encodeURIComponent(userEmail)}&category=${category}&token=${token}`;
  }
}