/**
 * Update User Profile Firebase Function
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
import { AuthAPI } from '../types/api';
import { UserDocument } from '../types/firestore';
import { helpers } from '../utils/helpers';
import { STATUS } from '../utils/constants';

/**
 * Schéma de validation pour la requête
 */
const requestSchema = Joi.object({
  firstName: Joi.string().min(2).max(50).optional(),
  lastName: Joi.string().min(2).max(50).optional(),
  phoneNumber: commonSchemas.phoneNumber.optional(),
  dateOfBirth: Joi.date().iso().max('now').optional(),
  bio: Joi.string().max(500).allow('').optional(),
  profilePicture: Joi.string().uri().optional(),
  address: Joi.object({
    street: Joi.string().max(100).optional(),
    city: Joi.string().max(50).optional(),
    postalCode: Joi.string().max(10).optional(),
    country: commonSchemas.countryCode.optional(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).optional(),
      lng: Joi.number().min(-180).max(180).optional(),
    }).optional(),
  }).optional(),
  preferences: Joi.object({
    language: commonSchemas.language.optional(),
    currency: commonSchemas.currency.optional(),
    timezone: Joi.string().optional(),
    notifications: Joi.object({
      email: Joi.boolean().optional(),
      push: Joi.boolean().optional(),
      inApp: Joi.boolean().optional(),
      frequency: Joi.string().valid('immediate', 'daily', 'weekly').optional(),
    }).optional(),
    privacy: Joi.object({
      profilePublic: Joi.boolean().optional(),
      showContributions: Joi.boolean().optional(),
      allowContact: Joi.boolean().optional(),
    }).optional(),
    interests: Joi.object({
      categories: Joi.array()
        .items(Joi.string().valid('environment', 'education', 'health', 'community', 'innovation'))
        .min(1)
        .max(5)
        .optional(),
      causes: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    }).optional(),
  }).optional(),
}).min(1).required(); // Au moins un champ doit être fourni

/**
 * Valide que l'utilisateur peut modifier son profil
 */
async function validateUserCanUpdateProfile(uid: string): Promise<UserDocument> {
  try {
    const user = await firestoreHelper.getDocument<UserDocument>('users', uid);
    
    if (!user.profileComplete) {
      throw new https.HttpsError('failed-precondition', 'Profile must be completed first');
    }

    if (user.accountStatus !== STATUS.USER.ACTIVE) {
      throw new https.HttpsError('failed-precondition', 'Account is not active');
    }

    // Vérifier si le compte est suspendu
    if (user.suspendedAt) {
      throw new https.HttpsError('permission-denied', 'Account is suspended');
    }

    return user;

  } catch (error) {
    if (error instanceof https.HttpsError) {
      throw error;
    }
    logger.error('Failed to validate user for profile update', error, { uid });
    throw new https.HttpsError('internal', 'Unable to validate user');
  }
}

/**
 * Valide les changements par rapport aux restrictions
 */
function validateProfileChanges(
  currentUser: UserDocument,
  updateData: Partial<AuthAPI.UpdateProfileRequest>
): void {
  // Vérifier les champs sensibles qui ne peuvent pas être modifiés après KYC
  if (currentUser.kyc.status === STATUS.KYC.APPROVED) {
    const restrictedFields = ['firstName', 'lastName', 'dateOfBirth'];
    
    for (const field of restrictedFields) {
      if (updateData[field as keyof typeof updateData] !== undefined) {
        throw new https.HttpsError(
          'failed-precondition',
          `Cannot modify ${field} after KYC approval. Contact support if needed.`
        );
      }
    }

    // Vérifier l'adresse - modifications limitées après KYC
    if (updateData.address && currentUser.kyc.level >= 2) {
      if (updateData.address.country && updateData.address.country !== currentUser.address.country) {
        throw new https.HttpsError(
          'failed-precondition',
          'Cannot modify country after enhanced KYC. Contact support if needed.'
        );
      }
    }
  }

  // Validation business rules
  if (updateData.dateOfBirth) {
    const age = helpers.date.calculateAge(new Date(updateData.dateOfBirth));
    if (age < 18) {
      throw new https.HttpsError('invalid-argument', 'Users must be at least 18 years old');
    }
  }
}

/**
 * Prépare les données de mise à jour pour Firestore
 */
function prepareUpdateData(
  currentUser: UserDocument,
  requestData: Partial<AuthAPI.UpdateProfileRequest>
): Partial<UserDocument> {
  const updateData: any = {
    updatedAt: new Date(),
    version: currentUser.version + 1,
  };

  // Champs directs
  if (requestData.firstName !== undefined) {
    updateData.firstName = requestData.firstName.trim();
  }
  
  if (requestData.lastName !== undefined) {
    updateData.lastName = requestData.lastName.trim();
  }

  if (requestData.phoneNumber !== undefined) {
    updateData.phoneNumber = requestData.phoneNumber;
  }

  if (requestData.dateOfBirth !== undefined) {
    updateData.dateOfBirth = new Date(requestData.dateOfBirth).toISOString().split('T')[0];
  }

  if (requestData.bio !== undefined) {
    updateData.bio = requestData.bio.trim() || undefined;
  }

  if (requestData.profilePicture !== undefined) {
    updateData.profilePicture = requestData.profilePicture;
  }

  // Mettre à jour displayName si nom/prénom changé
  if (requestData.firstName !== undefined || requestData.lastName !== undefined) {
    const firstName = requestData.firstName || currentUser.firstName;
    const lastName = requestData.lastName || currentUser.lastName;
    updateData.displayName = `${firstName} ${lastName}`;
  }

  // Adresse - merge avec l'existant
  if (requestData.address) {
    updateData.address = {
      ...currentUser.address,
      ...requestData.address,
    };
  }

  // Préférences - merge profond avec l'existant
  if (requestData.preferences) {
    updateData.preferences = helpers.object.deepMerge(
      currentUser.preferences,
      requestData.preferences
    );
  }

  return updateData;
}

