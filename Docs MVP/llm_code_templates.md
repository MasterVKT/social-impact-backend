# Templates de Code Complets pour Génération LLM
## Social Finance Impact Platform MVP

## 1. Templates des fichiers de configuration

### 1.1 package.json complet

```json
{
  "name": "social-impact-backend",
  "version": "1.0.0",
  "description": "Backend Firebase pour Social Finance Impact Platform",
  "main": "lib/index.js",
  "scripts": {
    "build": "tsc",
    "serve": "npm run build && firebase emulators:start",
    "shell": "firebase functions:shell",
    "start": "npm run shell",
    "deploy": "firebase deploy --only functions",
    "logs": "firebase functions:log",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint src/**/*.ts",
    "lint:fix": "eslint src/**/*.ts --fix"
  },
  "engines": {
    "node": "18"
  },
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^4.8.0",
    "joi": "^17.11.0",
    "stripe": "^14.14.0",
    "axios": "^1.6.0",
    "crypto": "^1.0.1",
    "moment": "^2.29.4",
    "@sendgrid/mail": "^7.7.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.53.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.2.0",
    "firebase-functions-test": "^3.1.0",
    "@firebase/rules-unit-testing": "^2.0.7"
  }
}
```

### 1.2 tsconfig.json strict

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2018",
    "lib": ["ES2018"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./lib",
    "rootDir": "./src",
    "removeComments": true,
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "moduleResolution": "node",
    "baseUrl": "./",
    "paths": {
      "*": ["node_modules/*"]
    },
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "lib",
    "**/*.test.ts"
  ]
}
```

### 1.3 firebase.json complet

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "ignore": [
        "node_modules",
        ".git",
        "firebase-debug.log",
        "firebase-debug.*.log",
        "*.local"
      ],
      "predeploy": [
        "npm --prefix \"$RESOURCE_DIR\" run lint",
        "npm --prefix \"$RESOURCE_DIR\" run build"
      ]
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  },
  "emulators": {
    "auth": {
      "port": 9099
    },
    "functions": {
      "port": 5001
    },
    "firestore": {
      "port": 8080
    },
    "storage": {
      "port": 9199
    },
    "ui": {
      "enabled": true,
      "port": 4000
    },
    "singleProjectMode": true
  }
}
```

## 2. Templates des modules utilitaires

### 2.1 src/utils/errors.ts complet

```typescript
import { https } from 'firebase-functions';
import { logger } from './logger';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;

  constructor(code: string, message: string, statusCode: number = 500, context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super('VALIDATION_ERROR', message, 400);
    this.field = field;
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('AUTHENTICATION_ERROR', message, 401);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super('AUTHORIZATION_ERROR', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super('CONFLICT_ERROR', message, 409);
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError: any;

  constructor(service: string, originalError: any, message?: string) {
    super(
      'EXTERNAL_SERVICE_ERROR',
      message || `${service} service error: ${originalError.message}`,
      502
    );
    this.service = service;
    this.originalError = originalError;
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(rule: string, message: string) {
    super('BUSINESS_RULE_VIOLATION', `${rule}: ${message}`, 400, { rule });
  }
}

const httpsErrorCodeMapping: Record<string, any> = {
  'VALIDATION_ERROR': 'invalid-argument',
  'AUTHENTICATION_ERROR': 'unauthenticated',
  'AUTHORIZATION_ERROR': 'permission-denied',
  'NOT_FOUND': 'not-found',
  'CONFLICT_ERROR': 'already-exists',
  'EXTERNAL_SERVICE_ERROR': 'unavailable',
  'BUSINESS_RULE_VIOLATION': 'failed-precondition'
};

export function convertToHttpsError(error: any): https.HttpsError {
  if (error instanceof https.HttpsError) {
    return error;
  }

  if (error instanceof AppError) {
    const code = httpsErrorCodeMapping[error.code] || 'internal';
    return new https.HttpsError(code, error.message, error.context);
  }

  // Log unexpected errors
  logger.error('Unhandled error type', error, { errorType: error.constructor.name });
  
  return new https.HttpsError(
    'internal',
    'An unexpected error occurred',
    { originalError: error.message }
  );
}

export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw convertToHttpsError(error);
    }
  };
}

export function withRetry<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  maxRetries: number = 3,
  backoffMs: number = 1000
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) break;
        
        // Only retry on transient errors
        if (error instanceof ExternalServiceError) {
          const delay = backoffMs * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        break; // Don't retry non-transient errors
      }
    }
    
    throw lastError;
  };
}
```

