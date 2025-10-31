# Guide de Migrations de Données Automatisées pour LLM
## Social Finance Impact Platform MVP

## 1. Système de migrations automatisé

### 1.1 Architecture des migrations pour génération LLM

```
migrations/
├── src/
│   ├── migrations/
│   │   ├── 001_initial_schema.ts
│   │   ├── 002_add_project_tags.ts
│   │   ├── 003_update_user_stats.ts
│   │   └── 004_migrate_notification_structure.ts
│   ├── utils/
│   │   ├── migrationRunner.ts
│   │   ├── backupManager.ts
│   │   └── validationHelper.ts
│   └── index.ts
└── package.json
```

### 1.2 Template de migration standardisé

```typescript
// Template obligatoire pour chaque migration
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export interface Migration {
  id: string;
  version: number;
  description: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
  validate: () => Promise<boolean>;
}

export class Migration_001_InitialSchema implements Migration {
  public readonly id = '001_initial_schema';
  public readonly version = 1;
  public readonly description = 'Initialize basic schema and system collections';

  private db = getFirestore();

  async up(): Promise<void> {
    logger.info('Starting migration', { migrationId: this.id, direction: 'up' });

    try {
      // 1. Créer collections système
      await this.createSystemCollections();
      
      // 2. Initialiser configuration
      await this.initializeSystemConfig();
      
      // 3. Créer index requis
      await this.createRequiredIndexes();

      logger.info('Migration completed successfully', { migrationId: this.id });

    } catch (error) {
      logger.error('Migration failed', error as Error, { migrationId: this.id });
      throw error;
    }
  }

  async down(): Promise<void> {
    logger.info('Reverting migration', { migrationId: this.id, direction: 'down' });

    try {
      // Supprimer dans l'ordre inverse
      await this.removeSystemConfig();
      await this.removeSystemCollections();

      logger.info('Migration reverted successfully', { migrationId: this.id });

    } catch (error) {
      logger.error('Migration revert failed', error as Error, { migrationId: this.id });
      throw error;
    }
  }

  async validate(): Promise<boolean> {
    try {
      // Vérifier existence des collections système
      const systemConfigDoc = await this.db.collection('system_config').doc('platform_settings').get();
      return systemConfigDoc.exists;

    } catch (error) {
      logger.error('Migration validation failed', error as Error, { migrationId: this.id });
      return false;
    }
  }

  private async createSystemCollections(): Promise<void> {
    const batch = this.db.batch();

    // Collection de métadonnées système
    const systemMetadataRef = this.db.collection('_system_metadata').doc('info');
    batch.set(systemMetadataRef, {
      schemaVersion: 1,
      createdAt: new Date(),
      lastMigration: this.id,
      environment: process.env.FUNCTIONS_ENV || 'development'
    });

    await batch.commit();
  }

  private async initializeSystemConfig(): Promise<void> {
    const configData = {
      platform: {
        maxContributionAmount: 1000000, // 10k€
        maxProjectGoal: 10000000, // 100k€
        maxActiveProjects: 3,
        auditTimeoutDays: 30
      },
      fees: {
        platformPercentage: 5,
        auditPercentage: 3,
        stripePercentage: 2.9
      },
      categories: [
        { id: 'environment', name: 'Environnement', active: true },
        { id: 'education', name: 'Éducation', active: true },
        { id: 'health', name: 'Santé', active: true },
        { id: 'community', name: 'Communauté', active: true },
        { id: 'innovation', name: 'Innovation', active: true }
      ],
      version: 1,
      updatedAt: new Date()
    };

    await this.db.collection('system_config').doc('platform_settings').set(configData);
  }

  private async createRequiredIndexes(): Promise<void> {
    // Note: Les index composites doivent être créés via firestore.indexes.json
    // Cette fonction peut préparer les données pour validation
    logger.info('Index creation completed (managed by firestore.indexes.json)');
  }

  private async removeSystemConfig(): Promise<void> {
    await this.db.collection('system_config').doc('platform_settings').delete();
  }

  private async removeSystemCollections(): Promise<void> {
    const batch = this.db.batch();
    
    const systemMetadataRef = this.db.collection('_system_metadata').doc('info');
    batch.delete(systemMetadataRef);

    await batch.commit();
  }
}
```

