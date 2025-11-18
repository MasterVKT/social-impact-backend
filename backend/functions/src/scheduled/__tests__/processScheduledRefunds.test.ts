/**
 * Tests for Process Scheduled Refunds Scheduled Function
 * Social Finance Impact Platform
 */

import { processScheduledRefunds } from '../processScheduledRefunds';
import { firestoreHelper } from '../../utils/firestore';
import { logger } from '../../utils/logger';

jest.mock('../../utils/firestore');
jest.mock('../../utils/logger');
jest.mock('../../integrations/stripe/stripeService');

const mockFirestoreHelper = jest.mocked(firestoreHelper);
const mockLogger = jest.mocked(logger);

describe('processScheduledRefunds Scheduled Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockFirestoreHelper.queryDocuments.mockResolvedValue([
      {
        id: 'refund-1',
        contributionId: 'contrib-1',
        amount: 10000,
        status: 'pending',
        scheduledFor: new Date(Date.now() - 1000)
      }
    ] as any);

    mockFirestoreHelper.updateDocument.mockResolvedValue();
    mockFirestoreHelper.getDocument.mockResolvedValue({
      id: 'contrib-1',
      stripePaymentIntentId: 'pi_123',
      amount: 10000
    } as any);
  });

  it('should process scheduled refunds that are due', async () => {
    await processScheduledRefunds();

    expect(mockFirestoreHelper.queryDocuments).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        ['scheduledFor', '<=', expect.any(Date)]
      ]),
      expect.any(Object)
    );
  });

  it('should update refund status after processing', async () => {
    await processScheduledRefunds();

    expect(mockFirestoreHelper.updateDocument).toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Scheduled refunds processed'),
      expect.any(Object)
    );
  });

  it('should handle empty refund queue', async () => {
    mockFirestoreHelper.queryDocuments.mockResolvedValue([]);

    await expect(processScheduledRefunds()).resolves.not.toThrow();
  });

  it('should handle Stripe errors gracefully', async () => {
    mockFirestoreHelper.updateDocument.mockRejectedValue(new Error('Stripe API error'));

    await expect(processScheduledRefunds()).rejects.toThrow();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
