/**
 * Tests for Project Update Trigger Function
 * Social Finance Impact Platform
 */

import { onProjectUpdate } from '../onProjectUpdate';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('onProjectUpdate Trigger Function', () => {
  let mockBeforeSnapshot: any;
  let mockAfterSnapshot: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    const baseData = {
      id: 'project-123',
      title: 'Test Project',
      status: 'draft',
      creator: { uid: 'creator-123' },
      funding: { raised: 0, goal: 100000 }
    };

    mockBeforeSnapshot = {
      id: 'project-123',
      data: () => baseData,
      exists: true
    };

    mockAfterSnapshot = {
      id: 'project-123',
      data: () => ({ ...baseData, status: 'live' }),
      exists: true
    };

    mockContext = {
      eventId: 'event-123',
      timestamp: new Date().toISOString()
    };

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      { id: 'follower-1', userId: 'user-1' }
    ] as any);
    mockFirestoreHelper.setDocument.mockResolvedValue();
    mockFirestoreHelper.updateDocument.mockResolvedValue();
  });

  describe('Status Change Detection', () => {
    it('should detect status change from draft to live', async () => {
      await onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Project status changed'),
        expect.objectContaining({
          from: 'draft',
          to: 'live'
        })
      );
    });

    it('should notify followers when project goes live', async () => {
      await onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'project_live',
          projectId: 'project-123'
        })
      );
    });
  });

  describe('Funding Updates', () => {
    it('should track funding milestone achievements', async () => {
      mockAfterSnapshot.data = () => ({
        ...mockBeforeSnapshot.data(),
        funding: { raised: 50000, goal: 100000 } // 50% milestone
      });

      await onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalled();
    });

    it('should notify creator when funding goal is reached', async () => {
      mockAfterSnapshot.data = () => ({
        ...mockBeforeSnapshot.data(),
        funding: { raised: 100000, goal: 100000 }
      });

      await onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext);

      expect(mockFirestoreHelper.setDocument).toHaveBeenCalledWith(
        expect.stringContaining('notifications'),
        expect.any(String),
        expect.objectContaining({
          type: 'funding_goal_reached',
          userId: 'creator-123'
        })
      );
    });
  });

  describe('Analytics Updates', () => {
    it('should update project analytics on significant changes', async () => {
      await onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'projects',
        'project-123',
        expect.objectContaining({
          'analytics.lastUpdated': expect.any(Object)
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing before snapshot', async () => {
      mockBeforeSnapshot.exists = false;

      await expect(
        onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext)
      ).resolves.not.toThrow();
    });

    it('should handle Firestore errors gracefully', async () => {
      mockFirestoreHelper.setDocument.mockRejectedValue(new Error('Firestore error'));

      await expect(
        onProjectUpdate(mockBeforeSnapshot, mockAfterSnapshot, mockContext)
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
