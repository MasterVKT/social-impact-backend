/**
 * Complete User Profile Firebase Function
 * Social Finance Impact Platform
 */

import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi, commonSchemas } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';
import { authHelper } from '../utils/auth';
import { emailService } from '../integrations/sendgrid/emailService';
import { AuthAPI } from '../types/api';
import { UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS, USER_TYPES } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  userType: Joi.string().valid('contributor', 'creator').required(),
  firstName: Joi.string().min(2).max(50).required(),
  lastName: Joi.string().min(2).max(50).required(),
  phoneNumber: commonSchemas.phoneNumber.optional(),
  dateOfBirth: Joi.date().iso().max('now').required(),
  address: commonSchemas.address.required(),
  preferences: Joi.object({
    language: commonSchemas.language.required(),
    currency: commonSchemas.currency.required(),
    notifications: Joi.object({
      email: Joi.boolean().required(),
      push: Joi.boolean().required(),
      inApp: Joi.boolean().required(),
    }).required(),
    interestedCategories: Joi.array()
      .items(Joi.string().valid('environment', 'education', 'health', 'community', 'innovation'))
      .min(1)
      .max(5)
      .required(),
  }).required(),
}).required();

/**
 * Valide que l'utilisateur peut compléter son profil
 */
async function validateUserCanCompleteProfile(uid: string): Promise<void> {
  try {
    const existingUser = await firestoreHelper.getDocumentOptional<UserDocument>('users', uid);
    
    if (existingUser?.profileComplete) {
      throw new https.HttpsError('already-exists', 'User profile is already complete');
    }

    // Vérifier l'utilisateur Firebase Auth
    const authUser = await authHelper.getUserRecord(uid);
    if (!authUser.email) {
      throw new https.HttpsError('failed-precondition', 'User must have a verified email');
    }

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate user for profile completion', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate user');
  }
}

/**
 * Crée le document utilisateur complet
 */
