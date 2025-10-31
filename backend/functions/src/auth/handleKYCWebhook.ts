/**
 * Handle KYC Webhook Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { Request, Response } from 'express';
import crypto from 'crypto';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi } from '../utils/validation';
import { sumsubWebhookHandlers } from '../integrations/sumsub/webhookHandlers';
import { SumsubTypes } from '../types/external';
import { helpers } from '../utils/helpers';

/**
 * Schéma de validation pour les données webhook Sumsub
 */
const webhookDataSchema = Joi.object({
  applicantId: Joi.string().required(),
  inspectionId: Joi.string().optional(),
  correlationId: Joi.string().optional(),
  externalUserId: Joi.string().required(),
  type: Joi.string().valid(
    'applicantReviewed',
    'applicantPending',
    'applicantCreated',
    'applicantOnHold',
    'applicantActionPending',
    'applicantLevelChanged'
  ).required(),
  reviewStatus: Joi.string().optional(),
  reviewResult: Joi.object({
    reviewAnswer: Joi.string().optional(),
    rejectLabels: Joi.array().items(Joi.string()).optional(),
    moderationComment: Joi.string().optional(),
    reviewRejectType: Joi.string().optional(),
  }).optional(),
  levelName: Joi.string().optional(),
  sandboxMode: Joi.boolean().default(false),
  createdAt: Joi.date().optional(),
}).required();

/**
 * Valide la signature HMAC du webhook Sumsub
 */
function validateSumsubSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  try {
    if (!signature || !secret) {
      logger.warn('Missing signature or secret for Sumsub webhook validation');
      return false;
    }

    // Sumsub envoie la signature avec le préfixe "sha256="
    const expectedSignature = signature.startsWith('sha256=') 
      ? signature 
      : `sha256=${signature}`;

    // Calculer la signature HMAC
    const computedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedHash = expectedSignature.replace('sha256=', '');

    // Comparaison sécurisée
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );

  } catch (error) {
    logger.error('Error validating Sumsub webhook signature', error);
    return false;
  }
}

/**
 * Valide l'origine et l'authenticité du webhook
 */
function validateWebhookOrigin(req: Request): {
  isValid: boolean;
  reason?: string;
} {
  // Vérifier la présence du secret webhook
  const webhookSecret = process.env.SUMSUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return {
      isValid: false,
      reason: 'Webhook secret not configured'
    };
  }

  // Vérifier la signature
  const signature = req.get('x-payload-digest') || req.get('x-sumsub-signature');
  if (!signature) {
    return {
      isValid: false,
      reason: 'Missing webhook signature'
    };
  }

  // Obtenir le body brut
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  // Valider la signature
  const isSignatureValid = validateSumsubSignature(rawBody, signature, webhookSecret);
  if (!isSignatureValid) {
    return {
      isValid: false,
      reason: 'Invalid webhook signature'
    };
  }

  return { isValid: true };
}

/**
 * Vérifie si l'événement webhook est un doublon
 */
async function isDuplicateEvent(eventId: string, applicantId: string): Promise<boolean> {
  try {
    // Créer un identifiant unique pour l'événement
    const eventKey = `${applicantId}_${eventId}`;
    
    // Vérifier si l'événement a déjà été traité dans les dernières 24h
    // Ceci devrait normalement utiliser une cache comme Redis
    // Pour l'instant, on utilise un simple log check
    
    logger.debug('Checking for duplicate webhook event', {
      eventId,
      applicantId,
      eventKey
    });

    // TODO: Implémenter une véritable détection de doublons avec Redis ou Firestore
    return false;

  } catch (error) {
    logger.error('Error checking for duplicate event', error, { eventId, applicantId });
    return false;
  }
}

/**
 * Enrichit les données webhook avec des informations supplémentaires
 */
function enrichWebhookData(data: SumsubTypes.WebhookData, req: Request): SumsubTypes.WebhookData {
  return {
    ...data,
    // Ajouter des métadonnées de traitement
    receivedAt: new Date(),
    sourceIP: helpers.network.getClientIP(req),
    userAgent: req.get('user-agent'),
    // Nettoyer et normaliser les données
    type: data.type.toLowerCase(),
    reviewStatus: data.reviewStatus?.toLowerCase(),
  };
}

/**
 * Traite les données du webhook KYC
 */