## 2. Runner de migrations automatisé

### 2.1 Migration Runner complet

```typescript
// src/utils/migrationRunner.ts
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from './logger';
import { BackupManager } from './backupManager';

export interface MigrationRecord {
  migrationId: string;
  version: number;
  description: string;
  executedAt: Date;
  executionTimeMs: number;
  status: 'completed' | 'failed' | 'rolled_back';
  checksum: string;
}

export class MigrationRunner {
  private db = getFirestore();
  private backupManager = new BackupManager();
  private migrations: Map<string, any> = new Map();

  constructor() {
    this.loadMigrations();
  }

  private loadMigrations(): void {
    // Auto-import de toutes les migrations
    const migrationClasses = [
      require('../migrations/001_initial_schema').Migration_001_InitialSchema,
      require('../migrations/002_add_project_tags').Migration_002_AddProjectTags,
      require('../migrations/003_update_user_stats').Migration_003_UpdateUserStats,
      // Ajouter nouvelles migrations ici automatiquement
    ];

    migrationClasses.forEach(MigrationClass => {
      const migration = new MigrationClass();
      this.migrations.set(migration.id, migration);
    });

    logger.info('Migrations loaded', { count: this.migrations.size });
  }

  async runPendingMigrations(): Promise<void> {
    logger.info('Starting migration process');

    const appliedMigrations = await this.getAppliedMigrations();
    const sortedMigrations = Array.from(this.migrations.values())
      .sort((a, b) => a.version - b.version);

    for (const migration of sortedMigrations) {
      const isApplied = appliedMigrations.some(m => m.migrationId === migration.id);
      
      if (!isApplied) {
        await this.runMigration(migration);
      } else {
        logger.info('Migration already applied', { migrationId: migration.id });
      }
    }

    logger.info('Migration process completed');
  }

  async runMigration(migration: any): Promise<void> {
    const startTime = Date.now();
    
    logger.info('Executing migration', {
      migrationId: migration.id,
      description: migration.description
    });

    // 1. Créer backup automatique
    const backupId = await this.backupManager.createPreMigrationBackup(migration.id);

    try {
      // 2. Exécuter la migration
      await migration.up();

      // 3. Valider la migration
      const isValid = await migration.validate();
      if (!isValid) {
        throw new Error('Migration validation failed');
      }

      // 4. Enregistrer la migration comme appliquée
      const executionTime = Date.now() - startTime;
      await this.recordMigration(migration, 'completed', executionTime);

      logger.info('Migration completed successfully', {
        migrationId: migration.id,
        executionTimeMs: executionTime
      });

    } catch (error) {
      // 5. En cas d'erreur, rollback automatique
      logger.error('Migration failed, attempting rollback', error as Error, {
        migrationId: migration.id
      });

      try {
        await migration.down();
        await this.backupManager.restoreBackup(backupId);
        await this.recordMigration(migration, 'rolled_back', Date.now() - startTime);
        
        logger.info('Migration rolled back successfully', { migrationId: migration.id });
      } catch (rollbackError) {
        logger.error('Migration rollback failed', rollbackError as Error, {
          migrationId: migration.id
        });
        await this.recordMigration(migration, 'failed', Date.now() - startTime);
      }

      throw error;
    }
  }

  async rollbackMigration(migrationId: string): Promise<void> {
    const migration = this.migrations.get(migrationId);
    if (!migration) {
      throw new Error(`Migration not found: ${migrationId}`);
    }

    logger.info('Rolling back migration', { migrationId });

    try {
      await migration.down();
      
      // Supprimer l'enregistrement de migration
      await this.db.collection('_migrations').doc(migrationId).delete();
      
      logger.info('Migration rolled back successfully', { migrationId });
    } catch (error) {
      logger.error('Migration rollback failed', error as Error, { migrationId });
      throw error;
    }
  }

  async getMigrationStatus(): Promise<{
    applied: MigrationRecord[];
    pending: string[];
    failed: MigrationRecord[];
  }> {
    const appliedMigrations = await this.getAppliedMigrations();
    const allMigrationIds = Array.from(this.migrations.keys());
    const appliedIds = appliedMigrations.map(m => m.migrationId);
    
    return {
      applied: appliedMigrations.filter(m => m.status === 'completed'),
      pending: allMigrationIds.filter(id => !appliedIds.includes(id)),
      failed: appliedMigrations.filter(m => m.status === 'failed')
    };
  }

  private async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const snapshot = await this.db.collection('_migrations')
      .orderBy('version', 'asc')
      .get();

    return snapshot.docs.map(doc => doc.data() as MigrationRecord);
  }

  private async recordMigration(
    migration: any,
    status: 'completed' | 'failed' | 'rolled_back',
    executionTimeMs: number
  ): Promise<void> {
    const record: MigrationRecord = {
      migrationId: migration.id,
      version: migration.version,
      description: migration.description,
      executedAt: new Date(),
      executionTimeMs,
      status,
      checksum: this.calculateChecksum(migration)
    };

    await this.db.collection('_migrations').doc(migration.id).set(record);
  }

  private calculateChecksum(migration: any): string {
    const crypto = require('crypto');
    const migrationString = migration.toString();
    return crypto.createHash('md5').update(migrationString).digest('hex');
  }
}
```