/**
 * Met à jour le profil utilisateur Firebase Auth si nécessaire
 */
async function updateFirebaseAuthProfile(
  uid: string,
  updateData: Partial<UserDocument>
): Promise<void> {
  try {
    const authUpdates: any = {};

    // Mettre à jour le displayName dans Firebase Auth
    if (updateData.displayName) {
      authUpdates.displayName = updateData.displayName;
    }

    // Mettre à jour la photo de profil dans Firebase Auth
    if (updateData.profilePicture) {
      authUpdates.photoURL = updateData.profilePicture;
    }

    // Appliquer les mises à jour si nécessaire
    if (Object.keys(authUpdates).length > 0) {
      await authHelper.updateUser(uid, authUpdates);
      
      logger.info('Firebase Auth profile updated', {
        uid,
        updatedFields: Object.keys(authUpdates)
      });
    }

  } catch (error) {
    logger.error('Failed to update Firebase Auth profile', error, { uid });
    // Ne pas faire échouer la fonction pour un problème de sync Auth
  }
}

/**
 * Valide et applique les changements de profil
 */
async function executeUpdateProfile(
  data: Partial<AuthAPI.UpdateProfileRequest>,
  context: CallableContext
): Promise<AuthAPI.UpdateProfileResponse> {
  const uid = context.auth!.uid;
  
  // Validation de l'utilisateur et des permissions
  const currentUser = await validateUserCanUpdateProfile(uid);
  
  // Validation des changements
  validateProfileChanges(currentUser, data);
  
  // Préparer les données de mise à jour
  const updateData = prepareUpdateData(currentUser, data);
  
  // Ajouter les métadonnées de contexte
  if (context.rawRequest.ip) {
    updateData.ipAddress = context.rawRequest.ip;
  }
  
  if (context.rawRequest.headers['user-agent']) {
    updateData.userAgent = context.rawRequest.headers['user-agent'] as string;
  }

  updateData.lastModifiedBy = uid;

  // Transaction pour mettre à jour le profil
  await firestoreHelper.runTransaction(async (transaction) => {
    const userRef = firestoreHelper.getDocumentRef('users', uid);
    
    // Vérifier la version pour éviter les conflits
    const currentDoc = await transaction.get(userRef);
    if (!currentDoc.exists) {
      throw new https.HttpsError('not-found', 'User profile not found');
    }

    const currentVersion = currentDoc.data()?.version || 0;
    if (currentUser.version !== currentVersion) {
      throw new https.HttpsError('aborted', 'Profile was modified by another operation. Please refresh and try again.');
    }

    // Appliquer la mise à jour
    transaction.update(userRef, updateData);
  });

  // Mettre à jour Firebase Auth en parallèle
  await updateFirebaseAuthProfile(uid, updateData);

  // Déterminer les champs modifiés pour le logging
  const modifiedFields = Object.keys(data).filter(key => data[key as keyof typeof data] !== undefined);

  logger.business('User profile updated', 'users', {
    uid,
    modifiedFields,
    hasAddressChange: !!data.address,
    hasPreferencesChange: !!data.preferences,
    kycStatus: currentUser.kyc.status,
    version: updateData.version,
  });

  // Calculer les changements sensibles
  const sensitiveChanges = modifiedFields.filter(field => 
    ['firstName', 'lastName', 'dateOfBirth', 'phoneNumber'].includes(field)
  );

  if (sensitiveChanges.length > 0) {
    logger.security('Sensitive profile data modified', 'medium', {
      uid,
      modifiedFields: sensitiveChanges,
      ipAddress: context.rawRequest.ip,
      userAgent: context.rawRequest.headers['user-agent'],
      kycStatus: currentUser.kyc.status,
    });
  }

  return {
    userId: uid,
    success: true,
    modifiedFields,
    version: updateData.version as number,
  };
}

/**
 * Firebase Function principale
 */
export const updateProfile = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<AuthAPI.UpdateProfileResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<Partial<AuthAPI.UpdateProfileRequest>>(requestSchema, data);

    // Logging de démarrage
    logger.info('Updating user profile', {
      functionName: 'updateProfile',
      uid: context.auth.uid,
      fieldsToUpdate: Object.keys(validatedData),
      hasAddressUpdate: !!validatedData.address,
      hasPreferencesUpdate: !!validatedData.preferences,
    });

    // Exécution
    const result = await executeUpdateProfile(validatedData, context);

    // Logging de succès
    logger.info('User profile updated successfully', {
      functionName: 'updateProfile',
      uid: context.auth.uid,
      modifiedFields: result.modifiedFields,
      version: result.version,
      success: true,
    });

    return result;
  })
);