# Social Impact Platform - Complete Frontend Documentation

## 📚 Documentation Overview

This documentation provides everything needed to build a fully-functional frontend for the Social Impact Platform backend. The backend is a production-ready Firebase-based system for social finance and impact investment.

---

## 🎯 What This Platform Does

The **Social Impact Platform** is a complete crowdfunding and impact investment system featuring:

### Core Features
- ✅ **User Management**: Firebase Auth + complete profile system
- ✅ **KYC Verification**: Integrated Sumsub for identity verification (Basic & Enhanced levels)
- ✅ **Project Creation**: Full project lifecycle with drafts, reviews, and publication
- ✅ **Secure Contributions**: Stripe integration with escrow system
- ✅ **Milestone-Based Release**: Funds released only after milestone completion
- ✅ **Independent Audits**: Third-party auditors validate milestone completion
- ✅ **Real-time Notifications**: In-app, email, and push notifications
- ✅ **Impact Tracking**: Measure and report social impact metrics

### Security & Compliance
- 🔒 Enterprise-grade security middleware
- 🔒 Fraud detection and risk assessment
- 🔒 AML/KYC compliance
- 🔒 GDPR compliance
- 🔒 Audit trails for all actions
- 🔒 Encrypted sensitive data

### Payment System
- 💳 Stripe Connect integration
- 💳 Escrow management
- 💳 Milestone-based fund release
- 💳 Automatic refunds on project failure
- 💳 Fee calculation (Platform: 5%, Audit: 3%, Stripe: ~2.9% + €0.30)

---

## 📖 Documentation Files

### 1. **FRONTEND_API_DOCUMENTATION.md** (Main Integration Guide)
**Start here!** Complete guide covering:
- Architecture overview
- Firebase setup
- Authentication context
- API client setup
- React Query integration
- Protected routes
- All major features

**Best For**: Understanding the overall system architecture and getting started

---

### 2. **API_ENDPOINTS_REFERENCE.md** (Detailed API Reference)
Complete reference for all endpoints:

#### Authentication & Users
- `completeProfile` - Complete user profile after registration
- `initKYC` - Initialize KYC verification with Sumsub
- `updateProfile` - Update user information
- `GET /users/profile` - Get user profile

#### Projects
- `createProject` - Create new project (draft)
- `GET /projects/search` - Search and filter projects
- `GET /projects/:id` - Get detailed project information
- `updateProject` - Update project information
- `publishProject` - Submit project for review

#### Contributions
- `createContribution` - Initiate contribution with payment
- `confirmPayment` - Confirm successful payment
- `GET /users/me/contributions` - Get user's contribution history

#### Audits
- `acceptAudit` - Auditor accepts audit assignment
- `submitAuditReport` - Submit milestone audit report
- `getAuditorDashboard` - Get auditor dashboard data

#### Notifications
- `getNotifications` - Fetch user notifications
- `markAsRead` - Mark notification as read

**Best For**: Looking up specific endpoint details, request/response formats

---

### 3. **TYPESCRIPT_TYPES_REFERENCE.md** (Complete Type Definitions)
All TypeScript interfaces and types:

- **Global Types**: UserType, Status enums, common interfaces
- **User Types**: UserProfile, CompleteProfileData, UpdateProfileData
- **Project Types**: Project, CreateProjectData, Milestone, ProjectListItem
- **Contribution Types**: Contribution, CreateContributionData, ContributionPortfolio
- **Audit Types**: Audit, AcceptAuditData, AuditorDashboard
- **Notification Types**: Notification, NotificationsList
- **Constants**: API_LIMITS, FEES, PROJECT_CATEGORIES, KYC_LEVELS

**Best For**: Type-safe development, IDE autocomplete, compile-time checks

---

### 4. **QUICK_START_GUIDE.md** (Step-by-Step Implementation)
Practical implementation guide:

