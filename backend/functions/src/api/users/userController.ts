import { Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger';
import { firestoreHelper } from '../../utils/firestore';
import { accessControlSystem } from '../../security/accessControl';
import { dataEncryptionSystem } from '../../security/dataEncryption';
import { auditLogger } from '../../monitoring/auditLogger';
import { securityMiddleware } from '../../security/securityMiddleware';
import { performanceMonitor } from '../../monitoring/performanceMonitor';
import { validateSchema } from '../../utils/validation';

export interface User {
  id: string;
  email: string;
  profile: {
    firstName: string;
    lastName: string;
    displayName: string;
    bio?: string;
    location?: {
      city: string;
      country: string;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
    avatar?: string;
    website?: string;
    socialLinks?: {
      twitter?: string;
      linkedin?: string;
      github?: string;
    };
  };
  preferences: {
    notifications: {
      email: boolean;
      push: boolean;
      frequency: 'immediate' | 'daily' | 'weekly';
    };
    privacy: {
      profileVisibility: 'public' | 'private' | 'supporters_only';
      showDonations: boolean;
      showLocation: boolean;
    };
    language: string;
    timezone: string;
    currency: string;
  };
  roles: string[];
  permissions: string[];
  verification: {
    email: boolean;
    phone: boolean;
    identity: boolean;
    kyc: 'pending' | 'verified' | 'rejected' | 'not_required';
  };
  activity: {
    totalDonations: number;
    totalProjectsSupported: number;
    totalProjectsCreated: number;
    lastLogin: Date;
    joinDate: Date;
    loginCount: number;
  };
  security: {
    mfaEnabled: boolean;
    lastPasswordChange: Date;
    suspendedUntil?: Date;
    suspensionReason?: string;
    securityEvents: number;
  };
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastModifiedBy: string;
    version: number;
    flags: string[];
  };
}

export interface CreateUserRequest {
  email: string;
  password: string;
  profile: {
    firstName: string;
    lastName: string;
    displayName?: string;
  };
  preferences?: Partial<User['preferences']>;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
}

export interface UpdateUserRequest {
  profile?: Partial<User['profile']>;
  preferences?: Partial<User['preferences']>;
}

export interface UserSearchFilters {
  role?: string;
  verified?: boolean;
  location?: string;
  joinedAfter?: Date;
  joinedBefore?: Date;
  lastActiveAfter?: Date;
  limit?: number;
  offset?: number;
}

const userCreateSchema = {
  type: 'object',
  required: ['email', 'password', 'profile', 'acceptedTerms', 'acceptedPrivacy'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
    profile: {
      type: 'object',
      required: ['firstName', 'lastName'],
      properties: {
        firstName: { type: 'string', minLength: 1, maxLength: 50 },
        lastName: { type: 'string', minLength: 1, maxLength: 50 },
        displayName: { type: 'string', maxLength: 100 }
      }
    },
    acceptedTerms: { type: 'boolean', const: true },
    acceptedPrivacy: { type: 'boolean', const: true }
  }
};

const userUpdateSchema = {
  type: 'object',
  properties: {
    profile: {
      type: 'object',
      properties: {
        firstName: { type: 'string', minLength: 1, maxLength: 50 },
        lastName: { type: 'string', minLength: 1, maxLength: 50 },
        displayName: { type: 'string', maxLength: 100 },
        bio: { type: 'string', maxLength: 500 },
        location: {
          type: 'object',
          properties: {
            city: { type: 'string', maxLength: 100 },
            country: { type: 'string', maxLength: 100 }
          }
        },
        website: { type: 'string', format: 'uri' }
      }
    },
    preferences: {
      type: 'object',
      properties: {
        notifications: {
          type: 'object',
          properties: {
            email: { type: 'boolean' },
            push: { type: 'boolean' },
            frequency: { enum: ['immediate', 'daily', 'weekly'] }
          }
        },
        privacy: {
          type: 'object',
          properties: {
            profileVisibility: { enum: ['public', 'private', 'supporters_only'] },
            showDonations: { type: 'boolean' },
            showLocation: { type: 'boolean' }
          }
        },
        language: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' },
        timezone: { type: 'string' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' }
      }
    }
  }
};

export class UserController {
  private db = getFirestore();
  private auth = getAuth();

  async createUser(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_create', 'endpoint', {
      endpoint: '/api/users',
      method: 'POST',
      ip: req.ip
    });

    try {
      // Validate request
      const validation = validateSchema(req.body, userCreateSchema);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid request data',
          details: validation.errors
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Validation failed');
        return;
      }

      const userData: CreateUserRequest = req.body;

      // Check if user already exists
      try {
        await this.auth.getUserByEmail(userData.email);
        res.status(409).json({ error: 'User already exists' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User already exists');
        return;
      } catch (error) {
        // User doesn't exist, continue with creation
      }

      // Create Firebase Auth user
      const authUser = await this.auth.createUser({
        email: userData.email,
        password: userData.password,
        emailVerified: false
      });

      // Prepare user document
      const user: User = {
        id: authUser.uid,
        email: userData.email,
        profile: {
          firstName: userData.profile.firstName,
          lastName: userData.profile.lastName,
          displayName: userData.profile.displayName || `${userData.profile.firstName} ${userData.profile.lastName}`,
          bio: '',
          avatar: '',
          website: '',
          socialLinks: {}
        },
        preferences: {
          notifications: {
            email: true,
            push: true,
            frequency: 'immediate'
          },
          privacy: {
            profileVisibility: 'public',
            showDonations: true,
            showLocation: false
          },
          language: 'en-US',
          timezone: 'UTC',
          currency: 'USD',
          ...userData.preferences
        },
        roles: ['user'],
        permissions: [],
        verification: {
          email: false,
          phone: false,
          identity: false,
          kyc: 'not_required'
        },
        activity: {
          totalDonations: 0,
          totalProjectsSupported: 0,
          totalProjectsCreated: 0,
          lastLogin: new Date(),
          joinDate: new Date(),
          loginCount: 1
        },
        security: {
          mfaEnabled: false,
          lastPasswordChange: new Date(),
          securityEvents: 0
        },
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          lastModifiedBy: 'system',
          version: 1,
          flags: []
        }
      };

      // Encrypt sensitive data
      const encryptedUser = await this.encryptUserData(user);

      // Store user in Firestore
      await firestoreHelper.setDocument('users', user.id, encryptedUser);

      // Assign default role
      await accessControlSystem.assignRole(user.id, ['user'], 'system');

      // Log user creation
      await auditLogger.logUserAction(
        user.id,
        'create',
        'user',
        user.id,
        'success',
        { service: 'user-api', endpoint: '/api/users' }
      );

      // Send response (without sensitive data)
      const publicUser = this.sanitizeUserForResponse(user);
      res.status(201).json({
        message: 'User created successfully',
        user: publicUser
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('User created successfully', {
        userId: user.id,
        email: user.email,
        roles: user.roles
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to create user', error as Error, {
        email: req.body.email,
        ip: req.ip
      });

      res.status(500).json({
        error: 'Failed to create user',
        message: 'An internal error occurred'
      });
    }
  }

  async getUserById(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_get_by_id', 'endpoint', {
      endpoint: `/api/users/${req.params.id}`,
      method: 'GET',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.params.id;
      const requestingUserId = req.user?.uid;

      // Check if user can access this profile
      const canAccess = await this.checkProfileAccess(userId, requestingUserId);
      if (!canAccess) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Get user from database
      const encryptedUser = await firestoreHelper.getDocumentOptional('users', userId) as User;
      if (!encryptedUser) {
        res.status(404).json({ error: 'User not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      // Decrypt user data
      const user = await this.decryptUserData(encryptedUser);

      // Apply privacy settings
      const sanitizedUser = this.applyPrivacySettings(user, requestingUserId);

      // Log access
      await auditLogger.logUserAction(
        requestingUserId || 'anonymous',
        'read',
        'user',
        userId,
        'success',
        { service: 'user-api', endpoint: `/api/users/${userId}` }
      );

      res.json({ user: sanitizedUser });
      await performanceMonitor.finishTrace(traceId, 'success');

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to get user', error as Error, {
        userId: req.params.id,
        requestingUserId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to retrieve user',
        message: 'An internal error occurred'
      });
    }
  }

  async updateUser(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_update', 'endpoint', {
      endpoint: `/api/users/${req.params.id}`,
      method: 'PUT',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.params.id;
      const requestingUserId = req.user?.uid;

      // Validate request
      const validation = validateSchema(req.body, userUpdateSchema);
      if (!validation.valid) {
        res.status(400).json({
          error: 'Invalid request data',
          details: validation.errors
        });
        await performanceMonitor.finishTrace(traceId, 'error', 'Validation failed');
        return;
      }

      // Check permissions
      const canUpdate = await this.checkUpdatePermissions(userId, requestingUserId);
      if (!canUpdate) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Get current user
      const encryptedUser = await firestoreHelper.getDocumentOptional('users', userId) as User;
      if (!encryptedUser) {
        res.status(404).json({ error: 'User not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      const user = await this.decryptUserData(encryptedUser);
      const updateData: UpdateUserRequest = req.body;

      // Store changes for audit
      const changes = {
        before: { ...user },
        after: { ...user }
      };

      // Apply updates
      if (updateData.profile) {
        user.profile = { ...user.profile, ...updateData.profile };
        changes.after.profile = user.profile;
      }

      if (updateData.preferences) {
        user.preferences = { ...user.preferences, ...updateData.preferences };
        changes.after.preferences = user.preferences;
      }

      // Update metadata
      user.metadata.updatedAt = new Date();
      user.metadata.lastModifiedBy = requestingUserId || 'system';
      user.metadata.version += 1;

      // Encrypt and store
      const encryptedUpdatedUser = await this.encryptUserData(user);
      await firestoreHelper.setDocument('users', userId, encryptedUpdatedUser);

      // Log update
      await auditLogger.logUserAction(
        requestingUserId || 'system',
        'update',
        'user',
        userId,
        'success',
        { service: 'user-api', endpoint: `/api/users/${userId}` },
        { before: changes.before, after: changes.after, fields: Object.keys(updateData) }
      );

      // Send response
      const sanitizedUser = this.sanitizeUserForResponse(user);
      res.json({
        message: 'User updated successfully',
        user: sanitizedUser
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('User updated successfully', {
        userId,
        updatedBy: requestingUserId,
        fields: Object.keys(updateData)
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to update user', error as Error, {
        userId: req.params.id,
        requestingUserId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to update user',
        message: 'An internal error occurred'
      });
    }
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_delete', 'endpoint', {
      endpoint: `/api/users/${req.params.id}`,
      method: 'DELETE',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.params.id;
      const requestingUserId = req.user?.uid;

      // Check permissions (only admins or self can delete)
      const canDelete = await this.checkDeletePermissions(userId, requestingUserId);
      if (!canDelete) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Get user to verify existence
      const user = await firestoreHelper.getDocumentOptional('users', userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      // Soft delete (mark as deleted but keep data for compliance)
      const deletedUser = {
        ...user,
        metadata: {
          ...user.metadata,
          deletedAt: new Date(),
          deletedBy: requestingUserId,
          flags: [...(user.metadata.flags || []), 'deleted']
        }
      };

      // Update user document
      await firestoreHelper.setDocument('users', userId, deletedUser);

      // Disable Firebase Auth user
      await this.auth.updateUser(userId, { disabled: true });

      // Remove from access control
      await accessControlSystem.removeUser(userId);

      // Log deletion
      await auditLogger.logUserAction(
        requestingUserId || 'system',
        'delete',
        'user',
        userId,
        'success',
        { service: 'user-api', endpoint: `/api/users/${userId}` }
      );

      res.json({ message: 'User deleted successfully' });
      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('User deleted successfully', {
        userId,
        deletedBy: requestingUserId
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to delete user', error as Error, {
        userId: req.params.id,
        requestingUserId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to delete user',
        message: 'An internal error occurred'
      });
    }
  }

  async searchUsers(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_search', 'endpoint', {
      endpoint: '/api/users/search',
      method: 'GET',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const requestingUserId = req.user?.uid;

      // Check search permissions
      const canSearch = await this.checkSearchPermissions(requestingUserId);
      if (!canSearch) {
        res.status(403).json({ error: 'Access denied' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      const filters: UserSearchFilters = {
        role: req.query.role as string,
        verified: req.query.verified === 'true',
        location: req.query.location as string,
        joinedAfter: req.query.joinedAfter ? new Date(req.query.joinedAfter as string) : undefined,
        joinedBefore: req.query.joinedBefore ? new Date(req.query.joinedBefore as string) : undefined,
        lastActiveAfter: req.query.lastActiveAfter ? new Date(req.query.lastActiveAfter as string) : undefined,
        limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        offset: parseInt(req.query.offset as string) || 0
      };

      // Build query
      let query = this.db.collection('users') as any;

      // Apply filters
      if (filters.role) {
        query = query.where('roles', 'array-contains', filters.role);
      }
      
      if (filters.verified !== undefined) {
        query = query.where('verification.email', '==', filters.verified);
      }
      
      if (filters.location) {
        query = query.where('profile.location.country', '==', filters.location);
      }
      
      if (filters.joinedAfter) {
        query = query.where('activity.joinDate', '>=', filters.joinedAfter);
      }
      
      if (filters.joinedBefore) {
        query = query.where('activity.joinDate', '<=', filters.joinedBefore);
      }
      
      if (filters.lastActiveAfter) {
        query = query.where('activity.lastLogin', '>=', filters.lastActiveAfter);
      }

      // Exclude deleted users
      query = query.where('metadata.flags', 'not-in', [['deleted']]);

      // Apply pagination
      query = query.limit(filters.limit).offset(filters.offset);

      // Execute query
      const snapshot = await query.get();
      const users = await Promise.all(
        snapshot.docs.map(async (doc: any) => {
          const encryptedUser = doc.data() as User;
          const user = await this.decryptUserData(encryptedUser);
          return this.applyPrivacySettings(user, requestingUserId);
        })
      );

      // Get total count for pagination
      const countQuery = this.db.collection('users')
        .where('metadata.flags', 'not-in', [['deleted']]);
      const totalCount = (await countQuery.count().get()).data().count;

      // Log search
      await auditLogger.logUserAction(
        requestingUserId || 'anonymous',
        'read',
        'user',
        'search',
        'success',
        { service: 'user-api', endpoint: '/api/users/search' }
      );

      res.json({
        users,
        pagination: {
          total: totalCount,
          limit: filters.limit,
          offset: filters.offset,
          hasMore: (filters.offset + filters.limit) < totalCount
        }
      });

      await performanceMonitor.finishTrace(traceId, 'success');

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to search users', error as Error, {
        requestingUserId: req.user?.uid,
        filters: req.query
      });

      res.status(500).json({
        error: 'Failed to search users',
        message: 'An internal error occurred'
      });
    }
  }

  async getUserProfile(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_get_profile', 'endpoint', {
      endpoint: '/api/users/profile',
      method: 'GET',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.user?.uid;
      if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Not authenticated');
        return;
      }

      // Get user profile
      const encryptedUser = await firestoreHelper.getDocumentOptional('users', userId) as User;
      if (!encryptedUser) {
        res.status(404).json({ error: 'User profile not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      const user = await this.decryptUserData(encryptedUser);

      // Update last login
      user.activity.lastLogin = new Date();
      user.activity.loginCount += 1;

      const encryptedUpdatedUser = await this.encryptUserData(user);
      await firestoreHelper.setDocument('users', userId, encryptedUpdatedUser);

      // Log profile access
      await auditLogger.logUserAction(
        userId,
        'read',
        'user',
        userId,
        'success',
        { service: 'user-api', endpoint: '/api/users/profile' }
      );

      // Return full profile (user accessing their own data)
      const profile = this.sanitizeUserForResponse(user);
      res.json({ user: profile });

      await performanceMonitor.finishTrace(traceId, 'success');

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to get user profile', error as Error, {
        userId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to retrieve profile',
        message: 'An internal error occurred'
      });
    }
  }

  async updateUserRoles(req: Request, res: Response): Promise<void> {
    const traceId = await performanceMonitor.startTrace('user_update_roles', 'endpoint', {
      endpoint: `/api/users/${req.params.id}/roles`,
      method: 'PUT',
      userId: req.user?.uid,
      ip: req.ip
    });

    try {
      const userId = req.params.id;
      const requestingUserId = req.user?.uid;
      const { roles, permissions } = req.body;

      // Check admin permissions
      const hasPermission = await accessControlSystem.checkAccess({
        userId: requestingUserId!,
        userRoles: req.user?.roles || [],
        userPermissions: req.user?.permissions || [],
        resource: 'user_roles',
        action: 'update',
        requestData: { targetUserId: userId, roles, permissions },
        ip: req.ip,
        timestamp: new Date()
      });

      if (!hasPermission.allowed) {
        res.status(403).json({ error: 'Insufficient permissions' });
        await performanceMonitor.finishTrace(traceId, 'error', 'Access denied');
        return;
      }

      // Get user
      const encryptedUser = await firestoreHelper.getDocumentOptional('users', userId) as User;
      if (!encryptedUser) {
        res.status(404).json({ error: 'User not found' });
        await performanceMonitor.finishTrace(traceId, 'error', 'User not found');
        return;
      }

      const user = await this.decryptUserData(encryptedUser);
      const oldRoles = [...user.roles];

      // Update roles in user document
      user.roles = roles;
      user.permissions = permissions || [];
      user.metadata.updatedAt = new Date();
      user.metadata.lastModifiedBy = requestingUserId!;
      user.metadata.version += 1;

      // Update in access control system
      await accessControlSystem.assignRole(userId, roles, requestingUserId!);

      // Encrypt and store
      const encryptedUpdatedUser = await this.encryptUserData(user);
      await firestoreHelper.setDocument('users', userId, encryptedUpdatedUser);

      // Log role change
      await auditLogger.logUserAction(
        requestingUserId!,
        'admin',
        'user',
        userId,
        'success',
        { service: 'user-api', endpoint: `/api/users/${userId}/roles` },
        { before: { roles: oldRoles }, after: { roles }, fields: ['roles'] }
      );

      res.json({ 
        message: 'User roles updated successfully',
        user: this.sanitizeUserForResponse(user)
      });

      await performanceMonitor.finishTrace(traceId, 'success');

      logger.info('User roles updated', {
        userId,
        oldRoles,
        newRoles: roles,
        updatedBy: requestingUserId
      });

    } catch (error) {
      await performanceMonitor.finishTrace(traceId, 'error', (error as Error).message);
      
      logger.error('Failed to update user roles', error as Error, {
        userId: req.params.id,
        requestingUserId: req.user?.uid
      });

      res.status(500).json({
        error: 'Failed to update user roles',
        message: 'An internal error occurred'
      });
    }
  }

  // Helper methods
  private async encryptUserData(user: User): Promise<User> {
    const sensitiveFields = ['profile.firstName', 'profile.lastName', 'email'];
    return await dataEncryptionSystem.encryptPII(user, sensitiveFields.map(field => ({
      field,
      type: 'name'
    })));
  }

  private async decryptUserData(encryptedUser: User): Promise<User> {
    const sensitiveFields = ['profile.firstName', 'profile.lastName', 'email'];
    return await dataEncryptionSystem.decryptPII(encryptedUser, sensitiveFields.map(field => ({
      field,
      type: 'name'
    })));
  }

  private sanitizeUserForResponse(user: User): Partial<User> {
    const { security, metadata, ...publicUser } = user;
    return {
      ...publicUser,
      metadata: {
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        version: metadata.version
      }
    };
  }

  private applyPrivacySettings(user: User, requestingUserId?: string): Partial<User> {
    const isOwner = user.id === requestingUserId;
    const isPublic = user.preferences.privacy.profileVisibility === 'public';
    const isPrivate = user.preferences.privacy.profileVisibility === 'private';

    if (isOwner) {
      return this.sanitizeUserForResponse(user);
    }

    if (isPrivate && !isOwner) {
      return {
        id: user.id,
        profile: {
          displayName: user.profile.displayName,
          avatar: user.profile.avatar
        },
        verification: {
          email: user.verification.email,
          identity: user.verification.identity
        }
      };
    }

    const publicProfile = this.sanitizeUserForResponse(user);

    if (!user.preferences.privacy.showLocation) {
      delete publicProfile.profile?.location;
    }

    if (!user.preferences.privacy.showDonations) {
      if (publicProfile.activity) {
        delete publicProfile.activity.totalDonations;
        delete publicProfile.activity.totalProjectsSupported;
      }
    }

    return publicProfile;
  }

  private async checkProfileAccess(userId: string, requestingUserId?: string): Promise<boolean> {
    if (!requestingUserId) {
      // Check if profile is public
      const user = await firestoreHelper.getDocumentOptional('users', userId) as User;
      return user?.preferences?.privacy?.profileVisibility === 'public';
    }

    if (userId === requestingUserId) {
      return true; // User can always access their own profile
    }

    // Check if requesting user has admin permissions
    const hasAccess = await accessControlSystem.checkAccess({
      userId: requestingUserId,
      userRoles: [], // Would be populated from session
      userPermissions: [],
      resource: 'user_profiles',
      action: 'read',
      requestData: { targetUserId: userId },
      ip: '127.0.0.1',
      timestamp: new Date()
    });

    return hasAccess.allowed;
  }

  private async checkUpdatePermissions(userId: string, requestingUserId?: string): Promise<boolean> {
    if (!requestingUserId) return false;
    
    if (userId === requestingUserId) {
      return true; // User can update their own profile
    }

    // Check admin permissions
    const hasAccess = await accessControlSystem.checkAccess({
      userId: requestingUserId,
      userRoles: [], // Would be populated from session
      userPermissions: [],
      resource: 'user_profiles',
      action: 'update',
      requestData: { targetUserId: userId },
      ip: '127.0.0.1',
      timestamp: new Date()
    });

    return hasAccess.allowed;
  }

  private async checkDeletePermissions(userId: string, requestingUserId?: string): Promise<boolean> {
    if (!requestingUserId) return false;
    
    if (userId === requestingUserId) {
      return true; // User can delete their own account
    }

    // Check admin permissions
    const hasAccess = await accessControlSystem.checkAccess({
      userId: requestingUserId,
      userRoles: [], // Would be populated from session
      userPermissions: [],
      resource: 'user_accounts',
      action: 'delete',
      requestData: { targetUserId: userId },
      ip: '127.0.0.1',
      timestamp: new Date()
    });

    return hasAccess.allowed;
  }

  private async checkSearchPermissions(requestingUserId?: string): Promise<boolean> {
    if (!requestingUserId) return true; // Allow anonymous search of public profiles

    const hasAccess = await accessControlSystem.checkAccess({
      userId: requestingUserId,
      userRoles: [], // Would be populated from session
      userPermissions: [],
      resource: 'user_search',
      action: 'read',
      requestData: {},
      ip: '127.0.0.1',
      timestamp: new Date()
    });

    return hasAccess.allowed;
  }
}

export const userController = new UserController();