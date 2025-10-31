/**
 * Tests for Update Profile Firebase Function
 * Social Finance Impact Platform
 */

import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { updateProfile } from '../updateProfile';
import { firestoreHelper } from '../../utils/firestore';
import { authHelper } from '../../utils/auth';
import { AuthAPI } from '../../types/api';
import { UserDocument } from '../../types/firestore';
import { STATUS, KYC_CONFIG } from '../../utils/constants';

// Mocks
jest.mock('../../utils/firestore');
jest.mock('../../utils/auth');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockAuthHelper = jest.mocked(authHelper);

describe('updateProfile Function', () => {
  let mockContext: CallableContext;
  let mockUser: UserDocument;
  let validUpdateData: Partial<AuthAPI.UpdateProfileRequest>;

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
      suspendedAt: undefined,
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
        currency: 'EUR',
        timezone: 'Europe/Paris',
        notifications: {
          email: true,
          push: true,
          inApp: true,
          frequency: 'immediate'
        },
        privacy: {
          profilePublic: false,
          showContributions: false,
          allowContact: true
        },
        interests: {
          categories: ['environment', 'education'],
          causes: []
        }
      },
      version: 1,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01')
    } as UserDocument;

    validUpdateData = {
      bio: 'Updated bio description',
      profilePicture: 'https://example.com/new-avatar.jpg',
      preferences: {
        notifications: {
          email: false,
          frequency: 'daily'
        },
        privacy: {
          profilePublic: true
        },
        interests: {
          categories: ['environment', 'health', 'community']
        }
      }
    };

    // Mock des services par défaut
    mockFirestoreHelper.getDocument.mockResolvedValue(mockUser);
    mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };
      await callback(mockTransaction as any);
    });
    mockFirestoreHelper.getDocumentRef.mockReturnValue({} as any);
    mockAuthHelper.updateUser.mockResolvedValue({} as any);
  });

  describe('Authentication Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthenticatedContext = { ...mockContext, auth: null };

      await expect(
        updateProfile(validUpdateData, unauthenticatedContext)
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
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow('Profile must be completed first');
    });

    it('should reject inactive users', async () => {
      const inactiveUser = {
        ...mockUser,
        accountStatus: STATUS.USER.SUSPENDED
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(inactiveUser);

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow('Account is not active');
    });

    it('should reject suspended users', async () => {
      const suspendedUser = {
        ...mockUser,
        suspendedAt: new Date()
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(suspendedUser);

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow('Account is suspended');
    });
  });

  describe('KYC Restrictions', () => {
    it('should block firstName changes after KYC approval', async () => {
      const approvedKYCUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: 1
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(approvedKYCUser);

      const sensitiveUpdate = {
        firstName: 'NewFirstName'
      };

      await expect(
        updateProfile(sensitiveUpdate, mockContext)
      ).rejects.toThrow('Cannot modify firstName after KYC approval');
    });

    it('should block lastName changes after KYC approval', async () => {
      const approvedKYCUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: 1
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(approvedKYCUser);

      const sensitiveUpdate = {
        lastName: 'NewLastName'
      };

      await expect(
        updateProfile(sensitiveUpdate, mockContext)
      ).rejects.toThrow('Cannot modify lastName after KYC approval');
    });

    it('should block dateOfBirth changes after KYC approval', async () => {
      const approvedKYCUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: 1
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(approvedKYCUser);

      const sensitiveUpdate = {
        dateOfBirth: new Date('1985-01-01')
      };

      await expect(
        updateProfile(sensitiveUpdate, mockContext)
      ).rejects.toThrow('Cannot modify dateOfBirth after KYC approval');
    });

    it('should block country changes after enhanced KYC', async () => {
      const enhancedKYCUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: KYC_CONFIG.LEVELS.ENHANCED.level
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(enhancedKYCUser);

      const countryUpdate = {
        address: {
          country: 'DE'
        }
      };

      await expect(
        updateProfile(countryUpdate, mockContext)
      ).rejects.toThrow('Cannot modify country after enhanced KYC');
    });

    it('should allow non-sensitive changes after KYC approval', async () => {
      const approvedKYCUser = {
        ...mockUser,
        kyc: {
          ...mockUser.kyc,
          status: STATUS.KYC.APPROVED,
          level: 1
        }
      };
      mockFirestoreHelper.getDocument.mockResolvedValue(approvedKYCUser);

      const safeUpdate = {
        bio: 'New bio',
        profilePicture: 'https://example.com/new-pic.jpg'
      };

      const result = await updateProfile(safeUpdate, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['bio', 'profilePicture']);
    });
  });

  describe('Data Validation', () => {
    it('should reject users under 18 for dateOfBirth updates', async () => {
      const underageUpdate = {
        dateOfBirth: new Date('2010-01-01')
      };

      await expect(
        updateProfile(underageUpdate, mockContext)
      ).rejects.toThrow('Users must be at least 18 years old');
    });

    it('should accept valid bio updates', async () => {
      const bioUpdate = {
        bio: 'This is my updated bio with valid content'
      };

      const result = await updateProfile(bioUpdate, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['bio']);
    });

    it('should reject bio that is too long', async () => {
      const longBioUpdate = {
        bio: 'x'.repeat(501) // Dépasse la limite de 500 caractères
      };

      await expect(
        updateProfile(longBioUpdate, mockContext)
      ).rejects.toThrow();
    });

    it('should validate phone number format', async () => {
      const invalidPhoneUpdate = {
        phoneNumber: 'invalid-phone'
      };

      await expect(
        updateProfile(invalidPhoneUpdate, mockContext)
      ).rejects.toThrow();
    });

    it('should accept valid phone number', async () => {
      const phoneUpdate = {
        phoneNumber: '+33987654321'
      };

      const result = await updateProfile(phoneUpdate, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['phoneNumber']);
    });
  });

  describe('Preferences Updates', () => {
    it('should merge notification preferences correctly', async () => {
      const preferencesUpdate = {
        preferences: {
          notifications: {
            email: false,
            frequency: 'weekly'
          }
        }
      };

      await updateProfile(preferencesUpdate, mockContext);

      expect(mockFirestoreHelper.runTransaction).toHaveBeenCalled();
      
      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preferences: expect.objectContaining({
            notifications: expect.objectContaining({
              email: false,
              push: true, // Preserved from original
              inApp: true, // Preserved from original
              frequency: 'weekly'
            })
          })
        })
      );
    });

    it('should merge privacy preferences correctly', async () => {
      const privacyUpdate = {
        preferences: {
          privacy: {
            profilePublic: true,
            showContributions: true
          }
        }
      };

      await updateProfile(privacyUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preferences: expect.objectContaining({
            privacy: expect.objectContaining({
              profilePublic: true,
              showContributions: true,
              allowContact: true // Preserved
            })
          })
        })
      );
    });

    it('should update interest categories', async () => {
      const interestsUpdate = {
        preferences: {
          interests: {
            categories: ['health', 'innovation'],
            causes: ['clean-water', 'renewable-energy']
          }
        }
      };

      const result = await updateProfile(interestsUpdate, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['preferences']);
    });
  });

  describe('Address Updates', () => {
    it('should merge address data correctly', async () => {
      const addressUpdate = {
        address: {
          street: '456 Avenue des Champs',
          postalCode: '75008'
          // city et country non fournis - doivent être préservés
        }
      };

      await updateProfile(addressUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          address: expect.objectContaining({
            street: '456 Avenue des Champs',
            city: 'Paris', // Preserved
            postalCode: '75008',
            country: 'FR' // Preserved
          })
        })
      );
    });

    it('should update coordinates correctly', async () => {
      const coordinatesUpdate = {
        address: {
          coordinates: {
            lat: 48.8738,
            lng: 2.2950
          }
        }
      };

      const result = await updateProfile(coordinatesUpdate, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['address']);
    });
  });

  describe('Display Name Updates', () => {
    it('should update displayName when firstName changes', async () => {
      const nameUpdate = {
        firstName: 'Pierre'
      };

      await updateProfile(nameUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          firstName: 'Pierre',
          displayName: 'Pierre Dupont'
        })
      );
    });

    it('should update displayName when lastName changes', async () => {
      const nameUpdate = {
        lastName: 'Martin'
      };

      await updateProfile(nameUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          lastName: 'Martin',
          displayName: 'Jean Martin'
        })
      );
    });

    it('should update displayName when both names change', async () => {
      const nameUpdate = {
        firstName: 'Pierre',
        lastName: 'Martin'
      };

      await updateProfile(nameUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          displayName: 'Pierre Martin'
        })
      );
    });
  });

  describe('Firebase Auth Synchronization', () => {
    it('should update Firebase Auth when displayName changes', async () => {
      const nameUpdate = {
        firstName: 'Pierre'
      };

      await updateProfile(nameUpdate, mockContext);

      expect(mockAuthHelper.updateUser).toHaveBeenCalledWith(
        'test-user-uid',
        {
          displayName: 'Pierre Dupont'
        }
      );
    });

    it('should update Firebase Auth when profilePicture changes', async () => {
      const pictureUpdate = {
        profilePicture: 'https://example.com/new-avatar.jpg'
      };

      await updateProfile(pictureUpdate, mockContext);

      expect(mockAuthHelper.updateUser).toHaveBeenCalledWith(
        'test-user-uid',
        {
          photoURL: 'https://example.com/new-avatar.jpg'
        }
      );
    });

    it('should handle Firebase Auth update failures gracefully', async () => {
      mockAuthHelper.updateUser.mockRejectedValue(new Error('Auth update failed'));

      const nameUpdate = {
        firstName: 'Pierre'
      };

      // La fonction devrait réussir même si l'Auth sync échoue
      const result = await updateProfile(nameUpdate, mockContext);
      expect(result.success).toBe(true);
    });

    it('should not call Firebase Auth for non-display changes', async () => {
      const bioUpdate = {
        bio: 'New bio content'
      };

      await updateProfile(bioUpdate, mockContext);

      expect(mockAuthHelper.updateUser).not.toHaveBeenCalled();
    });
  });

  describe('Version Control and Concurrency', () => {
    it('should handle version conflicts', async () => {
      // Mock d'un conflit de version
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ...mockUser, version: 2 }) // Version différente
          }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow('Profile was modified by another operation');
    });

    it('should increment version number correctly', async () => {
      await updateProfile(validUpdateData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
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

    it('should handle missing version gracefully', async () => {
      const userWithoutVersion = {
        ...mockUser
      };
      delete (userWithoutVersion as any).version;

      mockFirestoreHelper.getDocument.mockResolvedValue(userWithoutVersion);
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ...userWithoutVersion, version: undefined })
          }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      const result = await updateProfile(validUpdateData, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Context Metadata', () => {
    it('should capture IP address and user agent', async () => {
      await updateProfile(validUpdateData, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent',
          lastModifiedBy: 'test-user-uid'
        })
      );
    });

    it('should handle missing IP gracefully', async () => {
      const contextWithoutIP = {
        ...mockContext,
        rawRequest: {
          headers: {
            'user-agent': 'test-agent'
          }
        }
      };

      const result = await updateProfile(validUpdateData, contextWithoutIP as any);
      expect(result.success).toBe(true);
    });
  });

  describe('Empty and Minimal Updates', () => {
    it('should reject empty update objects', async () => {
      await expect(
        updateProfile({}, mockContext)
      ).rejects.toThrow();
    });

    it('should handle undefined values correctly', async () => {
      const updateWithUndefined = {
        bio: undefined,
        profilePicture: 'https://example.com/pic.jpg'
      };

      const result = await updateProfile(updateWithUndefined, mockContext);

      expect(result.success).toBe(true);
      expect(result.modifiedFields).toEqual(['profilePicture']);
    });

    it('should handle empty string bio', async () => {
      const emptyBioUpdate = {
        bio: ''
      };

      await updateProfile(emptyBioUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bio: undefined // Empty string converted to undefined
        })
      );
    });
  });

  describe('Return Values', () => {
    it('should return correct response structure', async () => {
      const result = await updateProfile(validUpdateData, mockContext);

      expect(result).toEqual({
        userId: 'test-user-uid',
        success: true,
        modifiedFields: ['bio', 'profilePicture', 'preferences'],
        version: 2
      });
    });

    it('should return correct modified fields list', async () => {
      const multiFieldUpdate = {
        firstName: 'Pierre',
        bio: 'New bio',
        phoneNumber: '+33987654321',
        preferences: {
          language: 'en'
        }
      };

      const result = await updateProfile(multiFieldUpdate, mockContext);

      expect(result.modifiedFields).toEqual(
        expect.arrayContaining(['firstName', 'bio', 'phoneNumber', 'preferences'])
      );
      expect(result.modifiedFields).toHaveLength(4);
    });
  });

  describe('Error Handling', () => {
    it('should handle Firestore errors', async () => {
      mockFirestoreHelper.getDocument.mockRejectedValue(new Error('Firestore error'));

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle transaction errors', async () => {
      mockFirestoreHelper.runTransaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow();
    });

    it('should handle user not found', async () => {
      mockFirestoreHelper.runTransaction.mockImplementation(async (callback) => {
        const mockTransaction = {
          get: jest.fn().mockResolvedValue({
            exists: false
          }),
          update: jest.fn(),
          set: jest.fn(),
          delete: jest.fn()
        };
        await callback(mockTransaction as any);
      });

      await expect(
        updateProfile(validUpdateData, mockContext)
      ).rejects.toThrow('User profile not found');
    });
  });

  describe('Complex Data Merging', () => {
    it('should perform deep merge for nested preferences', async () => {
      const deepPreferencesUpdate = {
        preferences: {
          notifications: {
            frequency: 'daily'
            // email, push, inApp should be preserved
          },
          interests: {
            causes: ['new-cause']
            // categories should be preserved
          }
        }
      };

      await updateProfile(deepPreferencesUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          preferences: expect.objectContaining({
            notifications: expect.objectContaining({
              email: true, // Preserved
              push: true, // Preserved
              inApp: true, // Preserved
              frequency: 'daily' // Updated
            }),
            interests: expect.objectContaining({
              categories: ['environment', 'education'], // Preserved
              causes: ['new-cause'] // Updated
            })
          })
        })
      );
    });
  });

  describe('Trimming and Data Cleanup', () => {
    it('should trim whitespace from string fields', async () => {
      const dataWithWhitespace = {
        firstName: '  Pierre  ',
        lastName: '  Martin  ',
        bio: '  This is my bio  '
      };

      await updateProfile(dataWithWhitespace, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          firstName: 'Pierre',
          lastName: 'Martin',
          bio: 'This is my bio',
          displayName: 'Pierre Martin'
        })
      );
    });
  });

  describe('Coordinate Validation', () => {
    it('should validate latitude bounds', async () => {
      const invalidLatUpdate = {
        address: {
          coordinates: {
            lat: 91, // Invalid latitude
            lng: 2.3522
          }
        }
      };

      await expect(
        updateProfile(invalidLatUpdate, mockContext)
      ).rejects.toThrow();
    });

    it('should validate longitude bounds', async () => {
      const invalidLngUpdate = {
        address: {
          coordinates: {
            lat: 48.8566,
            lng: 181 // Invalid longitude
          }
        }
      };

      await expect(
        updateProfile(invalidLngUpdate, mockContext)
      ).rejects.toThrow();
    });

    it('should accept valid coordinates', async () => {
      const validCoordinatesUpdate = {
        address: {
          coordinates: {
            lat: -90, // Valid minimum
            lng: 180 // Valid maximum
          }
        }
      };

      const result = await updateProfile(validCoordinatesUpdate, mockContext);
      expect(result.success).toBe(true);
    });
  });

  describe('Interest Categories Validation', () => {
    it('should validate interest categories', async () => {
      const validInterestsUpdate = {
        preferences: {
          interests: {
            categories: ['environment', 'education', 'health']
          }
        }
      };

      const result = await updateProfile(validInterestsUpdate, mockContext);
      expect(result.success).toBe(true);
    });

    it('should reject invalid interest categories', async () => {
      const invalidInterestsUpdate = {
        preferences: {
          interests: {
            categories: ['invalid-category']
          }
        }
      };

      await expect(
        updateProfile(invalidInterestsUpdate, mockContext)
      ).rejects.toThrow();
    });

    it('should enforce minimum and maximum categories', async () => {
      const tooManyCategories = {
        preferences: {
          interests: {
            categories: ['environment', 'education', 'health', 'community', 'innovation', 'extra']
          }
        }
      };

      await expect(
        updateProfile(tooManyCategories, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('Date Formatting', () => {
    it('should format dateOfBirth correctly', async () => {
      const dateUpdate = {
        dateOfBirth: new Date('1985-12-25T14:30:00.000Z')
      };

      await updateProfile(dateUpdate, mockContext);

      const transactionCallback = mockFirestoreHelper.runTransaction.mock.calls[0][0];
      const mockTransaction = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({ ...mockUser, version: 1 })
        }),
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
      };

      await transactionCallback(mockTransaction);

      expect(mockTransaction.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          dateOfBirth: '1985-12-25' // Format YYYY-MM-DD
        })
      );
    });
  });
});