- **Prerequisites**: Required packages and setup
- **Environment Setup**: .env configuration
- **Installation**: Dependencies and project structure
- **Authentication Flow**: Complete working examples
- **Common Use Cases**:
  - Display projects list
  - Project details page
  - Contribution flow with Stripe
  - Create project form
- **Testing**: Test accounts and cards
- **Deployment**: Build and launch checklist

**Best For**: Actually building the frontend, copy-paste ready code

---

## 🚀 Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
npm install firebase @stripe/stripe-js @stripe/react-stripe-js @tanstack/react-query
```

### 2. Setup Environment
```bash
# .env.local
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_API_URL=https://europe-west1-your_project.cloudfunctions.net/api
```

### 3. Initialize Firebase
```typescript
// lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

const app = initializeApp({
  // your config
});

export const auth = getAuth(app);
export const functions = getFunctions(app, 'europe-west1');
```

### 4. Create Auth Context
```typescript
// contexts/AuthContext.tsx
// See QUICK_START_GUIDE.md for complete code
```

### 5. Start Building!
```typescript
// Your first API call
import { apiClient } from '@/lib/api-client';

const projects = await apiClient.get('/projects/search?status=live');
```

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                              │
│  (React/Next.js/Vue - Your Choice)                          │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
┌───▼──────┐          ┌──────▼──────┐
│ Firebase │          │  REST API    │
│   Auth   │          │  /api/v2/*   │
└──────────┘          └──────┬───────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
            ┌───────▼────────┐  ┌──────▼────────┐
            │    Firebase     │  │   Firebase    │
            │   Functions     │  │   Firestore   │
            │  (Business      │  │   (Database)  │
            │   Logic)        │  │               │
            └────────┬────────┘  └───────────────┘
                     │
        ┌────────────┼───────────┐
        │            │           │
    ┌───▼────┐  ┌───▼────┐  ┌──▼─────┐
    │ Stripe │  │ Sumsub │  │SendGrid│
    │(Payment)│  │  (KYC)  │  │(Email) │
    └────────┘  └────────┘  └────────┘
```

---

## 🎨 Frontend Framework Support

This backend works with **any** frontend framework:

### React/Next.js
✅ Fully documented with examples
✅ React Query integration examples
✅ TypeScript types provided

### Vue/Nuxt
✅ Use same API endpoints
✅ Adapt Firebase integration
✅ Use Pinia instead of React Query

### Angular
✅ Use HttpClient for API calls
✅ RxJS for reactive patterns
✅ Convert types to interfaces

### Svelte/SvelteKit
✅ Use fetch API
✅ Svelte stores for state
✅ SSR-compatible

---

## 🔑 Key Concepts

### 1. Authentication Flow
```
Sign Up → Complete Profile → KYC Verification → Full Access
```

### 2. Project Lifecycle
```
Draft → Submit for Review → Approved → Published → Funding → Active → Completed
```

### 3. Contribution Flow
```
Select Amount → Enter Payment → Create PaymentIntent → Confirm with Stripe → Funds Held in Escrow
```

### 4. Milestone & Audit Flow
```
Creator Submits Milestone → Auditor Reviews → Audit Approved → Funds Released
```

### 5. User Types
- **Contributor**: Can contribute to projects
- **Creator**: Can create and manage projects
- **Auditor**: Can audit milestone completions
- **Admin**: Full system access

---

## 💰 Financial Configuration

### Contribution Limits
| KYC Level | Per Contribution | Daily Limit | Monthly Limit |
|-----------|-----------------|-------------|---------------|
| **None** | €0 | €0 | €0 |
| **Basic** | €1,000 | €1,000 | €10,000 |
| **Enhanced** | €100,000 | No limit | €100,000 |

### Project Limits
- **Minimum Goal**: €1,000
- **Maximum Goal**: €50,000
- **Campaign Duration**: 30-90 days
- **Max Active Projects per Creator**: 3

### Fee Structure
- **Platform Fee**: 5% of contribution
- **Audit Fee**: 3% of contribution (for projects requiring audit)
- **Stripe Fee**: ~2.9% + €0.30 per transaction

