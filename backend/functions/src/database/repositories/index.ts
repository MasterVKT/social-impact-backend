/**
 * Repository Index
 * Social Finance Impact Platform
 * 
 * Centralized export of all repository instances and types
 */

// Export repository classes
export { BaseRepository } from '../repository';
export { UserRepository, userRepository } from './UserRepository';
export { ProjectRepository, projectRepository } from './ProjectRepository';
export { DonationRepository, donationRepository } from './DonationRepository';

// Export repository-specific interfaces
export type {
  UserSearchFilters,
  UserEngagementMetrics,
  UserSecurityEvent
} from './UserRepository';

export type {
  ProjectSearchFilters,
  ProjectAnalytics,
  ProjectRecommendation,
  FundingMilestone
} from './ProjectRepository';

export type {
  DonationSearchFilters,
  DonationAnalytics,
  FinancialReport,
  FraudAnalysisResult,
  RecurringDonationSummary
} from './DonationRepository';

// Export base repository interfaces
export type {
  BaseEntity,
  QueryOptions,
  PaginationResult,
  CacheOptions
} from '../repository';

// Export schema types
export type {
  UserProfile,
  Project,
  Donation,
  AuditLog,
  Notification,
  Analytics
} from '../schema';

// Repository collection
export const repositories = {
  users: userRepository,
  projects: projectRepository,
  donations: donationRepository
} as const;

// Type-safe repository accessor
export type RepositoryType = keyof typeof repositories;

export function getRepository<T extends RepositoryType>(type: T): typeof repositories[T] {
  return repositories[type];
}

// Batch operations across repositories
export class RepositoryManager {
  static async healthCheck(): Promise<Record<string, { status: 'healthy' | 'unhealthy'; latency: number }>> {
    const results: Record<string, { status: 'healthy' | 'unhealthy'; latency: number }> = {};

    const checks = await Promise.allSettled([
      userRepository.healthCheck(),
      projectRepository.healthCheck(),
      donationRepository.healthCheck()
    ]);

    results.users = checks[0].status === 'fulfilled' ? checks[0].value : { status: 'unhealthy', latency: -1 };
    results.projects = checks[1].status === 'fulfilled' ? checks[1].value : { status: 'unhealthy', latency: -1 };
    results.donations = checks[2].status === 'fulfilled' ? checks[2].value : { status: 'unhealthy', latency: -1 };

    return results;
  }

  static clearAllCaches(): void {
    userRepository.clearCache();
    projectRepository.clearCache();
    donationRepository.clearCache();
  }

  static invalidateCacheByTag(tag: string): void {
    userRepository.invalidateCacheByTag(tag);
    projectRepository.invalidateCacheByTag(tag);
    donationRepository.invalidateCacheByTag(tag);
  }
}

export default {
  users: userRepository,
  projects: projectRepository,
  donations: donationRepository,
  RepositoryManager
};