### 2.2 src/utils/validation.ts complet

```typescript
import Joi from 'joi';
import { ValidationError } from './errors';

export const commonSchemas = {
  uid: Joi.string().min(1).max(128).required(),
  email: Joi.string().email().required(),
  phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/),
  amount: Joi.number().integer().min(1000).max(10000000), // 10€ à 100k€ en centimes
  currency: Joi.string().valid('EUR').required(),
  country: Joi.string().length(2).uppercase().required(),
  language: Joi.string().valid('fr', 'en').required(),
  projectId: Joi.string().min(1).max(50).required(),
  userType: Joi.string().valid('contributor', 'creator', 'auditor').required(),
  kycStatus: Joi.string().valid('pending', 'approved', 'rejected', 'requires_action').required(),
  
  address: Joi.object({
    street: Joi.string().min(5).max(200).required(),
    city: Joi.string().min(2).max(100).required(),
    postalCode: Joi.string().min(3).max(10).required(),
    country: Joi.string().length(2).uppercase().required()
  }).required(),

  dateRange: Joi.object({
    startDate: Joi.date().iso().required(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')).required()
  }).required(),

  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(50).default(20),
    offset: Joi.number().integer().min(0).default(0),
    orderBy: Joi.string().optional(),
    orderDirection: Joi.string().valid('asc', 'desc').default('desc')
  }).optional()
};

export function validateWithJoi<T>(schema: Joi.ObjectSchema, data: unknown): T {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true
  });

  if (error) {
    const firstError = error.details[0];
    throw new ValidationError(
      firstError.message,
      firstError.path.join('.')
    );
  }

  return value as T;
}

export function isValidEmail(email: string): boolean {
  const schema = Joi.string().email();
  const { error } = schema.validate(email);
  return !error;
}

export function isValidAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount >= 1000 && amount <= 10000000;
}

export function isValidProjectSlug(slug: string): boolean {
  const schema = Joi.string().pattern(/^[a-z0-9-]+$/).min(3).max(50);
  const { error } = schema.validate(slug);
  return !error;
}

export function generateProjectSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export function calculateFees(amount: number): { platform: number; audit: number; stripe: number; total: number } {
  const platformFee = Math.round(amount * 0.05); // 5%
  const auditFee = Math.round(amount * 0.03); // 3%
  const stripeFee = Math.round(amount * 0.029 + 30); // ~2.9% + 0.30€
  
  return {
    platform: platformFee,
    audit: auditFee,
    stripe: stripeFee,
    total: platformFee + auditFee + stripeFee
  };
}

export function isValidIBAN(iban: string): boolean {
  const ibanRegex = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}$/;
  if (!ibanRegex.test(iban.replace(/\s/g, ''))) return false;
  
  // IBAN checksum validation (basic)
  const cleanIban = iban.replace(/\s/g, '');
  const rearranged = cleanIban.substring(4) + cleanIban.substring(0, 4);
  const numericString = rearranged.replace(/[A-Z]/g, (char) => (char.charCodeAt(0) - 55).toString());
  
  let remainder = '';
  for (let i = 0; i < numericString.length; i += 7) {
    remainder = String(parseInt(remainder + numericString.substring(i, i + 7)) % 97);
  }
  
  return parseInt(remainder) === 1;
}

export const projectValidation = {
  title: Joi.string().min(10).max(100).required(),
  shortDescription: Joi.string().min(50).max(300).required(),
  fullDescription: Joi.string().min(200).max(5000).required(),
  category: Joi.string().valid('environment', 'education', 'health', 'community', 'innovation').required(),
  fundingGoal: commonSchemas.amount.required(),
  duration: Joi.number().integer().min(30).max(90).required(), // 30-90 jours
  location: Joi.object({
    city: Joi.string().min(2).max(100).required(),
    country: commonSchemas.country.required(),
    coordinates: Joi.object({
      lat: Joi.number().min(-90).max(90).required(),
      lng: Joi.number().min(-180).max(180).required()
    }).optional()
  }).required(),
  milestones: Joi.array().items(
    Joi.object({
      title: Joi.string().min(5).max(100).required(),
      description: Joi.string().min(20).max(500).required(),
      targetDate: Joi.date().iso().greater('now').required(),
      fundingPercentage: Joi.number().min(1).max(100).required(),
      deliverables: Joi.array().items(Joi.string().min(5).max(200)).min(1).required()
    })
  ).min(1).max(5).required()
};
```