### Example: €100 Contribution
```
Contribution:      €100.00
Platform Fee:      €  5.00 (5%)
Audit Fee:         €  3.00 (3%)
Stripe Fee:        €  3.20 (2.9% + €0.30)
────────────────────────────
Total Charged:     €111.20
Net to Project:    € 91.80
```

---

## 🔒 Security Features

### Authentication
- Firebase Auth with JWT tokens
- Custom claims for role-based access
- Session management
- Secure token refresh

### Payment Security
- PCI DSS compliant (via Stripe)
- No card data stored on servers
- 3D Secure support
- Fraud detection

### Data Protection
- Encrypted sensitive fields
- GDPR compliance
- Data retention policies
- Audit trails

### API Security
- Rate limiting
- CORS protection
- Input validation
- SQL injection prevention
- XSS protection

---

## 📊 Data Models

### User Profile
```typescript
{
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: 'contributor' | 'creator' | 'auditor';
  profileComplete: boolean;
  kyc: {
    status: 'pending' | 'approved' | 'rejected';
    level: 0 | 1 | 2;
  };
  stats: {
    totalContributed: number;
    projectsSupported: number;
    projectsCreated: number;
  };
}
```

### Project
```typescript
{
  id: string;
  title: string;
  description: string;
  category: 'environment' | 'education' | 'health' | 'community' | 'innovation';
  status: 'draft' | 'under_review' | 'live' | 'funded' | 'active' | 'completed';
  funding: {
    goal: number;
    raised: number;
    percentage: number;
    contributorsCount: number;
  };
  milestones: Array<{
    title: string;
    status: string;
    fundingPercentage: number;
  }>;
}
```

### Contribution
```typescript
{
  id: string;
  projectId: string;
  amount: {
    gross: number;
    fees: { platform: number; stripe: number; };
    net: number;
  };
  payment: {
    status: 'pending' | 'succeeded' | 'failed';
    paymentIntentId: string;
  };
  escrow: {
    status: 'held' | 'released' | 'refunded';
    releases: Array<{ milestoneId: string; amount: number; }>;
  };
}
```

---

## 🧪 Testing

### Test Accounts (Development)
```typescript
const TEST_USERS = {
  contributor: 'test-contributor@example.com',
  creator: 'test-creator@example.com',
  auditor: 'test-auditor@example.com',
};
```

### Test Cards (Stripe)
```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
3D Secure: 4000 0025 0000 3155
```

---

## 🐛 Error Handling

### Common Error Codes
```typescript
AUTH_REQUIRED           // User not authenticated
KYC_REQUIRED           // KYC verification needed
INSUFFICIENT_PERMISSIONS // User lacks required role
VALIDATION_ERROR       // Invalid input data
QUOTA_EXCEEDED         // Limit reached (daily/monthly)
PROJECT_NOT_LIVE       // Project not accepting contributions
STRIPE_ERROR           // Payment processing failed
INTERNAL_ERROR         // Server error
```

### Error Response Format
```typescript
{
  success: false,
  error: {
    code: 'KYC_REQUIRED',
    message: 'KYC verification required to contribute',
    details: { requiredLevel: 'basic' }
  },
  timestamp: '2024-01-15T10:30:00Z'
}
```

---

## 📱 Responsive Design Considerations

### Mobile-First Approach
- Touch-friendly buttons (min 44x44px)
- Readable font sizes (16px+ for body)
- Simplified navigation
- Progressive enhancement

### Key Breakpoints
```scss
$mobile: 320px;
$tablet: 768px;
$desktop: 1024px;
$wide: 1440px;
```

### Performance
- Lazy load images
- Code splitting
- API response caching
- Optimistic UI updates

---

## 🌍 Internationalization

### Supported Languages
- **French (fr)**: Primary language
- **English (en)**: Secondary language

### Implementation
```typescript
const translations = {
  fr: {
    'project.contribute': 'Contribuer',
    'project.goal': 'Objectif',
  },
  en: {
    'project.contribute': 'Contribute',
    'project.goal': 'Goal',
  },
};
```

