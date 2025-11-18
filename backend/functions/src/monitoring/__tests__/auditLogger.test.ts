/**
 * Tests for Audit Logger
 * Social Finance Impact Platform
 */

import { auditLogger } from '../auditLogger';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('Audit Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  describe('Admin Action Logging', () => {
    it('should log admin actions with full context', async () => {
      await auditLogger.logAdminAction({
        adminId: 'admin-123',
        action: 'approve_project',
        resourceType: 'project',
        resourceId: 'project-456',
        details: {
          previousStatus: 'under_review',
          newStatus: 'live'
        }
      });

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        'auditLogs',
        expect.any(String),
        expect.objectContaining({
          adminId: 'admin-123',
          action: 'approve_project',
          timestamp: expect.any(Object),
          ipAddress: expect.any(String)
        })
      );
    });

    it('should capture IP address and user agent', async () => {
      await auditLogger.logAdminAction({
        adminId: 'admin-123',
        action: 'delete_user',
        resourceType: 'user',
        resourceId: 'user-456',
        metadata: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        }
      });

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        'auditLogs',
        expect.any(String),
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0'
        })
      );
    });
  });

  describe('Security Event Logging', () => {
    it('should log security events', async () => {
      await auditLogger.logSecurityEvent({
        eventType: 'failed_login_attempt',
        userId: 'user-123',
        severity: 'medium',
        details: {
          reason: 'invalid_password',
          attemptCount: 3
        }
      });

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        'securityEvents',
        expect.any(String),
        expect.objectContaining({
          eventType: 'failed_login_attempt',
          severity: 'medium'
        })
      );
    });

    it('should flag high-severity events', async () => {
      await auditLogger.logSecurityEvent({
        eventType: 'account_takeover_attempt',
        userId: 'user-123',
        severity: 'high'
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('High-severity security event'),
        expect.any(Object)
      );
    });
  });

  describe('Data Access Logging', () => {
    it('should log sensitive data access', async () => {
      await auditLogger.logDataAccess({
        userId: 'admin-123',
        accessType: 'read',
        dataType: 'user_pii',
        resourceId: 'user-456',
        fields: ['email', 'phoneNumber', 'address']
      });

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        'dataAccessLogs',
        expect.any(String),
        expect.objectContaining({
          accessType: 'read',
          dataType: 'user_pii',
          fields: expect.arrayContaining(['email', 'phoneNumber'])
        })
      );
    });
  });

  describe('Compliance Reporting', () => {
    it('should generate audit trail for compliance', async () => {
      const auditTrail = await auditLogger.getAuditTrail({
        resourceType: 'user',
        resourceId: 'user-123',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31')
      });

      expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
        'auditLogs',
        expect.arrayContaining([
          ['resourceType', '==', 'user'],
          ['resourceId', '==', 'user-123']
        ]),
        expect.any(Object)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore errors gracefully', async () => {
      mockFirestoreHelper.setDocument.mockRejectedValue(
        new Error('Firestore error')
      );

      await expect(
        auditLogger.logAdminAction({
          adminId: 'admin-123',
          action: 'test',
          resourceType: 'test',
          resourceId: 'test-123'
        })
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
