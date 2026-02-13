/**
 * Migration Script: Update User Document to New Schema
 * Migrates from old "role" field to new "userType" + "permissions" system
 *
 * USAGE:
 * 1. Deploy: firebase deploy --only functions:migrateUserDocument
 * 2. Call from frontend or use Firebase CLI
 */

import { https } from 'firebase-functions';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

/**
 * Interface pour l'ancien modèle utilisateur
 */
interface OldUserModel {
  role?: string;
  [key: string]: any;
}

/**
 * Interface pour la requête de migration
 */
interface MigrationRequest {
  userId?: string;           // ID utilisateur spécifique (optionnel)
  migrateAll?: boolean;      // Migrer tous les utilisateurs (admin only)
  dryRun?: boolean;          // Mode simulation (ne modifie rien)
}

/**
 * Interface pour le résultat de migration
 */
interface MigrationResult {
  success: boolean;
  userId?: string;
  changes: {
    oldRole?: string;
    newUserType: string;
    permissions: string[];
    fieldsAdded: string[];
    fieldsRemoved: string[];
  };
  error?: string;
}

/**
 * Mappe l'ancien "role" vers le nouveau "userType"
 */
function mapRoleToUserType(oldRole: string | undefined): string {
  const mapping: Record<string, string> = {
    'organization': 'creator',
    'investor': 'contributor',
    'contributor': 'contributor',
    'auditor': 'auditor',
    'admin': 'admin',
    'creator': 'creator'  // Si déjà au nouveau format
  };

  return mapping[oldRole || ''] || 'contributor';
}

/**
 * Détermine les permissions par défaut selon le userType
 */
function getDefaultPermissions(userType: string): string[] {
  const permissionsMap: Record<string, string[]> = {
    'creator': [
      'CREATE_PROJECT',
      'EDIT_PROJECT',
      'DELETE_PROJECT',
      'CONTRIBUTE',
      'COMMENT'
    ],
    'contributor': [
      'CONTRIBUTE',
      'COMMENT'
    ],
    'auditor': [
      'AUDIT',
      'COMMENT'
    ],
    'admin': [
      'CREATE_PROJECT',
      'EDIT_PROJECT',
      'DELETE_PROJECT',
      'CONTRIBUTE',
      'AUDIT',
      'MODERATE',
      'BAN_USER',
      'COMMENT',
      'VIEW_ANALYTICS',
      'EXPORT_DATA'
    ]
  };

  return permissionsMap[userType] || ['COMMENT'];
}

/**
 * Migre un seul document utilisateur
 */
async function migrateUserDocument(
  userId: string,
  dryRun: boolean = false
): Promise<MigrationResult> {
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);

  try {
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return {
        success: false,
        userId,
        changes: {
          newUserType: '',
          permissions: [],
          fieldsAdded: [],
          fieldsRemoved: []
        },
        error: 'User document not found'
      };
    }

    const userData = userDoc.data() as OldUserModel;
    const oldRole = userData.role;

    // Déterminer le nouveau userType
    const newUserType = mapRoleToUserType(oldRole);

    // Déterminer les permissions
    const permissions = getDefaultPermissions(newUserType);

    // Préparer les changements
    const fieldsAdded: string[] = [];
    const fieldsRemoved: string[] = [];
    const updates: any = {};

    // userType (ajouter si n'existe pas)
    if (!userData.userType) {
      updates.userType = newUserType;
      fieldsAdded.push('userType');
    }

    // permissions (ajouter si n'existe pas ou est vide)
    if (!userData.permissions || userData.permissions.length === 0) {
      updates.permissions = permissions;
      fieldsAdded.push('permissions');
    }

    // accountStatus (ajouter si n'existe pas)
    if (!userData.accountStatus) {
      updates.accountStatus = 'active';
      fieldsAdded.push('accountStatus');
    }

    // profileComplete (ajouter si n'existe pas)
    if (userData.profileComplete === undefined) {
      updates.profileComplete = true;
      fieldsAdded.push('profileComplete');
    }

    // displayName (ajouter si n'existe pas)
    if (!userData.displayName && userData.firstName && userData.lastName) {
      updates.displayName = `${userData.firstName} ${userData.lastName}`;
      fieldsAdded.push('displayName');
    }

    // uid (ajouter si n'existe pas)
    if (!userData.uid) {
      updates.uid = userId;
      fieldsAdded.push('uid');
    }

    // Supprimer le champ "role" (via FieldValue.delete())
    if (userData.role !== undefined) {
      updates.role = FieldValue.delete();
      fieldsRemoved.push('role');
    }

    // updatedAt
    updates.updatedAt = new Date();

    // Appliquer les modifications (sauf si dry run)
    if (!dryRun && Object.keys(updates).length > 0) {
      await userRef.update(updates);
    }

    logger.info('User document migration completed', {
      userId,
      dryRun,
      oldRole,
      newUserType,
      permissions,
      fieldsAdded,
      fieldsRemoved,
      changesCount: Object.keys(updates).length
    });

    return {
      success: true,
      userId,
      changes: {
        oldRole,
        newUserType,
        permissions,
        fieldsAdded,
        fieldsRemoved
      }
    };

  } catch (error: any) {
    logger.error('Failed to migrate user document', error, { userId });

    return {
      success: false,
      userId,
      changes: {
        newUserType: '',
        permissions: [],
        fieldsAdded: [],
        fieldsRemoved: []
      },
      error: error.message
    };
  }
}

/**
 * Cloud Function callable pour migrer les documents utilisateur
 */
export const migrateUserDocument = https.onCall(
  async (data: MigrationRequest, context): Promise<MigrationResult | MigrationResult[]> => {
    const db = getFirestore();

    // Vérifier l'authentification
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    const callerId = context.auth.uid;
    const { userId, migrateAll, dryRun = false } = data;

    logger.info('Migration request received', {
      callerId,
      userId,
      migrateAll,
      dryRun
    });

    // CAS 1: Migrer tous les utilisateurs (admin only)
    if (migrateAll) {
      // Vérifier que l'appelant est admin
      const callerDoc = await db.collection('users').doc(callerId).get();
      const callerData = callerDoc.data();

      if (!callerData || callerData.userType !== 'admin') {
        throw new https.HttpsError(
          'permission-denied',
          'Only admins can migrate all users'
        );
      }

      // Récupérer tous les utilisateurs
      const usersSnapshot = await db.collection('users').get();
      const results: MigrationResult[] = [];

      for (const doc of usersSnapshot.docs) {
        const result = await migrateUserDocument(doc.id, dryRun);
        results.push(result);
      }

      logger.info('Batch migration completed', {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        dryRun
      });

      return results;
    }

    // CAS 2: Migrer un utilisateur spécifique
    const targetUserId = userId || callerId;

    // Vérifier les permissions
    if (targetUserId !== callerId) {
      const callerDoc = await db.collection('users').doc(callerId).get();
      const callerData = callerDoc.data();

      if (!callerData || callerData.userType !== 'admin') {
        throw new https.HttpsError(
          'permission-denied',
          'You can only migrate your own user document, unless you are an admin'
        );
      }
    }

    return await migrateUserDocument(targetUserId, dryRun);
  }
);
