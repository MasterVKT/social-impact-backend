/**
 * Tests for Process Audit Queue Scheduled Function
 * Social Finance Impact Platform
 */

import { processAuditQueue } from '../processAuditQueue';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('processAuditQueue Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      {
        id: 'audit-1',
        projectId: 'project-1',
        status: 'pending',
        milestoneId: 'milestone-1'
      }
    ] as any);

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'auditor-1',
      userType: 'auditor',
      auditorProfile: { specializations: ['environment'], availability: true }
    } as any);
  });

  it('should process pending audits in queue', async () => {
    await processAuditQueue();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        ['status', '==', 'pending']
      ]),
      expect.any(Object)
    );
  });

  it('should assign available auditors to pending audits', async () => {
    await processAuditQueue();

    expect(mockFirestoreHelper.updateDocument).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Audit queue processed'),
      expect.any(Object)
    );
  });

  it('should handle empty audit queue', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

    await expect(processAuditQueue()).resolves.not.toThrow();
  });

  it('should handle no available auditors', async () => {
    mockFirestoreHelper.getDocument.mockResolvedValue(null);

    await expect(processAuditQueue()).resolves.not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
