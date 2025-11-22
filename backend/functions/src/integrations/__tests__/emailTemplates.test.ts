/**
 * Tests for Email Templates
 * Social Finance Impact Platform
 */

import { emailTemplates } from '../sendgrid/templates';

describe('Email Templates', () => {
  describe('Welcome Email Template', () => {
    it('should generate welcome email HTML', () => {
      const html = emailTemplates.welcome({
        firstName: 'John',
        userType: 'creator'
      });

      expect(html).toContain('John');
      expect(html).toContain('Welcome');
      expect(html).toContain('creator');
    });

    it('should include platform branding', () => {
      const html = emailTemplates.welcome({ firstName: 'Jane' });

      expect(html).toContain('Social Impact Platform');
    });
  });

  describe('Receipt Email Template', () => {
    it('should format contribution amount correctly', () => {
      const html = emailTemplates.contributionReceipt({
        amount: 10000,
        projectTitle: 'Great Project',
        contributionDate: new Date('2024-01-01')
      });

      expect(html).toContain('€100.00');
      expect(html).toContain('Great Project');
      expect(html).toContain('2024');
    });

    it('should include tax deduction information', () => {
      const html = emailTemplates.contributionReceipt({
        amount: 10000,
        projectTitle: 'Project',
        contributionDate: new Date()
      });

      expect(html).toContain('tax');
    });
  });

  describe('Project Update Template', () => {
    it('should format project update notification', () => {
      const html = emailTemplates.projectUpdate({
        projectTitle: 'My Project',
        updateTitle: 'Milestone Achieved',
        updateContent: 'We reached our first milestone!'
      });

      expect(html).toContain('My Project');
      expect(html).toContain('Milestone Achieved');
      expect(html).toContain('We reached our first milestone!');
    });
  });

  describe('Digest Template', () => {
    it('should aggregate multiple notifications', () => {
      const html = emailTemplates.digest({
        notifications: [
          { type: 'project_update', title: 'Update 1', summary: 'Summary 1' },
          { type: 'contribution', title: 'Update 2', summary: 'Summary 2' }
        ],
        period: 'weekly'
      });

      expect(html).toContain('Update 1');
      expect(html).toContain('Update 2');
      expect(html).toContain('weekly');
    });

    it('should handle empty notifications list', () => {
      const html = emailTemplates.digest({
        notifications: [],
        period: 'daily'
      });

      expect(html).toContain('No new updates');
    });
  });
});
