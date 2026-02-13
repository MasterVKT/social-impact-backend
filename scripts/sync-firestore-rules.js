/**
 * Script de synchronisation automatique des fichiers firestore.rules
 * 
 * Ce script garantit que toutes les copies de firestore.rules dans le projet
 * sont synchronisées avec la version source (backend/functions/firestore.rules)
 * 
 * Exécution : node scripts/sync-firestore-rules.js
 * 
 * @author Backend AI Agent
 * @date 2026-01-11
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const CONFIG = {
  // Fichier source (version de référence)
  sourceFile: path.join(__dirname, '..', 'backend', 'functions', 'firestore.rules'),
  
  // Fichiers cibles à synchroniser
  targetFiles: [
    path.join(__dirname, '..', 'firestore.rules'), // Root du projet
  ],
  
  // Options
  createBackup: true,
  verbose: true,
};

/**
 * Calcule le hash MD5 d'un fichier pour détecter les différences
 */
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (error) {
    return null;
  }
}

/**
 * Crée une copie de sauvegarde d'un fichier
 */
function createBackup(filePath) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupPath = `${filePath}.backup-${timestamp}`;
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch (error) {
    console.error(`❌ Erreur lors de la création du backup de ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Synchronise un fichier cible avec le fichier source
 */
function syncFile(sourcePath, targetPath) {
  const sourceHash = getFileHash(sourcePath);
  const targetHash = getFileHash(targetPath);
  
  if (!sourceHash) {
    console.error(`❌ Fichier source introuvable: ${sourcePath}`);
    return false;
  }
  
  // Si le fichier cible n'existe pas
  if (!targetHash) {
    console.log(`📄 Création du fichier: ${targetPath}`);
    try {
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`✅ Fichier créé avec succès`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur lors de la création:`, error.message);
      return false;
    }
  }
  
  // Si les fichiers sont identiques
  if (sourceHash === targetHash) {
    console.log(`✓ Déjà synchronisé: ${targetPath}`);
    return true;
  }
  
  // Synchronisation nécessaire
  console.log(`🔄 Synchronisation de: ${targetPath}`);
  
  // Créer un backup si demandé
  if (CONFIG.createBackup) {
    const backupPath = createBackup(targetPath);
    if (backupPath) {
      console.log(`💾 Backup créé: ${backupPath}`);
    }
  }
  
  // Copier le fichier source vers la cible
  try {
    fs.copyFileSync(sourcePath, targetPath);
    const newHash = getFileHash(targetPath);
    
    if (newHash === sourceHash) {
      console.log(`✅ Synchronisation réussie`);
      return true;
    } else {
      console.error(`❌ Échec de la vérification après synchronisation`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Erreur lors de la synchronisation:`, error.message);
    return false;
  }
}

/**
 * Fonction principale
 */
function main() {
  console.log('🔄 SYNCHRONISATION DES FICHIERS FIRESTORE.RULES');
  console.log('================================================\n');
  
  // Vérifier que le fichier source existe
  if (!fs.existsSync(CONFIG.sourceFile)) {
    console.error(`❌ Fichier source introuvable: ${CONFIG.sourceFile}`);
    process.exit(1);
  }
  
  console.log(`📋 Fichier source: ${CONFIG.sourceFile}`);
  const sourceHash = getFileHash(CONFIG.sourceFile);
  console.log(`   Hash: ${sourceHash}`);
  console.log(`   Taille: ${fs.statSync(CONFIG.sourceFile).size} octets\n`);
  
  // Synchroniser tous les fichiers cibles
  let successCount = 0;
  let failCount = 0;
  
  CONFIG.targetFiles.forEach((targetFile, index) => {
    console.log(`\n[${index + 1}/${CONFIG.targetFiles.length}] ${targetFile}`);
    const success = syncFile(CONFIG.sourceFile, targetFile);
    
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  });
  
  // Résumé
  console.log('\n================================================');
  console.log('📊 RÉSUMÉ DE LA SYNCHRONISATION');
  console.log('================================================');
  console.log(`✅ Succès: ${successCount}`);
  console.log(`❌ Échecs: ${failCount}`);
  console.log(`📁 Total: ${CONFIG.targetFiles.length}`);
  
  if (failCount > 0) {
    console.log('\n⚠️  Certains fichiers n\'ont pas pu être synchronisés.');
    console.log('   Veuillez vérifier les erreurs ci-dessus.');
    process.exit(1);
  } else {
    console.log('\n✅ Tous les fichiers sont synchronisés avec succès !');
    process.exit(0);
  }
}

// Point d'entrée
if (require.main === module) {
  main();
}

module.exports = { syncFile, getFileHash };
