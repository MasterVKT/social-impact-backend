/**
 * User Repository Implementation
 * Social Finance Impact Platform
 * 
 * Specialized repository for user management with authentication,
 * KYC verification, and profile management capabilities
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { BaseRepository, QueryOptions, PaginationResult } from '../repository';
import { UserProfile } from '../schema';
import { dataEncryption } from '../../security/dataEncryption';
import { logger } from '../../utils/logger';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { metricsCollector } from '../../monitoring/metricsCollector';
import { auditLogger } from '../../monitoring/auditLogger';
import { 
  NotFoundError, 
  ConflictError, 
  ValidationError,
  BusinessRuleViolationError 
} from '../../utils/errors';

// ============================================================================
// USER-SPECIFIC INTERFACES
// ============================================================================

export interface UserSearchFilters {
  email?: string;
  status?: UserProfile['status'];
  roles?: UserProfile['roles'];
  verificationStatus?: UserProfile['verification']['status'];
  riskLevel?: UserProfile['verification']['riskAssessment']['level'];
  lastActiveAfter?: Date;
  lastActiveBefore?: Date;
  joinedAfter?: Date;
  joinedBefore?: Date;
  country?: string;
  language?: string;
}

export interface UserEngagementMetrics {
  totalUsers: number;
  activeUsers: number;
  newUsersThisMonth: number;
  verifiedUsers: number;
  averageEngagementScore: number;
  topCountries: Array<{ country: string; count: number }>;
  retentionRate: number;
}

export interface UserSecurityEvent {
  type: 'login' | 'password_change' | 'failed_login' | 'account_locked' | 'suspicious_activity';
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  location?: {
    country: string;
    city: string;
  };
  riskScore: number;
}

// ============================================================================
// USER REPOSITORY CLASS
// ============================================================================

export class UserRepository extends BaseRepository<UserProfile> {
  constructor() {
    super('users');
  }

  // ============================================================================
  // USER CREATION AND AUTHENTICATION
  // ============================================================================

  async createUser(userData: {
    firebaseUid: string;
    email: string;
    profile: {
      firstName: string;
      lastName: string;
      displayName?: string;
    };
    acceptedTerms: boolean;
    acceptedPrivacy: boolean;
    signupSource?: string;
    referralCode?: string;
  }): Promise<UserProfile> {
    const traceId = await performanceMonitor.startTrace('user_create', 'repository', {
      operation: 'createUser'
    });

    try {
      // Check if user already exists
      const existingUser = await this.findByFirebaseUid(userData.firebaseUid);
      if (existingUser) {
        throw new ConflictError('User already exists with this Firebase UID');
      }

      const existingEmail = await this.findByEmail(userData.email);
      if (existingEmail) {
        throw new ConflictError('User already exists with this email address');
      }

      // Validate terms acceptance
      if (!userData.acceptedTerms || !userData.acceptedPrivacy) {
        throw new ValidationError('Terms and privacy policy must be accepted');
      }

      // Encrypt sensitive data
      const encryptedEmail = await dataEncryption.encrypt(userData.email);
      const encryptedFirstName = await dataEncryption.encrypt(userData.profile.firstName);
      const encryptedLastName = await dataEncryption.encrypt(userData.profile.lastName);

      const newUser: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt' | 'version'> = {
        firebaseUid: userData.firebaseUid,
        email: encryptedEmail,
        emailVerified: false,

        profile: {
          firstName: encryptedFirstName,
          lastName: encryptedLastName,
          displayName: userData.profile.displayName || 
                      `${userData.profile.firstName} ${userData.profile.lastName}`,
        },

        preferences: {
          notifications: {
            email: true,
            push: true,
            sms: false,
            frequency: 'immediate',
            types: {
              projectUpdates: true,
              donationReceipts: true,
              systemAnnouncements: true,
              marketingEmails: false,
              auditReports: false
            }
          },
          privacy: {
            profileVisibility: 'public',
            showDonations: true,
            showLocation: false,
            showContactInfo: false,
            allowDirectMessages: true
          },
          language: 'en',
          timezone: 'UTC',
          currency: 'USD',
          theme: 'auto'
        },

        security: {
          loginAttempts: 0,
          twoFactorEnabled: false
        },

        roles: ['user'],
        permissions: [],

        verification: {
          status: 'pending',
          level: 'basic'
        },

        engagement: {
          totalDonations: 0,
          totalDonationAmount: 0,
          totalProjectsCreated: 0,
          totalProjectsSupported: 0,
          averageRating: 0,
          totalReviews: 0,
          lastActiveAt: new Date(),
          signupSource: userData.signupSource,
          referralCode: userData.referralCode
        },

        financial: {
          paymentMethods: [],
          limits: {
            dailyLimit: 10000, // $100 in cents
            monthlyLimit: 50000, // $500 in cents
            yearlyLimit: 600000, // $6000 in cents
            currentDailySpent: 0,
            currentMonthlySpent: 0,
            currentYearlySpent: 0
          }
        },

        compliance: {
          termsAcceptedAt: new Date(),
          termsVersion: '1.0',
          privacyAcceptedAt: new Date(),
          privacyVersion: '1.0',
          marketingConsent: false
        },

        status: 'pending_verification',
        createdBy: userData.firebaseUid,
        updatedBy: userData.firebaseUid
      };

      const user = await this.create(newUser);

      // Log user creation
      await auditLogger.logUserAction(
        userData.firebaseUid,
        'create',
        'user',
        user.id,
        'success',
        {
          service: 'user-repository',
          signupSource: userData.signupSource,
          referralCode: userData.referralCode
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('users.created', 1, {
        signupSource: userData.signupSource || 'direct',
        hasReferral: !!userData.referralCode
      });

      await performanceMonitor.endTrace(traceId, 'success', { userId: user.id });

      logger.info('User created successfully', {
        userId: user.id,
        firebaseUid: userData.firebaseUid,
        signupSource: userData.signupSource
      });

      return user;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async findByFirebaseUid(firebaseUid: string): Promise<UserProfile | null> {
    const users = await this.find({
      where: [{ field: 'firebaseUid', operator: '==', value: firebaseUid }],
      limit: 1
    });

    return users.length > 0 ? users[0] : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const encryptedEmail = await dataEncryption.encrypt(email);
    
    const users = await this.find({
      where: [{ field: 'email', operator: '==', value: encryptedEmail }],
      limit: 1
    });

    return users.length > 0 ? users[0] : null;
  }

  // ============================================================================
  // PROFILE MANAGEMENT
  // ============================================================================

  async updateProfile(
    userId: string, 
    updates: Partial<UserProfile['profile']>,
    updatedBy: string
  ): Promise<UserProfile> {
    const traceId = await performanceMonitor.startTrace('user_update_profile', 'repository', {
      operation: 'updateProfile',
      userId
    });

    try {
      const user = await this.findByIdOrThrow(userId);

      // Encrypt sensitive fields if they're being updated
      const encryptedUpdates: any = { ...updates };
      
      if (updates.firstName) {
        encryptedUpdates.firstName = await dataEncryption.encrypt(updates.firstName);
      }
      
      if (updates.lastName) {
        encryptedUpdates.lastName = await dataEncryption.encrypt(updates.lastName);
      }

      if (updates.phoneNumber) {
        encryptedUpdates.phoneNumber = await dataEncryption.encrypt(updates.phoneNumber);
      }

      if (updates.dateOfBirth) {
        encryptedUpdates.dateOfBirth = await dataEncryption.encrypt(updates.dateOfBirth.toISOString());
      }

      const updatedUser = await this.update(userId, {
        profile: {
          ...user.profile,
          ...encryptedUpdates
        },
        updatedBy
      });

      // Log profile update
      await auditLogger.logUserAction(
        updatedBy,
        'update',
        'user_profile',
        userId,
        'success',
        {
          service: 'user-repository',
          updatedFields: Object.keys(updates)
        }
      );

      await performanceMonitor.endTrace(traceId, 'success', { userId });

      return updatedUser;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  async updatePreferences(
    userId: string,
    preferences: Partial<UserProfile['preferences']>,
    updatedBy: string
  ): Promise<UserProfile> {
    const user = await this.findByIdOrThrow(userId);

    const updatedUser = await this.update(userId, {
      preferences: {
        ...user.preferences,
        ...preferences
      },
      updatedBy
    });

    // Log preferences update
    await auditLogger.logUserAction(
      updatedBy,
      'update',
      'user_preferences',
      userId,
      'success',
      {
        service: 'user-repository',
        updatedPreferences: Object.keys(preferences)
      }
    );

    return updatedUser;
  }

  // ============================================================================
  // ROLE AND PERMISSION MANAGEMENT
  // ============================================================================

  async updateRoles(
    userId: string,
    roles: UserProfile['roles'],
    permissions: string[],
    updatedBy: string
  ): Promise<UserProfile> {
    const traceId = await performanceMonitor.startTrace('user_update_roles', 'repository', {
      operation: 'updateRoles',
      userId
    });

    try {
      const user = await this.findByIdOrThrow(userId);

      // Validate role changes
      const validRoles = ['user', 'creator', 'moderator', 'auditor', 'support', 'admin'];
      const invalidRoles = roles.filter(role => !validRoles.includes(role));
      
      if (invalidRoles.length > 0) {
        throw new ValidationError(`Invalid roles: ${invalidRoles.join(', ')}`);
      }

      // Ensure user role is always included
      if (!roles.includes('user')) {
        roles.unshift('user');
      }

      const updatedUser = await this.update(userId, {
        roles,
        permissions,
        updatedBy
      });

      // Log role update
      await auditLogger.logUserAction(
        updatedBy,
        'update',
        'user_roles',
        userId,
        'success',
        {
          service: 'user-repository',
          previousRoles: user.roles,
          newRoles: roles,
          permissions
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('users.role_changes', 1, {
        newRoles: roles.join(','),
        updatedBy
      });

      await performanceMonitor.endTrace(traceId, 'success', { userId });

      return updatedUser;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // VERIFICATION AND KYC
  // ============================================================================

  async updateVerificationStatus(
    userId: string,
    status: UserProfile['verification']['status'],
    level?: UserProfile['verification']['level'],
    riskAssessment?: UserProfile['verification']['riskAssessment'],
    updatedBy: string
  ): Promise<UserProfile> {
    const traceId = await performanceMonitor.startTrace('user_update_verification', 'repository', {
      operation: 'updateVerificationStatus',
      userId,
      status
    });

    try {
      const user = await this.findByIdOrThrow(userId);

      const verificationUpdates: Partial<UserProfile['verification']> = {
        status,
        ...(level && { level }),
        ...(riskAssessment && { riskAssessment }),
        ...(status === 'approved' && { verifiedAt: new Date() })
      };

      const updatedUser = await this.update(userId, {
        verification: {
          ...user.verification,
          ...verificationUpdates
        },
        // Update account status based on verification
        status: status === 'approved' ? 'active' : 
                status === 'rejected' ? 'suspended' : 
                user.status,
        updatedBy
      });

      // Log verification update
      await auditLogger.logUserAction(
        updatedBy,
        'update',
        'user_verification',
        userId,
        'success',
        {
          service: 'user-repository',
          previousStatus: user.verification.status,
          newStatus: status,
          level,
          riskLevel: riskAssessment?.level
        }
      );

      // Record metrics
      await metricsCollector.recordCounter('users.verification_status_changes', 1, {
        status,
        level: level || user.verification.level,
        riskLevel: riskAssessment?.level || 'unknown'
      });

      await performanceMonitor.endTrace(traceId, 'success', { userId, status });

      return updatedUser;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // SECURITY MANAGEMENT
  // ============================================================================

  async recordLoginAttempt(
    userId: string,
    success: boolean,
    ipAddress: string,
    userAgent: string,
    location?: { country: string; city: string }
  ): Promise<void> {
    const user = await this.findByIdOrThrow(userId);

    if (success) {
      // Reset login attempts on successful login
      await this.update(userId, {
        security: {
          ...user.security,
          lastLoginAt: new Date(),
          lastLoginIP: ipAddress,
          loginAttempts: 0,
          lockedUntil: undefined
        },
        engagement: {
          ...user.engagement,
          lastActiveAt: new Date()
        },
        updatedBy: userId
      });

      // Log successful login
      await auditLogger.logUserAction(
        userId,
        'authentication',
        'login',
        userId,
        'success',
        {
          service: 'user-repository',
          ipAddress,
          userAgent,
          location
        }
      );

    } else {
      // Increment failed login attempts
      const newAttempts = user.security.loginAttempts + 1;
      const isLocked = newAttempts >= 5;
      
      await this.update(userId, {
        security: {
          ...user.security,
          loginAttempts: newAttempts,
          ...(isLocked && { 
            lockedUntil: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
          })
        },
        updatedBy: 'system'
      });

      // Log failed login
      await auditLogger.logUserAction(
        userId,
        'authentication',
        'login_failed',
        userId,
        'failure',
        {
          service: 'user-repository',
          ipAddress,
          userAgent,
          location,
          attempts: newAttempts,
          accountLocked: isLocked
        }
      );
    }
  }

  async lockAccount(userId: string, reason: string, lockedBy: string): Promise<void> {
    await this.update(userId, {
      status: 'suspended',
      suspensionReason: reason,
      updatedBy: lockedBy
    });

    await auditLogger.logUserAction(
      lockedBy,
      'security',
      'account_locked',
      userId,
      'success',
      {
        service: 'user-repository',
        reason
      }
    );
  }

  async unlockAccount(userId: string, unlockedBy: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);

    await this.update(userId, {
      status: 'active',
      suspensionReason: undefined,
      suspensionExpiresAt: undefined,
      security: {
        ...user.security,
        loginAttempts: 0,
        lockedUntil: undefined
      },
      updatedBy: unlockedBy
    });

    await auditLogger.logUserAction(
      unlockedBy,
      'security',
      'account_unlocked',
      userId,
      'success',
      {
        service: 'user-repository'
      }
    );
  }

  // ============================================================================
  // ENGAGEMENT TRACKING
  // ============================================================================

  async updateEngagementMetrics(
    userId: string,
    metrics: Partial<UserProfile['engagement']>
  ): Promise<UserProfile> {
    const user = await this.findByIdOrThrow(userId);

    return await this.update(userId, {
      engagement: {
        ...user.engagement,
        ...metrics,
        lastActiveAt: new Date()
      },
      updatedBy: 'system'
    });
  }

  async incrementDonationStats(
    userId: string,
    amount: number,
    projectId: string
  ): Promise<void> {
    const user = await this.findByIdOrThrow(userId);

    const isFirstDonationToProject = !user.engagement.totalProjectsSupported ||
      user.engagement.totalProjectsSupported === 0;

    await this.update(userId, {
      engagement: {
        ...user.engagement,
        totalDonations: user.engagement.totalDonations + 1,
        totalDonationAmount: user.engagement.totalDonationAmount + amount,
        totalProjectsSupported: isFirstDonationToProject 
          ? user.engagement.totalProjectsSupported + 1 
          : user.engagement.totalProjectsSupported,
        lastActiveAt: new Date()
      },
      updatedBy: 'system'
    });
  }

  // ============================================================================
  // SEARCH AND FILTERING
  // ============================================================================

  async searchUsers(filters: UserSearchFilters, options?: QueryOptions): Promise<PaginationResult<UserProfile>> {
    const whereConditions: QueryOptions['where'] = [];

    // Add filter conditions
    if (filters.email) {
      const encryptedEmail = await dataEncryption.encrypt(filters.email);
      whereConditions.push({ field: 'email', operator: '==', value: encryptedEmail });
    }

    if (filters.status) {
      whereConditions.push({ field: 'status', operator: '==', value: filters.status });
    }

    if (filters.verificationStatus) {
      whereConditions.push({ field: 'verification.status', operator: '==', value: filters.verificationStatus });
    }

    if (filters.riskLevel) {
      whereConditions.push({ field: 'verification.riskAssessment.level', operator: '==', value: filters.riskLevel });
    }

    if (filters.lastActiveAfter) {
      whereConditions.push({ field: 'engagement.lastActiveAt', operator: '>=', value: filters.lastActiveAfter });
    }

    if (filters.lastActiveBefore) {
      whereConditions.push({ field: 'engagement.lastActiveAt', operator: '<=', value: filters.lastActiveBefore });
    }

    if (filters.joinedAfter) {
      whereConditions.push({ field: 'createdAt', operator: '>=', value: filters.joinedAfter });
    }

    if (filters.joinedBefore) {
      whereConditions.push({ field: 'createdAt', operator: '<=', value: filters.joinedBefore });
    }

    if (filters.country) {
      whereConditions.push({ field: 'profile.location.country', operator: '==', value: filters.country });
    }

    if (filters.language) {
      whereConditions.push({ field: 'preferences.language', operator: '==', value: filters.language });
    }

    // Handle role filtering (array-contains)
    if (filters.roles && filters.roles.length > 0) {
      // For multiple roles, we need to filter client-side
      if (filters.roles.length === 1) {
        whereConditions.push({ field: 'roles', operator: 'array-contains', value: filters.roles[0] });
      }
    }

    const queryOptions: QueryOptions = {
      ...options,
      where: whereConditions
    };

    return await this.paginate(queryOptions);
  }

  async getUsersByRole(role: string): Promise<UserProfile[]> {
    return await this.find({
      where: [{ field: 'roles', operator: 'array-contains', value: role }]
    });
  }

  async getUsersRequiringVerification(): Promise<UserProfile[]> {
    return await this.find({
      where: [
        { field: 'verification.status', operator: '==', value: 'pending' },
        { field: 'status', operator: '==', value: 'pending_verification' }
      ]
    });
  }

  // ============================================================================
  // ANALYTICS AND REPORTING
  // ============================================================================

  async getEngagementMetrics(): Promise<UserEngagementMetrics> {
    const traceId = await performanceMonitor.startTrace('user_engagement_metrics', 'repository', {
      operation: 'getEngagementMetrics'
    });

    try {
      const totalUsers = await this.count();
      
      const activeUsers = await this.count({
        where: [
          { field: 'engagement.lastActiveAt', operator: '>=', value: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        ]
      });

      const thisMonth = new Date();
      thisMonth.setDate(1);
      thisMonth.setHours(0, 0, 0, 0);

      const newUsersThisMonth = await this.count({
        where: [
          { field: 'createdAt', operator: '>=', value: thisMonth }
        ]
      });

      const verifiedUsers = await this.count({
        where: [
          { field: 'verification.status', operator: '==', value: 'approved' }
        ]
      });

      // This would require aggregation queries or batch processing
      // For now, returning mock data
      const metrics: UserEngagementMetrics = {
        totalUsers,
        activeUsers,
        newUsersThisMonth,
        verifiedUsers,
        averageEngagementScore: 0.75, // Would be calculated from actual data
        topCountries: [], // Would be aggregated from user locations
        retentionRate: 0.85 // Would be calculated from user activity
      };

      await performanceMonitor.endTrace(traceId, 'success');

      return metrics;

    } catch (error) {
      await performanceMonitor.endTrace(traceId, 'error', {
        error: (error as Error).message
      });

      throw error;
    }
  }

  // ============================================================================
  // GDPR AND COMPLIANCE
  // ============================================================================

  async requestDataExport(userId: string): Promise<any> {
    const user = await this.findByIdOrThrow(userId);

    // Decrypt sensitive data for export
    const exportData = await this.decryptUserData(user);

    // Log data export request
    await auditLogger.logUserAction(
      userId,
      'compliance',
      'data_export',
      userId,
      'success',
      {
        service: 'user-repository',
        dataTypes: ['profile', 'preferences', 'engagement', 'financial']
      }
    );

    return exportData;
  }

  async requestDataDeletion(userId: string, reason: string): Promise<void> {
    const user = await this.findByIdOrThrow(userId);

    // Soft delete with GDPR compliance
    await this.delete(userId, { soft: true });

    // Update compliance record
    await this.update(userId, {
      compliance: {
        ...user.compliance,
        gdprDataRequest: {
          type: 'erasure',
          requestedAt: new Date(),
          status: 'processing'
        }
      },
      updatedBy: userId
    });

    await auditLogger.logUserAction(
      userId,
      'compliance',
      'data_deletion_request',
      userId,
      'success',
      {
        service: 'user-repository',
        reason
      }
    );
  }

  private async decryptUserData(user: UserProfile): Promise<any> {
    // Decrypt sensitive fields for data export
    const decryptedData = { ...user };

    try {
      decryptedData.email = await dataEncryption.decrypt(user.email);
      
      if (user.profile.firstName) {
        decryptedData.profile.firstName = await dataEncryption.decrypt(user.profile.firstName);
      }
      
      if (user.profile.lastName) {
        decryptedData.profile.lastName = await dataEncryption.decrypt(user.profile.lastName);
      }

      if (user.profile.phoneNumber) {
        decryptedData.profile.phoneNumber = await dataEncryption.decrypt(user.profile.phoneNumber);
      }

      if (user.profile.dateOfBirth) {
        decryptedData.profile.dateOfBirth = await dataEncryption.decrypt(user.profile.dateOfBirth as string);
      }

    } catch (error) {
      logger.error('Failed to decrypt user data for export', error as Error, { userId: user.id });
    }

    return decryptedData;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const userRepository = new UserRepository();