### 2.3 src/utils/firestore.ts complet

```typescript
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
```

## 3. Template de fonction Firebase complète

### 3.1 Template createProject complet

```typescript
// src/projects/createProject.ts
import { https } from 'firebase-functions';
import { CallableContext } from 'firebase-functions/v1/https';
import { getFirestore } from 'firebase-admin/firestore';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { withErrorHandling } from '../utils/errors';
import { validateWithJoi, projectValidation, generateProjectSlug } from '../utils/validation';
import { firestoreHelper } from '../utils/firestore';

interface CreateProjectRequest {
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: string;
  fundingGoal: number;
  duration: number;
  location: {
    city: string;
    country: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  milestones: Array<{
    title: string;
    description: string;
    targetDate: string;
    fundingPercentage: number;
    deliverables: string[];
  }>;
  images?: Array<{
    url: string;
    caption?: string;
    isMain?: boolean;
  }>;
  tags?: string[];
}

interface CreateProjectResponse {
  projectId: string;
  slug: string;
  status: string;
  estimatedApprovalTime: string;
}

const requestSchema = Joi.object({
  title: projectValidation.title,
  shortDescription: projectValidation.shortDescription,
  fullDescription: projectValidation.fullDescription,
  category: projectValidation.category,
  fundingGoal: projectValidation.fundingGoal,
  duration: projectValidation.duration,
  location: projectValidation.location,
  milestones: projectValidation.milestones,
  images: Joi.array().items(
    Joi.object({
      url: Joi.string().uri().required(),
      caption: Joi.string().max(200).optional(),
      isMain: Joi.boolean().optional()
    })
  ).max(10).optional(),
  tags: Joi.array().items(Joi.string().min(2).max(30)).max(10).optional()
}).required();

async function validateUserCanCreateProject(uid: string): Promise<void> {
  const user = await firestoreHelper.getDocument<any>('users', uid);
  
  if (!user.profileComplete) {
    throw new https.HttpsError('failed-precondition', 'Profile must be completed');
  }
  
  if (user.kycStatus !== 'approved') {
    throw new https.HttpsError('failed-precondition', 'KYC verification required');
  }
  
  if (user.userType !== 'creator') {
    throw new https.HttpsError('permission-denied', 'Only creators can create projects');
  }

  // Check active projects limit
  const activeProjects = await firestoreHelper.queryDocuments(
    'projects',
    [
      { field: 'creatorUid', operator: '==', value: uid },
      { field: 'status', operator: 'in', value: ['draft', 'pending_approval', 'live'] }
    ]
  );

  if (activeProjects.data.length >= 3) {
    throw new https.HttpsError('resource-exhausted', 'Maximum active projects limit reached');
  }
}

function generateProjectId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `proj_${timestamp}_${random}`;
}

async function executeCreateProject(
  data: CreateProjectRequest,
  context: CallableContext
): Promise<CreateProjectResponse> {
  const uid = context.auth!.uid;
  
  // Validation des permissions
  await validateUserCanCreateProject(uid);
  
  const projectId = generateProjectId();
  const slug = generateProjectSlug(data.title);
  const now = new Date();
  const endDate = new Date(now.getTime() + (data.duration * 24 * 60 * 60 * 1000));
  
  // Validation des milestones
  let cumulativePercentage = 0;
  const validatedMilestones = data.milestones.map((milestone, index) => {
    cumulativePercentage += milestone.fundingPercentage;
    return {
      id: `milestone_${index + 1}`,
      ...milestone,
      targetDate: new Date(milestone.targetDate),
      status: 'pending',
      cumulativePercentage,
      order: index + 1
    };
  });

  if (cumulativePercentage !== 100) {
    throw new https.HttpsError('invalid-argument', 'Milestones must total 100% funding');
  }

  // Création du projet
  const projectData = {
    id: projectId,
    slug,
    title: data.title,
    shortDescription: data.shortDescription,
    fullDescription: data.fullDescription,
    category: data.category,
    fundingGoal: data.fundingGoal,
    fundingRaised: 0,
    fundingPercentage: 0,
    duration: data.duration,
    endDate,
    location: data.location,
    milestones: validatedMilestones,
    images: data.images || [],
    tags: data.tags || [],
    
    // Metadata du créateur
    creatorUid: uid,
    creatorInfo: {
      uid,
      displayName: '', // À remplir depuis le profil utilisateur
      profilePicture: '',
      verifiedCreator: false
    },
    
    // Statuts
    status: 'draft',
    moderationStatus: 'pending',
    visibility: 'private',
    
    // Statistiques
    stats: {
      views: 0,
      contributions: 0,
      contributors: 0,
      shares: 0,
      likes: 0,
      comments: 0
    },
    
    // Audit trail
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    
    // Configuration
    settings: {
      allowAnonymousContributions: false,
      autoPublishUpdates: true,
      enableComments: true,
      requireContributorApproval: false
    }
  };

  // Récupération des infos créateur
  const creator = await firestoreHelper.getDocument<any>('users', uid);
  projectData.creatorInfo = {
    uid,
    displayName: `${creator.firstName} ${creator.lastName}`,
    profilePicture: creator.profilePicture || '',
    verifiedCreator: creator.stats?.successfulProjects > 0
  };

  // Transaction pour créer le projet et mettre à jour les stats utilisateur
  await firestoreHelper.runTransaction(async (transaction) => {
    // Créer le projet
    const projectRef = firestoreHelper.getDocumentRef('projects', projectId);
    transaction.set(projectRef, projectData);
    
    // Mettre à jour les stats utilisateur
    const userRef = firestoreHelper.getDocumentRef('users', uid);
    transaction.update(userRef, {
      'stats.projectsCreated': (creator.stats?.projectsCreated || 0) + 1,
      updatedAt: now
    });
  });

  logger.info('Project created successfully', {
    projectId,
    slug,
    creatorUid: uid,
    category: data.category,
    fundingGoal: data.fundingGoal
  });

  return {
    projectId,
    slug,
    status: 'draft',
    estimatedApprovalTime: '24-48 hours'
  };
}

export const createProject = https.onCall(
  withErrorHandling(async (data: unknown, context: CallableContext): Promise<CreateProjectResponse> => {
    // Authentification requise
    if (!context.auth) {
      throw new https.HttpsError('unauthenticated', 'Authentication required');
    }

    // Validation des données
    const validatedData = validateWithJoi<CreateProjectRequest>(requestSchema, data);

    // Logging de démarrage
    logger.info('Creating project', {
      functionName: 'createProject',
      uid: context.auth.uid,
      title: validatedData.title,
      category: validatedData.category
    });

    // Exécution
    const result = await executeCreateProject(validatedData, context);

    // Logging de succès
    logger.info('Project created', {
      functionName: 'createProject',
      uid: context.auth.uid,
      projectId: result.projectId,
      success: true
    });

    return result;
  })
);
```

