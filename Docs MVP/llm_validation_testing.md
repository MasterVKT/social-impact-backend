# Guide de Validation et Testing Automatique pour LLM
## Social Finance Impact Platform MVP

## 1. Stratégie de validation pour génération automatique

### 1.1 Principe de validation multicouche

```
┌─────────────────────────────────────────────────────────────┐
│                   VALIDATION PIPELINE                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. SYNTAX      →  2. SEMANTIC    →  3. FUNCTIONAL         │
│  ┌─────────┐       ┌─────────┐       ┌─────────┐           │
│  │TypeScript│       │Business │       │End-to-End│         │
│  │ESLint    │       │Rules    │       │Integration│        │
│  │Compile   │       │Logic    │       │Load Test  │        │
│  └─────────┘       └─────────┘       └─────────┘           │
│       ↓                 ↓                 ↓                 │
│  PASS/FAIL         PASS/FAIL         PASS/FAIL             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Ordre de validation obligatoire pour LLM** :
1. **Validation syntaxique** - Code compile et respecte les standards
2. **Validation sémantique** - Logique métier correcte et sécurisée
3. **Validation fonctionnelle** - Tests passent et performances acceptables

### 1.2 Configuration Jest complète pour LLM

**`jest.config.js`** optimisé pour génération automatique :
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.interface.ts',
    '!src/**/index.ts',
    '!src/test/**/*',
    '!src/**/__tests__/**/*'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    // Seuils par module
    './src/auth/': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    },
    './src/payments/': {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 30000,
  maxWorkers: 4,
  verbose: true,
  bail: 1, // Arrêt au premier échec pour LLM
  errorOnDeprecated: true,
  detectOpenHandles: true,
  forceExit: true,
  
  // Configuration modules séparés
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.integration.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup.integration.ts'],
      testEnvironment: '<rootDir>/test/firebase-test-environment.js'
    }
  ]
};
```

## 2. Templates de test obligatoires pour chaque type de function

### 2.1 Template test Firebase Function callable

```typescript
// Template standardisé pour tester une Firebase Function callable
import { [functionName] } from '../[functionName]';
import { testUtils } from '../../test/utils/testHelpers';
import { firestoreHelper } from '../../utils/firestore';
import { mockData } from '../../test/utils/mockData';

describe('[functionName]', () => {
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
    
    // Setup utilisateur de test standard
    mockAuth = testUtils.createMockAuth('test-user-id', {
      role: 'contributor',
      kycStatus: 'approved'
    });

    // Création données utilisateur standard
    await testUtils.createTestUser(mockAuth.uid);
  });

  describe('Success cases', () => {
    test('should handle valid request successfully', async () => {
      // Arrange
      const validRequest = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      // Act
      const result = await [functionName](validRequest, mockContext);

      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      
      // Vérifications base de données
      // TODO: Ajouter vérifications spécifiques selon la function
    });

    test('should handle edge cases correctly', async () => {
      // Test avec données limites valides
      const edgeCaseRequest = mockData.create[functionName]EdgeCase();
      const mockContext = testUtils.createMockContext(mockAuth);

      const result = await [functionName](edgeCaseRequest, mockContext);
      
      expect(result).toBeDefined();
      // Assertions spécifiques aux cas limites
    });
  });

  describe('Authentication & Authorization', () => {
    test('should reject unauthenticated requests', async () => {
      const request = mockData.create[functionName]Request();
      const unauthenticatedContext = testUtils.createMockContext(null);

      await expect(
        [functionName](request, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });

    test('should reject requests with insufficient permissions', async () => {
      const unauthorizedAuth = testUtils.createMockAuth('unauthorized-user', {
        role: 'invalid_role'
      });
      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(unauthorizedAuth);

      await expect(
        [functionName](request, mockContext)
      ).rejects.toThrow(/permission|authorization/i);
    });
  });

  describe('Input Validation', () => {
    const invalidCases = [
      { name: 'null data', data: null },
      { name: 'empty object', data: {} },
      { name: 'invalid types', data: { invalidField: 'invalid' } },
      // Ajouter cas spécifiques selon la function
    ];

    test.each(invalidCases)('should reject $name', async ({ data }) => {
      const mockContext = testUtils.createMockContext(mockAuth);

      await expect(
        [functionName](data, mockContext)
      ).rejects.toThrow(/invalid|validation/i);
    });
  });

  describe('Business Logic Validation', () => {
    test('should enforce business rules', async () => {
      // Test des règles métier spécifiques
      // TODO: Implémenter selon les règles de la function
    });

    test('should handle concurrent requests safely', async () => {
      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      // Exécution simultanée pour tester la concurrence
      const promises = Array(3).fill(null).map(() => 
        [functionName](request, mockContext)
      );

      const results = await Promise.allSettled(promises);
      
      // Vérifier qu'une seule opération réussit ou que toutes sont idempotentes
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle external API failures gracefully', async () => {
      // Mock d'échec API externe
      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      // TODO: Simuler échec API externe spécifique à la function

      await expect(
        [functionName](request, mockContext)
      ).rejects.toThrow(/external|service|unavailable/i);
    });

    test('should handle database errors appropriately', async () => {
      // Simulation d'erreur base de données
      jest.spyOn(firestoreHelper, 'getDocument').mockRejectedValue(
        new Error('Database connection failed')
      );

      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      await expect(
        [functionName](request, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    test('should complete within acceptable time', async () => {
      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      const startTime = Date.now();
      await [functionName](request, mockContext);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // 5 secondes max
    });
  });

  describe('Data Integrity', () => {
    test('should maintain data consistency', async () => {
      const request = mockData.create[functionName]Request();
      const mockContext = testUtils.createMockContext(mockAuth);

      await [functionName](request, mockContext);

      // Vérifications de cohérence des données
      // TODO: Ajouter vérifications spécifiques selon la function
    });
  });
});
```