async function createUserDocument(
  uid: string, 
  email: string, 
  data: AuthAPI.CompleteProfileRequest
): Promise<UserDocument> {
  const now = new Date();
  
  // Générer le nom d'affichage
  const displayName = `${data.firstName} ${data.lastName}`;
  
  // Obtenir la configuration du type d'utilisateur
  const userTypeConfig = USER_TYPES[data.userType.toUpperCase() as keyof typeof USER_TYPES];

  const userDocument: Omit<UserDocument, 'id'> = {
    // Identité principale
    uid,
    email,
    firstName: data.firstName,
    lastName: data.lastName,
    displayName,
    profilePicture: undefined,
    bio: undefined,
    
    // Type et rôle
    userType: data.userType,
    permissions: userTypeConfig.permissions,
    
    // Informations personnelles
    phoneNumber: data.phoneNumber,
    dateOfBirth: data.dateOfBirth.toISOString().split('T')[0], // Format YYYY-MM-DD
    gender: undefined,
    
    // Adresse
    address: {
      street: data.address.street,
      city: data.address.city,
      postalCode: data.address.postalCode,
      country: data.address.country,
      coordinates: data.address.coordinates ? {
        latitude: data.address.coordinates.lat,
        longitude: data.address.coordinates.lng,
      } : undefined,
    },
    
    // Statut KYC initial
    kyc: {
      status: STATUS.KYC.PENDING,
      level: 0,
      provider: 'sumsub',
      externalId: undefined,
      submittedAt: undefined,
      approvedAt: undefined,
      expiresAt: undefined,
      rejectionReason: undefined,
      documents: [],
    },
    
    // Préférences utilisateur
    preferences: {
      language: data.preferences.language,
      currency: data.preferences.currency,
      timezone: 'Europe/Paris', // Défaut français
      notifications: {
        email: data.preferences.notifications.email,
        push: data.preferences.notifications.push,
        inApp: data.preferences.notifications.inApp,
        frequency: 'immediate',
      },
      privacy: {
        profilePublic: false,
        showContributions: false,
        allowContact: true,
      },
      interests: {
        categories: data.preferences.interestedCategories,
        causes: [],
      },
    },
    
    // Statistiques d'activité initiales
    stats: {
      // Statistiques contributeur
      totalContributed: 0,
      projectsSupported: 0,
      averageContribution: 0,
      lastContributionAt: undefined,
      
      // Statistiques créateur
      projectsCreated: 0,
      totalFundsRaised: 0,
      successfulProjects: 0,
      averageProjectSize: 0,
      lastProjectAt: undefined,
      
      // Statistiques auditeur
      auditsCompleted: 0,
      averageAuditTime: 0,
      approvalRate: 0,
      totalEarnings: 0,
      lastAuditAt: undefined,
      
      // Engagement général
      profileViews: 0,
      loginStreak: 1,
      lastLoginAt: now,
    },
    
    // Métadonnées système
    accountStatus: STATUS.USER.ACTIVE,
    suspendedAt: undefined,
    suspensionReason: undefined,
    bannedAt: undefined,
    banReason: undefined,
    
    // Audit trail
    lastModifiedBy: uid,
    ipAddress: undefined, // Sera ajouté par le contexte
    userAgent: undefined, // Sera ajouté par le contexte
    profileComplete: true,
    
    // Champs BaseDocument
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  return userDocument as UserDocument;
}

/**
 * Exécute la completion du profil
 */
async function executeCompleteProfile(
  data: AuthAPI.CompleteProfileRequest,
  context: CallableContext
): Promise<AuthAPI.CompleteProfileResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  await validateUserCanCompleteProfile(uid);
  
  // Récupérer l'email depuis Firebase Auth
  const authUser = await authHelper.getUserRecord(uid);
  const email = authUser.email!;

  // Créer le document utilisateur
  const userDocument = await createUserDocument(uid, email, data);
  
  // Ajouter les métadonnées de contexte
  userDocument.ipAddress = context.rawRequest.ip;
  userDocument.userAgent = context.rawRequest.headers['user-agent'] as string;

  // Transaction pour créer l'utilisateur et mettre à jour les Custom Claims
  await firestoreHelper.runTransaction(async (transaction) => {
    const userRef = firestoreHelper.getDocumentRef('users', uid);
    transaction.set(userRef, userDocument);
  });

  // Mettre à jour les Custom Claims Firebase Auth
  await authHelper.updateUserTypeClaims(uid, data.userType);

  // Envoyer l'email de bienvenue
  try {
    await emailService.sendWelcomeEmail({
      to: email,
      firstName: data.firstName,
      userType: data.userType,
      kycRequired: true, // KYC toujours requis pour la plateforme
    });
  } catch (emailError) {
    // Ne pas faire échouer la fonction pour un problème d'email
    logger.warn('Failed to send welcome email', emailError, { uid, email });
  }

  logger.business('User profile completed', 'users', {
    uid,
    userType: data.userType,
    email,
    country: data.address.country,
  });

  // Déterminer les prochaines étapes
  const kycRequired = true; // Toujours requis dans notre plateforme
  const nextStep = kycRequired ? 'kyc_verification' : 'profile_ready';

  return {
    userId: uid,
    profileComplete: true,
    kycRequired,
    nextStep,
  };
}

/**
 * Firebase Function principale
 */
export const completeProfile = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuthAPI.CompleteProfileResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<AuthAPI.CompleteProfileRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Completing user profile', {
      functionName: 'completeProfile',
      uid: context.auth.uid,
      userType: validatedData.userType,
      country: validatedData.address.country,
    });

    // Exécution
    const result = await executeCompleteProfile(validatedData, context);

    // Logging de succès
    logger.info('User profile completed successfully', {
      functionName: 'completeProfile',
      uid: context.auth.uid,
      userType: validatedData.userType,
      success: true,
    });

    return result;
  })
);