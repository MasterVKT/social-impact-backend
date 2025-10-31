/**
 * Tests for Init KYC Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { initKYC } from '../initKYC';
import { firestoreHelper } from '../../utils/firestore';
import { sumsubService } from '../../integrations/sumsub/sumsubService';
import { AuthAPI } from '../../types/api';
import { UserDocument } from '../../types/firestore';
import { STATUS, KYC_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../integrations/sumsub/sumsubService');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockSumsubService = jest.mocked(sumsubService);

describe('initKYC Function', () => {
  let mockContext: CallableContext;
  let validKYCRequest: AuthAPI.InitKYCRequest;
  let mockUser: UserDocument;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockContext = {
      auth: {
        uid: 'test-user-uid',
        token: {}
      },
      rawRequest: {
        ip: '192.168.1.1',
        headers: {
          'user-agent': 'test-agent'
        }
      }
    } as any;

    validKYCRequest = {
      kycLevel: 'basic'
    };

    mockUser = {
      id: 'test-user-uid',
      uid: 'test-user-uid',
      email: 'test@example.com',
      firstName: 'Jean',
      lastName: 'Dupont',
      displayName: 'Jean Dupont',
      userType: 'contributor',
      profileComplete: true,
      accountStatus: STATUS.USER.ACTIVE,
      kyc: {
        status: STATUS.KYC.PENDING,
        level: 0,
        provider: 'sumsub',
        externalId: undefined,
        submittedAt: undefined,
        approvedAt: undefined,
        expiresAt: undefined,
        rejectionReason: undefined,
        documents: []
      },
      address: {
        street: '123 Rue de la Paix',
        city: 'Paris',
        postalCode: '75001',
        country: 'FR'
      },
      dateOfBirth: '1990-01-01',
      preferences: {
        language: 'fr',
        currency: 'EUR'
      }
    } as UserDocument;

    // Mock des services par défaut
    mockFirestoreHelper.getDocument.mockResolvedValue(mockUser);
    mockSumsubService.createApplicant.mockResolvedValue({
      id: 'test-applicant-id',
      externalUserId: 'user_test-user-uid_123456'
    } as any);
    mockSumsubService.generateAccessToken.mockResolvedValue({
      token: 'test-access-token',
      ttlInSecs: 86400
    });
    mockFirestoreHelper.updateDocument.mockResolvedValue();
  });

  describe('Authentication Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        initKYC(validKYCRequest, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });
  });

  describe('User Validation', () => {
    it('should reject users with incomplete profiles', async () => {
      const incompleteUser = {
        ...mockUser,
        profileComplete: false
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(incompleteUser);

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('User profile must be completed first');
    });

    it('should reject inactive users', async () => {
      const inactiveUser = {
        ...mockUser,
        accountStatus: STATUS.USER.SUSPENDED
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(inactiveUser);

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('User account is not active');
    });

    it('should reject users with already approved KYC at same level', async () => {
      const approvedUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: KYC_CONFIG.LEVELS.BASIC.level
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(approvedUser);

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('KYC already approved at basic level or higher');
    });

    it('should reject users with KYC already in progress', async () => {
      const pendingUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.PENDING,
          externalId: 'existing-applicant-id'
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(pendingUser);

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('KYC verification already in progress');
    });
  });

  describe('KYC Level Validation', () => {
    it('should accept basic KYC level', async () => {
      const basicRequest = { kycLevel: 'basic' as const };
      
      const result = await initKYC(basicRequest, mockContext);
      
      expect(result).toEqual({
        sumsubToken: 'test-access-token',
        sumsubUrl: 'https://cockpit.sumsub.com/idensic/l/#/uni_test-access-token',
        externalUserId: 'user_test-user-uid_123456',
        levelName: KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        expiresAt: expect.any(String)
      });
    });

    it('should accept enhanced KYC level', async () => {
      const enhancedRequest = { kycLevel: 'enhanced' as const };
      
      const result = await initKYC(enhancedRequest, mockContext);
      
      expect(result).toEqual({
        sumsubToken: 'test-access-token',
        sumsubUrl: 'https://cockpit.sumsub.com/idensic/l/#/uni_test-access-token',
        externalUserId: 'user_test-user-uid_123456',
        levelName: KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName,
        expiresAt: expect.any(String)
      });
    });

    it('should reject invalid KYC levels', async () => {
      const invalidRequest = { kycLevel: 'premium' as any };

      await expect(
        initKYC(invalidRequest, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Sumsub Integration', () => {
    it('should create new applicant when none exists', async () => {
      const userWithoutKYC = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          externalId: undefined
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithoutKYC);

      await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith({
        externalUserId: expect.stringContaining('user_test-user-uid_'),
        levelName: KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        lang: 'fr',
        email: 'test@example.com',
        phone: undefined,
        country: 'FR',
        firstName: 'Jean',
        lastName: 'Dupont',
        dob: '1990-01-01'
      });
    });

    it('should reuse existing applicant when available', async () => {
      const userWithExistingKYC = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          externalId: 'existing-applicant-id'
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithExistingKYC);

      await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.createApplicant).not.toHaveBeenCalled();
      expect(mockSumsubService.generateAccessToken).toHaveBeenCalledWith(
        expect.stringContaining('user_test-user-uid_'),
        KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        KYC_CONFIG.TOKEN_EXPIRY_HOURS * 3600
      );
    });

    it('should generate correct access token', async () => {
      await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.generateAccessToken).toHaveBeenCalledWith(
        expect.stringContaining('user_test-user-uid_'),
        KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        86400 // 24h en secondes
      );
    });

    it('should handle Sumsub service errors', async () => {
      mockSumsubService.createApplicant.mockRejectedValue(new Error('Sumsub API error'));

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('Unable to initialize KYC verification');
    });
  });

  describe('User Data Updates', () => {
    it('should update user KYC status correctly for basic level', async () => {
      await initKYC(validKYCRequest, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'test-user-uid',
        {
          'kyc.externalId': 'test-applicant-id',
          'kyc.levelName': KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
          'kyc.level': KYC_CONFIG.LEVELS.BASIC.level,
          'kyc.status': STATUS.KYC.PENDING,
          'kyc.submittedAt': expect.any(Date),
          updatedAt: expect.any(Date)
        }
      );
    });

    it('should update user KYC status correctly for enhanced level', async () => {
      const enhancedRequest = { kycLevel: 'enhanced' as const };
      
      await initKYC(enhancedRequest, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'test-user-uid',
        {
          'kyc.externalId': 'test-applicant-id',
          'kyc.levelName': KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName,
          'kyc.level': KYC_CONFIG.LEVELS.ENHANCED.level,
          'kyc.status': STATUS.KYC.PENDING,
          'kyc.submittedAt': expect.any(Date),
          updatedAt: expect.any(Date)
        }
      );
    });
  });

  describe('Response Generation', () => {
    it('should return correct response structure', async () => {
      const result = await initKYC(validKYCRequest, mockContext);

      expect(result).toEqual({
        sumsubToken: 'test-access-token',
        sumsubUrl: 'https://cockpit.sumsub.com/idensic/l/#/uni_test-access-token',
        externalUserId: expect.stringContaining('user_test-user-uid_'),
        levelName: KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        expiresAt: expect.any(String)
      });
    });

    it('should generate valid ISO date for expiration', async () => {
      const result = await initKYC(validKYCRequest, mockContext);

      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      
      const expirationDate = new Date(result.expiresAt);
      const now = new Date();
      const expectedExpiration = new Date(now.getTime() + (86400 * 1000)); // 24h
      
      expect(Math.abs(expirationDate.getTime() - expectedExpiration.getTime())).toBeLessThan(5000); // 5s tolerance
    });

    it('should generate unique external user IDs', async () => {
      const result1 = await initKYC(validKYCRequest, mockContext);
      
      // Reset mocks and call again
      jest.clearAllMocks();
      mockFirestoreHelper.getDocument.mockResolvedValue(mockUser);
      mockSumsubService.createApplicant.mockResolvedValue({
        id: 'test-applicant-id-2',
        externalUserId: 'user_test-user-uid_789012'
      } as any);
      mockSumsubService.generateAccessToken.mockResolvedValue({
        token: 'test-access-token-2',
        ttlInSecs: 86400
      });

      const result2 = await initKYC(validKYCRequest, mockContext);

      expect(result1.externalUserId).not.toEqual(result2.externalUserId);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing user document', async () => {
      mockFirestoreHelper.getDocument.mockRejectedValue(new Error('User not found'));

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow();
    });

    it('should handle Sumsub applicant creation failures', async () => {
      mockSumsubService.createApplicant.mockRejectedValue(new Error('API error'));

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow('Unable to initialize KYC verification');
    });

    it('should handle access token generation failures', async () => {
      mockSumsubService.generateAccessToken.mockRejectedValue(new Error('Token error'));

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow();
    });

    it('should handle Firestore update failures', async () => {
      mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Firestore error'));

      await expect(
        initKYC(validKYCRequest, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Applicant Data Preparation', () => {
    it('should prepare correct applicant data for basic KYC', async () => {
      await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith(
        expect.objectContaining({
          externalUserId: expect.stringContaining('user_test-user-uid_'),
          levelName: KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
          lang: 'fr',
          email: 'test@example.com',
          country: 'FR',
          firstName: 'Jean',
          lastName: 'Dupont',
          dob: '1990-01-01'
        })
      );
    });

    it('should prepare correct applicant data for enhanced KYC', async () => {
      const enhancedRequest = { kycLevel: 'enhanced' as const };
      
      await initKYC(enhancedRequest, mockContext);

      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith(
        expect.objectContaining({
          levelName: KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName
        })
      );
    });

    it('should include phone number when available', async () => {
      const userWithPhone = {
        ...mockUser,
        phoneNumber: '+33123456789'
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithPhone);

      await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+33123456789'
        })
      );
    });

    it('should handle missing optional fields gracefully', async () => {
      const userWithMinimalData = {
        ...mockUser,
        phoneNumber: undefined,
        address: {
          ...mockUser.address,
          coordinates: undefined
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithMinimalData);

      const result = await initKYC(validKYCRequest, mockContext);
      
      expect(result.sumsubToken).toBe('test-access-token');
      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: undefined
        })
      );
    });
  });

  describe('Existing Applicant Handling', () => {
    it('should reuse existing applicant ID', async () => {
      const userWithExistingKYC = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          externalId: 'existing-applicant-id',
          status: STATUS.KYC.REJECTED // Peut réessayer
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithExistingKYC);

      const result = await initKYC(validKYCRequest, mockContext);

      expect(mockSumsubService.createApplicant).not.toHaveBeenCalled();
      expect(result.sumsubToken).toBe('test-access-token');
      
      // Vérifier que generateAccessToken utilise les bonnes données
      expect(mockSumsubService.generateAccessToken).toHaveBeenCalledWith(
        expect.stringContaining('user_test-user-uid_'),
        KYC_CONFIG.LEVELS.BASIC.sumsubLevelName,
        86400
      );
    });
  });

  describe('URL Generation', () => {
    it('should generate correct Sumsub URL', async () => {
      const result = await initKYC(validKYCRequest, mockContext);

      expect(result.sumsubUrl).toBe('https://cockpit.sumsub.com/idensic/l/#/uni_test-access-token');
    });

    it('should handle different token formats', async () => {
      mockSumsubService.generateAccessToken.mockResolvedValue({
        token: 'special-token-format-123',
        ttlInSecs: 3600
      });

      const result = await initKYC(validKYCRequest, mockContext);

      expect(result.sumsubUrl).toBe('https://cockpit.sumsub.com/idensic/l/#/uni_special-token-format-123');
    });
  });

  describe('Token Expiration Calculation', () => {
    it('should calculate correct expiration time', async () => {
      const mockTtl = 7200; // 2 heures
      mockSumsubService.generateAccessToken.mockResolvedValue({
        token: 'test-token',
        ttlInSecs: mockTtl
      });

      const beforeCall = new Date();
      const result = await initKYC(validKYCRequest, mockContext);
      const afterCall = new Date();

      const expirationDate = new Date(result.expiresAt);
      const expectedMinExpiration = new Date(beforeCall.getTime() + (mockTtl * 1000));
      const expectedMaxExpiration = new Date(afterCall.getTime() + (mockTtl * 1000));

      expect(expirationDate.getTime()).toBeGreaterThanOrEqual(expectedMinExpiration.getTime());
      expect(expirationDate.getTime()).toBeLessThanOrEqual(expectedMaxExpiration.getTime());
    });
  });

  describe('Transaction Safety', () => {
    it('should handle concurrent KYC initialization attempts', async () => {
      // Premier appel commence
      const firstCall = initKYC(validKYCRequest, mockContext);
      
      // Changer le mock pour simuler qu'un autre processus a mis à jour le statut
      mockFirestoreHelper.getDocument.mockResolvedValue({
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.PENDING,
          externalId: 'another-applicant-id'
        }
      });

      // Deuxième appel
      const secondCall = initKYC(validKYCRequest, mockContext);

      // Le premier devrait réussir, le second échouer
      await expect(firstCall).resolves.toBeDefined();
      await expect(secondCall).rejects.toThrow('KYC verification already in progress');
    });
  });

  describe('Data Validation Edge Cases', () => {
    it('should handle missing request data', async () => {
      await expect(
        initKYC(undefined as any, mockContext)
      ).rejects.toThrow();
    });

    it('should handle empty request object', async () => {
      await expect(
        initKYC({} as any, mockContext)
      ).rejects.toThrow();
    });

    it('should handle null kycLevel', async () => {
      await expect(
        initKYC({ kycLevel: null } as any, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Level Configuration', () => {
    it('should use correct configuration for basic level', async () => {
      await initKYC({ kycLevel: 'basic' }, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'test-user-uid',
        expect.objectContaining({
          'kyc.level': KYC_CONFIG.LEVELS.BASIC.level,
          'kyc.levelName': KYC_CONFIG.LEVELS.BASIC.sumsubLevelName
        })
      );
    });

    it('should use correct configuration for enhanced level', async () => {
      await initKYC({ kycLevel: 'enhanced' }, mockContext);

      expect(mockFirestoreHelper.updateDocument).toHaveBeenCalledWith(
        'users',
        'test-user-uid',
        expect.objectContaining({
          'kyc.level': KYC_CONFIG.LEVELS.ENHANCED.level,
          'kyc.levelName': KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName
        })
      );
    });
  });

  describe('Edge Cases and Resilience', () => {
    it('should handle partial user data gracefully', async () => {
      const partialUser = {
        ...mockUser,
        phoneNumber: undefined,
        address: {
          ...mockUser.address,
          coordinates: undefined
        },
        preferences: {
          language: 'en' // Différent de la default
        }
      } as UserDocument;

      mockFirestoreHelper.getDocument.mockResolvedValue(partialUser);

      const result = await initKYC(validKYCRequest, mockContext);
      
      expect(result.sumsubToken).toBe('test-access-token');
      expect(mockSumsubService.createApplicant).toHaveBeenCalledWith(
        expect.objectContaining({
          lang: 'en',
          phone: undefined
        })
      );
    });

    it('should handle upgrade from basic to enhanced KYC', async () => {
      const userWithBasicKYC = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: KYC_CONFIG.LEVELS.BASIC.level,
          externalId: 'existing-basic-applicant'
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(userWithBasicKYC);

      const enhancedRequest = { kycLevel: 'enhanced' as const };
      const result = await initKYC(enhancedRequest, mockContext);

      expect(result.levelName).toBe(KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName);
      expect(mockSumsubService.generateAccessToken).toHaveBeenCalledWith(
        expect.any(String),
        KYC_CONFIG.LEVELS.ENHANCED.sumsubLevelName,
        86400
      );
    });
  });
});