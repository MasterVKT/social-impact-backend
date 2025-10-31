/**
 * Tests for getAuditorDashboard Firebase Function
 * Social Finance Impact Platform
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CallableContext } from 'firebase-functions/v1/https';
import { https } from 'firebase-functions';
import { getAuditorDashboard } from '../getAuditorDashboard';
import { firestoreHelper } from '../../utils/firestore';
import { UserDocument, ProjectDocument, AuditDocument } from '../../types/firestore';
import { STATUS, USER_PERMISSIONS, AUDIT_CONFIG } from '../../utils/constants';
import { AuditsAPI } from '../../types/api';

// Mock dependencies
jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = firestoreHelper as jest.Mocked<typeof firestoreHelper>;

describe('getAuditorDashboard', () => {
  let mockContext: CallableContext;
  let mockAuditor: UserDocument;
  let mockProjects: ProjectDocument[];
  let mockAudits: AuditDocument[];

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      auth: {
        uid: 'auditor_123',
        token: {
          email: 'auditor@test.com',
          role: 'auditor'
        }
      },
      rawRequest: {
        ip: '127.0.0.1'
      }
    };

    mockAuditor = {
      uid: 'auditor_123',
      email: 'auditor@test.com',
      firstName: 'Expert',
      lastName: 'Auditor',
      userType: 'auditor',
      status: 'active',
      permissions: [USER_PERMISSIONS.AUDIT_PROJECT],
      auditor: {
        specializations: ['environmental', 'financial'],
        certifications: [
          {
            category: 'environment',
            name: 'Environmental Audit Certification',
            status: 'active',
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          }
        ],
        hourlyRate: 75,
        maxConcurrentAudits: 3,
        availability: 'available',
        languages: ['fr', 'en'],
        stats: {
          totalCompleted: 25,
          averageScore: 87,
          activeAudits: 2,
          totalEarnings: 18500
        }
      },
      preferences: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1
    } as UserDocument;

    mockProjects = [
      {
        uid: 'project_123',
        title: 'Environmental Restoration Project',
        category: 'environment',
        status: STATUS.PROJECT.ACTIVE,
        creatorUid: 'creator_123',
        creatorName: 'Project Creator',
        funding: { goal: 50000, raised: 30000, currency: 'EUR' },
        timeline: { endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() },
        milestones: [
          {
            id: 'milestone_1',
            title: 'Phase 1',
            status: STATUS.MILESTONE.COMPLETED,
            fundingPercentage: 30
          }
        ],
        audit: { status: STATUS.AUDIT.IN_PROGRESS, auditorUid: 'auditor_123' },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      },
      {
        uid: 'project_456',
        title: 'Financial Inclusion Initiative',
        category: 'finance',
        status: STATUS.PROJECT.APPROVED,
        creatorUid: 'creator_456',
        creatorName: 'Finance Creator',
        funding: { goal: 75000, raised: 15000, currency: 'EUR' },
        timeline: { endDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString() },
        milestones: [
          {
            id: 'milestone_2',
            title: 'Financial Analysis',
            status: STATUS.MILESTONE.SUBMITTED,
            fundingPercentage: 40
          }
        ],
        audit: { status: STATUS.AUDIT.PENDING },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1
      }
    ] as ProjectDocument[];

    mockAudits = [
      {
        id: 'audit_123',
        projectId: 'project_123',
        projectTitle: 'Environmental Restoration Project',
        auditorUid: 'auditor_123',
        status: STATUS.AUDIT.IN_PROGRESS,
        assignedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        acceptedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        currentMilestone: 'milestone_1',
        estimatedHours: 16,
        timeSpent: 8,
        compensation: { amount: 1200, currency: 'EUR', status: 'pending' },
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
      },
      {
        id: 'audit_456',
        projectId: 'project_456',
        projectTitle: 'Financial Inclusion Initiative',
        auditorUid: 'auditor_123',
        status: STATUS.AUDIT.ASSIGNED,
        assignedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        currentMilestone: 'milestone_2',
        estimatedHours: 20,
        compensation: { amount: 1500, currency: 'EUR', status: 'pending' },
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
      },
      {
        id: 'audit_789',
        projectId: 'project_789',
        projectTitle: 'Completed Social Project',
        auditorUid: 'auditor_123',
        status: STATUS.AUDIT.COMPLETED,
        assignedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        acceptedAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        deadline: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        finalDecision: 'approved',
        finalScore: 92,
        timeSpent: 18,
        completionTime: 15,
        compensation: { 
          amount: 1350, 
          finalAmount: 1485, 
          currency: 'EUR', 
          status: 'paid',
          paidAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        },
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        updatedAt: new Date()
      }
    ] as AuditDocument[];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Successful Dashboard Retrieval', () => {
    it('should return complete dashboard with all stats and data', async () => {
      const requestData = {
        period: 'month',
        includeStats: true,
        includeHistory: true,
        limit: 20
      };

      // Setup mocks for sequential calls
      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAuditor) // Auditor validation
        .mockResolvedValueOnce(mockProjects[0]) // Project for assigned audit 1
        .mockResolvedValueOnce(mockProjects[1]) // Project for assigned audit 2
        .mockResolvedValueOnce(mockProjects[0]) // Project for completed audit history

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(mockAudits) // All audits for stats
        .mockResolvedValueOnce(mockAudits.filter(a => a.status !== STATUS.AUDIT.COMPLETED)) // Assigned audits
        .mockResolvedValueOnce(mockAudits.filter(a => a.status === STATUS.AUDIT.COMPLETED)) // Completed audits
        .mockResolvedValueOnce([mockProjects[1]]) // Projects needing audit
        .mockResolvedValueOnce([]) // No overdue payments
        .mockResolvedValueOnce([{ // Feedback for rating
          rating: 4.5,
          comment: 'Excellent work',
          createdAt: new Date()
        }]);

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        stats: {
          totalAudits: expect.any(Number),
          completedAudits: expect.any(Number),
          activeAudits: expect.any(Number),
          averageProcessingTime: expect.any(Number),
          approvalRate: expect.any(Number),
          totalEarnings: expect.any(Number),
          specializations: ['environmental', 'financial'],
          rating: expect.any(Number)
        },
        assigned: expect.arrayContaining([
          expect.objectContaining({
            auditId: 'audit_123',
            projectTitle: 'Environmental Restoration Project',
            status: STATUS.AUDIT.IN_PROGRESS,
            compensation: 1200,
            nextAction: 'continue_review'
          }),
          expect.objectContaining({
            auditId: 'audit_456',
            projectTitle: 'Financial Inclusion Initiative',
            status: STATUS.AUDIT.ASSIGNED,
            compensation: 1500,
            nextAction: 'accept_audit'
          })
        ]),
        completed: expect.arrayContaining([
          expect.objectContaining({
            auditId: 'audit_789',
            decision: 'approved',
            score: 92,
            timeSpent: 18,
            compensation: {
              amount: 1485,
              status: 'paid'
            }
          })
        ]),
        opportunities: expect.any(Array),
        profile: {
          specializations: ['environmental', 'financial'],
          hourlyRate: 75,
          maxConcurrentAudits: 3,
          availability: 'available',
          languages: ['fr', 'en']
        },
        performance: {
          thisMonth: expect.objectContaining({
            auditsCompleted: expect.any(Number),
            averageScore: expect.any(Number),
            earnings: expect.any(Number)
          }),
          trends: expect.objectContaining({
            improving: expect.any(Boolean),
            consistent: expect.any(Boolean),
            needsImprovement: expect.any(Boolean)
          })
        },
        nextActions: expect.arrayContaining([
          expect.any(String)
        ])
      });
    });

    it('should return dashboard with minimal data when options disabled', async () => {
      const requestData = {
        period: 'week',
        includeStats: false,
        includeHistory: false,
        limit: 5
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(mockAudits.filter(a => a.status !== STATUS.AUDIT.COMPLETED)) // Assigned only
        .mockResolvedValueOnce([mockProjects[0]]) // Opportunities
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.stats).toEqual({});
      expect(result.data.completed).toEqual([]);
      expect(result.data.assigned).toHaveLength(2);
    });

    it('should handle different time periods correctly', async () => {
      const requestData = {
        period: 'year',
        includeStats: true,
        includeHistory: true
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(mockAudits) // All audits for year
        .mockResolvedValueOnce([]) // No assigned audits
        .mockResolvedValueOnce(mockAudits.filter(a => a.status === STATUS.AUDIT.COMPLETED)) // Completed audits
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No alerts
        .mockResolvedValueOnce([]); // No feedback

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.stats.totalAudits).toBe(3);
      expect(result.data.stats.completedAudits).toBe(1);
    });
  });

  describe('Permission Validation', () => {
    it('should reject unauthenticated requests', async () => {
      const requestData = {
        period: 'month'
      };

      const unauthenticatedContext = { ...mockContext, auth: undefined };

      await expect(getAuditorDashboard(requestData, unauthenticatedContext))
        .rejects.toThrow('Authentication required');
    });

    it('should reject non-auditor users', async () => {
      const nonAuditor = {
        ...mockAuditor,
        permissions: [USER_PERMISSIONS.CREATE_PROJECT]
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(nonAuditor);

      await expect(getAuditorDashboard(requestData, mockContext))
        .rejects.toThrow('Auditor access required');
    });

    it('should reject inactive auditor accounts', async () => {
      const inactiveAuditor = {
        ...mockAuditor,
        status: 'suspended'
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(inactiveAuditor);

      await expect(getAuditorDashboard(requestData, mockContext))
        .rejects.toThrow('Auditor account is not active');
    });
  });

  describe('Statistics Calculation', () => {
    it('should calculate accurate auditor statistics', async () => {
      const requestData = {
        period: 'month',
        includeStats: true
      };

      const statsAudits = [
        {
          ...mockAudits[2], // Completed audit
          finalScore: 85,
          finalDecision: 'approved',
          completionTime: 12,
          compensation: { finalAmount: 1200 }
        },
        {
          id: 'audit_completed_2',
          auditorUid: 'auditor_123',
          status: STATUS.AUDIT.COMPLETED,
          finalScore: 90,
          finalDecision: 'approved',
          completionTime: 8,
          compensation: { finalAmount: 1000 },
          completedAt: new Date(),
          createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
        }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([...mockAudits, statsAudits[1]]) // All audits
        .mockResolvedValueOnce([]) // No assigned
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No alerts
        .mockResolvedValueOnce([{ rating: 4.8 }]); // Good feedback

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.stats.completedAudits).toBe(2);
      expect(result.data.stats.averageScore).toBeGreaterThan(0);
      expect(result.data.stats.totalEarnings).toBeGreaterThan(0);
      expect(result.data.stats.rating).toBe(4.8);
    });

    it('should handle empty audit history gracefully', async () => {
      const requestData = {
        period: 'month',
        includeStats: true
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No audits
        .mockResolvedValueOnce([]) // No assigned
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No alerts
        .mockResolvedValueOnce([]); // No feedback

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.stats.totalAudits).toBe(0);
      expect(result.data.stats.completedAudits).toBe(0);
      expect(result.data.stats.averageProcessingTime).toBe(0);
      expect(result.data.stats.rating).toBe(0);
    });
  });

  describe('Assigned Audits Processing', () => {
    it('should enrich assigned audits with project details', async () => {
      const requestData = {
        period: 'month',
        limit: 10
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProjects[0]) // Project for audit_123
        .mockResolvedValueOnce(mockProjects[1]); // Project for audit_456

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(mockAudits.filter(a => a.status !== STATUS.AUDIT.COMPLETED)) // Assigned audits
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.assigned).toHaveLength(2);
      expect(result.data.assigned[0]).toMatchObject({
        auditId: 'audit_123',
        projectTitle: 'Environmental Restoration Project',
        projectCategory: 'environment',
        milestoneTitle: 'Phase 1',
        status: STATUS.AUDIT.IN_PROGRESS,
        nextAction: 'continue_review'
      });
      expect(result.data.assigned[1]).toMatchObject({
        auditId: 'audit_456',
        projectTitle: 'Financial Inclusion Initiative',
        nextAction: 'accept_audit'
      });
    });

    it('should handle missing project data gracefully', async () => {
      const requestData = {
        period: 'month',
        limit: 10
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAuditor)
        .mockRejectedValueOnce(new Error('Project not found')); // Project lookup fails

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([mockAudits[0]]) // One assigned audit
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.assigned).toHaveLength(1);
      expect(result.data.assigned[0]).toMatchObject({
        auditId: 'audit_123',
        projectTitle: 'Unknown Project',
        projectCategory: 'unknown',
        milestoneTitle: 'Unknown Milestone'
      });
    });

    it('should prioritize audits by deadline correctly', async () => {
      const urgentAudit = {
        ...mockAudits[0],
        deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString() // Tomorrow
      };

      const requestData = {
        period: 'month',
        limit: 10
      };

      mockFirestoreHelper.getDocument
        .mockResolvedValueOnce(mockAuditor)
        .mockResolvedValueOnce(mockProjects[0]);

      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([urgentAudit]) // Urgent audit
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.assigned[0].priority).toBe('high');
    });
  });

  describe('Opportunities Detection', () => {
    it('should find relevant opportunities based on specializations', async () => {
      const requestData = {
        period: 'month'
      };

      const auditorWithFinanceCert = {
        ...mockAuditor,
        auditor: {
          ...mockAuditor.auditor!,
          certifications: [
            ...mockAuditor.auditor!.certifications!,
            {
              category: 'finance',
              name: 'Financial Audit Certification',
              status: 'active',
              issuedAt: new Date(),
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
            }
          ]
        }
      };

      const opportunityProject = {
        uid: 'project_opportunity',
        title: 'New Finance Project',
        category: 'finance',
        status: STATUS.PROJECT.APPROVED,
        funding: { goal: 80000, raised: 20000 },
        timeline: { endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() },
        audit: { status: STATUS.AUDIT.PENDING },
        createdAt: new Date()
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(auditorWithFinanceCert);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits
        .mockResolvedValueOnce([opportunityProject]) // Opportunity projects
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.opportunities).toHaveLength(1);
      expect(result.data.opportunities[0]).toMatchObject({
        projectId: 'project_opportunity',
        projectTitle: 'New Finance Project',
        projectCategory: 'finance',
        estimatedHours: expect.any(Number),
        estimatedCompensation: expect.any(Number)
      });
    });

    it('should return empty opportunities for auditors without matching specializations', async () => {
      const auditorWithoutCerts = {
        ...mockAuditor,
        auditor: {
          ...mockAuditor.auditor!,
          specializations: [] // No specializations
        }
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(auditorWithoutCerts);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.opportunities).toEqual([]);
    });
  });

  describe('Alert System', () => {
    it('should generate deadline alerts for urgent audits', async () => {
      const urgentAudit = {
        ...mockAudits[0],
        deadline: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        projectTitle: 'Urgent Project'
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits for main query
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([urgentAudit]) // Urgent audit for alerts
        .mockResolvedValueOnce([]); // No overdue payments

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.alerts).toContainEqual(
        expect.objectContaining({
          type: 'deadline_approaching',
          priority: 'high',
          message: expect.stringContaining('1 day'),
          auditId: urgentAudit.id
        })
      );
    });

    it('should generate acceptance overdue alerts', async () => {
      const overdueAssignment = {
        ...mockAudits[1],
        assignedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        status: STATUS.AUDIT.ASSIGNED,
        projectTitle: 'Overdue Assignment'
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits for main query
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([overdueAssignment]) // Overdue assignment for alerts
        .mockResolvedValueOnce([]); // No overdue payments

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.alerts).toContainEqual(
        expect.objectContaining({
          type: 'acceptance_overdue',
          priority: 'medium',
          message: expect.stringContaining('5 days'),
          auditId: overdueAssignment.id
        })
      );
    });

    it('should generate payment overdue alerts', async () => {
      const overduePayment = {
        id: 'payment_123',
        auditId: 'audit_789',
        auditorUid: 'auditor_123',
        finalAmount: 150000, // €1500.00
        status: 'pending_payment',
        dueDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days overdue
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits for main query
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No audit alerts
        .mockResolvedValueOnce([overduePayment]); // Overdue payment

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.alerts).toContainEqual(
        expect.objectContaining({
          type: 'payment_overdue',
          priority: 'high',
          message: 'Payment overdue: €1500.00',
          auditId: 'audit_789'
        })
      );
    });

    it('should sort alerts by priority correctly', async () => {
      const urgentDeadline = {
        ...mockAudits[0],
        deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
        projectTitle: 'Critical Project'
      };

      const overduePayment = {
        id: 'payment_123',
        auditId: 'audit_789',
        auditorUid: 'auditor_123',
        finalAmount: 100000,
        status: 'pending_payment',
        dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
      };

      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits for main query
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([urgentDeadline]) // Urgent deadline
        .mockResolvedValueOnce([overduePayment]); // Overdue payment

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.alerts).toHaveLength(2);
      // Urgent deadline should come first
      expect(result.data.alerts[0].priority).toBe('urgent');
      expect(result.data.alerts[1].priority).toBe('high');
    });
  });

  describe('Performance Metrics', () => {
    it('should calculate performance trends correctly', async () => {
      const requestData = {
        period: 'month',
        includeStats: true
      };

      const highPerformanceAudits = [
        {
          ...mockAudits[2],
          finalScore: 95,
          status: STATUS.AUDIT.COMPLETED
        }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(highPerformanceAudits) // High score audits
        .mockResolvedValueOnce([]) // No assigned
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No alerts
        .mockResolvedValueOnce([]); // No feedback

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.performance.trends.improving).toBe(true);
      expect(result.data.performance.trends.needsImprovement).toBe(false);
    });

    it('should identify performance improvement needs', async () => {
      const requestData = {
        period: 'month',
        includeStats: true
      };

      const lowPerformanceAudits = [
        {
          ...mockAudits[2],
          finalScore: 65,
          status: STATUS.AUDIT.COMPLETED
        }
      ];

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce(lowPerformanceAudits) // Low score audits
        .mockResolvedValueOnce([]) // No assigned
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]) // No alerts
        .mockResolvedValueOnce([]); // No feedback

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.performance.trends.needsImprovement).toBe(true);
      expect(result.data.performance.trends.improving).toBe(false);
    });
  });

  describe('Data Validation', () => {
    it('should use default values for missing parameters', async () => {
      // Request with no data (should use defaults)
      const result = await getAuditorDashboard({}, mockContext);

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Stats query with default month period
        .mockResolvedValueOnce([]) // Assigned with default limit 20
        .mockResolvedValueOnce([]) // History with default inclusion
        .mockResolvedValueOnce([]) // Opportunities
        .mockResolvedValueOnce([]) // Alerts
        .mockResolvedValueOnce([]); // Feedback

      expect(result.success).toBe(true);
      // Should use default period 'month', includeStats true, includeHistory true, limit 20
    });

    it('should reject invalid period values', async () => {
      const requestData = {
        period: 'invalid_period'
      };

      await expect(getAuditorDashboard(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });

    it('should enforce limit boundaries', async () => {
      const requestData = {
        limit: 150 // Above max of 100
      };

      await expect(getAuditorDashboard(requestData, mockContext))
        .rejects.toThrow('Validation error');
    });
  });

  describe('Error Handling', () => {
    it('should handle database query failures gracefully', async () => {
      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockRejectedValueOnce(new Error('Database unavailable')) // Stats query fails
        .mockResolvedValueOnce([]) // Other queries succeed
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(getAuditorDashboard(requestData, mockContext))
        .rejects.toThrow('Unable to calculate auditor statistics');
    });

    it('should continue if opportunities lookup fails', async () => {
      const requestData = {
        period: 'month',
        includeStats: false
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Assigned audits
        .mockRejectedValueOnce(new Error('Opportunities query failed')) // Opportunities fail
        .mockResolvedValueOnce([]); // Alerts succeed

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.opportunities).toEqual([]);
      // Should continue successfully with empty opportunities
    });

    it('should continue if alerts generation fails', async () => {
      const requestData = {
        period: 'month',
        includeStats: false
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // Assigned audits
        .mockResolvedValueOnce([]) // Opportunities
        .mockRejectedValueOnce(new Error('Alerts query failed')); // Alerts fail

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.alerts).toEqual([]);
      // Should continue successfully with empty alerts
    });
  });

  describe('Next Actions Generation', () => {
    it('should generate appropriate next actions based on current state', async () => {
      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([mockAudits[0]]) // Has assigned audits
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([{ // Has alerts
          type: 'deadline_approaching',
          priority: 'high'
        }]);

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.nextActions).toContain('Complete assigned audits');
      expect(result.data.nextActions).toContain('Address urgent alerts');
    });

    it('should suggest looking for opportunities when no active audits', async () => {
      const requestData = {
        period: 'month'
      };

      mockFirestoreHelper.getDocument.mockResolvedValueOnce(mockAuditor);
      mockFirestoreHelper.queryDocuments
        .mockResolvedValueOnce([]) // No assigned audits
        .mockResolvedValueOnce([]) // No opportunities
        .mockResolvedValueOnce([]); // No alerts

      const result = await getAuditorDashboard(requestData, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.nextActions).toContain('Look for new opportunities');
      expect(result.data.nextActions).toContain('Review performance metrics');
    });
  });
});