### 2.2 Template test Firebase Function HTTP

```typescript
// Template pour tester une Firebase Function HTTP (webhooks)
import { Request, Response } from 'express';
import { [webhookFunctionName] } from '../[webhookFunctionName]';
import { testUtils } from '../../test/utils/testHelpers';

describe('[webhookFunctionName] HTTP Function', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let statusSpy: jest.Mock;
  let jsonSpy: jest.Mock;
  let sendSpy: jest.Mock;

  beforeEach(() => {
    statusSpy = jest.fn().mockReturnThis();
    jsonSpy = jest.fn().mockReturnThis();
    sendSpy = jest.fn().mockReturnThis();

    mockResponse = {
      status: statusSpy,
      json: jsonSpy,
      send: sendSpy,
      setHeader: jest.fn()
    };

    mockRequest = {
      method: 'POST',
      headers: {},
      body: {},
      rawBody: Buffer.from(''),
      get: jest.fn()
    };
  });

  describe('Request Validation', () => {
    test('should validate webhook signature', async () => {
      const validSignature = testUtils.generateWebhookSignature('test-payload');
      mockRequest.headers = {
        'stripe-signature': validSignature // ou autre header selon service
      };
      mockRequest.body = { type: 'test.event' };

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(200);
    });

    test('should reject invalid signature', async () => {
      mockRequest.headers = {
        'stripe-signature': 'invalid-signature'
      };

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(400);
    });

    test('should reject non-POST requests', async () => {
      mockRequest.method = 'GET';

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(405);
    });
  });

  describe('Event Processing', () => {
    test('should process known event types', async () => {
      const validEvent = {
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            amount: 10000,
            metadata: {
              projectId: 'test-project-id',
              contributorUid: 'test-user-id'
            }
          }
        }
      };

      mockRequest.body = validEvent;
      mockRequest.headers = {
        'stripe-signature': testUtils.generateWebhookSignature(JSON.stringify(validEvent))
      };

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(200);
      // Vérifications spécifiques au traitement de l'événement
    });

    test('should ignore unknown event types', async () => {
      const unknownEvent = {
        type: 'unknown.event.type',
        data: { object: {} }
      };

      mockRequest.body = unknownEvent;
      mockRequest.headers = {
        'stripe-signature': testUtils.generateWebhookSignature(JSON.stringify(unknownEvent))
      };

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(200); // Ignore gracefully
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON', async () => {
      mockRequest.body = 'invalid-json';

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(400);
    });

    test('should handle processing errors', async () => {
      // Mock d'erreur dans le traitement
      const validEvent = { type: 'test.event', data: { object: {} } };
      mockRequest.body = validEvent;

      // Simuler erreur interne
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await [webhookFunctionName](mockRequest as Request, mockResponse as Response);

      expect(statusSpy).toHaveBeenCalledWith(500);
    });
  });
});
```