### 2.2 Backup Manager automatisé

```typescript
// src/utils/backupManager.ts
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from './logger';

export class BackupManager {
  private db = getFirestore();
  private backupBucket = 'migration-backups';

  async createPreMigrationBackup(migrationId: string): Promise<string> {
    const backupId = `backup_${migrationId}_${Date.now()}`;
    
    logger.info('Creating pre-migration backup', { backupId, migrationId });

    try {
      // 1. Exporter collections critiques
      const collections = ['users', 'projects', 'contributions', 'audits', 'system_config'];
      const backupData: Record<string, any> = {};

      for (const collectionName of collections) {
        const snapshot = await this.db.collection(collectionName).get();
        backupData[collectionName] = snapshot.docs.map(doc => ({
          id: doc.id,
          data: doc.data()
        }));
      }

      // 2. Sauvegarder metadata
      const metadata = {
        backupId,
        migrationId,
        timestamp: new Date().toISOString(),
        collections: Object.keys(backupData),
        documentCount: Object.values(backupData).reduce((sum, docs: any) => sum + docs.length, 0)
      };

      // 3. Stocker backup
      await this.storeBackup(backupId, { metadata, data: backupData });

      logger.info('Backup created successfully', {
        backupId,
        documentCount: metadata.documentCount
      });

      return backupId;

    } catch (error) {
      logger.error('Backup creation failed', error as Error, { backupId });
      throw error;
    }
  }

  async restoreBackup(backupId: string): Promise<void> {
    logger.info('Restoring from backup', { backupId });

    try {
      const backup = await this.getBackup(backupId);
      
      if (!backup) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      const { metadata, data } = backup;

      // Restoration par batch pour éviter les timeouts
      for (const [collectionName, documents] of Object.entries(data)) {
        await this.restoreCollection(collectionName, documents as any[]);
      }

      logger.info('Backup restored successfully', {
        backupId,
        collectionsRestored: metadata.collections.length
      });

    } catch (error) {
      logger.error('Backup restoration failed', error as Error, { backupId });
      throw error;
    }
  }

  async listBackups(): Promise<Array<{
    id: string;
    migrationId: string;
    timestamp: string;
    size: number;
  }>> {
    // Implémentation liste des backups
    const backupsSnapshot = await this.db.collection('_backup_metadata').get();
    
    return backupsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as any[];
  }

  async cleanupOldBackups(retentionDays: number = 30): Promise<void> {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));
    
    logger.info('Cleaning up old backups', { cutoffDate: cutoffDate.toISOString() });

    const oldBackups = await this.db.collection('_backup_metadata')
      .where('timestamp', '<', cutoffDate.toISOString())
      .get();

    const batch = this.db.batch();
    let deleteCount = 0;

    oldBackups.docs.forEach(doc => {
      batch.delete(doc.ref);
      deleteCount++;
    });

    if (deleteCount > 0) {
      await batch.commit();
      logger.info('Old backups cleaned up', { deletedCount: deleteCount });
    }
  }

  private async storeBackup(backupId: string, backup: any): Promise<void> {
    // Stocker metadata
    await this.db.collection('_backup_metadata').doc(backupId).set(backup.metadata);
    
    // Stocker données par chunks pour éviter les limites de taille
    const chunks = this.chunkBackupData(backup.data);
    
    for (let i = 0; i < chunks.length; i++) {
      await this.db.collection('_backup_data')
        .doc(`${backupId}_chunk_${i}`)
        .set({
          backupId,
          chunkIndex: i,
          totalChunks: chunks.length,
          data: chunks[i]
        });
    }
  }

  private async getBackup(backupId: string): Promise<any> {
    // Récupérer metadata
    const metadataDoc = await this.db.collection('_backup_metadata').doc(backupId).get();
    if (!metadataDoc.exists) return null;

    // Récupérer chunks de données
    const chunksSnapshot = await this.db.collection('_backup_data')
      .where('backupId', '==', backupId)
      .orderBy('chunkIndex')
      .get();

    const data: Record<string, any> = {};
    chunksSnapshot.docs.forEach(doc => {
      const chunkData = doc.data().data;
      Object.assign(data, chunkData);
    });

    return {
      metadata: metadataDoc.data(),
      data
    };
  }

  private async restoreCollection(collectionName: string, documents: any[]): Promise<void> {
    logger.info('Restoring collection', { collectionName, documentCount: documents.length });

    // Traitement par batches de 500 documents max
    const batchSize = 500;
    
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = this.db.batch();
      const batchDocs = documents.slice(i, i + batchSize);

      batchDocs.forEach(doc => {
        const docRef = this.db.collection(collectionName).doc(doc.id);
        batch.set(docRef, doc.data);
      });

      await batch.commit();
    }
  }

  private chunkBackupData(data: Record<string, any>, maxChunkSize = 1000): any[] {
    const chunks: any[] = [];
    let currentChunk: Record<string, any> = {};
    let currentSize = 0;

    Object.entries(data).forEach(([collection, documents]) => {
      const collectionSize = (documents as any[]).length;
      
      if (currentSize + collectionSize > maxChunkSize && currentSize > 0) {
        chunks.push(currentChunk);
        currentChunk = {};
        currentSize = 0;
      }

      currentChunk[collection] = documents;
      currentSize += collectionSize;
    });

    if (Object.keys(currentChunk).length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}
```