## 4. Template de tests complet

### 4.1 Test createProject complet

```typescript
// src/projects/__tests__/createProject.test.ts
import { createProject } from '../createProject';
import { testUtils } from '../../test/utils';
import { firestoreHelper } from '../../utils/firestore';

describe('createProject', () => {
  let testEnv: any;
  let mockAuth: any;

  beforeAll(async () => {
    testEnv = await testUtils.initializeTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearAuth();
    
    // Setup mock user with completed profile and KYC
    mockAuth = {
      uid: 'test-creator-uid',
      token: {
        email: 'creator@test.com',
        role: 'creator',
        kycStatus: 'approved'
      }
    };

    // Create user document
    await firestoreHelper.setDocument('users', mockAuth.uid, {
      uid: mockAuth.uid,
      email: 'creator@test.com',
      firstName: 'Test',
      lastName: 'Creator',
      userType: 'creator',
      profileComplete: true,
      kycStatus: 'approved',
      stats: {
        projectsCreated: 0,
        successfulProjects: 0
      }
    });
  });

  const validProjectData = {
    title: 'Test Project for Environmental Impact',
    shortDescription: 'This is a comprehensive test project designed to validate our system functionality and ensure proper project creation workflows.',
    fullDescription: 'This is a detailed description of the test project that meets the minimum length requirements. It describes the project goals, methodology, expected outcomes, and how it will create positive environmental impact. The project aims to develop sustainable solutions that can be replicated and scaled to make a meaningful difference in environmental conservation.',
    category: 'environment',
    fundingGoal: 50000, // 500€
    duration: 60,
    location: {
      city: 'Paris',
      country: 'FR',
      coordinates: {
        lat: 48.8566,
        lng: 2.3522
      }
    },
    milestones: [
      {
        title: 'Research and Planning Phase',
        description: 'Complete initial research and project planning with stakeholder engagement',
        targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        fundingPercentage: 40,
        deliverables: ['Research report', 'Project plan', 'Stakeholder agreements']
      },
      {
        title: 'Implementation Phase',
        description: 'Execute the main project activities and develop core solutions',
        targetDate: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString(),
        fundingPercentage: 60,
        deliverables: ['Solution prototype', 'Testing results', 'Final implementation']
      }
    ],
    tags: ['environment', 'sustainability', 'innovation']
  };

  describe('Success cases', () => {
    test('should create project with valid data', async () => {
      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      const result = await createProject(validProjectData, mockContext);

      expect(result).toMatchObject({
        projectId: expect.stringMatching(/^proj_/),
        slug: expect.stringContaining('test-project'),
        status: 'draft',
        estimatedApprovalTime: '24-48 hours'
      });

      // Verify project was created in Firestore
      const project = await firestoreHelper.getDocument('projects', result.projectId);
      expect(project).toMatchObject({
        title: validProjectData.title,
        creatorUid: mockAuth.uid,
        status: 'draft',
        fundingGoal: validProjectData.fundingGoal
      });

      // Verify user stats were updated
      const user = await firestoreHelper.getDocument('users', mockAuth.uid);
      expect(user.stats.projectsCreated).toBe(1);
    });

    test('should handle project with minimal required fields', async () => {
      const minimalProject = {
        title: 'Minimal Test Project Title Here',
        shortDescription: 'This is a minimal project description that meets the required length of at least fifty characters to pass validation.',
        fullDescription: 'This is a more detailed description that provides comprehensive information about the project goals, methodology, expected impact, and how it will be executed. It meets the minimum length requirements for the full description field and provides enough context for potential contributors.',
        category: 'environment',
        fundingGoal: 10000,
        duration: 30,
        location: {
          city: 'Test City',
          country: 'FR'
        },
        milestones: [
          {
            title: 'Single Milestone',
            description: 'Complete the entire project in this milestone',
            targetDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
            fundingPercentage: 100,
            deliverables: ['Final deliverable']
          }
        ]
      };

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      const result = await createProject(minimalProject, mockContext);
      expect(result.projectId).toBeDefined();
      expect(result.status).toBe('draft');
    });
  });

  describe('Validation errors', () => {
    test('should reject unauthenticated requests', async () => {
      const mockContext = {
        auth: null,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Authentication required');
    });

    test('should reject if user profile not complete', async () => {
      // Update user to incomplete profile
      await firestoreHelper.updateDocument('users', mockAuth.uid, {
        profileComplete: false
      });

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Profile must be completed');
    });

    test('should reject if KYC not approved', async () => {
      await firestoreHelper.updateDocument('users', mockAuth.uid, {
        kycStatus: 'pending'
      });

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('KYC verification required');
    });

    test('should reject invalid milestone percentages', async () => {
      const invalidProject = {
        ...validProjectData,
        milestones: [
          {
            ...validProjectData.milestones[0],
            fundingPercentage: 70
          },
          {
            ...validProjectData.milestones[1],
            fundingPercentage: 50 // Total = 120%
          }
        ]
      };

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(invalidProject, mockContext)
      ).rejects.toThrow('Milestones must total 100% funding');
    });

    test('should enforce active projects limit', async () => {
      // Create 3 active projects
      for (let i = 0; i < 3; i++) {
        await firestoreHelper.setDocument('projects', `existing-project-${i}`, {
          creatorUid: mockAuth.uid,
          status: 'live',
          title: `Existing Project ${i}`
        });
      }

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(validProjectData, mockContext)
      ).rejects.toThrow('Maximum active projects limit reached');
    });
  });

  describe('Data validation', () => {
    test('should reject too short title', async () => {
      const invalidProject = {
        ...validProjectData,
        title: 'Short'
      };

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(invalidProject, mockContext)
      ).rejects.toThrow();
    });

    test('should reject invalid funding goal', async () => {
      const invalidProject = {
        ...validProjectData,
        fundingGoal: 500 // Less than minimum 1000 (10€)
      };

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(invalidProject, mockContext)
      ).rejects.toThrow();
    });

    test('should reject invalid category', async () => {
      const invalidProject = {
        ...validProjectData,
        category: 'invalid-category'
      };

      const mockContext = {
        auth: mockAuth,
        rawRequest: { ip: '127.0.0.1' }
      };

      await expect(
        createProject(invalidProject, mockContext)
      ).rejects.toThrow();
    });
  });
});
```

Cette structure de templates permet à un LLM de générer un backend Firebase complet, cohérent et fonctionnel en suivant des patterns stricts et testés.