### 2.3 Template test Firebase Function trigger

```typescript
// Template pour tester une Firebase Function trigger
import { [triggerFunctionName] } from '../[triggerFunctionName]';
import { testUtils } from '../../test/utils/testHelpers';
import { firestore } from 'firebase-admin';

describe('[triggerFunctionName] Trigger', () => {
  let testEnv: any;

  beforeAll(async () => {
    testEnv = await testUtils.initializeTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('Document Creation Trigger', () => {
    test('should execute on document creation', async () => {
      const beforeSnap = testUtils.makeDocumentSnapshot(null, 'collection/doc');
      const afterSnap = testUtils.makeDocumentSnapshot(
        { field: 'value' },
        'collection/doc'
      );

      const change = testUtils.makeChange(beforeSnap, afterSnap);
      const context = testUtils.makeEventContext({
        resource: 'projects/test-project/databases/(default)/documents/collection/doc'
      });

      await [triggerFunctionName](change, context);

      // Vérifications des effets de bord
      // TODO: Ajouter vérifications spécifiques au trigger
    });
  });

  describe('Document Update Trigger', () => {
    test('should execute on relevant field changes', async () => {
      const beforeData = { status: 'pending', amount: 1000 };
      const afterData = { status: 'confirmed', amount: 1000 };

      const beforeSnap = testUtils.makeDocumentSnapshot(beforeData, 'collection/doc');
      const afterSnap = testUtils.makeDocumentSnapshot(afterData, 'collection/doc');

      const change = testUtils.makeChange(beforeSnap, afterSnap);
      const context = testUtils.makeEventContext();

      await [triggerFunctionName](change, context);

      // Vérifications des actions déclenchées
    });

    test('should ignore irrelevant field changes', async () => {
      const beforeData = { status: 'pending', lastSeen: new Date() };
      const afterData = { status: 'pending', lastSeen: new Date() };

      const beforeSnap = testUtils.makeDocumentSnapshot(beforeData, 'collection/doc');
      const afterSnap = testUtils.makeDocumentSnapshot(afterData, 'collection/doc');

      const change = testUtils.makeChange(beforeSnap, afterSnap);
      const context = testUtils.makeEventContext();

      const result = await [triggerFunctionName](change, context);

      // Le trigger devrait retourner sans action
      expect(result).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('should handle corrupted document data', async () => {
      const corruptedData = { invalidField: undefined, missingRequiredField: null };
      
      const beforeSnap = testUtils.makeDocumentSnapshot(null, 'collection/doc');
      const afterSnap = testUtils.makeDocumentSnapshot(corruptedData, 'collection/doc');

      const change = testUtils.makeChange(beforeSnap, afterSnap);
      const context = testUtils.makeEventContext();

      // Le trigger ne devrait pas lever d'exception
      await expect([triggerFunctionName](change, context)).resolves.not.toThrow();
    });
  });
});
```

## 3. Utilitaires de test obligatoires

### 3.1 `test/utils/testHelpers.ts` complet

