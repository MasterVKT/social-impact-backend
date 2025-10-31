import { ThreatDetectionSystem, ThreatEvent } from '../threatDetection';
import { AccessControlSystem, AccessContext, UserRole } from '../accessControl';
import { DataEncryptionSystem, EncryptedData } from '../dataEncryption';
import { SecurityMonitoringSystem, SecurityEvent } from '../securityMonitoring';

// Mock Firebase dependencies
jest.mock('firebase-admin/firestore');
jest.mock('firebase-admin/auth');
jest.mock('../../utils/logger');
jest.mock('../../utils/firestore');

describe('Security Framework Integration Tests', () => {
  let threatDetection: ThreatDetectionSystem;
  let accessControl: AccessControlSystem;
  let dataEncryption: DataEncryptionSystem;
  let securityMonitoring: SecurityMonitoringSystem;

  beforeEach(() => {
    // Initialize security systems
    threatDetection = new ThreatDetectionSystem();
    accessControl = new AccessControlSystem();
    dataEncryption = new DataEncryptionSystem();
    securityMonitoring = new SecurityMonitoringSystem();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Threat Detection System', () => {
    describe('Rate Limit Detection', () => {
      it('should detect rate limit violations', async () => {
        const request = {
          ip: '192.168.1.100',
          userAgent: 'Mozilla/5.0',
          userId: 'user123',
          endpoint: '/api/projects',
          method: 'GET',
          country: 'FR'
        };

        // Simulate multiple rapid requests
        const results = [];
        for (let i = 0; i < 10; i++) {
          const result = await threatDetection.detectThreats(request);
          results.push(result);
        }

        // Should detect rate limiting after threshold
        const blockedResults = results.filter(r => r.isBlocked);
        expect(blockedResults.length).toBeGreaterThan(0);

        const threatEvents = results.flatMap(r => r.threats);
        const rateLimitThreats = threatEvents.filter(t => t.type === 'rate_limit');
        expect(rateLimitThreats.length).toBeGreaterThan(0);
      });

      it('should calculate appropriate risk scores', async () => {
        const highRiskRequest = {
          ip: '192.168.1.100',
          userAgent: 'curl/7.68.0',
          endpoint: '/admin/users',
          method: 'DELETE',
          country: 'CN',
          payload: { id: '1 OR 1=1' }
        };

        const result = await threatDetection.detectThreats(highRiskRequest);
        
        expect(result.riskScore).toBeGreaterThan(50);
        expect(result.threatLevel).toBe('high');
        expect(result.threats.length).toBeGreaterThan(0);
      });
    });

    describe('Injection Detection', () => {
      it('should detect SQL injection attempts', async () => {
        const maliciousRequest = {
          ip: '192.168.1.100',
          endpoint: '/api/users/search',
          method: 'POST',
          payload: {
            query: "'; DROP TABLE users; --",
            filter: "1=1 OR 'a'='a'"
          }
        };

        const result = await threatDetection.detectThreats(maliciousRequest);
        
        expect(result.threats).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'injection_attempt',
              severity: expect.stringMatching(/high|critical/)
            })
          ])
        );
      });

      it('should detect NoSQL injection attempts', async () => {
        const noSQLInjection = {
          ip: '192.168.1.100',
          endpoint: '/api/projects/search',
          method: 'POST',
          payload: {
            filter: {
              $ne: null,
              $regex: '.*',
              $where: 'function() { return true; }'
            }
          }
        };

        const result = await threatDetection.detectThreats(noSQLInjection);
        
        expect(result.threats).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'injection_attempt'
            })
          ])
        );
      });
    });

    describe('Geolocation Analysis', () => {
      it('should block requests from banned countries', async () => {
        const bannedCountryRequest = {
          ip: '192.168.1.100',
          endpoint: '/api/projects',
          method: 'GET',
          country: 'KP' // North Korea - typically banned
        };

        const result = await threatDetection.detectThreats(bannedCountryRequest);
        
        expect(result.threats).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'geo_anomaly',
              severity: 'high'
            })
          ])
        );
      });

      it('should detect impossible travel patterns', async () => {
        const userId = 'user123';
        
        // First request from France
        await threatDetection.detectThreats({
          ip: '192.168.1.100',
          userId,
          endpoint: '/api/profile',
          method: 'GET',
          country: 'FR'
        });

        // Immediate request from Japan (impossible travel)
        const result = await threatDetection.detectThreats({
          ip: '192.168.1.101',
          userId,
          endpoint: '/api/profile',
          method: 'GET',
          country: 'JP'
        });

        expect(result.threats).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'geo_anomaly',
              severity: 'high'
            })
          ])
        );
      });
    });
  });

  describe('Access Control System', () => {
    describe('Role-Based Access Control', () => {
      it('should grant access to users with appropriate permissions', async () => {
        const userId = 'user123';
        
        // Assign admin role
        await accessControl.assignRole(userId, ['admin'], 'system');

        const context: AccessContext = {
          userId,
          userRoles: ['admin'],
          userPermissions: [],
          resource: '/api/admin/users',
          action: 'GET',
          ip: '192.168.1.100',
          timestamp: new Date()
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(true);
        expect(decision.reason).toBe('Access granted');
        expect(decision.missingPermissions).toHaveLength(0);
      });

      it('should deny access to users without required permissions', async () => {
        const userId = 'user123';
        
        // Assign basic user role
        await accessControl.assignRole(userId, ['user'], 'system');

        const context: AccessContext = {
          userId,
          userRoles: ['user'],
          userPermissions: [],
          resource: '/api/admin/users',
          action: 'DELETE',
          ip: '192.168.1.100',
          timestamp: new Date()
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe('Insufficient permissions');
        expect(decision.missingPermissions.length).toBeGreaterThan(0);
      });

      it('should enforce time-based restrictions', async () => {
        const userId = 'user123';
        
        // Assign role with time restrictions (only weekdays 9-17)
        await accessControl.assignRole(userId, ['creator'], 'system', {
          restrictions: {
            timeRestrictions: {
              allowedHours: [9, 17],
              allowedDays: [1, 2, 3, 4, 5], // Monday to Friday
              timezone: 'Europe/Paris'
            }
          }
        });

        // Test access during weekend
        const weekendTime = new Date('2024-01-06T10:00:00.000Z'); // Saturday
        const context: AccessContext = {
          userId,
          userRoles: ['creator'],
          userPermissions: [],
          resource: '/api/projects/create',
          action: 'POST',
          ip: '192.168.1.100',
          timestamp: weekendTime
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Access not allowed on Saturday');
      });

      it('should enforce IP whitelist restrictions', async () => {
        const userId = 'user123';
        
        // Assign role with IP restrictions
        await accessControl.assignRole(userId, ['admin'], 'system', {
          restrictions: {
            ipWhitelist: ['192.168.1.0/24', '10.0.0.100']
          }
        });

        // Test access from blocked IP
        const context: AccessContext = {
          userId,
          userRoles: ['admin'],
          userPermissions: [],
          resource: '/api/admin/config',
          action: 'PUT',
          ip: '203.0.113.1', // Outside whitelist
          timestamp: new Date()
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not in whitelist');
      });
    });

    describe('Resource-Specific Access Control', () => {
      it('should allow users to access their own resources', async () => {
        const userId = 'user123';
        
        await accessControl.assignRole(userId, ['creator'], 'system');

        const context: AccessContext = {
          userId,
          userRoles: ['creator'],
          userPermissions: [],
          resource: '/api/projects/update',
          action: 'PUT',
          resourceData: { creatorUid: userId },
          ip: '192.168.1.100',
          timestamp: new Date()
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(true);
      });

      it('should prevent users from accessing other users\' private resources', async () => {
        const userId = 'user123';
        const otherUserId = 'user456';
        
        await accessControl.assignRole(userId, ['user'], 'system');

        const context: AccessContext = {
          userId,
          userRoles: ['user'],
          userPermissions: [],
          resource: '/api/users/profile',
          action: 'GET',
          resourceData: { userId: otherUserId, public: false },
          ip: '192.168.1.100',
          timestamp: new Date()
        };

        const decision = await accessControl.checkAccess(context);
        
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Cannot access other user\'s private resources');
      });
    });

    describe('Rate Limiting', () => {
      it('should enforce rate limits per user role', async () => {
        const userId = 'user123';
        
        // Assign role with strict rate limits
        await accessControl.assignRole(userId, ['contributor'], 'system', {
          restrictions: {
            resourceLimits: {
              maxAPICallsPerHour: 10,
              maxProjectsPerDay: 1,
              maxContributionsPerDay: 5
            }
          }
        });

        // Simulate multiple API calls
        const contexts = Array.from({ length: 15 }, (_, i) => ({
          userId,
          userRoles: ['contributor'],
          userPermissions: [],
          resource: '/api/projects/search',
          action: 'GET',
          ip: '192.168.1.100',
          timestamp: new Date()
        }));

        const decisions = await Promise.all(
          contexts.map(context => accessControl.checkAccess(context))
        );

        const blockedRequests = decisions.filter(d => !d.allowed);
        expect(blockedRequests.length).toBeGreaterThan(0);
        
        const rateLimitBlocks = blockedRequests.filter(d => 
          d.reason.includes('rate limit exceeded')
        );
        expect(rateLimitBlocks.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Data Encryption System', () => {
    describe('Symmetric Encryption', () => {
      it('should encrypt and decrypt data correctly', async () => {
        const originalData = {
          name: 'John Doe',
          email: 'john.doe@example.com',
          sensitiveInfo: 'This is confidential'
        };

        // Encrypt data
        const encrypted = await dataEncryption.encryptData(originalData, 'sensitive');
        
        expect(encrypted).toHaveProperty('data');
        expect(encrypted).toHaveProperty('keyId');
        expect(encrypted).toHaveProperty('algorithm');
        expect(encrypted.metadata.dataType).toBe('sensitive');

        // Decrypt data
        const decrypted = await dataEncryption.decryptData(encrypted);
        
        expect(decrypted).toEqual(originalData);
      });

      it('should fail to decrypt with wrong key', async () => {
        const originalData = { secret: 'top secret information' };
        
        const encrypted = await dataEncryption.encryptData(originalData, 'sensitive');
        
        // Tamper with key ID
        const tamperedEncrypted = { ...encrypted, keyId: 'invalid_key_id' };
        
        await expect(dataEncryption.decryptData(tamperedEncrypted))
          .rejects.toThrow('Decryption key not found');
      });

      it('should detect data tampering', async () => {
        const originalData = { amount: 1000, currency: 'EUR' };
        
        const encrypted = await dataEncryption.encryptData(originalData, 'financial');
        
        // Tamper with encrypted data
        const tamperedData = encrypted.data.slice(0, -4) + 'XXXX';
        const tamperedEncrypted = { ...encrypted, data: tamperedData };
        
        await expect(dataEncryption.decryptData(tamperedEncrypted))
          .rejects.toThrow();
      });
    });

    describe('PII Encryption', () => {
      it('should encrypt PII fields correctly', async () => {
        const userData = {
          id: 'user123',
          name: 'John Doe',
          email: 'john.doe@example.com',
          phone: '+33123456789',
          address: {
            street: '123 Main St',
            city: 'Paris',
            country: 'France'
          },
          publicInfo: 'This is public'
        };

        const piiFields = [
          { fieldPath: 'name', dataType: 'name', encryptionRequired: true, hashingRequired: true, tokenizationRequired: false },
          { fieldPath: 'email', dataType: 'email', encryptionRequired: true, hashingRequired: false, tokenizationRequired: true },
          { fieldPath: 'phone', dataType: 'phone', encryptionRequired: true, hashingRequired: false, tokenizationRequired: true },
          { fieldPath: 'address', dataType: 'address', encryptionRequired: true, hashingRequired: false, tokenizationRequired: false }
        ];

        const encrypted = await dataEncryption.encryptPII(userData, piiFields);
        
        // Check that PII fields are encrypted
        expect(encrypted.name).toHaveProperty('data');
        expect(encrypted.name).toHaveProperty('keyId');
        expect(encrypted.email).toHaveProperty('data');
        expect(encrypted.phone).toHaveProperty('data');
        expect(encrypted.address).toHaveProperty('data');
        
        // Check that non-PII fields remain unchanged
        expect(encrypted.id).toBe('user123');
        expect(encrypted.publicInfo).toBe('This is public');
        
        // Check that hashes and tokens are generated
        expect(encrypted.name_hash).toBeDefined();
        expect(encrypted.email_token).toBeDefined();
        expect(encrypted.phone_token).toBeDefined();

        // Decrypt and verify
        const decrypted = await dataEncryption.decryptPII(encrypted, piiFields);
        expect(decrypted.name).toBe(userData.name);
        expect(decrypted.email).toBe(userData.email);
        expect(decrypted.phone).toBe(userData.phone);
        expect(decrypted.address).toEqual(userData.address);
      });
    });

    describe('Data Hashing', () => {
      it('should generate consistent hashes', async () => {
        const data = 'sensitive password';
        const dataType = 'password';
        
        const hash1 = await dataEncryption.hashData(data, dataType);
        const hash2 = await dataEncryption.hashData(data, dataType, { 
          salt: hash1.split(':')[0] // Use same salt
        });
        
        expect(hash1).toBe(hash2);
      });

      it('should verify hashes correctly', async () => {
        const originalData = 'user_password_123';
        const dataType = 'password';
        
        const hash = await dataEncryption.hashData(originalData, dataType);
        
        const isValid = await dataEncryption.verifyHash(originalData, hash, dataType);
        expect(isValid).toBe(true);
        
        const isInvalid = await dataEncryption.verifyHash('wrong_password', hash, dataType);
        expect(isInvalid).toBe(false);
      });
    });

    describe('Key Management', () => {
      it('should generate encryption keys', async () => {
        const symmetricKey = await dataEncryption.generateKey('symmetric', 'encryption');
        
        expect(symmetricKey).toHaveProperty('id');
        expect(symmetricKey.type).toBe('symmetric');
        expect(symmetricKey.purpose).toBe('encryption');
        expect(symmetricKey.status).toBe('active');
        expect(symmetricKey).toHaveProperty('keyData');

        const asymmetricKey = await dataEncryption.generateKey('asymmetric', 'encryption');
        
        expect(asymmetricKey.type).toBe('asymmetric');
        expect(asymmetricKey).toHaveProperty('publicKey');
      });

      it('should rotate keys', async () => {
        const originalKey = await dataEncryption.generateKey('symmetric', 'encryption');
        
        const newKey = await dataEncryption.rotateKey(originalKey.id);
        
        expect(newKey.id).not.toBe(originalKey.id);
        expect(newKey.type).toBe(originalKey.type);
        expect(newKey.purpose).toBe(originalKey.purpose);
        expect(newKey.status).toBe('active');

        // Original key should be deprecated
        const originalKeyInfo = await dataEncryption.getKeyInfo(originalKey.id);
        expect(originalKeyInfo?.status).toBe('deprecated');
      });
    });
  });

  describe('Security Monitoring System', () => {
    describe('Event Logging', () => {
      it('should log security events correctly', async () => {
        const event = await securityMonitoring.logSecurityEvent({
          type: 'authentication',
          severity: 'medium',
          source: {
            userId: 'user123',
            ip: '192.168.1.100',
            service: 'auth'
          },
          details: {
            action: 'login_attempt',
            outcome: 'failure',
            reason: 'invalid_password'
          },
          risk: {
            score: 40,
            factors: ['failed_authentication'],
            confidence: 0.9
          }
        });

        expect(event).toHaveProperty('id');
        expect(event.type).toBe('authentication');
        expect(event.severity).toBe('medium');
        expect(event.risk.score).toBe(40);
        expect(event).toHaveProperty('timestamp');
        expect(event).toHaveProperty('correlation');
      });

      it('should correlate related events', async () => {
        const ip = '192.168.1.100';
        const userId = 'user123';

        // Log multiple related events
        const events = await Promise.all([
          securityMonitoring.logSecurityEvent({
            type: 'authentication',
            severity: 'medium',
            source: { userId, ip, service: 'auth' },
            details: { action: 'login_attempt', outcome: 'failure' },
            risk: { score: 40, factors: ['failed_auth'], confidence: 0.9 }
          }),
          securityMonitoring.logSecurityEvent({
            type: 'authorization',
            severity: 'high',
            source: { userId, ip, service: 'auth' },
            details: { action: 'privilege_escalation', outcome: 'blocked' },
            risk: { score: 70, factors: ['privilege_escalation'], confidence: 0.95 }
          }),
          securityMonitoring.logSecurityEvent({
            type: 'data_access',
            severity: 'medium',
            source: { userId, ip, service: 'api' },
            details: { action: 'bulk_export', outcome: 'success' },
            risk: { score: 50, factors: ['bulk_data_access'], confidence: 0.8 }
          })
        ]);

        // Events should have correlation information
        expect(events[0].correlation.sessionId).toBeDefined();
        expect(events[1].correlation.sessionId).toBe(events[0].correlation.sessionId);
        expect(events[2].correlation.sessionId).toBe(events[0].correlation.sessionId);
      });
    });

    describe('Alert Generation', () => {
      it('should create alerts for monitoring rule violations', async () => {
        // Add a monitoring rule
        const rule = await securityMonitoring.addMonitoringRule({
          name: 'Multiple Failed Logins',
          description: 'Detect brute force attacks',
          enabled: true,
          conditions: {
            eventTypes: ['authentication'],
            severity: ['medium', 'high'],
            timeWindow: 15,
            threshold: 3
          },
          actions: {
            alert: true,
            block: false,
            escalate: false,
            notify: ['security-team']
          }
        });

        // Generate events that should trigger the rule
        const events = [];
        for (let i = 0; i < 5; i++) {
          const event = await securityMonitoring.logSecurityEvent({
            type: 'authentication',
            severity: 'medium',
            source: {
              userId: 'user123',
              ip: '192.168.1.100',
              service: 'auth'
            },
            details: {
              action: 'login_attempt',
              outcome: 'failure',
              reason: 'invalid_password'
            },
            risk: {
              score: 40,
              factors: ['failed_authentication'],
              confidence: 0.9
            }
          });
          events.push(event);
        }

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if alert was created
        const alerts = await securityMonitoring.getActiveAlerts();
        const matchingAlerts = alerts.filter(alert => 
          alert.triggers.some(trigger => trigger.ruleId === rule.id)
        );

        expect(matchingAlerts.length).toBeGreaterThan(0);
        expect(matchingAlerts[0].severity).toMatch(/medium|high/);
        expect(matchingAlerts[0].events.length).toBeGreaterThanOrEqual(3);
      });

      it('should execute automated responses', async () => {
        // Add rule with automated blocking
        const rule = await securityMonitoring.addMonitoringRule({
          name: 'Critical Threat Detection',
          description: 'Auto-block critical threats',
          enabled: true,
          conditions: {
            eventTypes: ['threat_detected'],
            severity: ['critical'],
            timeWindow: 5,
            threshold: 1
          },
          actions: {
            alert: true,
            block: true,
            escalate: true,
            notify: ['security-team', 'admin']
          }
        });

        // Generate critical threat event
        const event = await securityMonitoring.logSecurityEvent({
          type: 'threat_detected',
          severity: 'critical',
          source: {
            ip: '192.168.1.100',
            service: 'threat_detection'
          },
          details: {
            action: 'injection_attempt',
            outcome: 'blocked',
            reason: 'SQL injection detected'
          },
          risk: {
            score: 95,
            factors: ['sql_injection', 'automated_attack'],
            confidence: 0.99
          }
        });

        // Wait for processing
        await new Promise(resolve => setTimeout(resolve, 100));

        const alerts = await securityMonitoring.getActiveAlerts();
        const criticalAlerts = alerts.filter(alert => 
          alert.severity === 'critical' && alert.response.automated
        );

        expect(criticalAlerts.length).toBeGreaterThan(0);
        expect(criticalAlerts[0].response.actions).toContain('blocking_executed');
        expect(criticalAlerts[0].response.escalated).toBe(true);
      });
    });

    describe('Security Metrics', () => {
      it('should calculate security metrics correctly', async () => {
        // Generate various security events
        await Promise.all([
          securityMonitoring.logSecurityEvent({
            type: 'authentication',
            severity: 'low',
            source: { ip: '192.168.1.100', service: 'auth' },
            details: { action: 'login', outcome: 'success' },
            risk: { score: 10, factors: [], confidence: 0.9 }
          }),
          securityMonitoring.logSecurityEvent({
            type: 'authorization',
            severity: 'medium',
            source: { ip: '192.168.1.101', service: 'api' },
            details: { action: 'access_denied', outcome: 'blocked' },
            risk: { score: 50, factors: ['access_denied'], confidence: 0.8 }
          }),
          securityMonitoring.logSecurityEvent({
            type: 'threat_detected',
            severity: 'high',
            source: { ip: '192.168.1.102', service: 'threat_detection' },
            details: { action: 'malware_detected', outcome: 'blocked' },
            risk: { score: 80, factors: ['malware'], confidence: 0.95 }
          })
        ]);

        const metrics = await securityMonitoring.getSecurityMetrics(1); // Last 1 hour

        expect(metrics.totalEvents).toBeGreaterThanOrEqual(3);
        expect(metrics.eventsByType).toHaveProperty('authentication');
        expect(metrics.eventsByType).toHaveProperty('authorization');
        expect(metrics.eventsByType).toHaveProperty('threat_detected');
        expect(metrics.eventsBySeverity).toHaveProperty('low');
        expect(metrics.eventsBySeverity).toHaveProperty('medium');
        expect(metrics.eventsBySeverity).toHaveProperty('high');
        expect(metrics.riskScore).toBeGreaterThan(0);
      });
    });
  });

  describe('Security Framework Integration', () => {
    describe('End-to-End Security Flow', () => {
      it('should handle complete security workflow', async () => {
        const userId = 'user123';
        const ip = '192.168.1.100';
        
        // 1. Setup user role
        await accessControl.assignRole(userId, ['creator'], 'system');

        // 2. Simulate threat detection
        const threatResult = await threatDetection.detectThreats({
          ip,
          userId,
          endpoint: '/api/projects/create',
          method: 'POST',
          userAgent: 'Mozilla/5.0',
          payload: { title: 'Valid Project', description: 'Valid description' }
        });

        expect(threatResult.isBlocked).toBe(false);
        expect(threatResult.threatLevel).toBe('none');

        // 3. Check access control
        const accessContext: AccessContext = {
          userId,
          userRoles: ['creator'],
          userPermissions: [],
          resource: '/api/projects/create',
          action: 'POST',
          ip,
          timestamp: new Date()
        };

        const accessDecision = await accessControl.checkAccess(accessContext);
        expect(accessDecision.allowed).toBe(true);

        // 4. Encrypt sensitive data
        const projectData = {
          title: 'My Project',
          description: 'This project contains sensitive information',
          bankAccount: 'FR1420041010050500013M02606',
          personalNotes: 'Private creator notes'
        };

        const piiFields = [
          { fieldPath: 'bankAccount', dataType: 'financial', encryptionRequired: true, hashingRequired: false, tokenizationRequired: false },
          { fieldPath: 'personalNotes', dataType: 'sensitive', encryptionRequired: true, hashingRequired: false, tokenizationRequired: false }
        ];

        const encryptedProject = await dataEncryption.encryptPII(projectData, piiFields);
        
        expect(encryptedProject.title).toBe(projectData.title); // Not encrypted
        expect(encryptedProject.bankAccount).toHaveProperty('data'); // Encrypted
        expect(encryptedProject.personalNotes).toHaveProperty('data'); // Encrypted

        // 5. Log security event
        await securityMonitoring.logSecurityEvent({
          type: 'data_access',
          severity: 'info',
          source: { userId, ip, service: 'projects' },
          details: { action: 'project_create', outcome: 'success' },
          risk: { score: 15, factors: [], confidence: 0.8 }
        });

        // 6. Verify data can be decrypted
        const decryptedProject = await dataEncryption.decryptPII(encryptedProject, piiFields);
        expect(decryptedProject.bankAccount).toBe(projectData.bankAccount);
        expect(decryptedProject.personalNotes).toBe(projectData.personalNotes);
      });

      it('should handle security violations correctly', async () => {
        const userId = 'user123';
        const maliciousIP = '203.0.113.1';
        
        // 1. Setup limited user role
        await accessControl.assignRole(userId, ['user'], 'system');

        // 2. Attempt malicious request
        const maliciousRequest = {
          ip: maliciousIP,
          userId,
          endpoint: '/admin/users',
          method: 'DELETE',
          payload: { userId: 'admin', force: true, sql: "'; DROP TABLE users; --" }
        };

        const threatResult = await threatDetection.detectThreats(maliciousRequest);
        
        // Should detect multiple threats
        expect(threatResult.isBlocked).toBe(true);
        expect(threatResult.threatLevel).toMatch(/high|critical/);
        expect(threatResult.threats.length).toBeGreaterThan(0);

        // 3. Access control should also deny
        const accessContext: AccessContext = {
          userId,
          userRoles: ['user'],
          userPermissions: [],
          resource: '/admin/users',
          action: 'DELETE',
          ip: maliciousIP,
          timestamp: new Date()
        };

        const accessDecision = await accessControl.checkAccess(accessContext);
        expect(accessDecision.allowed).toBe(false);

        // 4. Security monitoring should log the violation
        await securityMonitoring.logSecurityEvent({
          type: 'security_violation',
          severity: 'critical',
          source: { userId, ip: maliciousIP, service: 'access_control' },
          details: { 
            action: 'unauthorized_admin_access', 
            outcome: 'blocked',
            reason: 'Insufficient permissions and threat detected'
          },
          risk: { score: 90, factors: ['privilege_escalation', 'injection_attempt'], confidence: 0.95 }
        });

        // 5. Should trigger alerts
        const alerts = await securityMonitoring.getActiveAlerts();
        expect(alerts.length).toBeGreaterThan(0);
        
        const highSeverityAlerts = alerts.filter(alert => 
          alert.severity === 'critical' || alert.severity === 'high'
        );
        expect(highSeverityAlerts.length).toBeGreaterThan(0);
      });
    });

    describe('Performance and Scalability', () => {
      it('should handle concurrent security checks efficiently', async () => {
        const startTime = Date.now();
        const concurrentRequests = 50;

        // Generate concurrent requests
        const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
          ip: `192.168.1.${100 + (i % 10)}`,
          userId: `user${i % 5}`,
          endpoint: '/api/projects',
          method: 'GET',
          userAgent: 'Mozilla/5.0'
        }));

        // Process all requests concurrently
        const results = await Promise.all(
          requests.map(request => threatDetection.detectThreats(request))
        );

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        // Should complete within reasonable time (less than 5 seconds for 50 requests)
        expect(totalTime).toBeLessThan(5000);
        expect(results).toHaveLength(concurrentRequests);
        
        // All results should have valid structure
        results.forEach(result => {
          expect(result).toHaveProperty('isBlocked');
          expect(result).toHaveProperty('threatLevel');
          expect(result).toHaveProperty('riskScore');
          expect(Array.isArray(result.threats)).toBe(true);
        });
      });

      it('should maintain security under load', async () => {
        const maliciousRequests = Array.from({ length: 20 }, () => ({
          ip: '203.0.113.1',
          endpoint: '/admin/config',
          method: 'POST',
          payload: { command: 'rm -rf /', injection: "'; DROP TABLE users; --" }
        }));

        const results = await Promise.all(
          maliciousRequests.map(request => threatDetection.detectThreats(request))
        );

        // All malicious requests should be blocked
        const blockedRequests = results.filter(r => r.isBlocked);
        expect(blockedRequests.length).toBe(maliciousRequests.length);

        // Should maintain high threat detection accuracy
        const highRiskRequests = results.filter(r => r.riskScore > 70);
        expect(highRiskRequests.length).toBe(maliciousRequests.length);
      });
    });
  });
});

describe('Security Framework Edge Cases', () => {
  let threatDetection: ThreatDetectionSystem;
  let accessControl: AccessControlSystem;
  let dataEncryption: DataEncryptionSystem;

  beforeEach(() => {
    threatDetection = new ThreatDetectionSystem();
    accessControl = new AccessControlSystem();
    dataEncryption = new DataEncryptionSystem();
  });

  describe('Error Handling', () => {
    it('should handle invalid encryption data gracefully', async () => {
      const invalidEncryptedData = {
        data: 'invalid_base64_!@#$',
        keyId: 'nonexistent_key',
        algorithm: 'aes-256-gcm',
        metadata: {
          encryptedAt: new Date(),
          dataType: 'test',
          version: 1,
          checksum: 'invalid_checksum'
        }
      };

      await expect(dataEncryption.decryptData(invalidEncryptedData as EncryptedData))
        .rejects.toThrow();
    });

    it('should handle system overload gracefully', async () => {
      // Simulate system under heavy load
      const heavyRequests = Array.from({ length: 100 }, (_, i) => ({
        ip: `192.168.1.${i % 255}`,
        endpoint: '/api/heavy-operation',
        method: 'POST',
        payload: { data: 'x'.repeat(10000) } // Large payload
      }));

      const startTime = Date.now();
      
      // Process requests and catch any errors
      const results = await Promise.allSettled(
        heavyRequests.map(request => threatDetection.detectThreats(request))
      );

      const endTime = Date.now();
      
      // Should not take longer than 30 seconds even under load
      expect(endTime - startTime).toBeLessThan(30000);
      
      // Most requests should succeed (at least 80%)
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(heavyRequests.length * 0.8);
    });
  });

  describe('Security Bypass Attempts', () => {
    it('should prevent time-based attacks', async () => {
      const validData = { amount: 1000 };
      const encrypted = await dataEncryption.encryptData(validData, 'financial');
      
      // Measure decryption time for valid data
      const validStart = Date.now();
      await dataEncryption.decryptData(encrypted);
      const validTime = Date.now() - validStart;
      
      // Measure decryption time for invalid data
      const invalidEncrypted = { ...encrypted, data: 'invalid_data' };
      const invalidStart = Date.now();
      
      try {
        await dataEncryption.decryptData(invalidEncrypted);
      } catch (error) {
        // Expected to fail
      }
      
      const invalidTime = Date.now() - invalidStart;
      
      // Time difference should be minimal to prevent timing attacks
      const timeDifference = Math.abs(validTime - invalidTime);
      expect(timeDifference).toBeLessThan(100); // Less than 100ms difference
    });

    it('should prevent role enumeration attacks', async () => {
      const userId = 'user123';
      
      // Try to enumerate roles by testing different permissions
      const testPermissions = [
        'admin:read', 'admin:write', 'system:admin',
        'users:delete', 'projects:moderate', 'security:admin'
      ];
      
      const startTime = Date.now();
      
      const results = await Promise.all(
        testPermissions.map(async (permission) => {
          try {
            return await accessControl.validatePermission(userId, permission as any);
          } catch (error) {
            return false;
          }
        })
      );
      
      const endTime = Date.now();
      
      // Response times should be consistent regardless of permission validity
      const averageTime = (endTime - startTime) / testPermissions.length;
      expect(averageTime).toBeLessThan(50); // Quick response for all checks
      
      // Should return false for all permissions (user doesn't exist/have role)
      const trueResults = results.filter(r => r === true);
      expect(trueResults).toHaveLength(0);
    });
  });
});