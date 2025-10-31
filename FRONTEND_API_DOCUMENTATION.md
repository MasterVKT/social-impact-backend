# Social Impact Platform - Frontend Integration Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Authentication Setup](#authentication-setup)
4. [API Integration](#api-integration)
5. [Authentication & User Management](#authentication--user-management)
6. [Projects Management](#projects-management)
7. [Payments & Contributions](#payments--contributions)
8. [Audits System](#audits-system)
9. [Notifications](#notifications)
10. [Error Handling](#error-handling)
11. [Type Definitions](#type-definitions)
12. [Best Practices](#best-practices)

---

## Overview

This documentation provides complete integration details for the **Social Impact Platform** frontend. The platform is a social finance and impact investment system built on Firebase with TypeScript, featuring:

- User authentication with Firebase Auth
- KYC verification via Sumsub
- Project creation and management
- Secure contributions via Stripe
- Milestone-based fund release
- Independent audit system
- Real-time notifications

### Technology Stack
- **Backend**: Firebase Functions (Node.js/TypeScript)
- **Database**: Firestore
- **Authentication**: Firebase Auth
- **Payments**: Stripe Connect
- **KYC**: Sumsub
- **Email**: SendGrid
- **Storage**: Firebase Storage
- **API**: REST + Firebase Callable Functions

### Base Configuration

```typescript
// Firebase Configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// API Endpoints
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ||
  'https://europe-west1-YOUR_PROJECT_ID.cloudfunctions.net/api';

const API_VERSION = 'v2';
```

---

## Architecture

### System Architecture

```
┌─────────────────┐
│   Frontend      │
│   (React/Next)  │
└────────┬────────┘
         │
         ├─── Firebase Auth (Authentication)
         │
         ├─── Firebase Functions (Business Logic)
         │    │
         │    ├─── REST API (/api/v2/*)
         │    └─── Callable Functions
         │
         ├─── Firestore (Database)
         │
         ├─── Firebase Storage (File Uploads)
         │
         └─── External Services
              ├─── Stripe (Payments)
              ├─── Sumsub (KYC)
              └─── SendGrid (Emails)
```

### Data Flow

```
User Action → Frontend Validation → API Call → Firebase Function
    ↓
Backend Validation → Business Logic → Database Update
    ↓
External Service Integration (if needed) → Response
    ↓
Frontend Update → UI Refresh → Notifications
```

---

## Authentication Setup

### Firebase Authentication Integration

```typescript
// lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west1');

// Development emulators (optional)
if (process.env.NODE_ENV === 'development' && process.env.USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFunctionsEmulator(functions, 'localhost', 5001);
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectStorageEmulator(storage, 'localhost', 9199);
}
```

### Authentication Context

```typescript
// contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

interface UserProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  userType: 'contributor' | 'creator' | 'auditor' | 'admin';
  profileComplete: boolean;
  kyc: {
    status: string;
    level: number;
  };
  accountStatus: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile from Firestore
  const fetchProfile = async (uid: string) => {
    try {
      const docRef = doc(db, 'users', uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setProfile(docSnap.data() as UserProfile);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  // Listen to auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      if (user) {
        await fetchProfile(user.uid);
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user.uid);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

### Protected Routes

```typescript
// components/ProtectedRoute.tsx
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireProfile?: boolean;
  requireKYC?: boolean;
  allowedRoles?: string[];
}

export function ProtectedRoute({
  children,
  requireProfile = false,
  requireKYC = false,
  allowedRoles,
}: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      // Not authenticated
      if (!user) {
        router.push('/login?redirect=' + router.pathname);
        return;
      }

      // Profile required but not complete
      if (requireProfile && (!profile || !profile.profileComplete)) {
        router.push('/onboarding/complete-profile');
        return;
      }

      // KYC required but not approved
      if (requireKYC && profile?.kyc.status !== 'approved') {
        router.push('/onboarding/kyc');
        return;
      }

      // Role check
      if (allowedRoles && profile && !allowedRoles.includes(profile.userType)) {
        router.push('/unauthorized');
        return;
      }
    }
  }, [user, profile, loading, requireProfile, requireKYC, allowedRoles, router]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
```

---

## API Integration

### API Client Setup

```typescript
// lib/api-client.ts
import { auth } from './firebase';

class ApiClient {
  private baseUrl: string;
  private version: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL ||
      'https://europe-west1-YOUR_PROJECT_ID.cloudfunctions.net/api';
    this.version = 'v2';
  }

  private async getAuthToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getAuthToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}/${this.version}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: { message: 'An error occurred' }
      }));
      throw new Error(error.error?.message || 'API request failed');
    }

    return response.json();
  }

  // HTTP Methods
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async patch<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
}

