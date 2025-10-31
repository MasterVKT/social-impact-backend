/**
 * Authentication and Authorization Utilities
 * Social Finance Impact Platform
 */

import { getAuth } from 'firebase-admin/auth';
import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import { logger } from './logger';
import { firestoreHelper } from './firestore';
import { AuthenticationError, AuthorizationError, NotFoundError } from './errors';
import { UserDocument } from '../types/firestore';
import { UserType } from '../types/global';
import { USER_TYPES, STATUS } from './constants';

/**
 * Interface pour le contexte d'authentification enrichi
 */
export interface AuthContext {
  uid: string;
  email: string;
  userType: UserType;
  permissions: string[];
  kycLevel: number;
  kycStatus: string;
  accountStatus: string;
  profileComplete: boolean;
}

/**
 * Classe principale pour la gestion de l'authentification
 */
export class AuthHelper {
  private auth = getAuth();

  /**
   * Vérifie et enrichit le contexte d'authentification d'une Firebase Function
   */
  async validateAndEnrichAuth(context: CallableContext): Promise<AuthContext> {
    // Vérification de base
    if (!context.auth) {
      throw new AuthenticationError('Authentication required');
    }

    const { uid } = context.auth;

    try {
      // Récupération du document utilisateur
      const userDoc = await firestoreHelper.getDocument<UserDocument>('users', uid);
      
      // Vérification du statut du compte
      if (userDoc.accountStatus === STATUS.USER.SUSPENDED) {
        throw new AuthorizationError(`Account suspended: ${userDoc.suspensionReason}`);
      }
      
      if (userDoc.accountStatus === STATUS.USER.BANNED) {
        throw new AuthorizationError(`Account banned: ${userDoc.banReason}`);
      }

      // Construction du contexte enrichi
      const authContext: AuthContext = {
        uid,
        email: userDoc.email,
        userType: userDoc.userType,
        permissions: userDoc.permissions || [],
        kycLevel: userDoc.kyc.level,
        kycStatus: userDoc.kyc.status,
        accountStatus: userDoc.accountStatus,
        profileComplete: userDoc.profileComplete,
      };

      // Mise à jour de la dernière activité
      await this.updateLastActivity(uid);

      logger.info('Authentication validated', {
        uid,
        userType: authContext.userType,
        kycLevel: authContext.kycLevel,
        functionName: context.rawRequest?.url?.split('/').pop(),
      });

      return authContext;

    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new AuthenticationError('User profile not found');
      }
      throw error;
    }
  }

  /**
   * Vérifie les permissions spécifiques
   */
  hasPermission(authContext: AuthContext, permission: string): boolean {
    // Admin a toutes les permissions
    if (authContext.permissions.includes('*')) {
      return true;
    }

    // Vérification directe de la permission
    if (authContext.permissions.includes(permission)) {
      return true;
    }

    // Vérification des permissions de type wildcard
    const wildcardPermissions = authContext.permissions.filter(p => p.endsWith('*'));
    for (const wildcardPerm of wildcardPermissions) {
      const prefix = wildcardPerm.slice(0, -1);
      if (permission.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Vérifie les permissions et lance une erreur si insuffisantes
   */
  requirePermission(authContext: AuthContext, permission: string): void {
    if (!this.hasPermission(authContext, permission)) {
      throw new AuthorizationError(`Permission required: ${permission}`);
    }
  }

  /**
   * Vérifie le type d'utilisateur
   */
  requireUserType(authContext: AuthContext, ...allowedTypes: UserType[]): void {
    if (!allowedTypes.includes(authContext.userType)) {
      throw new AuthorizationError(`User type required: ${allowedTypes.join(' or ')}`);
    }
  }

  /**
   * Vérifie le niveau KYC minimum
   */
  requireKYCLevel(authContext: AuthContext, minLevel: number): void {
    if (authContext.kycLevel < minLevel) {
      throw new AuthorizationError(`KYC verification level ${minLevel} required`);
    }
  }

  /**
   * Vérifie que le profil est complet
   */
  requireCompleteProfile(authContext: AuthContext): void {
    if (!authContext.profileComplete) {
      throw new AuthorizationError('Complete profile required');
    }
  }

  /**
   * Vérifie que l'utilisateur peut accéder à une ressource lui appartenant
   */
  requireOwnership(authContext: AuthContext, resourceOwnerId: string): void {
    if (authContext.uid !== resourceOwnerId && !this.hasPermission(authContext, '*')) {
      throw new AuthorizationError('Access denied: resource ownership required');
    }
  }

  /**
   * Met à jour la dernière activité de l'utilisateur
   */
  private async updateLastActivity(uid: string): Promise<void> {
    try {
      await firestoreHelper.updateDocument('users', uid, {
        'stats.lastLoginAt': new Date(),
      });
    } catch (error) {
      logger.warn('Failed to update last activity', error, { uid });
    }
  }

  /**
   * Crée ou met à jour les Custom Claims d'un utilisateur
   */
  async setCustomClaims(uid: string, claims: Record<string, any>): Promise<void> {
    try {
      await this.auth.setCustomUserClaims(uid, claims);
      
      logger.info('Custom claims updated', {
        uid,
        claims: Object.keys(claims),
      });
    } catch (error) {
      logger.error('Failed to set custom claims', error, { uid, claims });
      throw error;
    }
  }

  /**
   * Met à jour les Custom Claims selon le type d'utilisateur
   */
  async updateUserTypeClaims(uid: string, userType: UserType): Promise<void> {
    const userTypeConfig = USER_TYPES[userType.toUpperCase() as keyof typeof USER_TYPES];
    
    const claims = {
      userType,
      permissions: userTypeConfig.permissions,
      role: userType, // Pour compatibilité
    };

    await this.setCustomClaims(uid, claims);
  }

  /**
   * Révoque tous les tokens d'un utilisateur
   */
  async revokeUserTokens(uid: string): Promise<void> {
    try {
      await this.auth.revokeRefreshTokens(uid);
      
      logger.security('User tokens revoked', 'high', { uid });
    } catch (error) {
      logger.error('Failed to revoke user tokens', error, { uid });
      throw error;
    }
  }

  /**
   * Suspend un utilisateur
   */
  async suspendUser(uid: string, reason: string, suspendedBy: string): Promise<void> {
    try {
      // Désactiver le compte Firebase Auth
      await this.auth.updateUser(uid, { disabled: true });

      // Mettre à jour Firestore
      await firestoreHelper.updateDocument('users', uid, {
        accountStatus: STATUS.USER.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason,
        lastModifiedBy: suspendedBy,
      });

      // Révoquer les tokens
      await this.revokeUserTokens(uid);

      logger.security('User suspended', 'high', {
        uid,
        reason,
        suspendedBy,
      });
    } catch (error) {
      logger.error('Failed to suspend user', error, { uid, reason, suspendedBy });
      throw error;
    }
  }

  /**
   * Réactive un utilisateur suspendu
   */
  async reactivateUser(uid: string, reactivatedBy: string): Promise<void> {
    try {
      // Réactiver le compte Firebase Auth
      await this.auth.updateUser(uid, { disabled: false });

      // Mettre à jour Firestore
      await firestoreHelper.updateDocument('users', uid, {
        accountStatus: STATUS.USER.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
        lastModifiedBy: reactivatedBy,
      });

      logger.security('User reactivated', 'medium', {
        uid,
        reactivatedBy,
      });
    } catch (error) {
      logger.error('Failed to reactivate user', error, { uid, reactivatedBy });
      throw error;
    }
  }

  /**
   * Obtient les informations d'un utilisateur Firebase Auth
   */
  async getUserRecord(uid: string) {
    try {
      return await this.auth.getUser(uid);
    } catch (error) {
      throw new NotFoundError(`Firebase Auth user: ${uid}`);
    }
  }

  /**
   * Valide un token ID Firebase personnalisé
   */
  async verifyIdToken(idToken: string) {
    try {
      return await this.auth.verifyIdToken(idToken);
    } catch (error) {
      throw new AuthenticationError('Invalid ID token');
    }
  }

  /**
   * Génère un lien de vérification d'email personnalisé
   */
  async generateEmailVerificationLink(email: string): Promise<string> {
    try {
      return await this.auth.generateEmailVerificationLink(email, {
        url: process.env.EMAIL_VERIFICATION_REDIRECT_URL || 'https://socialimpact.fr/verify-email',
        handleCodeInApp: true,
      });
    } catch (error) {
      logger.error('Failed to generate email verification link', error, { email });
      throw error;
    }
  }

  /**
   * Génère un lien de réinitialisation de mot de passe
   */
  async generatePasswordResetLink(email: string): Promise<string> {
    try {
      return await this.auth.generatePasswordResetLink(email, {
        url: process.env.PASSWORD_RESET_REDIRECT_URL || 'https://socialimpact.fr/reset-password',
      });
    } catch (error) {
      logger.error('Failed to generate password reset link', error, { email });
      throw error;
    }
  }
}

/**
 * Instance globale du helper d'authentification
 */
export const authHelper = new AuthHelper();

/**
 * Decorator pour valider l'authentification dans les Firebase Functions
 */
export function requireAuth(
  target: any,
  propertyName: string,
  descriptor: PropertyDescriptor
) {
  const method = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    const context = args[1] as CallableContext;
    
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    return method.apply(this, args);
  };

  return descriptor;
}

/**
 * Decorator pour valider les permissions dans les Firebase Functions
 */
export function requirePermission(permission: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const context = args[1] as CallableContext;
      const authContext = await authHelper.validateAndEnrichAuth(context);
      
      authHelper.requirePermission(authContext, permission);

      return method.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Decorator pour valider le type d'utilisateur
 */
export function requireUserType(...allowedTypes: UserType[]) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const context = args[1] as CallableContext;
      const authContext = await authHelper.validateAndEnrichAuth(context);
      
      authHelper.requireUserType(authContext, ...allowedTypes);

      return method.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Decorator pour valider le niveau KYC
 */
export function requireKYC(minLevel: number) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const context = args[1] as CallableContext;
      const authContext = await authHelper.validateAndEnrichAuth(context);
      
      authHelper.requireKYCLevel(authContext, minLevel);

      return method.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Utilitaires pour extraire des informations du contexte
 */
export const contextUtils = {
  /**
   * Extrait l'adresse IP de la requête
   */
  getClientIP(context: CallableContext): string {
    return context.rawRequest.ip || 
           context.rawRequest.headers['x-forwarded-for'] as string ||
           context.rawRequest.connection?.remoteAddress ||
           'unknown';
  },

  /**
   * Extrait le User-Agent de la requête
   */
  getUserAgent(context: CallableContext): string {
    return context.rawRequest.headers['user-agent'] as string || 'unknown';
  },

  /**
   * Extrait l'ID de trace pour le logging
   */
  getTraceId(context: CallableContext): string {
    const traceHeader = context.rawRequest.headers['x-cloud-trace-context'] as string;
    return traceHeader?.split('/')[0] || `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Extrait la géolocalisation approximative (pays) si disponible
   */
  getCountryCode(context: CallableContext): string | undefined {
    return context.rawRequest.headers['x-appengine-country'] as string;
  },
};