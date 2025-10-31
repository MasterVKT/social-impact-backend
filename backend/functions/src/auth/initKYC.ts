/**
 * Initialize KYC Verification Firebase Function
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
import { sumsubService, SumsubUtils } from '../integrations/sumsub/sumsubService';
import { AuthAPI } from '../types/api';
import { UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, KYC_CONFIG } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  kycLevel: Joi.string().valid('basic', 'enhanced').required(),
}).required();

/**
 * Valide que l'utilisateur peut initialiser le KYC
 */
async function validateUserCanInitKYC(uid: string, kycLevel: string): Promise<UserDocument> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);
    
    if (!user.profileComplete) {
      throw new https.HttpsError('failed-precondition', 'User profile must be completed first');
    }

    if (user.accountStatus !== STATUS.USER.ACTIVE) {
      throw new https.HttpsError('failed-precondition', 'User account is not active');
    }

    // Vérifier si KYC déjà approuvé à ce niveau ou plus
    const requiredLevel = kycLevel === 'enhanced' ? KYC_CONFIG.LEVELS.ENHANCED.level : KYC_CONFIG.LEVELS.BASIC.level;
    if (user.kyc.status === STATUS.KYC.APPROVED && user.kyc.level >= requiredLevel) {
      throw new https.HttpsError('already-exists', `KYC already approved at ${kycLevel} level or higher`);
    }

    // Vérifier si déjà en cours
    if (user.kyc.status === STATUS.KYC.PENDING && user.kyc.externalId) {
      throw new https.HttpsError('already-exists', 'KYC verification already in progress');
    }

    return user;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate user for KYC initialization', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate user for KYC');
  }
}

/**
 * Prépare les données utilisateur pour Sumsub
 */
function prepareSumsubApplicantData(user: UserDocument, kycLevel: string): {
  externalUserId: string;
  levelName: string;
  applicantData: any;
} {
  // Générer external user ID unique
  const externalUserId = SumsubUtils.generateExternalUserId(user.uid);
  
  // Déterminer le level name Sumsub
  const levelName = kycLevel === 'enhanced' 
    ? KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName
    : KYC_CONFIG.LEVELS.BASIC.sumsubLevelName;

  // Préparer les données applicant
  const applicantData = {
    externalUserId,
    levelName,
    lang: user.preferences.language,
    email: user.email,
    phone: user.phoneNumber,
    country: user.address?.country,
    firstName: user.firstName,
    lastName: user.lastName,
    dob: user.dateOfBirth, // Format YYYY-MM-DD
  };

  return { externalUserId, levelName, applicantData };
}

/**
 * Crée ou récupère un applicant Sumsub
 */
async function createOrGetSumsubApplicant(
  user: UserDocument, 
  kycLevel: string
): Promise<{ applicantId: string; externalUserId: string; levelName: string }> {
  const { externalUserId, levelName, applicantData } = prepareSumsubApplicantData(user, kycLevel);

  try {
    // Vérifier si l'applicant existe déjà
    if (user.kyc.externalId) {
      logger.info('Using existing Sumsub applicant', {
        applicantId: user.kyc.externalId,
        userId: user.uid,
      });
      
      return {
        applicantId: user.kyc.externalId,
        externalUserId,
        levelName,
      };
    }

    // Créer un nouvel applicant
    const applicant = await sumsubService.createApplicant(applicantData);

    logger.info('Sumsub applicant created', {
      applicantId: applicant.id,
      userId: user.uid,
      levelName,
    });

    return {
      applicantId: applicant.id,
      externalUserId,
      levelName,
    };

  } catch (error) {
    logger.error('Failed to create Sumsub applicant', error, {
      userId: user.uid,
      kycLevel,
    });
    throw new https.HttpsError('unavailable', 'Unable to initialize KYC verification');
  }
}

/**
 * Met à jour le statut KYC de l'utilisateur
 */
async function updateUserKYCStatus(
  uid: string,
  applicantId: string,
  levelName: string,
  kycLevel: string
): Promise<void> {
  try {
    const updateData = {
      'kyc.externalId': applicantId,
      'kyc.levelName': levelName,
      'kyc.level': kycLevel === 'enhanced' ? KYC_CONFIG.LEVELS.ENHANCED.level : KYC_CONFIG.LEVELS.BASIC.level,
      'kyc.status': STATUS.KYC.PENDING,
      'kyc.submittedAt': new Date(),
      updatedAt: new Date(),
    };

    await firestoreHelper.updateDocument('users', uid, updateData);

    logger.info('User KYC status updated for initialization', {
      uid,
      applicantId,
      levelName,
      kycLevel,
    });

  } catch (error) {
    logger.error('Failed to update user KYC status', error, { uid, applicantId });
    throw error;
  }
}

/**
 * Exécute l'initialisation du KYC
 */
async function executeInitKYC(
  data: AuthAPI.InitKYCRequest,
  context: CallableContext
): Promise<AuthAPI.InitKYCResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  const user = await validateUserCanInitKYC(uid, data.kycLevel);
  
  // Créer ou récupérer l'applicant Sumsub
  const { applicantId, externalUserId, levelName } = await createOrGetSumsubApplicant(user, data.kycLevel);

  // Générer le token d'accès Sumsub
  const accessToken = await sumsubService.generateAccessToken(
    externalUserId,
    levelName,
    KYC_CONFIG.TOKEN_EXPIRY_HOURS * 3600 // 24h en secondes
  );

  // Construire l'URL de vérification
  const sumsubUrl = `https://cockpit.sumsub.com/idensic/l/#/uni_${accessToken.token}`;

  // Mettre à jour le statut KYC de l'utilisateur
  await updateUserKYCStatus(uid, applicantId, levelName, data.kycLevel);

  // Calculer l'expiration
  const expiresAt = SumsubUtils.calculateTokenExpiration(accessToken.ttlInSecs);

  logger.business('KYC verification initialized', 'users', {
    uid,
    kycLevel: data.kycLevel,
    applicantId,
    levelName,
    tokenExpiration: expiresAt,
  });

  return {
    sumsubToken: accessToken.token,
    sumsubUrl,
    externalUserId,
    levelName,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Firebase Function principale
 */
export const initKYC = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuthAPI.InitKYCResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<AuthAPI.InitKYCRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Initializing KYC verification', {
      functionName: 'initKYC',
      uid: context.auth.uid,
      kycLevel: validatedData.kycLevel,
    });

    // Exécution
    const result = await executeInitKYC(validatedData, context);

    // Logging de succès
    logger.info('KYC verification initialized successfully', {
      functionName: 'initKYC',
      uid: context.auth.uid,
      kycLevel: validatedData.kycLevel,
      applicantCreated: true,
      success: true,
    });

    return result;
  })
);