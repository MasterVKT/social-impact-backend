/**
 * Script de test simplifié pour migrateUserDocument
 * Utilise l'émulateur Firebase local
 * 
 * USAGE:
 * 1. Démarrer l'émulateur: npm run emulator
 * 2. Exécuter ce script: npm run test:migrate
 */

import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Configuration pour l'émulateur
const EMULATOR_HOST = 'localhost';
const FIRESTORE_PORT = 8081;
const AUTH_PORT = 9100;

// Initialiser Firebase Admin pour l'émulateur
if (!admin.apps.length) {
  process.env.FIRESTORE_EMULATOR_HOST = `${EMULATOR_HOST}:${FIRESTORE_PORT}`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${EMULATOR_HOST}:${AUTH_PORT}`;
  
  admin.initializeApp({
    projectId: 'social-impact-platform-mvp',
  });
}

const db = getFirestore();

/**
 * Fonction de migration (copie de la logique de migrateUserDocument.ts)
 */
function mapRoleToUserType(oldRole: string | undefined): string {
  const mapping: Record<string, string> = {
    'organization': 'creator',
    'investor': 'contributor',
    'contributor': 'contributor',
    'auditor': 'auditor',
    'admin': 'admin',
    'creator': 'creator'
  };
  return mapping[oldRole || ''] || 'contributor';
}

function getDefaultPermissions(userType: string): string[] {
  const permissionsMap: Record<string, string[]> = {
    'creator': ['CREATE_PROJECT', 'EDIT_PROJECT', 'DELETE_PROJECT', 'CONTRIBUTE', 'COMMENT'],
    'contributor': ['CONTRIBUTE', 'COMMENT'],
    'auditor': ['AUDIT', 'COMMENT'],
    'admin': ['CREATE_PROJECT', 'EDIT_PROJECT', 'DELETE_PROJECT', 'CONTRIBUTE', 'AUDIT', 'MODERATE', 'BAN_USER', 'COMMENT', 'VIEW_ANALYTICS', 'EXPORT_DATA']
  };
  return permissionsMap[userType] || ['COMMENT'];
}

async function migrateUserDocument(userId: string, dryRun: boolean = false) {
  const userRef = db.collection('users').doc(userId);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    return {
      success: false,
      userId,
      error: 'User document not found'
    };
  }

  const userData = userDoc.data() as any;
  const oldRole = userData.role;
  const newUserType = mapRoleToUserType(oldRole);
  const permissions = getDefaultPermissions(newUserType);

  const fieldsAdded: string[] = [];
  const fieldsRemoved: string[] = [];
  const updates: any = {};

  if (!userData.userType) {
    updates.userType = newUserType;
    fieldsAdded.push('userType');
  }

  if (!userData.permissions || userData.permissions.length === 0) {
    updates.permissions = permissions;
    fieldsAdded.push('permissions');
  }

  if (!userData.accountStatus) {
    updates.accountStatus = 'active';
    fieldsAdded.push('accountStatus');
  }

  if (userData.profileComplete === undefined) {
    updates.profileComplete = true;
    fieldsAdded.push('profileComplete');
  }

  if (!userData.displayName && userData.firstName && userData.lastName) {
    updates.displayName = `${userData.firstName} ${userData.lastName}`;
    fieldsAdded.push('displayName');
  }

  if (!userData.uid) {
    updates.uid = userId;
    fieldsAdded.push('uid');
  }

  if (userData.role !== undefined) {
    updates.role = FieldValue.delete();
    fieldsRemoved.push('role');
  }

  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

  if (!dryRun && Object.keys(updates).length > 0) {
    await userRef.update(updates);
  }

  return {
    success: true,
    userId,
    changes: {
      oldRole,
      newUserType,
      permissions,
      fieldsAdded,
      fieldsRemoved
    },
    dryRun
  };
}

/**
 * Test de migration d'un utilisateur spécifique
 */
async function testMigrateSingleUser(userId: string, dryRun: boolean = true) {
  console.log('\n🧪 Test de migration pour un utilisateur spécifique');
  console.log(`User ID: ${userId}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log('─'.repeat(50));

  try {
    // Créer un utilisateur de test avec l'ancien format
    const testUserRef = db.collection('users').doc(userId);
    const existingUser = await testUserRef.get();

    if (!existingUser.exists) {
      await testUserRef.set({
        email: `test-${userId}@example.com`,
        firstName: 'Test',
        lastName: 'User',
        role: 'organization', // Ancien format
        accountStatus: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ Utilisateur de test créé avec l\'ancien format (role)');
    } else {
      console.log('ℹ️  Utilisateur existant trouvé');
    }

    const beforeData = (await testUserRef.get()).data();
    console.log('\n📋 Données AVANT migration:');
    console.log(JSON.stringify(beforeData, null, 2));

    console.log('\n🔄 Exécution de la migration...');
    const result = await migrateUserDocument(userId, dryRun);

    const afterData = (await testUserRef.get()).data();
    console.log('\n📋 Données APRÈS migration:');
    console.log(JSON.stringify(afterData, null, 2));

    console.log('\n📊 Résultat de la migration:');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n✅ Test terminé avec succès!');
    return { success: true, beforeData, afterData, result };

  } catch (error: any) {
    console.error('\n❌ Erreur lors du test:', error);
    throw error;
  }
}

/**
 * Test de migration de tous les utilisateurs
 */
async function testMigrateAllUsers(dryRun: boolean = true) {
  console.log('\n🧪 Test de migration de tous les utilisateurs');
  console.log(`Dry Run: ${dryRun}`);
  console.log('─'.repeat(50));

  try {
    const usersSnapshot = await db.collection('users').get();
    console.log(`\n📊 Nombre d'utilisateurs trouvés: ${usersSnapshot.size}`);

    const results: any[] = [];
    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const hasOldRole = userData.role !== undefined;
      const hasNewFormat = userData.userType !== undefined;

      if (hasOldRole && !hasNewFormat) {
        console.log(`\n🔄 Migration de l'utilisateur: ${doc.id}`);
        const result = await migrateUserDocument(doc.id, dryRun);
        results.push({ userId: doc.id, ...result });
      } else {
        console.log(`⏭️  Utilisateur ${doc.id} déjà au nouveau format ou sans ancien format`);
      }
    }

    console.log(`\n✅ Migration terminée pour ${results.length} utilisateur(s)`);
    return results;

  } catch (error: any) {
    console.error('\n❌ Erreur lors de la migration:', error);
    throw error;
  }
}

// Point d'entrée du script
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'single';
  const userId = args[1] || 'test-user-001';
  const dryRun = args[2] !== 'false';

  console.log('🚀 Script de test pour migrateUserDocument');
  console.log('─'.repeat(50));
  console.log(`Mode: ${command}`);
  console.log(`Dry Run: ${dryRun}`);
  console.log(`Émulateur Firestore: ${EMULATOR_HOST}:${FIRESTORE_PORT}`);
  console.log(`Émulateur Auth: ${EMULATOR_HOST}:${AUTH_PORT}`);

  try {
    if (command === 'all') {
      await testMigrateAllUsers(dryRun);
    } else {
      await testMigrateSingleUser(userId, dryRun);
    }
    
    console.log('\n✨ Tous les tests sont terminés!');
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Erreur fatale:', error);
    process.exit(1);
  }
}

// Exécuter le script
if (require.main === module) {
  main();
}

export { testMigrateSingleUser, testMigrateAllUsers, migrateUserDocument };