---

## 📈 Analytics & Tracking

### Key Events to Track
```typescript
// User Events
'user_registered'
'profile_completed'
'kyc_completed'

// Project Events
'project_created'
'project_published'
'project_viewed'

// Contribution Events
'contribute_clicked'
'payment_started'
'payment_completed'

// Engagement Events
'milestone_viewed'
'creator_profile_viewed'
'notification_clicked'
```

---

## 🚦 Status Indicators

### Project Status Colors
```scss
$draft: #6B7280;        // Gray
$review: #F59E0B;       // Orange
$live: #10B981;         // Green
$funded: #3B82F6;       // Blue
$active: #8B5CF6;       // Purple
$completed: #059669;    // Dark Green
$failed: #EF4444;       // Red
```

### KYC Status Badges
```scss
$pending: #F59E0B;      // Orange
$approved: #10B981;     // Green
$rejected: #EF4444;     // Red
$action: #3B82F6;       // Blue
```

---

## 🎯 Best Practices

### API Calls
✅ Use React Query for caching
✅ Implement retry logic
✅ Show loading states
✅ Handle errors gracefully
✅ Use optimistic updates

### Security
✅ Never expose secret keys
✅ Validate all user input
✅ Sanitize displayed data
✅ Use HTTPS only
✅ Implement CSP headers

### Performance
✅ Lazy load routes
✅ Optimize images
✅ Minimize bundle size
✅ Use CDN for static assets
✅ Enable gzip compression

### UX/UI
✅ Provide clear feedback
✅ Use consistent design
✅ Accessibility (WCAG 2.1)
✅ Mobile-responsive
✅ Fast load times (<3s)

---

## 📞 Support & Resources

### Documentation Files
1. `FRONTEND_API_DOCUMENTATION.md` - Main integration guide
2. `API_ENDPOINTS_REFERENCE.md` - Detailed API reference
3. `TYPESCRIPT_TYPES_REFERENCE.md` - Complete type definitions
4. `QUICK_START_GUIDE.md` - Step-by-step implementation

### External Resources
- [Firebase Documentation](https://firebase.google.com/docs)
- [Stripe Documentation](https://stripe.com/docs)
- [React Query](https://tanstack.com/query/latest)
- [Next.js Documentation](https://nextjs.org/docs)

---

## ✅ Pre-Launch Checklist

### Development
- [ ] All Firebase services configured
- [ ] Environment variables set
- [ ] API client working
- [ ] Authentication flow complete
- [ ] Test accounts working

### Features
- [ ] User registration & profile
- [ ] KYC verification flow
- [ ] Project creation
- [ ] Project browsing/search
- [ ] Contribution flow with Stripe
- [ ] Milestone display
- [ ] Notifications

### Testing
- [ ] Unit tests for components
- [ ] Integration tests for flows
- [ ] E2E tests for critical paths
- [ ] Cross-browser testing
- [ ] Mobile responsiveness
- [ ] Accessibility audit

### Security
- [ ] No secrets in code
- [ ] HTTPS enforced
- [ ] CORS configured
- [ ] Rate limiting tested
- [ ] Input validation everywhere

### Performance
- [ ] Lighthouse score >90
- [ ] First paint <1.5s
- [ ] Time to interactive <3s
- [ ] Bundle size optimized
- [ ] Images optimized

### Legal/Compliance
- [ ] Privacy policy
- [ ] Terms of service
- [ ] Cookie consent
- [ ] GDPR compliance
- [ ] Data retention policy

---

## 🎉 You're Ready to Build!

All backend systems are **production-ready** and **fully documented**. The API is secure, scalable, and feature-complete.

**Start with**: `QUICK_START_GUIDE.md` for hands-on implementation

**Reference**: Other docs as needed for specific features

**Questions?** All endpoints are documented with examples and types

---

**Built with** ❤️ **for social impact**
