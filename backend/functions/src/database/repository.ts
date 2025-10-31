/**
 * Data Access Layer - Repository Pattern
 * Social Finance Impact Platform
 * 
 * Provides high-level database operations with caching,
 * transaction support, and performance optimization
 */

import { 
  Firestore, 
  DocumentReference, 
  CollectionReference, 
  Query, 
  QuerySnapshot,
  DocumentSnapshot,
  WriteBatch,
  Transaction,
  FieldValue,
  Timestamp
} from 'firebase-admin/firestore';
import { firestoreDb } from '../config/database';
import { logger } from '../utils/logger';
import { performanceMonitor } from '../monitoring/performanceMonitor';
import { metricsCollector } from '../monitoring/metricsCollector';
import { DatabaseError, NotFoundError } from '../utils/errors';

// ============================================================================
// BASE REPOSITORY INTERFACE
// ============================================================================

export interface BaseEntity {
  id: string;
  createdAt: Date | Timestamp | FieldValue;
  updatedAt: Date | Timestamp | FieldValue;
  version: number;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  where?: Array<{ field: string; operator: FirebaseFirestore.WhereFilterOp; value: any }>;
  select?: string[];
}

export interface PaginationResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  previousCursor?: string;
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  key?: string;
  tags?: string[];
}

// ============================================================================
// BASE REPOSITORY CLASS
// ============================================================================

export abstract class BaseRepository<T extends BaseEntity> {
  protected db: Firestore;
  protected collection: CollectionReference;
  protected cache: Map<string, { data: T; expiresAt: number; tags: string[] }>;
  protected collectionName: string;

  constructor(collectionName: string) {
    this.db = firestoreDb;
    this.collectionName = collectionName;
    this.collection = this.db.collection(collectionName);
    this.cache = new Map();
    
    // Setup cache cleanup
    setInterval(() => this.cleanupExpiredCache(), 5 * 60 * 1000); // Every 5 minutes
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  async create(data: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'version'>, options?: { id?: string }): Promise<T> {
    const traceId = await performanceMonitor.startTrace('db_create', 'database', {
      collection: this.collectionName
    });

    try {
      const id = options?.id || this.collection.doc().id;
      const now = Timestamp.now();
      
      const entity: T = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
        version: 1
      } as T;

      await this.collection.doc(id).set(entity);
      
      // Update cache
      this.setCache(id, entity);
      
      // Record metrics
      await metricsCollector.recordCounter('database.operations', 1, {
        operation: 'create',
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { documentId: id });
      
      logger.info('Document created', {
        collection: this.collectionName,
        documentId: id
      });

      return entity;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to create ${this.collectionName} document`,
        'create',
        this.collectionName,
        { originalError: (error as Error).message }
      );
    }
  }

  async findById(id: string, options?: { useCache?: boolean }): Promise<T | null> {
    const traceId = await performanceMonitor.startTrace('db_findById', 'database', {
      collection: this.collectionName,
      documentId: id
    });

    try {
      // Check cache first
      if (options?.useCache !== false) {
        const cached = this.getCache(id);
        if (cached) {
          await performanceMonitor.endTrace(traceId, 'success', { source: 'cache' });
          return cached;
        }
      }

      const doc = await this.collection.doc(id).get();
      
      if (!doc.exists) {
        await performanceMonitor.endTrace(traceId, 'success', { found: false });
        return null;
      }

      const entity = { id: doc.id, ...doc.data() } as T;
      
      // Cache the result
      this.setCache(id, entity);
      
      // Record metrics
      await metricsCollector.recordCounter('database.operations', 1, {
        operation: 'read',
        collection: this.collectionName,
        found: 'true'
      });

      await performanceMonitor.endTrace(traceId, 'success', { found: true });
      
      return entity;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to find ${this.collectionName} document`,
        'read',
        this.collectionName,
        { documentId: id, originalError: (error as Error).message }
      );
    }
  }

  async findByIdOrThrow(id: string, options?: { useCache?: boolean }): Promise<T> {
    const entity = await this.findById(id, options);
    if (!entity) {
      throw new NotFoundError(`${this.collectionName} with ID '${id}' not found`);
    }
    return entity;
  }