## 3. Migrations de données spécifiques

### 3.1 Migration structure utilisateur

```typescript
// src/migrations/003_update_user_stats.ts
import { Migration } from '../utils/migrationRunner';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';

export class Migration_003_UpdateUserStats implements Migration {
  public readonly id = '003_update_user_stats';
  public readonly version = 3;
  public readonly description = 'Add comprehensive stats tracking to user documents';

  private db = getFirestore();

  async up(): Promise<void> {
    logger.info('Starting user stats migration');

    const usersSnapshot = await this.db.collection('users').get();
    const batchSize = 500;
    let processedCount = 0;

    // Traitement par batches
    for (let i = 0; i < usersSnapshot.docs.length; i += batchSize) {
      const batch = this.db.batch();
      const batchDocs = usersSnapshot.docs.slice(i, i + batchSize);

      for (const userDoc of batchDocs) {
        const userData = userDoc.data();
        const userId = userDoc.id;

        // Calculer statistiques réelles
        const stats = await this.calculateUserStats(userId, userData);

        // Ajouter nouvelles propriétés
        const updatedData = {
          ...userData,
          stats: {
            ...userData.stats,
            ...stats,
            // Nouvelles métriques
            averageContribution: stats.totalContributed / (stats.contributionsCount || 1),
            successRate: stats.successfulProjects / (stats.projectsCreated || 1),
            lastActivityAt: userData.lastLoginAt || userData.createdAt,
            impactScore: this.calculateImpactScore(stats)
          },
          // Migration metadata
          migratedAt: new Date(),
          schemaVersion: 3
        };

        batch.update(userDoc.ref, updatedData);
        processedCount++;
      }

      await batch.commit();
      logger.info('Processed batch of users', {
        batchStart: i,
        batchSize: batchDocs.length,
        totalProcessed: processedCount
      });
    }

    logger.info('User stats migration completed', { totalProcessed: processedCount });
  }

  async down(): Promise<void> {
    logger.info('Reverting user stats migration');

    const usersSnapshot = await this.db.collection('users')
      .where('schemaVersion', '==', 3)
      .get();

    const batch = this.db.batch();
    
    usersSnapshot.docs.forEach(doc => {
      const updateData = {
        'stats.averageContribution': admin.firestore.FieldValue.delete(),
        'stats.successRate': admin.firestore.FieldValue.delete(),
        'stats.lastActivityAt': admin.firestore.FieldValue.delete(),
        'stats.impactScore': admin.firestore.FieldValue.delete(),
        migratedAt: admin.firestore.FieldValue.delete(),
        schemaVersion: 2
      };
      
      batch.update(doc.ref, updateData);
    });

    await batch.commit();
    logger.info('User stats migration reverted');
  }

  async validate(): Promise<boolean> {
    const sampleUser = await this.db.collection('users')
      .where('schemaVersion', '==', 3)
      .limit(1)
      .get();

    if (sampleUser.empty) return false;

    const userData = sampleUser.docs[0].data();
    return userData.stats?.impactScore !== undefined &&
           userData.stats?.averageContribution !== undefined;
  }

  private async calculateUserStats(userId: string, userData: any) {
    // Calculer stats depuis les contributions
    const contributionsSnapshot = await this.db.collectionGroup('contributions')
      .where('contributorUid', '==', userId)
      .where('status', '==', 'confirmed')
      .get();

    const contributionsCount = contributionsSnapshot.size;
    const totalContributed = contributionsSnapshot.docs.reduce(
      (sum, doc) => sum + (doc.data().amount || 0), 0
    );

    // Calculer stats projets créés
    const projectsSnapshot = await this.db.collection('projects')
      .where('creatorUid', '==', userId)
      .get();

    const projectsCreated = projectsSnapshot.size;
    const successfulProjects = projectsSnapshot.docs.filter(
      doc => doc.data().status === 'completed'
    ).length;

    return {
      contributionsCount,
      totalContributed,
      projectsCreated,
      successfulProjects
    };
  }

  private calculateImpactScore(stats: any): number {
    // Algorithme de scoring d'impact
    const contributionScore = Math.min(stats.totalContributed / 100000, 10); // Max 10 points
    const projectScore = stats.successfulProjects * 5; // 5 points par projet réussi
    const consistencyScore = stats.contributionsCount > 5 ? 5 : stats.contributionsCount;

    return Math.round(contributionScore + projectScore + consistencyScore);
  }
}
```

