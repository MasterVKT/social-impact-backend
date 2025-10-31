/**
 * Tests for Update Project Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { updateProject } from '../updateProject';
import { firestoreHelper } from '../../utils/firestore';
import { ProjectsAPI } from '../../types/api';
import { ProjectDocument, UserDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, PROJECT_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);

describe('updateProject Function', () => {
  let mockContext: CallableContext;
  let mockProject: ProjectDocument;
  let mockUser: UserDocument;
  let validUpdateData: Partial<ProjectsAPI.UpdateProjectRequest>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: { uid: 'creator-uid', token: {} },
      rawRequest: { ip: '192.168.1.1', headers: { 'user-agent': 'test-agent' } }
    } as any;

    mockProject = {
      uid: 'test-project-id',
      creatorUid: 'creator-uid',
      status: STATUS.PROJECT.DRAFT,
      title: 'Test Project',
      version: 1,
      milestones: [{ id: 'milestone-1', fundingPercentage: 100 }],
      team: [{ id: 'team-1', isLead: true, name: 'Leader' }],
      funding: { deadline: new Date(Date.now() + 48 * 60 * 60 * 1000) }
    } as ProjectDocument;

    mockUser = {
      uid: 'creator-uid',
      permissions: [USER_PERMISSIONS.CREATE_PROJECT]
    } as UserDocument;

    validUpdateData = {
      projectId: 'test-project-id',
      title: 'Updated Project Title',
      description: 'Updated project description'
    };

    mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
      if (collection === 'users') return Promise.resolve(mockUser);
      if (collection === 'projects') return Promise.resolve(mockProject);
      throw new Error('Unexpected collection');
    });

    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };
      await callback(mockTransaction as any);
    });

    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
  });

  describe('Permission Validation', () => {
    it('should allow project creator to update', async () => {
      const result = await updateProject(validUpdateData, mockContext);
      expect(result.success).toBe(true);
    });

    it('should allow admins to update any project', async () => {
      const adminUser = {
        ...mockUser,
        uid: 'admin-uid',
        permissions: [USER_PERMISSIONS.MODERATE_PROJECTS]
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(adminUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      const adminContext = { ...mockContext, auth: { uid: 'admin-uid', token: {} } };
      const result = await updateProject(validUpdateData, adminContext);
      
      expect(result.success).toBe(true);
    });

    it('should reject unauthorized users', async () => {
      const unauthorizedUser = {
        ...mockUser,
        uid: 'other-uid',
        permissions: []
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(unauthorizedUser);
        if (collection === 'projects') return Promise.resolve(mockProject);
        throw new Error('Unexpected collection');
      });

      const otherContext = { ...mockContext, auth: { uid: 'other-uid', token: {} } };
      
      await expect(
        updateProject(validUpdateData, otherContext)
      ).rejects.toThrow('Only the project creator can modify this project');
    });
  });

  describe('Status Restrictions', () => {
    it('should prevent updates to completed projects', async () => {
      const completedProject = {
        ...mockProject,
        status: STATUS.PROJECT.COMPLETED
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(completedProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        updateProject(validUpdateData, mockContext)
      ).rejects.toThrow('Cannot modify project in status');
    });

    it('should prevent updates in last 24h of funding', async () => {
      const nearDeadlineProject = {
        ...mockProject,
        status: STATUS.PROJECT.FUNDING,
        funding: {
          ...mockProject.funding,
          deadline: new Date(Date.now() + 12 * 60 * 60 * 1000) // 12 hours remaining
        }
      };
      
      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(nearDeadlineProject);
        throw new Error('Unexpected collection');
      });

      await expect(
        updateProject(validUpdateData, mockContext)
      ).rejects.toThrow('Project cannot be modified in the last 24 hours of funding');
    });
  });

  describe('Version Control', () => {
    it('should handle version conflicts', async () => {
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ...mockProject, version: 2 }) // Different version
          }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      await expect(
        updateProject(validUpdateData, mockContext)
      ).rejects.toThrow('Project was modified by another operation');
    });

    it('should increment version number', async () => {
      await updateProject(validUpdateData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          version: 2
        })
      );
    });
  });

  describe('Team Management', () => {
    it('should add new team members', async () => {
      const teamUpdate = {
        projectId: 'test-project-id',
        team: {
          add: [
            { name: 'New Member', role: 'Specialist', bio: 'Expert in field' }
          ]
        }
      };

      await updateProject(teamUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockProject, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          team: expect.arrayContaining([
            expect.objectContaining({ name: 'New Member', role: 'Specialist' })
          ])
        })
      );
    });

    it('should prevent removing team lead', async () => {
      const teamUpdate = {
        projectId: 'test-project-id',
        team: {
          remove: ['team-1'] // Team lead ID
        }
      };

      await expect(
        updateProject(teamUpdate, mockContext)
      ).rejects.toThrow('Cannot remove the team lead');
    });
  });

  describe('Data Merging', () => {
    it('should merge media data correctly', async () => {
      const mediaUpdate = {
        projectId: 'test-project-id',
        media: {
          gallery: ['https://example.com/new-image.jpg'],
          video: 'https://example.com/new-video.mp4'
        }
      };

      const projectWithMedia = {
        ...mockProject,
        media: {
          coverImage: 'https://example.com/existing-cover.jpg',
          gallery: ['https://example.com/existing-image.jpg'],
          documents: [{ id: 'doc-1', name: 'Existing Doc' }]
        }
      };

      mockFirestoreHelper.getDocument.mockImplementation((collection, id) => {
        if (collection === 'users') return Promise.resolve(mockUser);
        if (collection === 'projects') return Promise.resolve(projectWithMedia);
        throw new Error('Unexpected collection');
      });

      await updateProject(mediaUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...projectWithMedia, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          media: expect.objectContaining({
            coverImage: 'https://example.com/existing-cover.jpg', // Preserved
            gallery: ['https://example.com/new-image.jpg'], // Updated
            video: 'https://example.com/new-video.mp4' // Updated
          })
        })
      );
    });
  });
});