```typescript
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { setLogLevel } from 'firebase/firestore';
import { firestoreHelper } from '../../utils/firestore';

// Désactiver les logs Firestore pendant les tests
setLogLevel('silent');

export class TestUtils {
  private testEnv: RulesTestEnvironment | null = null;

  async initializeTestEnvironment(): Promise<RulesTestEnvironment> {
    if (!this.testEnv) {
      this.testEnv = await initializeTestEnvironment({
        projectId: `test-project-${Date.now()}`,
        firestore: {
          rules: require('fs').readFileSync('../../firestore.rules', 'utf8'),
          host: 'localhost',
          port: 8080
        },
        storage: {
          rules: require('fs').readFileSync('../../storage.rules', 'utf8'),
          host: 'localhost',
          port: 9199
        }
      });
    }
    return this.testEnv;
  }

  async cleanup(): Promise<void> {
    if (this.testEnv) {
      await this.testEnv.cleanup();
      this.testEnv = null;
    }
  }

  createMockAuth(uid: string, claims: any = {}) {
    return {
      uid,
      token: {
        email: `${uid}@test.com`,
        ...claims,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      }
    };
  }

  createMockContext(auth: any) {
    return {
      auth,
      rawRequest: {
        ip: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent',
          'x-forwarded-for': '127.0.0.1'
        }
      },
      instanceIdToken: null,
      eventId: 'test-event-id',
      timestamp: new Date().toISOString(),
      eventType: 'test.event'
    };
  }

  async createTestUser(uid: string, overrides: any = {}) {
    const userData = {
      uid,
      email: `${uid}@test.com`,
      firstName: 'Test',
      lastName: 'User',
      userType: 'contributor',
      profileComplete: true,
      kycStatus: 'approved',
      kycLevel: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      stats: {
        projectsCreated: 0,
        totalContributed: 0,
        totalRaised: 0,
        successfulProjects: 0
      },
      ...overrides
    };

    await firestoreHelper.setDocument('users', uid, userData);
    return userData;
  }

  async createTestProject(creatorUid: string, overrides: any = {}) {
    const projectId = `test-project-${Date.now()}`;
    const projectData = {
      id: projectId,
      title: 'Test Project Title Here',
      shortDescription: 'This is a test project description that meets minimum length requirements.',
      fullDescription: 'This is a comprehensive test project designed to validate system functionality.',
      category: 'environment',
      fundingGoal: 50000,
      fundingRaised: 0,
      status: 'draft',
      creatorUid,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides
    };

    await firestoreHelper.setDocument('projects', projectId, projectData);
    return projectData;
  }

  generateWebhookSignature(payload: string, secret: string = 'test-webhook-secret'): string {
    const crypto = require('crypto');
    const timestamp = Date.now();
    const signedPayload = `${timestamp}.${payload}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
    
    return `t=${timestamp},v1=${signature}`;
  }

  makeDocumentSnapshot(data: any, path: string) {
    return {
      exists: data !== null,
      data: () => data,
      id: path.split('/').pop(),
      ref: { path },
      get: (field: string) => data?.[field]
    };
  }

  makeChange(before: any, after: any) {
    return {
      before,
      after
    };
  }

  makeEventContext(overrides: any = {}) {
    return {
      eventId: 'test-event-id',
      timestamp: new Date().toISOString(),
      eventType: 'google.firestore.document.write',
      resource: 'projects/test/databases/(default)/documents/test/doc',
      ...overrides
    };
  }

  async waitFor(condition: () => Promise<boolean>, timeout = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }
}

export const testUtils = new TestUtils();
```

### 3.2 `test/utils/mockData.ts` complet

```typescript
// Générateur de données de test standardisées
export class MockDataGenerator {
  createCompleteProfileRequest() {
    return {
      userType: 'contributor',
      firstName: 'John',
      lastName: 'Doe',
      phoneNumber: '+33123456789',
      dateOfBirth: '1990-01-01',
      address: {
        street: '123 Test Street',
        city: 'Paris',
        postalCode: '75001',
        country: 'FR'
      },
      preferences: {
        language: 'fr',
        currency: 'EUR',
        notifications: {
          email: true,
          push: true,
          inApp: true
        }
      }
    };
  }

  createProjectRequest() {
    return {
      title: 'Test Environmental Project',
      shortDescription: 'This is a comprehensive test project designed to validate our environmental impact systems.',
      fullDescription: 'This project aims to create positive environmental change through innovative solutions. It includes detailed planning, stakeholder engagement, and measurable outcomes that contribute to sustainability goals.',
      category: 'environment',
      fundingGoal: 50000,
      duration: 60,
      location: {
        city: 'Paris',
        country: 'FR'
      },
      milestones: [
        {
          title: 'Research Phase',
          description: 'Complete initial research and planning',
          targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 40,
          deliverables: ['Research report', 'Project plan']
        },
        {
          title: 'Implementation Phase',
          description: 'Execute main project activities',
          targetDate: new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 60,
          deliverables: ['Final implementation', 'Impact report']
        }
      ]
    };
  }

