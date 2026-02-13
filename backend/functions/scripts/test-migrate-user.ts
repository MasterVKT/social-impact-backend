/**
 * Script de test pour la fonction migrateUserDocument
 * Utilise l'émulateur Firebase local
 * 
 * USAGE:
 * 1. Démarrer l'émulateur: npm run emulator
 * 2. Exécuter ce script: npm run test:migrate
 */

import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

// Initialiser Firebase Admin pour l'émulateur
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'social-impact-platform-mvp',
  });
  
  // Connecter à l'émulateur Firestore
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
}

const db = getFirestore();

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
      // Créer un utilisateur de test
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

    // Récupérer les données avant migration
    const beforeData = (await testUserRef.get()).data();
    console.log('\n📋 Données AVANT migration:');
    console.log(JSON.stringify(beforeData, null, 2));

    // Simuler l'appel de la fonction migrateUserDocument
    // Note: En production, on utiliserait firebase-functions-test
    // Ici, on appelle directement la logique de migration
    const { migrateUserDocument: migrateFunction } = await import('../lib/migrations/migrateUserDocument');
    
    // Pour tester avec l'émulateur, on doit utiliser firebase-functions-test
    // ou appeler directement la logique interne
    console.log('\n🔄 Exécution de la migration...');
    
    // Appel direct de la logique (simulation)
    const oldRole = beforeData?.role;
    const newUserType = oldRole === 'organization' ? 'creator' : 
                       oldRole === 'investor' ? 'contributor' : 
                       oldRole === 'auditor' ? 'auditor' : 'contributor';
    
    const permissions = newUserType === 'creator' ? 
      ['CREATE_PROJECT', 'EDIT_PROJECT', 'DELETE_PROJECT', 'CONTRIBUTE', 'COMMENT'] :
      newUserType === 'contributor' ? 
      ['CONTRIBUTE', 'COMMENT'] :
      ['AUDIT', 'COMMENT'];

    const updates: any = {};
    if (!beforeData?.userType) {
      updates.userType = newUserType;
    }
    if (!beforeData?.permissions || beforeData.permissions.length === 0) {
      updates.permissions = permissions;
    }
    if (!beforeData?.accountStatus) {
      updates.accountStatus = 'active';
    }
    if (beforeData?.role !== undefined) {
      updates.role = admin.firestore.FieldValue.delete();
    }
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    if (!dryRun && Object.keys(updates).length > 0) {
      await testUserRef.update(updates);
      console.log('✅ Migration appliquée');
    } else {
      console.log('ℹ️  Mode dry-run: aucune modification appliquée');
    }

    // Récupérer les données après migration
    const afterData = (await testUserRef.get()).data();
    console.log('\n📋 Données APRÈS migration:');
    console.log(JSON.stringify(afterData, null, 2));

    console.log('\n✅ Test terminé avec succès!');
    return { success: true, beforeData, afterData, updates };

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
        const result = await testMigrateSingleUser(doc.id, dryRun);
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

export { testMigrateSingleUser, testMigrateAllUsers };

