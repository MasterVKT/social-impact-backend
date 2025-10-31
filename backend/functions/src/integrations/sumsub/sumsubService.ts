/**
 * Sumsub KYC Service
 * Social Finance Impact Platform
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { logger } from '../../utils/logger';
import { ExternalServiceError, ValidationError } from '../../utils/errors';
import { withRetry } from '../../utils/errors';
import { SumsubTypes } from '../../types/external';
import { KYC_CONFIG } from '../../utils/constants';
import { helpers } from '../../utils/helpers';

/**
 * Configuration Sumsub
 */
const SUMSUB_CONFIG = {
  baseURL: 'https://api.sumsub.com',
  timeout: 30000,
  maxRetries: 3,
};

/**
 * Service principal Sumsub pour KYC
 */
export class SumsubService {
  private client: AxiosInstance;
  private appToken: string;
  private secretKey: string;

  constructor() {
    this.appToken = process.env.SUMSUB_APP_TOKEN || '';
    this.secretKey = process.env.SUMSUB_SECRET_KEY || '';

    if (!this.appToken || !this.secretKey) {
      throw new Error('SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY environment variables are required');
    }

    this.client = axios.create({
      baseURL: SUMSUB_CONFIG.baseURL,
      timeout: SUMSUB_CONFIG.timeout,
    });

    // Intercepteur pour ajouter l'authentification
    this.client.interceptors.request.use((config) => {
      return this.addAuthHeaders(config);
    });

    // Intercepteur pour logger les erreurs
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Sumsub API error', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          config: {
            method: error.config?.method,
            url: error.config?.url,
          },
        });
        return Promise.reject(error);
      }
    );

    logger.info('Sumsub service initialized', {
      baseURL: SUMSUB_CONFIG.baseURL,
      hasCredentials: !!(this.appToken && this.secretKey),
    });
  }

  /**
   * Génère la signature d'authentification Sumsub
   */
  private generateSignature(method: string, url: string, timestamp: number, body?: string): string {
    const message = timestamp + method.toUpperCase() + url + (body || '');
    return crypto
      .createHmac('sha256', this.secretKey)
      .update(message)
      .digest('hex');
  }

  /**
   * Ajoute les en-têtes d'authentification à une requête
   */
  private addAuthHeaders(config: AxiosRequestConfig): AxiosRequestConfig {
    const timestamp = Math.floor(Date.now() / 1000);
    const method = config.method?.toUpperCase() || 'GET';
    const url = config.url || '';
    const body = config.data ? JSON.stringify(config.data) : undefined;

    const signature = this.generateSignature(method, url, timestamp, body);

    config.headers = {
      ...config.headers,
      'X-App-Token': this.appToken,
      'X-App-Access-Ts': timestamp.toString(),
      'X-App-Access-Sig': signature,
      'Content-Type': 'application/json',
    };

    return config;
  }

  /**
   * Crée un nouvel applicant Sumsub
   */
  async createApplicant(params: SumsubTypes.CreateApplicantRequest): Promise<SumsubTypes.Applicant> {
    try {
      const response = await withRetry(
        () => this.client.post('/resources/applicants', params),
        SUMSUB_CONFIG.maxRetries,
        1000
      );

      const applicant = response.data;

      logger.info('Sumsub applicant created', {
        applicantId: applicant.id,
        externalUserId: params.externalUserId,
        levelName: params.levelName,
      });

      return applicant;

    } catch (error) {
      logger.error('Failed to create Sumsub applicant', error, {
        externalUserId: params.externalUserId,
        levelName: params.levelName,
      });

      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Génère un token d'accès pour l'applicant
   */
  async generateAccessToken(
    externalUserId: string, 
    levelName: string,
    ttlInSecs: number = 86400 // 24 heures par défaut
  ): Promise<SumsubTypes.AccessToken> {
    try {
      const params = {
        externalUserId,
        levelName,
        ttlInSecs,
      };

      const response = await withRetry(
        () => this.client.post('/resources/accessTokens', params),
        SUMSUB_CONFIG.maxRetries,
        1000
      );

      const accessToken = response.data;

      logger.info('Sumsub access token generated', {
        externalUserId,
        levelName,
        ttlInSecs,
      });

      return accessToken;

    } catch (error) {
      logger.error('Failed to generate Sumsub access token', error, {
        externalUserId,
        levelName,
      });

      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Récupère le statut d'un applicant
   */
  async getApplicantStatus(applicantId: string): Promise<SumsubTypes.GetApplicantStatusResponse> {
    try {
      const response = await this.client.get(`/resources/applicants/${applicantId}/status`);
      
      const status = response.data;

      logger.debug('Sumsub applicant status retrieved', {
        applicantId,
        reviewStatus: status.reviewStatus,
        reviewResult: status.reviewResult?.reviewAnswer,
      });

      return status;

    } catch (error) {
      logger.error('Failed to get Sumsub applicant status', error, { applicantId });
      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Récupère les détails complets d'un applicant
   */
  async getApplicant(applicantId: string): Promise<SumsubTypes.Applicant> {
    try {
      const response = await this.client.get(`/resources/applicants/${applicantId}`);
      
      const applicant = response.data;

      logger.debug('Sumsub applicant retrieved', {
        applicantId,
        externalUserId: applicant.externalUserId,
      });

      return applicant;

    } catch (error) {
      logger.error('Failed to get Sumsub applicant', error, { applicantId });
      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Recherche un applicant par externalUserId
   */
  async findApplicantByExternalId(externalUserId: string): Promise<SumsubTypes.Applicant | null> {
    try {
      const response = await this.client.get('/resources/applicants', {
        params: { externalUserId }
      });

      const applicants = response.data.items || [];

      if (applicants.length === 0) {
        logger.debug('No Sumsub applicant found', { externalUserId });
        return null;
      }

      const applicant = applicants[0];

      logger.debug('Sumsub applicant found by external ID', {
        applicantId: applicant.id,
        externalUserId,
      });

      return applicant;

    } catch (error) {
      logger.error('Failed to find Sumsub applicant by external ID', error, { externalUserId });
      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Upload un document pour un applicant
   */
  async uploadDocument(
    applicantId: string,
    document: SumsubTypes.Document
  ): Promise<any> {
    try {
      const formData = new FormData();
      
      if (document.content) {
        const buffer = Buffer.from(document.content, 'base64');
        formData.append('content', buffer, document.fileName);
      }
      
      formData.append('metadata', JSON.stringify({
        idDocType: document.idDocType,
        country: document.country,
      }));

      const response = await this.client.post(
        `/resources/applicants/${applicantId}/info/idDoc`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      logger.info('Document uploaded to Sumsub', {
        applicantId,
        documentType: document.idDocType,
        country: document.country,
      });

      return response.data;

    } catch (error) {
      logger.error('Failed to upload document to Sumsub', error, {
        applicantId,
        documentType: document.idDocType,
      });

      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Met à jour les informations d'un applicant
   */
  async updateApplicantInfo(
    applicantId: string,
    info: Partial<SumsubTypes.Applicant['info']>
  ): Promise<SumsubTypes.Applicant> {
    try {
      const response = await this.client.patch(
        `/resources/applicants/${applicantId}/info`,
        { info }
      );

      const applicant = response.data;

      logger.info('Sumsub applicant info updated', {
        applicantId,
        updatedFields: Object.keys(info),
      });

      return applicant;

    } catch (error) {
      logger.error('Failed to update Sumsub applicant info', error, {
        applicantId,
        updatedFields: Object.keys(info),
      });

      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Démarre la vérification d'un applicant
   */
  async startVerification(applicantId: string): Promise<void> {
    try {
      await this.client.post(`/resources/applicants/${applicantId}/status/pending`);

      logger.info('Sumsub verification started', { applicantId });

    } catch (error) {
      logger.error('Failed to start Sumsub verification', error, { applicantId });
      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Reset l'applicant pour permettre une nouvelle soumission
   */
  async resetApplicant(applicantId: string): Promise<void> {
    try {
      await this.client.post(`/resources/applicants/${applicantId}/reset`);

      logger.info('Sumsub applicant reset', { applicantId });

    } catch (error) {
      logger.error('Failed to reset Sumsub applicant', error, { applicantId });
      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Valide la signature d'un webhook Sumsub
   */
  validateWebhookSignature(
    payload: string,
    signature: string,
    timestamp: number
  ): boolean {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(timestamp + payload)
        .digest('hex');

      const isValid = signature === expectedSignature;

      logger.debug('Sumsub webhook signature validation', {
        isValid,
        timestamp,
      });

      return isValid;

    } catch (error) {
      logger.error('Failed to validate Sumsub webhook signature', error, {
        hasPayload: !!payload,
        hasSignature: !!signature,
        timestamp,
      });

      return false;
    }
  }

  /**
   * Traite les données d'un webhook Sumsub
   */
  parseWebhookData(payload: string): SumsubTypes.WebhookData {
    try {
      const data = JSON.parse(payload) as SumsubTypes.WebhookData;

      // Validation de base des données requises
      if (!data.applicantId || !data.externalUserId || !data.type) {
        throw new ValidationError('Invalid Sumsub webhook data: missing required fields');
      }

      logger.debug('Sumsub webhook data parsed', {
        applicantId: data.applicantId,
        externalUserId: data.externalUserId,
        type: data.type,
        reviewStatus: data.reviewStatus,
      });

      return data;

    } catch (error) {
      logger.error('Failed to parse Sumsub webhook data', error, { payload });
      throw new ValidationError('Invalid Sumsub webhook payload');
    }
  }

  /**
   * Obtient l'URL de vérification pour un utilisateur
   */
  async getVerificationUrl(
    externalUserId: string,
    levelName: string = KYC_CONFIG.LEVELS.BASIC.sumsubLevelName
  ): Promise<string> {
    try {
      // Générer le token d'accès
      const accessToken = await this.generateAccessToken(externalUserId, levelName);

      // Construire l'URL de vérification
      const verificationUrl = `https://cockpit.sumsub.com/idensic/l/#/uni_${accessToken.token}`;

      logger.info('Sumsub verification URL generated', {
        externalUserId,
        levelName,
      });

      return verificationUrl;

    } catch (error) {
      logger.error('Failed to generate Sumsub verification URL', error, {
        externalUserId,
        levelName,
      });

      throw new ExternalServiceError('Sumsub', error);
    }
  }

  /**
   * Obtient les statistiques de vérification
   */
  async getVerificationStats(): Promise<any> {
    try {
      const response = await this.client.get('/resources/applicants/stats');
      
      const stats = response.data;

      logger.debug('Sumsub verification stats retrieved', stats);

      return stats;

    } catch (error) {
      logger.error('Failed to get Sumsub verification stats', error);
      throw new ExternalServiceError('Sumsub', error);
    }
  }
}

/**
 * Instance globale du service Sumsub
 */
export const sumsubService = new SumsubService();

/**
 * Utilitaires pour Sumsub
 */
export namespace SumsubUtils {
  /**
   * Convertit un statut de review Sumsub vers notre système
   */
  export function mapReviewStatus(
    reviewStatus: SumsubTypes.ReviewStatus,
    reviewAnswer?: SumsubTypes.ReviewAnswer
  ): string {
    if (reviewStatus === 'completed' && reviewAnswer) {
      switch (reviewAnswer) {
        case 'GREEN':
          return 'approved';
        case 'RED':
          return 'rejected';
        case 'YELLOW':
          return 'requires_action';
        default:
          return 'pending';
      }
    }

    const statusMap: Record<SumsubTypes.ReviewStatus, string> = {
      'init': 'pending',
      'pending': 'pending',
      'queued': 'pending',
      'completed': 'pending', // Sera résolu par reviewAnswer
      'onHold': 'requires_action',
    };

    return statusMap[reviewStatus] || 'pending';
  }

  /**
   * Détermine le niveau KYC basé sur le levelName Sumsub
   */
  export function mapKYCLevel(levelName: string): number {
    if (levelName.includes('enhanced')) {
      return KYC_CONFIG.LEVELS.ENHANCED.level;
    } else if (levelName.includes('basic')) {
      return KYC_CONFIG.LEVELS.BASIC.level;
    }
    return KYC_CONFIG.LEVELS.NONE.level;
  }

  /**
   * Génère un external user ID unique
   */
  export function generateExternalUserId(userId: string): string {
    return `user_${userId}_${Date.now()}`;
  }

  /**
   * Valide les données requises pour un niveau KYC
   */
  export function validateKYCLevel(
    levelName: string,
    applicantData: Partial<SumsubTypes.Applicant>
  ): { valid: boolean; missingFields: string[] } {
    const requiredFields: Record<string, string[]> = {
      'basic-kyc-level': ['firstName', 'lastName', 'dob'],
      'enhanced-kyc-level': ['firstName', 'lastName', 'dob', 'country', 'addresses'],
    };

    const required = requiredFields[levelName] || [];
    const missingFields: string[] = [];

    for (const field of required) {
      if (!applicantData.info?.[field as keyof typeof applicantData.info]) {
        missingFields.push(field);
      }
    }

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Calcule l'expiration du token basé sur le TTL
   */
  export function calculateTokenExpiration(ttlInSecs: number): Date {
    return helpers.date.addDays(new Date(), ttlInSecs / (24 * 3600));
  }

  /**
   * Formate une adresse pour Sumsub
   */
  export function formatAddress(address: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  }): SumsubTypes.Address {
    return {
      country: address.country,
      postCode: address.postalCode,
      town: address.city,
      street: address.street,
    };
  }
}