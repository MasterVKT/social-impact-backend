import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import { firestoreHelper } from '../utils/firestore';

export type Role = 'admin' | 'moderator' | 'auditor' | 'creator' | 'contributor' | 'user';

export type Permission = 
  // User management
  | 'users:read' | 'users:write' | 'users:delete' | 'users:admin'
  // Project management  
  | 'projects:read' | 'projects:write' | 'projects:delete' | 'projects:moderate' | 'projects:publish'
  // Payment management
  | 'payments:read' | 'payments:write' | 'payments:process' | 'payments:refund'
  // Audit management
  | 'audits:read' | 'audits:write' | 'audits:assign' | 'audits:approve'
  // System administration
  | 'system:read' | 'system:write' | 'system:admin' | 'system:monitor'
  // Content management
  | 'content:read' | 'content:write' | 'content:moderate' | 'content:publish'
  // Analytics and reporting
  | 'analytics:read' | 'analytics:export' | 'reports:generate'
  // Security management
  | 'security:read' | 'security:write' | 'security:admin';

export interface UserRole {
  userId: string;
  roles: Role[];
  permissions: Permission[];
  customPermissions?: Permission[];
  restrictions?: {
    ipWhitelist?: string[];
    timeRestrictions?: {
      allowedHours: [number, number]; // [start, end] in 24h format
      allowedDays: number[]; // 0-6, Sunday to Saturday
      timezone: string;
    };
    resourceLimits?: {
      maxProjectsPerDay?: number;
      maxContributionsPerDay?: number;
      maxAPICallsPerHour?: number;
    };
  };
  metadata: {
    assignedAt: Date;
    assignedBy: string;
    lastUpdated: Date;
    expiresAt?: Date;
    reason?: string;
  };
}

export interface AccessContext {
  userId: string;
  userRoles: Role[];
  userPermissions: Permission[];
  resource: string;
  action: string;
  resourceData?: any;
  requestData?: any;
  ip?: string;
  timestamp: Date;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  requiredPermissions: Permission[];
  missingPermissions: Permission[];
  appliedRestrictions: string[];
  riskScore: number;
}

export class AccessControlSystem {
  private db = getFirestore();
  private auth = getAuth();
  private rolePermissions: Map<Role, Permission[]> = new Map();
  private resourcePermissions: Map<string, Permission[]> = new Map();
  private initialized = false;

