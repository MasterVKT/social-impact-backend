import { getFirestore, DocumentReference, CollectionReference, Query, WriteResult } from 'firebase-admin/firestore';
import { logger } from './logger';
import { NotFoundError } from './errors';

export interface PaginationOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  startAfter?: any;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  nextPageToken?: string;
}

export class FirestoreHelper {
  private db = getFirestore();

  async getDocument<T>(collection: string, docId: string): Promise<T> {
    const doc = await this.db.collection(collection).doc(docId).get();
    
    if (!doc.exists) {
      throw new NotFoundError(`${collection}/${docId}`);
    }
    
    return { id: doc.id, ...doc.data() } as T;
  }

  async getDocumentOptional<T>(collection: string, docId: string): Promise<T | null> {
    const doc = await this.db.collection(collection).doc(docId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as T) : null;
  }

  async setDocument<T extends Record<string, any>>(
    collection: string, 
    docId: string, 
    data: T
  ): Promise<WriteResult> {
    const timestamp = new Date();
    const documentData = {
      ...data,
      updatedAt: timestamp,
      ...(!(await this.db.collection(collection).doc(docId).get()).exists && { createdAt: timestamp })
    };

    logger.info('Setting document', {
      collection,
      docId,
      hasData: !!data
    });

    return this.db.collection(collection).doc(docId).set(documentData, { merge: true });
  }

  async updateDocument<T extends Record<string, any>>(
    collection: string,
    docId: string,
    data: Partial<T>
  ): Promise<WriteResult> {
    const updateData = {
      ...data,
      updatedAt: new Date()
    };

    logger.info('Updating document', {
      collection,
      docId,
      fields: Object.keys(data)
    });

    return this.db.collection(collection).doc(docId).update(updateData);
  }

  async deleteDocument(collection: string, docId: string): Promise<WriteResult> {
    logger.info('Deleting document', { collection, docId });
    return this.db.collection(collection).doc(docId).delete();
  }

  async addDocument<T extends Record<string, any>>(
    collection: string,
    data: T
  ): Promise<DocumentReference> {
    const timestamp = new Date();
    const documentData = {
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    logger.info('Adding document', { collection, hasData: !!data });
    return this.db.collection(collection).add(documentData);
  }

  async queryDocuments<T>(
    collection: string,
    filters: Array<{ field: string; operator: FirebaseFirestore.WhereFilterOp; value: any }> = [],
    options: PaginationOptions = {}
  ): Promise<PaginatedResult<T>> {
    let query: Query = this.db.collection(collection);

    // Apply filters
    filters.forEach(filter => {
      query = query.where(filter.field, filter.operator, filter.value);
    });

    // Apply ordering
    if (options.orderBy) {
      query = query.orderBy(options.orderBy, options.orderDirection || 'desc');
    }

    // Apply pagination
    if (options.startAfter) {
      query = query.startAfter(options.startAfter);
    } else if (options.offset) {
      query = query.offset(options.offset);
    }

    const limit = Math.min(options.limit || 20, 50);
    query = query.limit(limit + 1); // Get one extra to check if there are more

    const snapshot = await query.get();
    const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
    
    const hasMore = docs.length > limit;
    const data = hasMore ? docs.slice(0, limit) : docs;

    logger.info('Query completed', {
      collection,
      filtersCount: filters.length,
      resultCount: data.length,
      hasMore
    });

    return {
      data,
      total: data.length, // Note: total count requires separate query for exact number
      hasMore,
      nextPageToken: hasMore ? snapshot.docs[limit - 1].id : undefined
    };
  }

  async runTransaction<T>(updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(updateFunction);
  }

  async batchWrite(operations: Array<{
    operation: 'set' | 'update' | 'delete';
    collection: string;
    docId: string;
    data?: any;
  }>): Promise<WriteResult[]> {
    const batch = this.db.batch();

    operations.forEach(op => {
      const docRef = this.db.collection(op.collection).doc(op.docId);
      
      switch (op.operation) {
        case 'set':
          batch.set(docRef, { ...op.data, updatedAt: new Date() });
          break;
        case 'update':
          batch.update(docRef, { ...op.data, updatedAt: new Date() });
          break;
        case 'delete':
          batch.delete(docRef);
          break;
      }
    });

    logger.info('Executing batch write', { operationsCount: operations.length });
    return batch.commit();
  }

  getCollectionRef(collection: string): CollectionReference {
    return this.db.collection(collection);
  }

  getDocumentRef(collection: string, docId: string): DocumentReference {
    return this.db.collection(collection).doc(docId);
  }
}

export const firestoreHelper = new FirestoreHelper();

// Commonly used collection helpers
export const collections = {
  users: (uid: string) => firestoreHelper.getDocumentRef('users', uid),
  projects: (projectId: string) => firestoreHelper.getDocumentRef('projects', projectId),
  contributions: (projectId: string, contributionId: string) => 
    firestoreHelper.getDocumentRef(`projects/${projectId}/contributions`, contributionId),
  audits: (auditId: string) => firestoreHelper.getDocumentRef('audits', auditId),
  notifications: (userId: string, notificationId: string) =>
    firestoreHelper.getDocumentRef(`users/${userId}/notifications`, notificationId)
};