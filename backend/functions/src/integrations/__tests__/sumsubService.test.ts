/**
 * Tests for Sumsub Service Integration
 * Social Finance Impact Platform
 */

import { sumsubService } from '../sumsub/sumsubService';
import { logger } from '../../utils/logger';

jest.mock('axios');
jest.mock('../../utils/logger');

const mockLogger = jest.mocked(logger);

describe('Sumsub Service Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Applicant Creation', () => {
    it('should create applicant with user details', async () => {
      const mockCreate = jest.fn().mockResolvedValue({
        data: {
          id: 'applicant-123',
          externalUserId: 'user-456',
          createdAt: new Date().toISOString()
        }
      });

      (sumsubService as any).apiClient = {
        post: mockCreate
      };

      const result = await sumsubService.createApplicant({
        externalUserId: 'user-456',
        email: 'user@test.com',
        firstName: 'John',
        lastName: 'Doe'
      });

      expect(result.id).toBe('applicant-123');
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should handle API errors during applicant creation', async () => {
      const mockCreate = jest.fn().mockRejectedValue(
        new Error('Sumsub API error')
      );

      (sumsubService as any).apiClient = {
        post: mockCreate
      };

      await expect(
        sumsubService.createApplicant({
          externalUserId: 'user-456',
          email: 'user@test.com',
          firstName: 'John',
          lastName: 'Doe'
        })
      ).rejects.toThrow('Sumsub API error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Verification Status', () => {
    it('should retrieve verification status', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        data: {
          id: 'applicant-123',
          reviewStatus: 'completed',
          reviewResult: {
            reviewAnswer: 'GREEN'
          }
        }
      });

      (sumsubService as any).apiClient = {
        get: mockGet
      };

      const result = await sumsubService.getApplicantStatus('applicant-123');

      expect(result.reviewStatus).toBe('completed');
      expect(result.reviewResult.reviewAnswer).toBe('GREEN');
    });
  });

  describe('Access Token Generation', () => {
    it('should generate access token for applicant', async () => {
      const mockGenerate = jest.fn().mockResolvedValue({
        data: {
          token: 'token-123',
          userId: 'user-456'
        }
      });

      (sumsubService as any).apiClient = {
        post: mockGenerate
      };

      const result = await sumsubService.generateAccessToken('applicant-123');

      expect(result.token).toBe('token-123');
    });
  });

  describe('Document Upload', () => {
    it('should upload document for verification', async () => {
      const mockUpload = jest.fn().mockResolvedValue({
        data: {
          id: 'doc-123',
          type: 'PASSPORT'
        }
      });

      (sumsubService as any).apiClient = {
        post: mockUpload
      };

      const result = await sumsubService.uploadDocument({
        applicantId: 'applicant-123',
        documentType: 'PASSPORT',
        file: Buffer.from('file-data')
      });

      expect(result.id).toBe('doc-123');
    });
  });
});