  constructor() {
    // Don't initialize here - use lazy initialization
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      this.initializeRolePermissions();
      this.initializeResourcePermissions();
      this.initialized = true;
    }
  }

  private initializeRolePermissions(): void {
    // Admin - Full system access
    this.rolePermissions.set('admin', [
      'users:read', 'users:write', 'users:delete', 'users:admin',
      'projects:read', 'projects:write', 'projects:delete', 'projects:moderate', 'projects:publish',
      'payments:read', 'payments:write', 'payments:process', 'payments:refund',
      'audits:read', 'audits:write', 'audits:assign', 'audits:approve',
      'system:read', 'system:write', 'system:admin', 'system:monitor',
      'content:read', 'content:write', 'content:moderate', 'content:publish',
      'analytics:read', 'analytics:export', 'reports:generate',
      'security:read', 'security:write', 'security:admin'
    ]);

    // Moderator - Content and project moderation
    this.rolePermissions.set('moderator', [
      'users:read',
      'projects:read', 'projects:moderate', 'projects:publish',
      'content:read', 'content:moderate', 'content:publish',
      'analytics:read', 'reports:generate',
      'security:read'
    ]);

    // Auditor - Audit management and project review
    this.rolePermissions.set('auditor', [
      'users:read',
      'projects:read',
      'audits:read', 'audits:write',
      'analytics:read',
      'security:read'
    ]);

    // Creator - Project creation and management
    this.rolePermissions.set('creator', [
      'users:read',
      'projects:read', 'projects:write',
      'content:read', 'content:write',
      'analytics:read'
    ]);

    // Contributor - Project contribution and interaction
    this.rolePermissions.set('contributor', [
      'users:read',
      'projects:read',
      'content:read'
    ]);

    // User - Basic read access
    this.rolePermissions.set('user', [
      'users:read',
      'projects:read',
      'content:read'
    ]);
  }

  private initializeResourcePermissions(): void {
    // User management endpoints
    this.resourcePermissions.set('/api/users/create', ['users:admin']);
    this.resourcePermissions.set('/api/users/update', ['users:write']);
    this.resourcePermissions.set('/api/users/delete', ['users:delete']);
    this.resourcePermissions.set('/api/users/list', ['users:read']);
    this.resourcePermissions.set('/api/users/profile', ['users:read']);

    // Project management endpoints
    this.resourcePermissions.set('/api/projects/create', ['projects:write']);
    this.resourcePermissions.set('/api/projects/update', ['projects:write']);
    this.resourcePermissions.set('/api/projects/delete', ['projects:delete']);
    this.resourcePermissions.set('/api/projects/publish', ['projects:publish']);
    this.resourcePermissions.set('/api/projects/moderate', ['projects:moderate']);
    this.resourcePermissions.set('/api/projects/list', ['projects:read']);
    this.resourcePermissions.set('/api/projects/details', ['projects:read']);

    // Payment management endpoints
    this.resourcePermissions.set('/api/payments/create', ['payments:write']);
    this.resourcePermissions.set('/api/payments/process', ['payments:process']);
    this.resourcePermissions.set('/api/payments/refund', ['payments:refund']);
    this.resourcePermissions.set('/api/payments/history', ['payments:read']);

    // Audit management endpoints
    this.resourcePermissions.set('/api/audits/assign', ['audits:assign']);
    this.resourcePermissions.set('/api/audits/submit', ['audits:write']);
    this.resourcePermissions.set('/api/audits/approve', ['audits:approve']);
    this.resourcePermissions.set('/api/audits/list', ['audits:read']);

    // System administration endpoints
    this.resourcePermissions.set('/api/admin/users', ['system:admin']);
    this.resourcePermissions.set('/api/admin/system', ['system:admin']);
    this.resourcePermissions.set('/api/admin/monitor', ['system:monitor']);
    this.resourcePermissions.set('/api/admin/config', ['system:write']);

    // Security endpoints
    this.resourcePermissions.set('/api/security/threats', ['security:read']);
    this.resourcePermissions.set('/api/security/config', ['security:write']);
    this.resourcePermissions.set('/api/security/audit', ['security:admin']);

    // Analytics endpoints
    this.resourcePermissions.set('/api/analytics/dashboard', ['analytics:read']);
    this.resourcePermissions.set('/api/analytics/export', ['analytics:export']);
    this.resourcePermissions.set('/api/reports/generate', ['reports:generate']);
  }

  async checkAccess(context: AccessContext): Promise<AccessDecision> {
    this.ensureInitialized();
    try {
      // Get user roles and permissions
      const userRole = await this.getUserRole(context.userId);
      if (!userRole) {
        return {
          allowed: false,
          reason: 'User role not found',
          requiredPermissions: [],
          missingPermissions: [],
          appliedRestrictions: [],
          riskScore: 0
        };
      }

      // Get required permissions for the resource
      const requiredPermissions = this.getRequiredPermissions(context.resource, context.action);
      
      // Check basic permission requirements
      const hasPermissions = this.hasRequiredPermissions(userRole, requiredPermissions);
      const missingPermissions = requiredPermissions.filter(perm => 
        !userRole.permissions.includes(perm) && 
        !(userRole.customPermissions || []).includes(perm)
      );

      if (!hasPermissions) {
        return {
          allowed: false,
          reason: 'Insufficient permissions',
          requiredPermissions,
          missingPermissions,
          appliedRestrictions: [],
          riskScore: 20
        };
      }

      // Check time restrictions
      const timeRestrictionResult = this.checkTimeRestrictions(userRole, context.timestamp);
      if (!timeRestrictionResult.allowed) {
        return {
          allowed: false,
          reason: timeRestrictionResult.reason,
          requiredPermissions,
          missingPermissions: [],
          appliedRestrictions: ['time_restriction'],
          riskScore: 30
        };
      }

      // Check IP restrictions
      const ipRestrictionResult = this.checkIPRestrictions(userRole, context.ip);
      if (!ipRestrictionResult.allowed) {
        return {
          allowed: false,
          reason: ipRestrictionResult.reason,
          requiredPermissions,
          missingPermissions: [],
          appliedRestrictions: ['ip_restriction'],
          riskScore: 40
        };
      }

      // Check resource-specific restrictions
      const resourceRestrictionResult = await this.checkResourceRestrictions(userRole, context);
      if (!resourceRestrictionResult.allowed) {
        return {
          allowed: false,
          reason: resourceRestrictionResult.reason,
          requiredPermissions,
          missingPermissions: [],
          appliedRestrictions: ['resource_restriction'],
          riskScore: 25
        };
      }

      // Check rate limits
      const rateLimitResult = await this.checkRateLimits(userRole, context);
      if (!rateLimitResult.allowed) {
        return {
          allowed: false,
          reason: rateLimitResult.reason,
          requiredPermissions,
          missingPermissions: [],
          appliedRestrictions: ['rate_limit'],
          riskScore: 50
        };
      }

      // Calculate risk score
      const riskScore = this.calculateAccessRiskScore(userRole, context);

      // Log successful access
      await this.logAccessEvent(context, {
        allowed: true,
        reason: 'Access granted',
        requiredPermissions,
        missingPermissions: [],
        appliedRestrictions: [],
        riskScore
      });

      return {
        allowed: true,
        reason: 'Access granted',
        requiredPermissions,
        missingPermissions: [],
        appliedRestrictions: [],
        riskScore
      };

    } catch (error) {
      logger.error('Access control check failed', error as Error, {
        userId: context.userId,
        resource: context.resource,
        action: context.action
      });

      return {
        allowed: false,
        reason: 'Access control system error',
        requiredPermissions: [],
        missingPermissions: [],
        appliedRestrictions: [],
        riskScore: 100
      };
    }
  }

  async assignRole(userId: string, roles: Role[], assignedBy: string, options?: {
    customPermissions?: Permission[];
    restrictions?: UserRole['restrictions'];
    expiresAt?: Date;
    reason?: string;
  }): Promise<void> {
    try {
      // Validate roles
      const validRoles = roles.filter(role => this.rolePermissions.has(role));
      if (validRoles.length !== roles.length) {
        throw new Error('Invalid roles provided');
      }

      // Calculate permissions from roles
      const permissions = this.calculatePermissionsFromRoles(validRoles);

      // Create user role record
      const userRole: UserRole = {
        userId,
        roles: validRoles,
        permissions,
        customPermissions: options?.customPermissions,
        restrictions: options?.restrictions,
        metadata: {
          assignedAt: new Date(),
          assignedBy,
          lastUpdated: new Date(),
          expiresAt: options?.expiresAt,
          reason: options?.reason
        }
      };

      // Store in Firestore
      await firestoreHelper.setDocument('user_roles', userId, userRole);

      // Update Firebase Auth custom claims
      await this.updateUserClaims(userId, {
        roles: validRoles,
        permissions,
        lastUpdated: new Date().toISOString()
      });

      logger.info('Role assigned successfully', {
        userId,
        roles: validRoles,
        assignedBy,
        permissions: permissions.length
      });

    } catch (error) {
      logger.error('Failed to assign role', error as Error, { userId, roles, assignedBy });
      throw error;
    }
  }

  async revokeRole(userId: string, revokedBy: string, reason?: string): Promise<void> {
    try {
      // Remove user role record
      await firestoreHelper.deleteDocument('user_roles', userId);

      // Update Firebase Auth custom claims
      await this.updateUserClaims(userId, {
        roles: [],
        permissions: [],
        revokedAt: new Date().toISOString(),
        revokedBy,
        reason
      });

      logger.info('Role revoked successfully', { userId, revokedBy, reason });

    } catch (error) {
      logger.error('Failed to revoke role', error as Error, { userId, revokedBy });
      throw error;
    }
  }

  async updateRole(userId: string, updates: Partial<UserRole>, updatedBy: string): Promise<void> {
    try {
      const existingRole = await this.getUserRole(userId);
      if (!existingRole) {
        throw new Error('User role not found');
      }

      // Calculate new permissions if roles changed
      let newPermissions = existingRole.permissions;
      if (updates.roles) {
        newPermissions = this.calculatePermissionsFromRoles(updates.roles);
      }

      const updatedRole: UserRole = {
        ...existingRole,
        ...updates,
        permissions: newPermissions,
        metadata: {
          ...existingRole.metadata,
          lastUpdated: new Date()
        }
      };

      // Store updated role
      await firestoreHelper.setDocument('user_roles', userId, updatedRole);

      // Update Firebase Auth custom claims
      await this.updateUserClaims(userId, {
        roles: updatedRole.roles,
        permissions: updatedRole.permissions,
        lastUpdated: new Date().toISOString()
      });

      logger.info('Role updated successfully', { userId, updatedBy, changes: Object.keys(updates) });

    } catch (error) {
      logger.error('Failed to update role', error as Error, { userId, updatedBy });
      throw error;
    }
  }

  private async getUserRole(userId: string): Promise<UserRole | null> {
    try {
      const userRole = await firestoreHelper.getDocumentOptional('user_roles', userId);
      
      if (!userRole) {
        // Check if user has basic access
        const user = await this.auth.getUser(userId);
        if (user) {
          // Assign default user role
          const defaultRole: UserRole = {
            userId,
            roles: ['user'],
            permissions: this.rolePermissions.get('user') || [],
            metadata: {
              assignedAt: new Date(),
              assignedBy: 'system',
              lastUpdated: new Date()
            }
          };
          
          await firestoreHelper.setDocument('user_roles', userId, defaultRole);
          return defaultRole;
        }
        return null;
      }

      // Check if role has expired
      if (userRole.metadata.expiresAt && new Date() > userRole.metadata.expiresAt) {
        await this.revokeRole(userId, 'system', 'Role expired');
        return null;
      }

      return userRole as UserRole;

    } catch (error) {
      logger.error('Failed to get user role', error as Error, { userId });
      return null;
    }
  }

  private getRequiredPermissions(resource: string, action: string): Permission[] {
    // Check exact resource match
    const exactMatch = this.resourcePermissions.get(resource);
    if (exactMatch) {
      return exactMatch;
    }

    // Check pattern-based matches
    for (const [pattern, permissions] of this.resourcePermissions.entries()) {
      if (this.matchesPattern(resource, pattern)) {
        return permissions;
      }
    }

    // Default permissions based on action
    return this.getDefaultPermissionsForAction(action);
  }

  private matchesPattern(resource: string, pattern: string): boolean {
    // Convert pattern to regex (e.g., /api/users/* becomes /api/users/.*)
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(resource);
  }

  private getDefaultPermissionsForAction(action: string): Permission[] {
    const actionPermissions: Record<string, Permission[]> = {
      'GET': ['projects:read', 'users:read', 'content:read'],
      'POST': ['projects:write', 'users:write', 'content:write'],
      'PUT': ['projects:write', 'users:write', 'content:write'],
      'DELETE': ['projects:delete', 'users:delete', 'content:write'],
      'PATCH': ['projects:write', 'users:write', 'content:write']
    };

    return actionPermissions[action.toUpperCase()] || [];
  }

  private hasRequiredPermissions(userRole: UserRole, requiredPermissions: Permission[]): boolean {
    const allUserPermissions = [
      ...userRole.permissions,
      ...(userRole.customPermissions || [])
    ];

    return requiredPermissions.every(permission => 
      allUserPermissions.includes(permission)
    );
  }

  private checkTimeRestrictions(userRole: UserRole, timestamp: Date): { allowed: boolean; reason: string } {
    const timeRestrictions = userRole.restrictions?.timeRestrictions;
    if (!timeRestrictions) {
      return { allowed: true, reason: 'No time restrictions' };
    }

    // Check day restrictions
    const dayOfWeek = timestamp.getDay();
    if (!timeRestrictions.allowedDays.includes(dayOfWeek)) {
      return { 
        allowed: false, 
        reason: `Access not allowed on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}` 
      };
    }

    // Check hour restrictions
    const hour = timestamp.getHours();
    const [startHour, endHour] = timeRestrictions.allowedHours;
    
    if (startHour <= endHour) {
      // Normal time range (e.g., 9-17)
      if (hour < startHour || hour >= endHour) {
        return { 
          allowed: false, 
          reason: `Access only allowed between ${startHour}:00 and ${endHour}:00` 
        };
      }
    } else {
      // Overnight time range (e.g., 22-6)
      if (hour < startHour && hour >= endHour) {
        return { 
          allowed: false, 
          reason: `Access only allowed between ${startHour}:00 and ${endHour}:00` 
        };
      }
    }

    return { allowed: true, reason: 'Time restrictions passed' };
  }

  private checkIPRestrictions(userRole: UserRole, ip?: string): { allowed: boolean; reason: string } {
    const ipWhitelist = userRole.restrictions?.ipWhitelist;
    if (!ipWhitelist || !ip) {
      return { allowed: true, reason: 'No IP restrictions' };
    }

    const isAllowed = ipWhitelist.some(allowedIP => {
      // Support CIDR notation and exact matches
      if (allowedIP.includes('/')) {
        return this.isIPInCIDR(ip, allowedIP);
      }
      return ip === allowedIP;
    });

    if (!isAllowed) {
      return { 
        allowed: false, 
        reason: `IP ${ip} not in whitelist` 
      };
    }

    return { allowed: true, reason: 'IP restrictions passed' };
  }

  private async checkResourceRestrictions(userRole: UserRole, context: AccessContext): Promise<{ allowed: boolean; reason: string }> {
    // Check if user can access their own resources vs others
    if (context.resourceData?.userId && context.resourceData.userId !== context.userId) {
      // User trying to access another user's resource
      if (!userRole.permissions.includes('users:admin') && !userRole.permissions.includes('system:admin')) {
        // Check if it's a read-only operation on public data
        if (context.action === 'GET' && context.resourceData.public) {
          return { allowed: true, reason: 'Public resource access' };
        }
        
        return { 
          allowed: false, 
          reason: 'Cannot access other user\'s private resources' 
        };
      }
    }

    // Check project ownership for project operations
    if (context.resource.includes('/projects/') && context.resourceData?.creatorUid) {
      if (context.resourceData.creatorUid !== context.userId) {
        // Check if user has moderation rights
        if (!userRole.permissions.includes('projects:moderate') && 
            !userRole.permissions.includes('projects:admin')) {
          return { 
            allowed: false, 
            reason: 'Cannot modify projects created by other users' 
          };
        }
      }
    }

    return { allowed: true, reason: 'Resource restrictions passed' };
  }

  private async checkRateLimits(userRole: UserRole, context: AccessContext): Promise<{ allowed: boolean; reason: string }> {
    const resourceLimits = userRole.restrictions?.resourceLimits;
    if (!resourceLimits) {
      return { allowed: true, reason: 'No rate limits' };
    }

    const now = new Date();
    const userId = context.userId;

    // Check API calls per hour
    if (resourceLimits.maxAPICallsPerHour) {
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const recentCalls = await this.getRecentAPICallsCount(userId, hourAgo);
      
      if (recentCalls >= resourceLimits.maxAPICallsPerHour) {
        return { 
          allowed: false, 
          reason: `API rate limit exceeded: ${recentCalls}/${resourceLimits.maxAPICallsPerHour} calls per hour` 
        };
      }
    }

    // Check projects per day
    if (resourceLimits.maxProjectsPerDay && context.resource.includes('/projects/create')) {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const projectsToday = await this.getRecentProjectsCount(userId, dayAgo);
      
      if (projectsToday >= resourceLimits.maxProjectsPerDay) {
        return { 
          allowed: false, 
          reason: `Daily project limit exceeded: ${projectsToday}/${resourceLimits.maxProjectsPerDay} projects per day` 
        };
      }
    }

    // Check contributions per day
    if (resourceLimits.maxContributionsPerDay && context.resource.includes('/contributions/create')) {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const contributionsToday = await this.getRecentContributionsCount(userId, dayAgo);
      
      if (contributionsToday >= resourceLimits.maxContributionsPerDay) {
        return { 
          allowed: false, 
          reason: `Daily contribution limit exceeded: ${contributionsToday}/${resourceLimits.maxContributionsPerDay} contributions per day` 
        };
      }
    }

    return { allowed: true, reason: 'Rate limits passed' };
  }

  private calculatePermissionsFromRoles(roles: Role[]): Permission[] {
    const permissions = new Set<Permission>();
    
    roles.forEach(role => {
      const rolePermissions = this.rolePermissions.get(role) || [];
      rolePermissions.forEach(permission => permissions.add(permission));
    });

    return Array.from(permissions);
  }

  private calculateAccessRiskScore(userRole: UserRole, context: AccessContext): number {
    let riskScore = 0;

    // Base risk based on roles
    const roleRisk: Record<Role, number> = {
      'admin': 20,
      'moderator': 15,
      'auditor': 10,
      'creator': 5,
      'contributor': 3,
      'user': 1
    };

    const maxRoleRisk = Math.max(...userRole.roles.map(role => roleRisk[role] || 0));
    riskScore += maxRoleRisk;

    // Risk based on resource access
    if (context.resource.includes('/admin/')) riskScore += 15;
    if (context.resource.includes('/payments/')) riskScore += 10;
    if (context.resource.includes('/security/')) riskScore += 12;

    // Risk based on action
    const actionRisk: Record<string, number> = {
      'DELETE': 10,
      'POST': 5,
      'PUT': 3,
      'PATCH': 3,
      'GET': 1
    };
    riskScore += actionRisk[context.action.toUpperCase()] || 0;

    // Risk based on time (higher risk outside business hours)
    const hour = context.timestamp.getHours();
    if (hour < 6 || hour > 22) riskScore += 5;

    return Math.min(riskScore, 100);
  }

  private async updateUserClaims(userId: string, claims: any): Promise<void> {
    try {
      await this.auth.setCustomUserClaims(userId, claims);
    } catch (error) {
      logger.error('Failed to update user claims', error as Error, { userId });
      throw error;
    }
  }

  private isIPInCIDR(ip: string, cidr: string): boolean {
    // Simple CIDR check implementation
    // In production, use a proper IP library
    const [network, maskBits] = cidr.split('/');
    const mask = parseInt(maskBits);
    
    // Convert IPs to integers and apply mask
    const ipInt = this.ipToInt(ip);
    const networkInt = this.ipToInt(network);
    const maskInt = (0xFFFFFFFF << (32 - mask)) >>> 0;
    
    return (ipInt & maskInt) === (networkInt & maskInt);
  }

  private ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  private async getRecentAPICallsCount(userId: string, since: Date): Promise<number> {
    try {
      const snapshot = await this.db.collection('access_logs')
        .where('userId', '==', userId)
        .where('timestamp', '>=', since)
        .get();
      
      return snapshot.size;
    } catch (error) {
      logger.error('Failed to get API calls count', error as Error, { userId });
      return 0;
    }
  }

  private async getRecentProjectsCount(userId: string, since: Date): Promise<number> {
    try {
      const snapshot = await this.db.collection('projects')
        .where('creatorUid', '==', userId)
        .where('createdAt', '>=', since)
        .get();
      
      return snapshot.size;
    } catch (error) {
      logger.error('Failed to get projects count', error as Error, { userId });
      return 0;
    }
  }

  private async getRecentContributionsCount(userId: string, since: Date): Promise<number> {
    try {
      const snapshot = await this.db.collectionGroup('contributions')
        .where('contributorUid', '==', userId)
        .where('createdAt', '>=', since)
        .get();
      
      return snapshot.size;
    } catch (error) {
      logger.error('Failed to get contributions count', error as Error, { userId });
      return 0;
    }
  }

  private async logAccessEvent(context: AccessContext, decision: AccessDecision): Promise<void> {
    try {
      const accessLog = {
        userId: context.userId,
        resource: context.resource,
        action: context.action,
        allowed: decision.allowed,
        reason: decision.reason,
        riskScore: decision.riskScore,
        timestamp: context.timestamp,
        ip: context.ip,
        appliedRestrictions: decision.appliedRestrictions
      };

      await firestoreHelper.addDocument('access_logs', accessLog);
    } catch (error) {
      logger.error('Failed to log access event', error as Error, { userId: context.userId });
    }
  }

  // Public management methods
  async getRoleDetails(userId: string): Promise<UserRole | null> {
    return this.getUserRole(userId);
  }

  async listUsersWithRole(role: Role): Promise<UserRole[]> {
    try {
      const snapshot = await this.db.collection('user_roles')
        .where('roles', 'array-contains', role)
        .get();

      return snapshot.docs.map(doc => doc.data() as UserRole);
    } catch (error) {
      logger.error('Failed to list users with role', error as Error, { role });
      return [];
    }
  }

  async getAccessHistory(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const snapshot = await this.db.collection('access_logs')
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      logger.error('Failed to get access history', error as Error, { userId });
      return [];
    }
  }

  async validatePermission(userId: string, permission: Permission): Promise<boolean> {
    const userRole = await this.getUserRole(userId);
    if (!userRole) return false;

    return userRole.permissions.includes(permission) || 
           (userRole.customPermissions || []).includes(permission);
  }
}

// Middleware function for Express/Firebase Functions
export async function requirePermissions(requiredPermissions: Permission[]) {
  return async (req: any, res: any, next: any) => {
    try {
      const accessControl = new AccessControlSystem();
      const userId = req.user?.uid;
      
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const context: AccessContext = {
        userId,
        userRoles: [], // Will be populated by checkAccess
        userPermissions: [], // Will be populated by checkAccess
        resource: req.path,
        action: req.method,
        resourceData: req.params,
        requestData: req.body,
        ip: req.ip,
        timestamp: new Date()
      };

      const decision = await accessControl.checkAccess(context);

      if (!decision.allowed) {
        return res.status(403).json({
          error: 'Access denied',
          reason: decision.reason,
          requiredPermissions,
          missingPermissions: decision.missingPermissions
        });
      }

      // Add access decision to request for logging
      req.accessDecision = decision;
      next();

    } catch (error) {
      logger.error('Permission check failed', error as Error);
      res.status(500).json({ error: 'Authorization system error' });
    }
  };
}

// Singleton instance
export const accessControlSystem = new AccessControlSystem();