/**
 * Extension du type Request d'Express pour ajouter la propriété user
 */

import { UserDocument } from './firestore';

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email: string;
        displayName: string;
        userType: 'creator' | 'contributor' | 'auditor';
        permissions: string[];
        kycStatus?: string;
        kycLevel?: number;
        // Référence complète au document utilisateur
        userData?: UserDocument;
      };
    }
  }
}

export {};