export const apiClient = new ApiClient();
```

### Firebase Callable Functions

```typescript
// lib/functions.ts
import { functions } from './firebase';
import { httpsCallable } from 'firebase/functions';

// Helper to call Firebase functions
export async function callFunction<TRequest, TResponse>(
  functionName: string,
  data: TRequest
): Promise<TResponse> {
  try {
    const callable = httpsCallable<TRequest, TResponse>(functions, functionName);
    const result = await callable(data);
    return result.data;
  } catch (error: any) {
    console.error(`Error calling function ${functionName}:`, error);
    throw new Error(error.message || 'Function call failed');
  }
}

// Typed function wrappers
export const firebaseFunctions = {
  // Auth functions
  completeProfile: (data: CompleteProfileRequest) =>
    callFunction<CompleteProfileRequest, CompleteProfileResponse>('completeProfile', data),

  initKYC: (data: InitKYCRequest) =>
    callFunction<InitKYCRequest, InitKYCResponse>('initKYC', data),

  updateProfile: (data: UpdateProfileRequest) =>
    callFunction<UpdateProfileRequest, UpdateProfileResponse>('updateProfile', data),

  // Project functions
  createProject: (data: CreateProjectRequest) =>
    callFunction<CreateProjectRequest, CreateProjectResponse>('createProject', data),

  updateProject: (projectId: string, data: UpdateProjectRequest) =>
    callFunction<any, UpdateProjectResponse>('updateProject', { projectId, ...data }),

  publishProject: (projectId: string) =>
    callFunction<{ projectId: string }, PublishProjectResponse>('publishProject', { projectId }),

  // Payment functions
  createContribution: (data: CreateContributionRequest) =>
    callFunction<CreateContributionRequest, CreateContributionResponse>('createContribution', data),

  confirmPayment: (data: ConfirmPaymentRequest) =>
    callFunction<ConfirmPaymentRequest, ConfirmPaymentResponse>('confirmPayment', data),

  // Audit functions
  acceptAudit: (auditId: string, data: AcceptAuditRequest) =>
    callFunction<any, AcceptAuditResponse>('acceptAudit', { auditId, ...data }),

  submitAuditReport: (auditId: string, data: SubmitReportRequest) =>
    callFunction<any, SubmitReportResponse>('submitAuditReport', { auditId, ...data }),

  getAuditorDashboard: () =>
    callFunction<{}, AuditorDashboardResponse>('getAuditorDashboard', {}),

  // Notification functions
  getNotifications: (limit?: number) =>
    callFunction<{ limit?: number }, NotificationsListResponse>('getNotifications', { limit }),

  markAsRead: (notificationId: string) =>
    callFunction<{ notificationId: string }, MarkNotificationReadResponse>(
      'markAsRead',
      { notificationId }
    ),
};
```

### React Query Integration (Recommended)

```typescript
// lib/queries.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './api-client';
import { firebaseFunctions } from './functions';

// Query Keys
export const queryKeys = {
  user: (uid: string) => ['user', uid],
  userProfile: ['userProfile'],
  projects: ['projects'],
  project: (id: string) => ['project', id],
  contributions: (userId: string) => ['contributions', userId],
  notifications: ['notifications'],
  audits: ['audits'],
};

// User queries
export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile,
    queryFn: () => apiClient.get('/users/profile'),
  });
}

// Project queries
export function useProjects(filters?: any) {
  return useQuery({
    queryKey: [...queryKeys.projects, filters],
    queryFn: () => apiClient.get('/projects/search?' + new URLSearchParams(filters)),
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiClient.get(`/projects/${projectId}`),
    enabled: !!projectId,
  });
}

// Mutations
export function useCompleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: firebaseFunctions.completeProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfile });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: firebaseFunctions.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
    },
  });
}

export function useCreateContribution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: firebaseFunctions.createContribution,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(variables.projectId)
      });
    },
  });
}
```

---

*Continue to next section for detailed API endpoints...*
