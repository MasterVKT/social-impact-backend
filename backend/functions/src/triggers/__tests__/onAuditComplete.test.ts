/**
 * Tests for Audit Complete Trigger Function
 * Social Finance Impact Platform
 */

import { onAuditComplete } from '../onAuditComplete';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('onAuditComplete Trigger Function', () => {
  let mockSnapshot: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSnapshot = {
      id: 'audit-123',
      data: () => ({
        id: 'audit-123',
        projectId: 'project-456',
        milestoneId: 'milestone-789',
        auditorUid: 'auditor-111',
        status: 'completed',
        result: 'approved',
        completedAt: new Date(),
        report: {
          summary: 'Audit passed',
          findings: []
        }
      }),
      ref: {
        update: jest.fn().mockResolvedValue(undefined)
      }
    };

    mockContext = {
      eventId: 'event-123',
      timestamp: new Date().toISOString()
    };

    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'project-456',
      title: 'Great Project',
      creator: { uid: 'creator-456' }
    } as any);

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.setDocument.mockResolvedValue();
  });

  describe('Milestone Status Update', () => {
    it('should update milestone status when audit is approved', async () => {
      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        expect.stringContaining('milestones'),
        'milestone-789',
        expect.objectContaining({
          auditStatus: 'approved',
          status: expect.any(String)
        })
      );
    });

    it('should handle rejected audit', async () => {
      mockSnapshot.data = () => ({
        ...mockSnapshot.data(),
        result: 'rejected'
      });

      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        expect.stringContaining('milestones'),
        'milestone-789',
        expect.objectContaining({
          auditStatus: 'rejected'
        })
      );
    });
  });

  describe('Creator Notification', () => {
    it('should notify creator of audit approval', async () => {
      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'audit_completed',
          userId: 'creator-456',
          data: expect.objectContaining({
            result: 'approved'
          })
        })
      );
    });

    it('should notify creator of audit rejection', async () => {
      mockSnapshot.data = () => ({
        ...mockSnapshot.data(),
        result: 'rejected'
      });

      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'audit_completed',
          data: expect.objectContaining({
            result: 'rejected'
          })
        })
      );
    });
  });

  describe('Auditor Statistics', () => {
    it('should update auditor statistics', async () => {
      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'auditor-111',
        expect.objectContaining({
          'auditorProfile.stats.auditsCompleted': expect.anything(),
          'auditorProfile.stats.lastAuditDate': expect.any(Object)
        })
      );
    });
  });

  describe('Fund Release', () => {
    it('should trigger fund release for approved milestone', async () => {
      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Audit completed'),
        expect.objectContaining({
          result: 'approved'
        })
      );
    });

    it('should not release funds for rejected audit', async () => {
      mockSnapshot.data = () => ({
        ...mockSnapshot.data(),
        result: 'rejected'
      });

      await onAuditComplete(mockSnapshot, mockContext);

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing project gracefully', async () => {
      mockFirestoreHelper.getDocument.mockResolvedValue(null);

      await expect(onAuditComplete(mockSnapshot, mockContext)).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Project not found'),
        expect.any(Object)
      );
    });

    it('should handle update errors gracefully', async () => {
      mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Update failed'));

      await expect(onAuditComplete(mockSnapshot, mockContext)).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
