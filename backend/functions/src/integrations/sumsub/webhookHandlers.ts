/**
 * Sumsub Webhook Handlers
 * Social Finance Impact Platform
 */

import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { emailService } from '../sendgrid/emailService';
import { sumsubService, SumsubUtils } from './sumsubService';
import { authHelper } from '../../utils/auth';
import { ExternalServiceError, NotFoundError } from '../../utils/errors';
import { SumsubTypes } from '../../types/external';
import { UserDocument } from '../../types/firestore';
import { helpers } from '../../utils/helpers';
import { STATUS, KYC_CONFIG } from '../../utils/constants';

/**
 * Interface pour le contexte de traitement des webhooks Sumsub
 */
interface SumsubWebhookContext {
  applicantId: string;
  externalUserId: string;
  type: string;
  reviewStatus: string;
  sandboxMode: boolean;
  retryAttempt?: number;
}

/**
 * Classe principale pour gérer les webhooks Sumsub
 */
export class SumsubWebhookHandlers {
  
  /**
   * Traite un événement webhook Sumsub
   */
  async processWebhookEvent(webhookData: SumsubTypes.WebhookData): Promise<void> {
    const context: SumsubWebhookContext = {
      applicantId: webhookData.applicantId,
      externalUserId: webhookData.externalUserId,
      type: webhookData.type,
      reviewStatus: webhookData.reviewStatus,
      sandboxMode: webhookData.sandboxMode,
    };

    logger.info('Processing Sumsub webhook event', context);

    try {
      switch (webhookData.type) {
        case 'applicantReviewed':
          await this.handleApplicantReviewed(webhookData, context);
          break;

        case 'applicantPending':
          await this.handleApplicantPending(webhookData, context);
          break;

        case 'applicantCreated':
          await this.handleApplicantCreated(webhookData, context);
          break;

        case 'applicantOnHold':
          await this.handleApplicantOnHold(webhookData, context);
          break;

        case 'applicantActionPending':
          await this.handleApplicantActionPending(webhookData, context);
          break;

        case 'applicantLevelChanged':
          await this.handleApplicantLevelChanged(webhookData, context);
          break;

        default:
          logger.warn('Unhandled Sumsub webhook event type', {
            type: webhookData.type,
            applicantId: webhookData.applicantId,
          });
      }

      logger.info('Sumsub webhook event processed successfully', context);

    } catch (error) {
      logger.error('Failed to process Sumsub webhook event', error, context);
      throw error;
    }
  }

