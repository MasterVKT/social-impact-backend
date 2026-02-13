/**
 * Database Configuration
 * Exports configured Firestore instance
 * Note: Settings must be configured in index.ts before any getFirestore() calls
 */

import { getFirestore } from 'firebase-admin/firestore';

// Export Firestore instance (already configured in index.ts)
export const firestoreDb = getFirestore();