async function processKYCWebhook(
  data: SumsubTypes.WebhookData,
  req: Request
): Promise<{ success: boolean; message: string }> {
  try {
    // Validation des données
    const validatedData = validateWithJoi<SumsubTypes.WebhookData>(webhookDataSchema, data);
    
    // Enrichir les données
    const enrichedData = enrichWebhookData(validatedData, req);

    // Vérifier les doublons
    const isDuplicate = await isDuplicateEvent(
      req.get('x-request-id') || helpers.string.generateId('webhook'),
      validatedData.applicantId
    );

    if (isDuplicate) {
      logger.warn('Duplicate webhook event detected, ignoring', {
        applicantId: validatedData.applicantId,
        type: validatedData.type
      });
      
      return {
        success: true,
        message: 'Duplicate event ignored'
      };
    }

    // Log de l'événement reçu
    logger.info('Processing KYC webhook event', {
      applicantId: enrichedData.applicantId,
      type: enrichedData.type,
      reviewStatus: enrichedData.reviewStatus,
      externalUserId: enrichedData.externalUserId,
      sandboxMode: enrichedData.sandboxMode
    });

    // Traiter l'événement avec retry automatique
    await sumsubWebhookHandlers.handleWebhookWithRetry(enrichedData);

    // Log de succès avec détails business
    logger.business('KYC webhook processed successfully', 'webhooks', {
      applicantId: enrichedData.applicantId,
      type: enrichedData.type,
      reviewStatus: enrichedData.reviewStatus,
      processedAt: new Date(),
      sandboxMode: enrichedData.sandboxMode
    });

    return {
      success: true,
      message: 'Webhook processed successfully'
    };

  } catch (error) {
    logger.error('Failed to process KYC webhook', error, {
      applicantId: data.applicantId,
      type: data.type,
      externalUserId: data.externalUserId
    });

    // Log d'audit sécurité pour les erreurs de webhook
    logger.security('KYC webhook processing failed', 'medium', {
      applicantId: data.applicantId,
      type: data.type,
      error: error.message,
      sourceIP: helpers.network.getClientIP(req)
    });

    throw error;
  }
}

/**
 * Firebase Function principale pour les webhooks KYC
 */
export const handleKYCWebhook = https.onRequest(
  withErrorHandling(async (req: Request, res: Response): Promise<void> => {
    // Log de démarrage
    logger.info('KYC webhook received', {
      functionName: 'handleKYCWebhook',
      method: req.method,
      contentType: req.get('content-type'),
      userAgent: req.get('user-agent'),
      sourceIP: helpers.network.getClientIP(req)
    });

    // Vérifier la méthode HTTP
    if (req.method !== 'POST') {
      logger.warn('Invalid HTTP method for KYC webhook', {
        method: req.method,
        sourceIP: helpers.network.getClientIP(req)
      });
      
      res.status(405).json({
        error: 'Method not allowed',
        message: 'Only POST requests are accepted'
      });
      return;
    }

    // Valider l'origine du webhook
    const originValidation = validateWebhookOrigin(req);
    if (!originValidation.isValid) {
      logger.warn('Invalid webhook origin or signature', {
        reason: originValidation.reason,
        sourceIP: helpers.network.getClientIP(req),
        userAgent: req.get('user-agent')
      });

      // Log d'audit sécurité
      logger.security('Unauthorized KYC webhook attempt', 'high', {
        reason: originValidation.reason,
        sourceIP: helpers.network.getClientIP(req),
        userAgent: req.get('user-agent'),
        timestamp: new Date().toISOString()
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook signature or origin'
      });
      return;
    }

    try {
      // Vérifier la présence de données
      if (!req.body || typeof req.body !== 'object') {
        throw new https.HttpsError('invalid-argument', 'Missing or invalid webhook data');
      }

      // Traiter le webhook
      const result = await processKYCWebhook(req.body, req);

      // Réponse de succès
      logger.info('KYC webhook processed successfully', {
        functionName: 'handleKYCWebhook',
        applicantId: req.body.applicantId,
        type: req.body.type,
        success: true
      });

      res.status(200).json({
        success: result.success,
        message: result.message,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      // Logging d'erreur
      logger.error('KYC webhook processing failed', error, {
        functionName: 'handleKYCWebhook',
        applicantId: req.body?.applicantId,
        type: req.body?.type,
        sourceIP: helpers.network.getClientIP(req)
      });

      // Réponse d'erreur appropriée pour Sumsub
      if (error instanceof https.HttpsError) {
        res.status(400).json({
          error: error.code,
          message: error.message
        });
      } else {
        res.status(500).json({
          error: 'internal_error',
          message: 'An internal error occurred while processing the webhook'
        });
      }
    }
  })
);