  /**
   * Traite la review complète d'un applicant
   */
  private async handleApplicantReviewed(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const reviewResult = webhookData.reviewResult;

    if (!reviewResult) {
      throw new Error('Missing reviewResult in applicantReviewed webhook');
    }

    logger.info('Handling applicantReviewed', {
      applicantId: webhookData.applicantId,
      reviewAnswer: reviewResult.reviewAnswer,
      reviewStatus: webhookData.reviewStatus,
    });

    // Extraire l'UID utilisateur depuis l'externalUserId
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    try {
      // Récupérer l'utilisateur
      const user = await firestoreHelper.getDocument<UserDocument>('users', userId);

      // Mapper le statut KYC
      const kycStatus = SumsubUtils.mapReviewStatus(
        webhookData.reviewStatus,
        reviewResult.reviewAnswer
      );

      // Déterminer le niveau KYC
      const kycLevel = SumsubUtils.mapKYCLevel(webhookData.levelName);

      // Mettre à jour le profil utilisateur
      await this.updateUserKYCStatus({
        userId,
        kycStatus,
        kycLevel,
        applicantId: webhookData.applicantId,
        reviewResult,
        levelName: webhookData.levelName,
      });

      // Mettre à jour les Custom Claims Firebase Auth si approuvé
      if (kycStatus === STATUS.KYC.APPROVED) {
        await this.updateAuthClaims(userId, kycLevel);
      }

      // Envoyer une notification par email
      await this.sendKYCStatusNotification({
        user,
        kycStatus,
        kycLevel,
        reviewResult,
      });

      // Log d'audit sécurité
      logger.security('KYC status updated', 'medium', {
        userId,
        previousStatus: user.kyc.status,
        newStatus: kycStatus,
        kycLevel,
        reviewAnswer: reviewResult.reviewAnswer,
        applicantId: webhookData.applicantId,
      });

    } catch (error) {
      logger.error('Failed to process applicant review', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Traite un applicant en attente de review
   */
  private async handleApplicantPending(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    logger.info('Handling applicantPending', {
      applicantId: webhookData.applicantId,
      userId,
    });

    try {
      await this.updateUserKYCStatus({
        userId,
        kycStatus: STATUS.KYC.PENDING,
        applicantId: webhookData.applicantId,
        levelName: webhookData.levelName,
        submittedAt: new Date(),
      });

      // Notifier l'utilisateur que sa soumission est en cours de review
      await this.notifyKYCSubmitted(userId);

    } catch (error) {
      logger.error('Failed to process applicant pending', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Traite la création d'un applicant
   */
  private async handleApplicantCreated(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    logger.info('Handling applicantCreated', {
      applicantId: webhookData.applicantId,
      userId,
      levelName: webhookData.levelName,
    });

    try {
      // Mettre à jour les informations Sumsub dans le profil
      await firestoreHelper.updateDocument('users', userId, {
        'kyc.provider': 'sumsub',
        'kyc.externalId': webhookData.applicantId,
        'kyc.levelName': webhookData.levelName,
        updatedAt: new Date(),
      });

    } catch (error) {
      logger.error('Failed to process applicant created', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Traite un applicant mis en attente
   */
  private async handleApplicantOnHold(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    logger.info('Handling applicantOnHold', {
      applicantId: webhookData.applicantId,
      userId,
    });

    try {
      await this.updateUserKYCStatus({
        userId,
        kycStatus: STATUS.KYC.REQUIRES_ACTION,
        applicantId: webhookData.applicantId,
        levelName: webhookData.levelName,
      });

      // Notifier l'utilisateur qu'une action est requise
      await this.notifyKYCOnHold(userId, 'Additional verification required');

    } catch (error) {
      logger.error('Failed to process applicant on hold', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Traite un applicant nécessitant une action
   */
  private async handleApplicantActionPending(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    logger.info('Handling applicantActionPending', {
      applicantId: webhookData.applicantId,
      userId,
    });

    try {
      await this.updateUserKYCStatus({
        userId,
        kycStatus: STATUS.KYC.REQUIRES_ACTION,
        applicantId: webhookData.applicantId,
        levelName: webhookData.levelName,
      });

      // Notifier l'utilisateur qu'une action spécifique est requise
      await this.notifyKYCActionRequired(userId);

    } catch (error) {
      logger.error('Failed to process applicant action pending', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Traite un changement de niveau KYC
   */
  private async handleApplicantLevelChanged(
    webhookData: SumsubTypes.WebhookData,
    context: SumsubWebhookContext
  ): Promise<void> {
    const userId = this.extractUserIdFromExternalId(webhookData.externalUserId);

    logger.info('Handling applicantLevelChanged', {
      applicantId: webhookData.applicantId,
      userId,
      newLevelName: webhookData.levelName,
    });

    try {
      const newKycLevel = SumsubUtils.mapKYCLevel(webhookData.levelName);

      await firestoreHelper.updateDocument('users', userId, {
        'kyc.level': newKycLevel,
        'kyc.levelName': webhookData.levelName,
        updatedAt: new Date(),
      });

      // Mettre à jour les Custom Claims si nécessaire
      await this.updateAuthClaims(userId, newKycLevel);

    } catch (error) {
      logger.error('Failed to process applicant level changed', error, {
        applicantId: webhookData.applicantId,
        userId,
      });
      throw error;
    }
  }

  /**
   * Met à jour le statut KYC d'un utilisateur
   */
  private async updateUserKYCStatus(params: {
    userId: string;
    kycStatus: string;
    kycLevel?: number;
    applicantId: string;
    levelName?: string;
    reviewResult?: SumsubTypes.WebhookData['reviewResult'];
    submittedAt?: Date;
  }): Promise<void> {
    try {
      const updateData: any = {
        'kyc.status': params.kycStatus,
        'kyc.externalId': params.applicantId,
        updatedAt: new Date(),
      };

      if (params.kycLevel !== undefined) {
        updateData['kyc.level'] = params.kycLevel;
      }

      if (params.levelName) {
        updateData['kyc.levelName'] = params.levelName;
      }

      if (params.submittedAt) {
        updateData['kyc.submittedAt'] = params.submittedAt;
      }

      if (params.kycStatus === STATUS.KYC.APPROVED) {
        updateData['kyc.approvedAt'] = new Date();
        updateData['kyc.expiresAt'] = helpers.date.addDays(new Date(), 365); // 1 an
      } else if (params.kycStatus === STATUS.KYC.REJECTED && params.reviewResult) {
        updateData['kyc.rejectionReason'] = params.reviewResult.moderationComment || 
                                          params.reviewResult.rejectLabels?.join(', ') ||
                                          'Verification failed';
      }

      await firestoreHelper.updateDocument('users', params.userId, updateData);

      logger.info('User KYC status updated', {
        userId: params.userId,
        kycStatus: params.kycStatus,
        kycLevel: params.kycLevel,
        applicantId: params.applicantId,
      });

    } catch (error) {
      logger.error('Failed to update user KYC status', error, params);
      throw error;
    }
  }

  /**
   * Met à jour les Custom Claims Firebase Auth
   */
  private async updateAuthClaims(userId: string, kycLevel: number): Promise<void> {
    try {
      await authHelper.setCustomClaims(userId, {
        kycLevel,
        kycVerified: kycLevel > 0,
        verifiedAt: new Date().toISOString(),
      });

      logger.info('Auth claims updated for KYC', {
        userId,
        kycLevel,
      });

    } catch (error) {
      logger.error('Failed to update auth claims', error, {
        userId,
        kycLevel,
      });
      // Ne pas faire échouer le webhook pour un problème de claims
    }
  }

  /**
   * Envoie une notification de statut KYC
   */
  private async sendKYCStatusNotification(params: {
    user: UserDocument;
    kycStatus: string;
    kycLevel: number;
    reviewResult?: SumsubTypes.WebhookData['reviewResult'];
  }): Promise<void> {
    try {
      const { user, kycStatus, reviewResult } = params;

      let rejectionReason: string | undefined;
      let nextSteps: string | undefined;

      if (kycStatus === STATUS.KYC.REJECTED && reviewResult) {
        rejectionReason = reviewResult.moderationComment || 
                         reviewResult.rejectLabels?.join(', ') ||
                         'Document verification failed';
        
        nextSteps = reviewResult.reviewRejectType === 'RETRY' 
          ? 'You can submit new documents for verification'
          : 'Please contact support for assistance';
      } else if (kycStatus === STATUS.KYC.REQUIRES_ACTION) {
        nextSteps = 'Please check your verification status and provide any additional information required';
      }

      await emailService.sendKYCStatusEmail({
        to: user.email,
        firstName: user.firstName,
        status: kycStatus as 'approved' | 'rejected' | 'requires_action',
        rejectionReason,
        nextSteps,
        supportUrl: `${process.env.FRONTEND_URL}/support`,
      });

    } catch (error) {
      logger.error('Failed to send KYC status notification', error, {
        userId: params.user.uid,
        kycStatus: params.kycStatus,
      });
      // Ne pas faire échouer le webhook pour un problème d'email
    }
  }

  /**
   * Notifie que la soumission KYC est en cours de traitement
   */
  private async notifyKYCSubmitted(userId: string): Promise<void> {
    try {
      // Implémenter la notification de soumission KYC
      logger.info('KYC submission notification would be sent', { userId });
    } catch (error) {
      logger.error('Failed to notify KYC submitted', error, { userId });
    }
  }

  /**
   * Notifie que le KYC est en attente
   */
  private async notifyKYCOnHold(userId: string, reason: string): Promise<void> {
    try {
      // Implémenter la notification de KYC en attente
      logger.info('KYC on hold notification would be sent', { userId, reason });
    } catch (error) {
      logger.error('Failed to notify KYC on hold', error, { userId });
    }
  }

  /**
   * Notifie qu'une action KYC est requise
   */
  private async notifyKYCActionRequired(userId: string): Promise<void> {
    try {
      // Implémenter la notification d'action KYC requise
      logger.info('KYC action required notification would be sent', { userId });
    } catch (error) {
      logger.error('Failed to notify KYC action required', error, { userId });
    }
  }

  /**
   * Extrait l'UID utilisateur depuis l'externalUserId Sumsub
   */
  private extractUserIdFromExternalId(externalUserId: string): string {
    // Format attendu: "user_{userId}_{timestamp}"
    const parts = externalUserId.split('_');
    if (parts.length >= 2 && parts[0] === 'user') {
      return parts[1];
    }
    throw new Error(`Invalid externalUserId format: ${externalUserId}`);
  }

  /**
   * Récupère les détails complets d'un applicant pour debugging
   */
  private async getApplicantDetails(applicantId: string): Promise<SumsubTypes.Applicant> {
    try {
      return await sumsubService.getApplicant(applicantId);
    } catch (error) {
      logger.error('Failed to get applicant details', error, { applicantId });
      throw error;
    }
  }

  /**
   * Valide la cohérence des données webhook avec l'applicant
   */
  private async validateWebhookData(
    webhookData: SumsubTypes.WebhookData
  ): Promise<boolean> {
    try {
      const applicant = await this.getApplicantDetails(webhookData.applicantId);
      
      // Vérifier que l'externalUserId correspond
      if (applicant.externalUserId !== webhookData.externalUserId) {
        logger.warn('ExternalUserId mismatch in webhook', {
          webhookExternalUserId: webhookData.externalUserId,
          applicantExternalUserId: applicant.externalUserId,
          applicantId: webhookData.applicantId,
        });
        return false;
      }

      return true;

    } catch (error) {
      logger.error('Failed to validate webhook data', error, {
        applicantId: webhookData.applicantId,
      });
      return false;
    }
  }

  /**
   * Gère les cas d'erreur et retry pour les webhooks
   */
  async handleWebhookWithRetry(
    webhookData: SumsubTypes.WebhookData,
    retryAttempt: number = 0
  ): Promise<void> {
    try {
      // Valider les données webhook
      const isValid = await this.validateWebhookData(webhookData);
      if (!isValid) {
        throw new Error('Invalid webhook data');
      }

      // Traiter l'événement
      await this.processWebhookEvent(webhookData);

    } catch (error) {
      const maxRetries = 3;
      
      if (retryAttempt < maxRetries) {
        logger.warn('Retrying Sumsub webhook processing', {
          applicantId: webhookData.applicantId,
          retryAttempt: retryAttempt + 1,
          error: error.message,
        });

        // Délai exponentiel
        const delay = 1000 * Math.pow(2, retryAttempt);
        await helpers.async.delay(delay);

        return this.handleWebhookWithRetry(webhookData, retryAttempt + 1);
      } else {
        logger.error('Max retries exceeded for Sumsub webhook', error, {
          applicantId: webhookData.applicantId,
          maxRetries,
        });
        throw error;
      }
    }
  }
}

/**
 * Instance globale des handlers de webhook Sumsub
 */
export const sumsubWebhookHandlers = new SumsubWebhookHandlers();