  async update(id: string, updates: Partial<Omit<T, 'id' | 'createdAt' | 'version'>>, options?: { increaseVersion?: boolean }): Promise<T> {
    const traceId = await performanceMonitor.startTrace('db_update', 'database', {
      collection: this.collectionName,
      documentId: id
    });

    try {
      const docRef = this.collection.doc(id);
      
      // Use transaction for consistency
      const result = await this.db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);
        
        if (!doc.exists) {
          throw new NotFoundError(`${this.collectionName} with ID '${id}' not found`);
        }

        const currentData = doc.data() as T;
        const newVersion = options?.increaseVersion !== false ? (currentData.version || 0) + 1 : currentData.version;
        
        const updatedData = {
          ...updates,
          updatedAt: Timestamp.now(),
          version: newVersion
        };

        transaction.update(docRef, updatedData);
        
        return { ...currentData, ...updatedData } as T;
      });

      // Invalidate cache
      this.invalidateCache(id);
      
      // Record metrics
      await metricsCollector.recordCounter('database.operations', 1, {
        operation: 'update',
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { documentId: id });
      
      logger.info('Document updated', {
        collection: this.collectionName,
        documentId: id
      });

      return result;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new DatabaseError(
        `Failed to update ${this.collectionName} document`,
        'update',
        this.collectionName,
        { documentId: id, originalError: (error as Error).message }
      );
    }
  }

  async delete(id: string, options?: { soft?: boolean }): Promise<void> {
    const traceId = await performanceMonitor.startTrace('db_delete', 'database', {
      collection: this.collectionName,
      documentId: id,
      soft: options?.soft || false
    });

    try {
      const docRef = this.collection.doc(id);
      
      if (options?.soft) {
        // Soft delete - mark as deleted
        await docRef.update({
          deletedAt: Timestamp.now(),
          isDeleted: true,
          updatedAt: Timestamp.now(),
          version: FieldValue.increment(1)
        });
      } else {
        // Hard delete
        await docRef.delete();
      }

      // Invalidate cache
      this.invalidateCache(id);
      
      // Record metrics
      await metricsCollector.recordCounter('database.operations', 1, {
        operation: options?.soft ? 'soft_delete' : 'delete',
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { documentId: id });
      
      logger.info('Document deleted', {
        collection: this.collectionName,
        documentId: id,
        soft: options?.soft || false
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to delete ${this.collectionName} document`,
        'delete',
        this.collectionName,
        { documentId: id, originalError: (error as Error).message }
      );
    }
  }

  // ============================================================================
  // QUERY OPERATIONS
  // ============================================================================

  async find(options?: QueryOptions): Promise<T[]> {
    const traceId = await performanceMonitor.startTrace('db_find', 'database', {
      collection: this.collectionName,
      limit: options?.limit
    });

    try {
      let query: Query = this.collection;

      // Apply where conditions
      if (options?.where) {
        for (const condition of options.where) {
          query = query.where(condition.field, condition.operator, condition.value);
        }
      }

      // Apply ordering
      if (options?.orderBy) {
        for (const order of options.orderBy) {
          query = query.orderBy(order.field, order.direction);
        }
      }

      // Apply pagination
      if (options?.offset) {
        query = query.offset(options.offset);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      // Apply field selection
      if (options?.select) {
        query = query.select(...options.select);
      }

      const snapshot = await query.get();
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));

      // Record metrics
      await metricsCollector.recordCounter('database.operations', 1, {
        operation: 'query',
        collection: this.collectionName
      });

      await metricsCollector.recordHistogram('database.query_results', results.length, {
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { 
        resultCount: results.length 
      });

      return results;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to query ${this.collectionName} collection`,
        'query',
        this.collectionName,
        { originalError: (error as Error).message }
      );
    }
  }

  async findOne(options?: Omit<QueryOptions, 'limit' | 'offset'>): Promise<T | null> {
    const results = await this.find({ ...options, limit: 1 });
    return results.length > 0 ? results[0] : null;
  }

  async count(options?: Omit<QueryOptions, 'limit' | 'offset' | 'select' | 'orderBy'>): Promise<number> {
    const traceId = await performanceMonitor.startTrace('db_count', 'database', {
      collection: this.collectionName
    });

    try {
      let query: Query = this.collection;

      // Apply where conditions
      if (options?.where) {
        for (const condition of options.where) {
          query = query.where(condition.field, condition.operator, condition.value);
        }
      }

      const snapshot = await query.count().get();
      const count = snapshot.data().count;

      await performanceMonitor.endTrace(traceId, 'success', { count });

      return count;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to count ${this.collectionName} documents`,
        'count',
        this.collectionName,
        { originalError: (error as Error).message }
      );
    }
  }

  async paginate(options?: QueryOptions & { cursor?: string }): Promise<PaginationResult<T>> {
    const traceId = await performanceMonitor.startTrace('db_paginate', 'database', {
      collection: this.collectionName,
      limit: options?.limit
    });

    try {
      const limit = options?.limit || 20;
      let query: Query = this.collection;

      // Apply where conditions
      if (options?.where) {
        for (const condition of options.where) {
          query = query.where(condition.field, condition.operator, condition.value);
        }
      }

      // Apply ordering
      if (options?.orderBy) {
        for (const order of options.orderBy) {
          query = query.orderBy(order.field, order.direction);
        }
      }

      // Apply cursor pagination
      if (options?.cursor) {
        const cursorDoc = await this.collection.doc(options.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Get one extra document to check if there are more
      const snapshot = await query.limit(limit + 1).get();
      const docs = snapshot.docs;
      
      const hasMore = docs.length > limit;
      const data = docs.slice(0, limit).map(doc => ({ id: doc.id, ...doc.data() } as T));
      
      const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].id : undefined;
      
      // Get total count (expensive operation - consider caching)
      const total = await this.count({ where: options?.where });

      const result: PaginationResult<T> = {
        data,
        total,
        hasMore,
        nextCursor
      };

      await performanceMonitor.endTrace(traceId, 'success', { 
        resultCount: data.length,
        hasMore
      });

      return result;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to paginate ${this.collectionName} collection`,
        'paginate',
        this.collectionName,
        { originalError: (error as Error).message }
      );
    }
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  async batchCreate(entities: Array<Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'version'>>): Promise<T[]> {
    const traceId = await performanceMonitor.startTrace('db_batch_create', 'database', {
      collection: this.collectionName,
      count: entities.length
    });

    try {
      const batch = this.db.batch();
      const results: T[] = [];
      const now = Timestamp.now();

      for (const entityData of entities) {
        const id = this.collection.doc().id;
        const entity: T = {
          ...entityData,
          id,
          createdAt: now,
          updatedAt: now,
          version: 1
        } as T;

        batch.set(this.collection.doc(id), entity);
        results.push(entity);
      }

      await batch.commit();

      // Update cache for all entities
      for (const entity of results) {
        this.setCache(entity.id, entity);
      }

      // Record metrics
      await metricsCollector.recordCounter('database.operations', entities.length, {
        operation: 'batch_create',
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { 
        count: entities.length 
      });

      return results;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to batch create ${this.collectionName} documents`,
        'batch_create',
        this.collectionName,
        { count: entities.length, originalError: (error as Error).message }
      );
    }
  }

  async batchUpdate(updates: Array<{ id: string; data: Partial<Omit<T, 'id' | 'createdAt' | 'version'>> }>): Promise<void> {
    const traceId = await performanceMonitor.startTrace('db_batch_update', 'database', {
      collection: this.collectionName,
      count: updates.length
    });

    try {
      const batch = this.db.batch();
      const now = Timestamp.now();

      for (const update of updates) {
        const updateData = {
          ...update.data,
          updatedAt: now,
          version: FieldValue.increment(1)
        };

        batch.update(this.collection.doc(update.id), updateData);
        
        // Invalidate cache
        this.invalidateCache(update.id);
      }

      await batch.commit();

      // Record metrics
      await metricsCollector.recordCounter('database.operations', updates.length, {
        operation: 'batch_update',
        collection: this.collectionName
      });

      await performanceMonitor.endTrace(traceId, 'success', { 
        count: updates.length 
      });

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Failed to batch update ${this.collectionName} documents`,
        'batch_update',
        this.collectionName,
        { count: updates.length, originalError: (error as Error).message }
      );
    }
  }

  // ============================================================================
  // TRANSACTION SUPPORT
  // ============================================================================

  async runTransaction<R>(operation: (transaction: Transaction) => Promise<R>): Promise<R> {
    const traceId = await performanceMonitor.startTrace('db_transaction', 'database', {
      collection: this.collectionName
    });

    try {
      const result = await this.db.runTransaction(operation);

      await performanceMonitor.endTrace(traceId, 'success');

      return result;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw new DatabaseError(
        `Transaction failed for ${this.collectionName}`,
        'transaction',
        this.collectionName,
        { originalError: (error as Error).message }
      );
    }
  }

  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================

  private setCache(id: string, entity: T, options?: CacheOptions): void {
    const ttl = options?.ttl || 300; // 5 minutes default
    const expiresAt = Date.now() + (ttl * 1000);
    const tags = options?.tags || [];

    this.cache.set(id, {
      data: entity,
      expiresAt,
      tags
    });
  }

  private getCache(id: string): T | null {
    const cached = this.cache.get(id);
    
    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expiresAt) {
      this.cache.delete(id);
      return null;
    }

    return cached.data;
  }

  private invalidateCache(id: string): void {
    this.cache.delete(id);
  }

  public invalidateCacheByTag(tag: string): void {
    for (const [id, cached] of this.cache.entries()) {
      if (cached.tags.includes(tag)) {
        this.cache.delete(id);
      }
    }
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [id, cached] of this.cache.entries()) {
      if (now > cached.expiresAt) {
        this.cache.delete(id);
      }
    }
  }

  // ============================================================================
  // HEALTH CHECK
  // ============================================================================

  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency: number }> {
    const startTime = Date.now();
    
    try {
      // Simple read operation to test connectivity
      await this.collection.limit(1).get();
      
      const latency = Date.now() - startTime;
      
      return {
        status: 'healthy',
        latency
      };

    } catch (error) {
      const latency = Date.now() - startTime;
      
      logger.error('Database health check failed', error as Error, {
        collection: this.collectionName,
        latency
      });

      return {
        status: 'unhealthy',
        latency
      };
    }
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  protected getDocumentReference(id: string): DocumentReference {
    return this.collection.doc(id);
  }

  protected getCollectionReference(): CollectionReference {
    return this.collection;
  }

  protected convertTimestamps(data: any): any {
    if (data && typeof data === 'object') {
      const converted = { ...data };
      
      for (const [key, value] of Object.entries(converted)) {
        if (value instanceof Timestamp) {
          converted[key] = value.toDate();
        } else if (typeof value === 'object' && value !== null) {
          converted[key] = this.convertTimestamps(value);
        }
      }
      
      return converted;
    }
    
    return data;
  }
}

export default BaseRepository;