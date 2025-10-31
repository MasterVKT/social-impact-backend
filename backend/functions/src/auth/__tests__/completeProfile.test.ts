/**
 * Tests for Complete Profile Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { completeProfile } from '../completeProfile';
import { firestoreHelper } from '../../utils/firestore';
import { authHelper } from '../../utils/auth';
import { emailService } from '../../integrations/sendgrid/emailService';
import { AuthAPI } from '../../types/api';
import { UserDocument } from '../../types/firestore';
import { STATUS, USER_TYPES } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../integrations/sendgrid/emailService');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockAuthHelper = jest.mocked(authHelper);
const mockEmailService = jest.mocked(emailService);

describe('completeProfile Function', () => {
  let mockContext: CallableContext;
  let validProfileData: AuthAPI.CompleteProfileRequest;

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

    validProfileData = {
      userType: 'contributor',
      firstName: 'Jean',
      lastName: 'Dupont',
      phoneNumber: '+33123456789',
      dateOfBirth: new Date('1990-01-01'),
      address: {
        street: '123 Rue de la Paix',
        city: 'Paris',
        postalCode: '75001',
        country: 'FR',
        coordinates: {
          lat: 48.8566,
          lng: 2.3522
        }
      },
      preferences: {
        language: 'fr',
        currency: 'EUR',
        notifications: {
          email: true,
          push: true,
          inApp: true
        },
        interestedCategories: ['environment', 'education']
      }
    };

    // Mock des services par défaut
    mockFirestoreHelper.getDocumentOptional.mockResolvedValue(null);
    mockAuthHelper.getUserRecord.mockResolvedValue({
      uid: 'test-user-uid',
      email: 'test@example.com',
      emailVerified: true
    } as any);
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      await callback({
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      } as any);
    });
    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
    mockAuthHelper.updateUserTypeClaims.mockResolvedValue();
    mockEmailService.sendWelcomeEmail.mockResolvedValue();
  });

  describe('Authentication Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        completeProfile(validProfileData, unauthenticatedContext)
      ).rejects.toThrow('Authentication required');
    });

    it('should reject users without verified email', async () => {
      mockAuthHelper.getUserRecord.mockResolvedValue({
        uid: 'test-user-uid',
        email: null
      } as any);

      await expect(
        completeProfile(validProfileData, mockContext)
      ).rejects.toThrow('User must have a verified email');
    });
  });

  describe('Profile Completion Validation', () => {
    it('should reject users with already completed profiles', async () => {
      const existingUser: Partial<UserDocument> = {
        uid: 'test-user-uid',
        profileComplete: true
      };
      
      mockFirestoreHelper.getDocumentOptional.mockResolvedValue(existingUser as UserDocument);

      await expect(
        completeProfile(validProfileData, mockContext)
      ).rejects.toThrow('User profile is already complete');
    });

    it('should allow profile completion for new users', async () => {
      mockFirestoreHelper.getDocumentOptional.mockResolvedValue(null);

      const result = await completeProfile(validProfileData, mockContext);

      expect(result).toEqual({
        userId: 'test-user-uid',
        profileComplete: true,
        kycRequired: true,
        nextStep: 'kyc_verification'
      });
    });
  });

  describe('Data Validation', () => {
    it('should reject invalid user types', async () => {
      const invalidData = {
        ...validProfileData,
        userType: 'invalid-type' as any
      };

      await expect(
        completeProfile(invalidData, mockContext)
      ).rejects.toThrow();
    });

    it('should reject invalid phone numbers', async () => {
      const invalidData = {
        ...validProfileData,
        phoneNumber: 'invalid-phone'
      };

      await expect(
        completeProfile(invalidData, mockContext)
      ).rejects.toThrow();
    });

    it('should reject future birth dates', async () => {
      const invalidData = {
        ...validProfileData,
        dateOfBirth: new Date('2030-01-01')
      };

      await expect(
        completeProfile(invalidData, mockContext)
      ).rejects.toThrow();
    });

    it('should reject invalid countries', async () => {
      const invalidData = {
        ...validProfileData,
        address: {
          ...validProfileData.address,
          country: 'INVALID'
        }
      };

      await expect(
        completeProfile(invalidData, mockContext)
      ).rejects.toThrow();
    });

    it('should reject too few interested categories', async () => {
      const invalidData = {
        ...validProfileData,
        preferences: {
          ...validProfileData.preferences,
          interestedCategories: []
        }
      };

      await expect(
        completeProfile(invalidData, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('User Document Creation', () => {
    it('should create correct contributor user document', async () => {
      const contributorData = {
        ...validProfileData,
        userType: 'contributor' as const
      };

      await completeProfile(contributorData, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      
      // Vérifier que la transaction inclut les bonnes données
      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          uid: 'test-user-uid',
          email: 'test@example.com',
          firstName: 'Jean',
          lastName: 'Dupont',
          displayName: 'Jean Dupont',
          userType: 'contributor',
          permissions: USER_TYPES.CONTRIBUTOR.permissions,
          profileComplete: true,
          accountStatus: STATUS.USER.ACTIVE,
          kyc: expect.objectContaining({
            status: STATUS.KYC.PENDING,
            level: 0,
            provider: 'sumsub'
          }),
          stats: expect.objectContaining({
            totalContributed: 0,
            projectsSupported: 0,
            loginStreak: 1
          })
        })
      );
    });

    it('should create correct creator user document', async () => {
      const creatorData = {
        ...validProfileData,
        userType: 'creator' as const
      };

      await completeProfile(creatorData, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      
      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userType: 'creator',
          permissions: USER_TYPES.CREATOR.permissions
        })
      );
    });

    it('should handle optional fields correctly', async () => {
      const minimalData = {
        userType: 'contributor' as const,
        firstName: 'Jean',
        lastName: 'Dupont',
        dateOfBirth: new Date('1990-01-01'),
        address: {
          street: '123 Rue de la Paix',
          city: 'Paris',
          postalCode: '75001',
          country: 'FR'
        },
        preferences: {
          language: 'fr' as const,
          currency: 'EUR' as const,
          notifications: {
            email: true,
            push: false,
            inApp: true
          },
          interestedCategories: ['environment'] as const
        }
      };

      const result = await completeProfile(minimalData, mockContext);

      expect(result.profileComplete).toBe(true);
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
    });
  });

  describe('External Service Integration', () => {
    it('should update Firebase Auth custom claims', async () => {
      await completeProfile(validProfileData, mockContext);

      expect(mockAuthHelper.updateUserTypeClaims).toHaveBeenCalledWith(
        'test-user-uid',
        'contributor'
      );
    });

    it('should send welcome email', async () => {
      await completeProfile(validProfileData, mockContext);

      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        firstName: 'Jean',
        userType: 'contributor',
        kycRequired: true
      });
    });

    it('should not fail if welcome email fails', async () => {
      mockEmailService.sendWelcomeEmail.mockRejectedValue(new Error('Email service down'));

      const result = await completeProfile(validProfileData, mockContext);

      expect(result.profileComplete).toBe(true);
      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore errors', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Firestore error'));

      await expect(
        completeProfile(validProfileData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle Auth service errors', async () => {
      mockAuthHelper.getUserRecord.mockRejectedValue(new Error('Auth error'));

      await expect(
        completeProfile(validProfileData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle custom claims update errors gracefully', async () => {
      mockAuthHelper.updateUserTypeClaims.mockRejectedValue(new Error('Claims error'));

      // La fonction devrait réussir même si les claims échouent
      const result = await completeProfile(validProfileData, mockContext);
      expect(result.profileComplete).toBe(true);
    });
  });

  describe('Age Validation', () => {
    it('should reject users under 18', async () => {
      const underageData = {
        ...validProfileData,
        dateOfBirth: new Date('2010-01-01') // Trop jeune
      };

      await expect(
        completeProfile(underageData, mockContext)
      ).rejects.toThrow();
    });

    it('should accept users exactly 18', async () => {
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
      
      const validAgeData = {
        ...validProfileData,
        dateOfBirth: eighteenYearsAgo
      };

      const result = await completeProfile(validAgeData, mockContext);
      expect(result.profileComplete).toBe(true);
    });
  });

  describe('Address Validation', () => {
    it('should validate coordinates are within valid ranges', async () => {
      const invalidCoordinatesData = {
        ...validProfileData,
        address: {
          ...validProfileData.address,
          coordinates: {
            lat: 100, // Invalid latitude
            lng: 2.3522
          }
        }
      };

      await expect(
        completeProfile(invalidCoordinatesData, mockContext)
      ).rejects.toThrow();
    });

    it('should accept valid coordinates', async () => {
      const result = await completeProfile(validProfileData, mockContext);
      expect(result.profileComplete).toBe(true);
    });
  });

  describe('Preferences Validation', () => {
    it('should validate notification preferences', async () => {
      const result = await completeProfile(validProfileData, mockContext);
      
      expect(result.profileComplete).toBe(true);
      
      // Vérifier que les préférences par défaut sont bien définies
      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preferences: expect.objectContaining({
            notifications: expect.objectContaining({
              frequency: 'immediate'
            }),
            privacy: expect.objectContaining({
              profilePublic: false,
              showContributions: false,
              allowContact: true
            })
          })
        })
      );
    });

    it('should set correct timezone default', async () => {
      await completeProfile(validProfileData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preferences: expect.objectContaining({
            timezone: 'Europe/Paris'
          })
        })
      );
    });
  });

  describe('User Type Configuration', () => {
    it('should set correct permissions for contributors', async () => {
      const contributorData = {
        ...validProfileData,
        userType: 'contributor' as const
      };

      await completeProfile(contributorData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userType: 'contributor',
          permissions: USER_TYPES.CONTRIBUTOR.permissions
        })
      );
    });

    it('should set correct permissions for creators', async () => {
      const creatorData = {
        ...validProfileData,
        userType: 'creator' as const
      };

      await completeProfile(creatorData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userType: 'creator',
          permissions: USER_TYPES.CREATOR.permissions
        })
      );
    });
  });

  describe('Stats Initialization', () => {
    it('should initialize user stats correctly', async () => {
      await completeProfile(validProfileData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          stats: expect.objectContaining({
            totalContributed: 0,
            projectsSupported: 0,
            projectsCreated: 0,
            totalFundsRaised: 0,
            auditsCompleted: 0,
            profileViews: 0,
            loginStreak: 1,
            lastLoginAt: expect.any(Date)
          })
        })
      );
    });
  });

  describe('Context Metadata', () => {
    it('should capture IP address and user agent', async () => {
      await completeProfile(validProfileData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent',
          lastModifiedBy: 'test-user-uid'
        })
      );
    });

    it('should handle missing IP and user agent gracefully', async () => {
      const contextWithoutMeta = {
        ...mockContext,
        rawRequest: {
          ip: undefined,
          headers: {}
        }
      };

      const result = await completeProfile(validProfileData, contextWithoutMeta as any);
      expect(result.profileComplete).toBe(true);
    });
  });

  describe('Return Values', () => {
    it('should return correct response structure', async () => {
      const result = await completeProfile(validProfileData, mockContext);

      expect(result).toEqual({
        userId: 'test-user-uid',
        profileComplete: true,
        kycRequired: true,
        nextStep: 'kyc_verification'
      });
    });

    it('should always require KYC in the platform', async () => {
      const result = await completeProfile(validProfileData, mockContext);

      expect(result.kycRequired).toBe(true);
      expect(result.nextStep).toBe('kyc_verification');
    });
  });

  describe('Integration Points', () => {
    it('should call all required services in correct order', async () => {
      await completeProfile(validProfileData, mockContext);

      // Vérifier l'ordre des appels
      expect(mockFirestoreHelper.getDocumentOptional).toHaveBeenCalledBefore(
        mockAuthHelper.getUserRecord as jest.Mock
      );
      expect(mockAuthHelper.getUserRecord).toHaveBeenCalledBefore(
        mockFirestoreHelper.runTransaction as jest.Mock
      );
      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalledBefore(
        mockAuthHelper.updateUserTypeClaims as jest.Mock
      );
      expect(mockAuthHelper.updateUserTypeClaims).toHaveBeenCalledBefore(
        mockEmailService.sendWelcomeEmail as jest.Mock
      );
    });

    it('should pass correct parameters to services', async () => {
      await completeProfile(validProfileData, mockContext);

      expect(mockAuthHelper.updateUserTypeClaims).toHaveBeenCalledWith(
        'test-user-uid',
        'contributor'
      );

      expect(mockEmailService.sendWelcomeEmail).toHaveBeenCalledWith({
        to: 'test@example.com',
        firstName: 'Jean',
        userType: 'contributor',
        kycRequired: true
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing optional phone number', async () => {
      const dataWithoutPhone = {
        ...validProfileData
      };
      delete dataWithoutPhone.phoneNumber;

      const result = await completeProfile(dataWithoutPhone, mockContext);
      expect(result.profileComplete).toBe(true);
    });

    it('should handle missing optional coordinates', async () => {
      const dataWithoutCoords = {
        ...validProfileData,
        address: {
          street: '123 Rue de la Paix',
          city: 'Paris',
          postalCode: '75001',
          country: 'FR'
        }
      };

      const result = await completeProfile(dataWithoutCoords, mockContext);
      expect(result.profileComplete).toBe(true);
    });

    it('should handle concurrent profile completion attempts', async () => {
      // Premier utilisateur avec profil déjà complété
      const existingUser: Partial<UserDocument> = {
        uid: 'test-user-uid',
        profileComplete: true
      };
      
      mockFirestoreHelper.getDocumentOptional.mockResolvedValue(existingUser as UserDocument);

      await expect(
        completeProfile(validProfileData, mockContext)
      ).rejects.toThrow('User profile is already complete');
    });
  });

  describe('Date Handling', () => {
    it('should format date of birth correctly', async () => {
      const testDate = new Date('1985-06-15T10:30:00.000Z');
      const dataWithSpecificDate = {
        ...validProfileData,
        dateOfBirth: testDate
      };

      await completeProfile(dataWithSpecificDate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          dateOfBirth: '1985-06-15' // Format YYYY-MM-DD
        })
      );
    });
  });
});