## 4. Commandes de migration automatisées

### 4.1 CLI de migration

```typescript
// src/cli/migrate.ts
import { MigrationRunner } from '../utils/migrationRunner';
import { logger } from '../utils/logger';

async function main() {
  const command = process.argv[2];
  const migrationRunner = new MigrationRunner();

  try {
    switch (command) {
      case 'status':
        const status = await migrationRunner.getMigrationStatus();
        console.log('Migration Status:');
        console.log(`Applied: ${status.applied.length}`);
        console.log(`Pending: ${status.pending.length}`);
        console.log(`Failed: ${status.failed.length}`);
        break;

      case 'up':
        await migrationRunner.runPendingMigrations();
        console.log('All pending migrations applied successfully');
        break;

      case 'rollback':
        const migrationId = process.argv[3];
        if (!migrationId) {
          throw new Error('Migration ID required for rollback');
        }
        await migrationRunner.rollbackMigration(migrationId);
        console.log(`Migration ${migrationId} rolled back successfully`);
        break;

      case 'create':
        const migrationName = process.argv[3];
        if (!migrationName) {
          throw new Error('Migration name required');
        }
        // TODO: Générer template de migration
        break;

      default:
        console.log('Usage: npm run migrate [status|up|rollback|create] [args]');
    }

  } catch (error) {
    logger.error('Migration command failed', error as Error);
    process.exit(1);
  }
}

main();
```

Ce système de migrations permet à un LLM de gérer automatiquement l'évolution du schéma de données avec sécurité et traçabilité complète.