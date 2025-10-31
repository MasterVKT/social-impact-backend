/**
 * Database Utilities
 * Social Finance Impact Platform
 * 
 * Specialized utilities for database operations, migrations,
 * and data transformations
 */

import { Firestore, DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { firestoreDb } from '../config/database';
import { logger } from '../utils/logger';
import { performanceMonitor } from '../monitoring/performanceMonitor';
import { metricsCollector } from '../monitoring/metricsCollector';

// ============================================================================
// FIRESTORE UTILITIES
// ============================================================================

export class FirestoreUtilities {
  private db: Firestore;

  constructor() {
    this.db = firestoreDb;
  }

  /**
   * Batch write with automatic chunking for large datasets
   */
  async batchWrite(
    operations: Array<{
      type: 'set' | 'update' | 'delete';
      collection: string;
      docId: string;
      data?: any;
    }>,
    chunkSize: number = 500
  ): Promise<void> {
    const traceId = await performanceMonitor.startTrace('db_batch_write', 'database', {
      operationCount: operations.length
    });

    try {
      const chunks = this.chunkArray(operations, chunkSize);

      for (let i = 0; i < chunks.length; i++) {
        const batch = this.db.batch();
        const chunk = chunks[i];

        for (const operation of chunk) {
          const docRef = this.db.collection(operation.collection).doc(operation.docId);

          switch (operation.type) {
            case 'set':
              batch.set(docRef, operation.data!);
              break;
            case 'update':
              batch.update(docRef, operation.data!);
              break;
            case 'delete':
              batch.delete(docRef);
              break;
          }
        }

        await batch.commit();

        logger.info(`Batch write chunk ${i + 1}/${chunks.length} completed`, {
          operations: chunk.length
        });
      }

      await performanceMonitor.endTrace(traceId, 'success', {
        totalOperations: operations.length,
        chunks: chunks.length
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Bulk delete documents with query filter
   */
  async bulkDelete(
    collectionPath: string,
    whereConditions: Array<{ field: string; operator: FirebaseFirestore.WhereFilterOp; value: any }>,
    batchSize: number = 500
  ): Promise<number> {
    const traceId = await performanceMonitor.startTrace('db_bulk_delete', 'database', {
      collection: collectionPath
    });

    try {
      let query: FirebaseFirestore.Query = this.db.collection(collectionPath);

      for (const condition of whereConditions) {
        query = query.where(condition.field, condition.operator, condition.value);
      }

      let deletedCount = 0;
      let hasMore = true;

      while (hasMore) {
        const snapshot = await query.limit(batchSize).get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        const batch = this.db.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        deletedCount += snapshot.docs.length;

        logger.info(`Deleted ${snapshot.docs.length} documents from ${collectionPath}`, {
          totalDeleted: deletedCount
        });

        hasMore = snapshot.docs.length === batchSize;
      }

      await performanceMonitor.endTrace(traceId, 'success', {
        deletedCount
      });

      await metricsCollector.recordCounter('database.bulk_delete', deletedCount, {
        collection: collectionPath
      });

      return deletedCount;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Copy collection with transformation
   */
  async copyCollection(
    sourceCollection: string,
    targetCollection: string,
    transformer?: (doc: DocumentData) => DocumentData,
    batchSize: number = 500
  ): Promise<number> {
    const traceId = await performanceMonitor.startTrace('db_copy_collection', 'database', {
      source: sourceCollection,
      target: targetCollection
    });

    try {
      let copiedCount = 0;
      let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

      while (true) {
        let query = this.db.collection(sourceCollection).limit(batchSize);

        if (lastDoc) {
          query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();

        if (snapshot.empty) break;

        const batch = this.db.batch();

        for (const doc of snapshot.docs) {
          const data = transformer ? transformer(doc.data()) : doc.data();
          const targetRef = this.db.collection(targetCollection).doc(doc.id);
          batch.set(targetRef, data);
        }

        await batch.commit();
        copiedCount += snapshot.docs.length;
        lastDoc = snapshot.docs[snapshot.docs.length - 1];

        logger.info(`Copied ${copiedCount} documents to ${targetCollection}`);
      }

      await performanceMonitor.endTrace(traceId, 'success', {
        copiedCount
      });

      return copiedCount;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Create indexes programmatically
   */
  async ensureIndexes(indexes: Array<{
    collection: string;
    fields: Array<{ field: string; direction: 'asc' | 'desc' }>;
  }>): Promise<void> {
    logger.info('Firestore indexes must be created via Firebase Console or firebase.json', {
      indexes: indexes.length
    });

    // Log index definitions for documentation
    for (const index of indexes) {
      logger.info('Index definition', {
        collection: index.collection,
        fields: index.fields
      });
    }
  }

  /**
   * Timestamp conversion utilities
   */
  convertTimestampToDate(data: any): any {
    if (data instanceof Timestamp) {
      return data.toDate();
    }

    if (Array.isArray(data)) {
      return data.map(item => this.convertTimestampToDate(item));
    }

    if (data && typeof data === 'object') {
      const converted: any = {};
      for (const [key, value] of Object.entries(data)) {
        converted[key] = this.convertTimestampToDate(value);
      }
      return converted;
    }

    return data;
  }

  convertDateToTimestamp(data: any): any {
    if (data instanceof Date) {
      return Timestamp.fromDate(data);
    }

    if (Array.isArray(data)) {
      return data.map(item => this.convertDateToTimestamp(item));
    }

    if (data && typeof data === 'object') {
      const converted: any = {};
      for (const [key, value] of Object.entries(data)) {
        converted[key] = this.convertDateToTimestamp(value);
      }
      return converted;
    }

    return data;
  }

  /**
   * Utility methods
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// ============================================================================
// DATA MIGRATION UTILITIES
// ============================================================================

export class DataMigration {
  private db: Firestore;
  private utilities: FirestoreUtilities;

  constructor() {
    this.db = firestoreDb;
    this.utilities = new FirestoreUtilities();
  }

  /**
   * Migrate data with version tracking
   */
  async migrate(
    migrationName: string,
    migrationFn: () => Promise<void>
  ): Promise<void> {
    const migrationId = `migration_${migrationName}_${Date.now()}`;
    
    const traceId = await performanceMonitor.startTrace('db_migration', 'database', {
      migrationName
    });

    try {
      // Check if migration already ran
      const migrationDoc = await this.db
        .collection('_migrations')
        .doc(migrationName)
        .get();

      if (migrationDoc.exists) {
        logger.warn(`Migration ${migrationName} already completed`, {
          completedAt: migrationDoc.data()?.completedAt
        });
        return;
      }

      // Run migration
      logger.info(`Starting migration: ${migrationName}`);
      const startTime = Date.now();

      await migrationFn();

      const duration = Date.now() - startTime;

      // Record migration completion
      await this.db.collection('_migrations').doc(migrationName).set({
        id: migrationId,
        name: migrationName,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        duration,
        status: 'completed'
      });

      await performanceMonitor.endTrace(traceId, 'success', {
        duration,
        migrationName
      });

      logger.info(`Migration completed: ${migrationName}`, { duration });

    } catch (error) {
      // Record migration failure
      await this.db.collection('_migrations').doc(migrationName).set({
        id: migrationId,
        name: migrationName,
        startedAt: new Date(),
        failedAt: new Date(),
        status: 'failed',
        error: (error as Error).message
      });

      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      logger.error(`Migration failed: ${migrationName}`, error as Error);
      throw error;
    }
  }

  /**
   * Add field to all documents in collection
   */
  async addFieldToCollection(
    collection: string,
    fieldName: string,
    defaultValue: any,
    batchSize: number = 500
  ): Promise<number> {
    let updatedCount = 0;
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
      let query = this.db.collection(collection).limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      const batch = this.db.batch();

      for (const doc of snapshot.docs) {
        if (!doc.data()[fieldName]) {
          batch.update(doc.ref, {
            [fieldName]: defaultValue,
            updatedAt: FieldValue.serverTimestamp()
          });
          updatedCount++;
        }
      }

      await batch.commit();
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      logger.info(`Updated ${updatedCount} documents in ${collection}`);
    }

    return updatedCount;
  }

  /**
   * Rename field in all documents
   */
  async renameField(
    collection: string,
    oldFieldName: string,
    newFieldName: string,
    batchSize: number = 500
  ): Promise<number> {
    let updatedCount = 0;
    let lastDoc: FirebaseFirestore.DocumentSnapshot | null = null;

    while (true) {
      let query = this.db.collection(collection).limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) break;

      const batch = this.db.batch();

      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (oldFieldName in data) {
          batch.update(doc.ref, {
            [newFieldName]: data[oldFieldName],
            [oldFieldName]: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()
          });
          updatedCount++;
        }
      }

      await batch.commit();
      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      logger.info(`Renamed field in ${updatedCount} documents in ${collection}`);
    }

    return updatedCount;
  }

  /**
   * Cleanup expired documents
   */
  async cleanupExpired(
    collection: string,
    expirationField: string,
    batchSize: number = 500
  ): Promise<number> {
    const now = new Date();
    let deletedCount = 0;

    while (true) {
      const snapshot = await this.db
        .collection(collection)
        .where(expirationField, '<', now)
        .limit(batchSize)
        .get();

      if (snapshot.empty) break;

      const batch = this.db.batch();

      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
      });

      await batch.commit();

      logger.info(`Deleted ${deletedCount} expired documents from ${collection}`);
    }

    return deletedCount;
  }
}

// ============================================================================
// BACKUP UTILITIES
// ============================================================================

export class BackupUtilities {
  private db: Firestore;

  constructor() {
    this.db = firestoreDb;
  }

  /**
   * Export collection to JSON
   */
  async exportCollection(collection: string): Promise<DocumentData[]> {
    const snapshot = await this.db.collection(collection).get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  /**
   * Import collection from JSON
   */
  async importCollection(
    collection: string,
    data: DocumentData[],
    batchSize: number = 500
  ): Promise<number> {
    let importedCount = 0;

    const chunks = this.chunkArray(data, batchSize);

    for (const chunk of chunks) {
      const batch = this.db.batch();

      for (const item of chunk) {
        const { id, ...docData } = item;
        const docRef = this.db.collection(collection).doc(id || this.db.collection(collection).doc().id);
        batch.set(docRef, docData);
        importedCount++;
      }

      await batch.commit();
    }

    logger.info(`Imported ${importedCount} documents to ${collection}`);
    return importedCount;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

export const firestoreUtilities = new FirestoreUtilities();
export const dataMigration = new DataMigration();
export const backupUtilities = new BackupUtilities();

export default {
  firestoreUtilities,
  dataMigration,
  backupUtilities
};