  createContributionRequest() {
    return {
      projectId: 'test-project-id',
      amount: 10000, // 100€
      currency: 'EUR',
      anonymous: false,
      message: 'Supporting this great cause!'
    };
  }

  // Générateurs pour cas limites
  createMinimalProjectRequest() {
    return {
      title: 'Minimal Test Project Title',
      shortDescription: 'This is the minimal description that meets length requirements for testing purposes.',
      fullDescription: 'This is a minimal but valid full description that provides enough detail to meet the minimum length requirements while testing the system with the simplest valid input possible.',
      category: 'environment',
      fundingGoal: 1000,
      duration: 30,
      location: {
        city: 'Test',
        country: 'FR'
      },
      milestones: [
        {
          title: 'Only Milestone',
          description: 'Single milestone for minimal project',
          targetDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 100,
          deliverables: ['Final result']
        }
      ]
    };
  }

  createMaximalProjectRequest() {
    return {
      title: 'Maximum Length Project Title That Tests The Upper Limits Of Our System Validation Rules',
      shortDescription: 'This is a maximum length description that tests the upper bounds of our validation system while ensuring it contains meaningful content that describes a comprehensive project with multiple aspects and detailed planning phases.',
      fullDescription: 'This is an extremely detailed project description that tests the maximum length limits of our system. '.repeat(50),
      category: 'environment',
      fundingGoal: 10000000, // 100k€
      duration: 90,
      location: {
        city: 'Very Long City Name That Tests Limits',
        country: 'FR',
        coordinates: {
          lat: 48.8566,
          lng: 2.3522
        }
      },
      milestones: [
        {
          title: 'Phase 1: Initial Research',
          description: 'Comprehensive initial research phase with stakeholder engagement',
          targetDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 20,
          deliverables: ['Research report', 'Stakeholder analysis', 'Initial planning']
        },
        {
          title: 'Phase 2: Development',
          description: 'Development and prototyping phase',
          targetDate: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 30,
          deliverables: ['Prototype', 'Technical documentation']
        },
        {
          title: 'Phase 3: Testing',
          description: 'Comprehensive testing and validation phase',
          targetDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 25,
          deliverables: ['Test results', 'Performance metrics']
        },
        {
          title: 'Phase 4: Deployment',
          description: 'Final deployment and launch phase',
          targetDate: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000).toISOString(),
          fundingPercentage: 25,
          deliverables: ['Live system', 'Documentation', 'Training materials']
        }
      ],
      tags: ['environment', 'sustainability', 'innovation', 'technology', 'impact']
    };
  }
}

export const mockData = new MockDataGenerator();
```

## 4. Checklist de validation finale pour LLM

### 4.1 Validation syntaxique automatique

```bash
# Commandes de validation à exécuter automatiquement
npm run lint           # ESLint sans erreurs
npm run build          # Compilation TypeScript réussie
npm run test:unit      # Tests unitaires tous passés
npm run test:coverage  # Couverture > 85%
```

### 4.2 Validation sémantique automatique

**Points de contrôle obligatoires** :
- [ ] Toutes les functions ont validation Joi
- [ ] Gestion d'erreurs présente partout
- [ ] Logging structuré implémenté
- [ ] Types TypeScript stricts respectés
- [ ] Security rules cohérentes avec le code

### 4.3 Validation fonctionnelle automatique

**Tests d'intégration obligatoires** :
- [ ] Scénario complet utilisateur (inscription → projet → contribution)
- [ ] Gestion des cas d'erreur externes
- [ ] Performance sous charge acceptable
- [ ] Sécurité validation des permissions

Cette approche de validation permet à un LLM de générer du code backend robuste et de s'assurer automatiquement de sa qualité avant livraison.