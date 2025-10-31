# API Endpoints Reference - Social Impact Platform

Complete reference for all REST API endpoints and Firebase Callable Functions.

---

## Base URLs

- **Production**: `https://europe-west1-YOUR_PROJECT_ID.cloudfunctions.net/api`
- **API Version**: `v2`
- **Full Endpoint**: `{BASE_URL}/v2/{endpoint}`

---

## Authentication

All authenticated endpoints require a Firebase ID Token in the Authorization header:

```http
Authorization: Bearer {FIREBASE_ID_TOKEN}
```

Get the token:
```typescript
const token = await firebase.auth().currentUser.getIdToken();
```

---

## Table of Contents

1. [Authentication & User Management](#1-authentication--user-management)
2. [Projects](#2-projects)
3. [Contributions](#3-contributions)
4. [Audits](#4-audits)
5. [Notifications](#5-notifications)
6. [System](#6-system)

---

## 1. Authentication & User Management

### 1.1. Complete Profile

**Firebase Function**: `completeProfile`

**Description**: Complete user profile after initial registration.

**Request**:
```typescript
interface CompleteProfileRequest {
  userType: 'contributor' | 'creator';
  firstName: string;
  lastName: string;
  phoneNumber?: string; // Format: +33612345678
  dateOfBirth: string; // Format: YYYY-MM-DD, must be 18+
  address: {
    street: string;
    city: string;
    postalCode: string;
    country: string; // ISO 3166-1 alpha-2 (FR, BE, etc.)
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  preferences: {
    language: 'fr' | 'en';
    currency: 'EUR';
    notifications: {
      email: boolean;
      push: boolean;
      inApp: boolean;
    };
    interestedCategories: Array<'environment' | 'education' | 'health' | 'community' | 'innovation'>;
  };
}
```

**Response**:
```typescript
interface CompleteProfileResponse {
  userId: string;
  profileComplete: boolean;
  kycRequired: boolean;
  nextStep: string; // 'kyc_verification' | 'profile_ready'
}
```

**Example**:
```typescript
import { firebaseFunctions } from '@/lib/functions';

const completeProfile = async () => {
  try {
    const result = await firebaseFunctions.completeProfile({
      userType: 'contributor',
      firstName: 'Jean',
      lastName: 'Dupont',
      phoneNumber: '+33612345678',
      dateOfBirth: '1990-01-15',
      address: {
        street: '123 Rue de la Paix',
        city: 'Paris',
        postalCode: '75001',
        country: 'FR',
      },
      preferences: {
        language: 'fr',
        currency: 'EUR',
        notifications: {
          email: true,
          push: true,
          inApp: true,
        },
        interestedCategories: ['environment', 'education'],
      },
    });

    console.log('Profile completed:', result);
    // Navigate to KYC if required
    if (result.kycRequired) {
      router.push('/onboarding/kyc');
    }
  } catch (error) {
    console.error('Error completing profile:', error);
  }
};
```

**Errors**:
- `already-exists`: Profile already complete
- `invalid-argument`: Invalid data (check validation)
- `failed-precondition`: Email not verified

---

### 1.2. Initialize KYC

**Firebase Function**: `initKYC`

**Description**: Initialize KYC verification with Sumsub.

**Request**:
```typescript
interface InitKYCRequest {
  kycLevel: 'basic' | 'enhanced';
}
```

**Response**:
```typescript
interface InitKYCResponse {
  sumsubToken: string; // Use with Sumsub SDK
  sumsubUrl: string; // Direct URL for Sumsub verification
  externalUserId: string;
  levelName: string;
  expiresAt: string; // ISO timestamp
}
```

**Example**:
```typescript
import { firebaseFunctions } from '@/lib/functions';
import SumsubWebSdk from '@sumsub/websdk-react';

const initializeKYC = async () => {
  try {
    const result = await firebaseFunctions.initKYC({
      kycLevel: 'basic',
    });

    // Initialize Sumsub SDK
    const sumsub = SumsubWebSdk({
      accessToken: result.sumsubToken,
      expirationHandler: () => renewKYCToken(),
      onMessage: (type, payload) => {
        console.log('Sumsub message:', type, payload);
      },
      onError: (error) => {
        console.error('Sumsub error:', error);
      },
    });

    sumsub.launch('#sumsub-container');
  } catch (error) {
    console.error('Error initializing KYC:', error);
  }
};

const renewKYCToken = async () => {
  const result = await firebaseFunctions.initKYC({ kycLevel: 'basic' });
  return result.sumsubToken;
};
```

**KYC Levels**:
- **Basic**: Max contribution €1,000 - Requires ID + Selfie
- **Enhanced**: Max contribution €100,000 - Requires ID + Proof of Address + Manual Review

---

### 1.3. Update Profile

**Firebase Function**: `updateProfile`

**Description**: Update user profile information.

**Request**:
```typescript
interface UpdateProfileRequest {
  profilePicture?: string; // URL to uploaded image
  bio?: string; // Max 500 characters
  preferences?: {
    notifications?: {
      email?: boolean;
      push?: boolean;
      inApp?: boolean;
    };
    interestedCategories?: Array<ProjectCategory>;
  };
  address?: {
    city?: string;
    country?: string;
  };
}
```

**Response**:
```typescript
interface UpdateProfileResponse {
  updated: boolean;
  profilePictureUrl?: string;
}
```

---

### 1.4. Get User Profile

**REST Endpoint**: `GET /v2/users/profile`

**Authentication**: Required

**Response**:
```typescript
interface ProfileResponse {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: 'contributor' | 'creator' | 'auditor' | 'admin';
  profilePicture?: string;
  kyc: {
    status: 'pending' | 'approved' | 'rejected' | 'requires_action';
    level: 0 | 1 | 2;
    verifiedAt?: string;
    documents: Array<{
      type: string;
      status: string;
      submittedAt: string;
    }>;
  };
  stats: {
    totalContributed: number; // in cents
    projectsSupported: number;
    projectsCreated: number;
    auditsCompleted: number;
  };
  preferences: any;
  createdAt: string;
  lastLoginAt: string;
}
```

**Example**:
```typescript
import { apiClient } from '@/lib/api-client';

const fetchProfile = async () => {
  try {
    const profile = await apiClient.get<ProfileResponse>('/users/profile');
    console.log('User profile:', profile);
  } catch (error) {
    console.error('Error fetching profile:', error);
  }
};
```

---

## 2. Projects

### 2.1. Create Project

**Firebase Function**: `createProject`

**Description**: Create a new project (draft status).

**Request**:
```typescript
interface CreateProjectRequest {
  title: string; // 3-100 characters
  shortDescription: string; // 10-200 characters
  description: string; // 10-2000 characters (full description)
  category: 'environment' | 'education' | 'health' | 'community' | 'innovation';
  tags: string[]; // 1-10 tags, max 30 chars each

  impactGoals: {
    primary: string; // Primary impact goal
    secondary?: string[]; // Optional secondary goals
    metrics: Array<{
      name: string; // e.g., "Trees Planted"
      target: number; // e.g., 1000
      unit: string; // e.g., "trees"
      description?: string;
    }>;
  };

  funding: {
    goal: number; // Amount in cents (min: €10, max: €50,000)
    currency: 'EUR';
    deadline: string; // ISO date, max 90 days from now
    minContribution?: number; // Min amount in cents
  };

  milestones: Array<{
    title: string;
    description: string;
    targetDate: string; // ISO date
    fundingPercentage: number; // Must sum to 100%
    deliverables: string[]; // List of deliverables
  }>;

  media: {
    coverImage: string; // URL to uploaded image
    gallery?: string[]; // Array of image URLs
    video?: string; // Video URL (YouTube, Vimeo, etc.)
    documents?: Array<{
      name: string;
      url: string;
      type: 'pdf' | 'doc' | 'image' | 'other';
      size?: number; // in bytes
    }>;
  };

  location: {
    country: string; // ISO country code
    region?: string;
    city?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };

  team: Array<{
    name: string;
    role: string;
    bio?: string;
    avatar?: string; // URL
    linkedin?: string; // URL
  }>;

  settings?: {
    allowPublicComments?: boolean; // default: true
    requireIdentityVerification?: boolean; // default: false
    autoApproveContributions?: boolean; // default: true
    notifyOnMilestone?: boolean; // default: true
    visibility?: 'public' | 'private'; // default: 'public'
  };
}
```

**Response**:
```typescript
interface CreateProjectResponse {
  projectId: string;
  slug: string; // URL-friendly identifier
  status: 'draft';
  auditRequired: boolean;
  estimatedDuration: number; // days
  riskLevel: 'low' | 'medium' | 'high';
  nextSteps: string[]; // Array of next required actions
}
```

**Example**:
```typescript
import { firebaseFunctions } from '@/lib/functions';

const createNewProject = async () => {
  try {
    const result = await firebaseFunctions.createProject({
      title: 'Reforestation Project in Amazon',
      shortDescription: 'Plant 10,000 trees in the Amazon rainforest',
      description: `Long detailed description of the project...

        Goals:
        - Plant 10,000 native trees
        - Restore 100 hectares of forest
        - Create jobs for local communities

        Impact:
        - Absorb 500 tons of CO2 annually
        - Protect biodiversity
        - Support indigenous communities`,
      category: 'environment',
      tags: ['reforestation', 'amazon', 'climate', 'biodiversity'],

      impactGoals: {
        primary: 'Restore degraded Amazon rainforest land',
        metrics: [
          {
            name: 'Trees Planted',
            target: 10000,
            unit: 'trees',
            description: 'Native species including Brazil nut, mahogany, and rubber trees',
          },
          {
            name: 'Hectares Restored',
            target: 100,
            unit: 'hectares',
          },
          {
            name: 'CO2 Absorbed',
            target: 500,
            unit: 'tons/year',
          },
        ],
      },

      funding: {
        goal: 5000000, // €50,000
        currency: 'EUR',
        deadline: '2024-12-31T23:59:59Z',
        minContribution: 1000, // €10 minimum
      },

      milestones: [
        {
          title: 'Land Preparation and Planning',
          description: 'Clear invasive species, prepare soil, map planting areas',
          targetDate: '2024-03-31T23:59:59Z',
          fundingPercentage: 20,
          deliverables: [
            'Detailed land survey report',
            'Soil analysis results',
            'Planting schedule',
          ],
        },
        {
          title: 'Seedling Procurement',
          description: 'Source and transport 10,000 native seedlings',
          targetDate: '2024-06-30T23:59:59Z',
          fundingPercentage: 30,
          deliverables: [
            'Seedling quality certificates',
            'Transportation logs',
            'Storage facility setup',
          ],
        },
        {
          title: 'Tree Planting',
          description: 'Plant all 10,000 trees with community involvement',
          targetDate: '2024-09-30T23:59:59Z',
          fundingPercentage: 30,
          deliverables: [
            'Planting completion report',
            'GPS coordinates of planted areas',
            'Photo documentation',
          ],
        },
        {
          title: 'Monitoring and Maintenance',
          description: '6-month follow-up care and survival rate assessment',
          targetDate: '2024-12-31T23:59:59Z',
          fundingPercentage: 20,
          deliverables: [
            'Survival rate report',
            'Growth measurements',
            'Impact assessment',
          ],
        },
      ],

      media: {
        coverImage: 'https://storage.example.com/projects/cover.jpg',
        gallery: [
          'https://storage.example.com/projects/gallery1.jpg',
          'https://storage.example.com/projects/gallery2.jpg',
        ],
        video: 'https://youtube.com/watch?v=example',
        documents: [
          {
            name: 'Project Proposal.pdf',
            url: 'https://storage.example.com/documents/proposal.pdf',
            type: 'pdf',
            size: 2048000, // 2MB
          },
        ],
      },

      location: {
        country: 'BR',
        region: 'Amazonas',
        city: 'Manaus',
        coordinates: {
          lat: -3.119027,
          lng: -60.021731,
        },
      },

      team: [
        {
          name: 'Maria Silva',
          role: 'Project Lead',
          bio: 'Environmental scientist with 10 years experience in reforestation',
          avatar: 'https://storage.example.com/avatars/maria.jpg',
          linkedin: 'https://linkedin.com/in/mariasilva',
        },
        {
          name: 'João Santos',
          role: 'Field Coordinator',
          bio: 'Local community leader and agronomist',
        },
      ],

      settings: {
        allowPublicComments: true,
        requireIdentityVerification: false,
        autoApproveContributions: true,
        notifyOnMilestone: true,
        visibility: 'public',
      },
    });

    console.log('Project created:', result);
    // Navigate to project page
    router.push(`/projects/${result.slug}`);
  } catch (error) {
    console.error('Error creating project:', error);
  }
};
```

**Validation Rules**:
- Milestones funding percentages must sum to 100%
- All milestone dates must be before or on funding deadline
- Funding goal: €10 - €50,000
- Campaign duration: 30-90 days
- At least 1 team member required
- At least 1 milestone required (max 5)
- At least 1 impact metric required

---

### 2.2. Search Projects

**REST Endpoint**: `GET /v2/projects/search`

**Authentication**: Optional (required for personalized results)

**Query Parameters**:
```typescript
interface SearchParams {
  query?: string; // Search in title and description
  category?: 'environment' | 'education' | 'health' | 'community' | 'innovation';
  status?: 'live' | 'funded' | 'active' | 'completed';
  minFunding?: number; // in cents
  maxFunding?: number; // in cents
  location?: string; // ISO country code
  sortBy?: 'recent' | 'popular' | 'ending_soon' | 'funding_progress';
  limit?: number; // default: 20, max: 100
  offset?: number; // for pagination
}
```

**Response**:
```typescript
interface ProjectListResponse {
  data: Array<{
    id: string;
    title: string;
    shortDescription: string;
    category: string;
    coverImageUrl: string;
    creator: {
      uid: string;
      displayName: string;
      profilePicture?: string;
    };
    funding: {
      goal: number;
      raised: number;
      percentage: number;
      contributorsCount: number;
    };
    status: string;
    endDate: string;
    createdAt: string;
    metrics: {
      views: number;
      saves: number;
    };
  }>;
  total: number;
  hasMore: boolean;
  nextPageToken?: string;
}
```

**Example**:
```typescript
import { apiClient } from '@/lib/api-client';

const searchProjects = async () => {
  try {
    const params = new URLSearchParams({
      category: 'environment',
      status: 'live',
      sortBy: 'ending_soon',
      limit: '20',
    });

    const response = await apiClient.get<ProjectListResponse>(
      `/projects/search?${params}`
    );

    console.log('Found projects:', response.data);
    console.log('Total:', response.total);
  } catch (error) {
    console.error('Error searching projects:', error);
  }
};
```

---

### 2.3. Get Project Details

**REST Endpoint**: `GET /v2/projects/:projectId`

**Authentication**: Optional (required for full details if private)

**Response**:
```typescript
interface ProjectDetailsResponse {
  id: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
  category: string;
  status: string;

  creator: {
    uid: string;
    displayName: string;
    profilePicture?: string;
    bio?: string;
    stats: {
      projectsCreated: number;
      successRate: number;
    };
  };

  funding: {
    goal: number;
    raised: number;
    percentage: number;
    contributorsCount: number;
    platformFee: number;
    auditFee: number;
  };

  timeline: {
    createdAt: string;
    publishedAt?: string;
    endDate: string;
    daysRemaining: number;
  };

  milestones: Array<{
    id: string;
    title: string;
    description: string;
    budgetPercentage: number;
    status: string;
    dueDate: string;
    submittedAt?: string;
    audit?: {
      auditorName: string;
      status: string;
      completedAt?: string;
    };
  }>;

  impactMetrics: {
    beneficiariesCount: number;
    targetAudience: string;
    actualImpact?: any;
  };

  media: {
    coverImageUrl: string;
    additionalImages: string[];
    documents: Array<{
      name: string;
      type: string;
      url: string;
      downloadable: boolean;
    }>;
  };

  userInteraction: {
    hasContributed: boolean;
    contributionAmount?: number;
    isSaved: boolean;
    canContribute: boolean;
  };
}
```

**Example**:
```typescript
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

function ProjectDetails({ projectId }: { projectId: string }) {
  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => apiClient.get<ProjectDetailsResponse>(`/projects/${projectId}`),
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading project</div>;
  if (!project) return null;

  return (
    <div>
      <h1>{project.title}</h1>
      <p>{project.fullDescription}</p>

      <div className="funding">
        <div>Goal: €{project.funding.goal / 100}</div>
        <div>Raised: €{project.funding.raised / 100}</div>
        <div>Progress: {project.funding.percentage}%</div>
        <div>Contributors: {project.funding.contributorsCount}</div>
      </div>

      <div className="milestones">
        {project.milestones.map((milestone) => (
          <div key={milestone.id}>
            <h3>{milestone.title}</h3>
            <p>{milestone.description}</p>
            <span>Status: {milestone.status}</span>
          </div>
        ))}
      </div>

      {project.userInteraction.canContribute && (
        <button onClick={() => contributeToProject(projectId)}>
          Contribute Now
        </button>
      )}
    </div>
  );
}
```

---

### 2.4. Update Project

**Firebase Function**: `updateProject`

**Description**: Update draft or active project (creator only).

**Request**:
```typescript
interface UpdateProjectRequest {
  projectId: string;
  // Any field from CreateProjectRequest
  title?: string;
  description?: string;
  media?: any;
  // ... etc
}
```

**Restrictions**:
- Cannot change funding goal once project is live
- Cannot change milestones once contributions exist
- Requires creator authorization

---

### 2.5. Publish Project

**Firebase Function**: `publishProject`

**Description**: Submit project for review and publication.

**Request**:
```typescript
interface PublishProjectRequest {
  projectId: string;
}
```

**Response**:
```typescript
interface PublishProjectResponse {
  status: 'under_review' | 'published';
  submittedAt: string;
  estimatedDecision: string; // e.g., "2-3 business days"
  reviewQueue: number;
}
```

**Requirements Before Publishing**:
- Profile must be complete
- KYC must be approved
- All required fields filled
- At least one milestone
- Cover image uploaded
- Team information complete

---

## 3. Contributions

### 3.1. Create Contribution

**Firebase Function**: `createContribution`

**Description**: Initiate a contribution to a project (creates Stripe PaymentIntent).

**Request**:
```typescript
interface CreateContributionRequest {
  projectId: string;
  amount: number; // Amount in cents (min: €10, max: €1,000)
  message?: string; // Optional message to creator (max 500 chars)
  anonymous: boolean; // Hide contributor name
  paymentMethod: {
    type: 'card';
    source: 'form' | 'saved'; // 'form' for new card, 'saved' for saved payment method
    savedPaymentMethodId?: string; // Required if source is 'saved'
  };
}
```

**Response**:
```typescript
interface CreateContributionResponse {
  contributionId: string;
  paymentIntent: {
    id: string;
    clientSecret: string; // Use with Stripe.js
    amount: number;
    currency: string;
  };
  fees: {
    platformFee: number; // 5% of amount
    stripeFee: number; // ~2.9% + €0.30
    total: number;
  };
  escrow: {
    holdUntil: string; // ISO date
    releaseConditions: string[];
  };
}
```

**Example**:
```typescript
import { firebaseFunctions } from '@/lib/functions';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function ContributionForm({ projectId }: { projectId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setProcessing(true);

    try {
      // Step 1: Create contribution and get PaymentIntent
      const contribution = await firebaseFunctions.createContribution({
        projectId,
        amount: 5000, // €50
        message: 'Great project! Keep up the good work.',
        anonymous: false,
        paymentMethod: {
          type: 'card',
          source: 'form',
        },
      });

      console.log('Contribution created:', contribution);
      console.log('Fees breakdown:', contribution.fees);

      // Step 2: Confirm payment with Stripe
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error, paymentIntent } = await stripe.confirmCardPayment(
        contribution.paymentIntent.clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: 'Jean Dupont',
              email: 'jean@example.com',
            },
          },
        }
      );

      if (error) {
        console.error('Payment failed:', error);
        alert(`Payment failed: ${error.message}`);
      } else if (paymentIntent?.status === 'succeeded') {
        console.log('Payment succeeded:', paymentIntent);

        // Step 3: Confirm payment in backend
        await firebaseFunctions.confirmPayment({
          paymentIntentId: paymentIntent.id,
          stripeClientSecret: contribution.paymentIntent.clientSecret,
        });

        alert('Contribution successful! Thank you for your support.');
        router.push(`/contributions/${contribution.contributionId}/receipt`);
      }
    } catch (error) {
      console.error('Error creating contribution:', error);
      alert('Failed to create contribution');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Contribute to Project</h2>

      <div>
        <label>Amount: €50.00</label>
        <div>Platform Fee: €2.50 (5%)</div>
        <div>Payment Fee: €1.75</div>
        <div>Total: €54.25</div>
      </div>

      <div>
        <label>Card Details</label>
        <CardElement options={{
          style: {
            base: {
              fontSize: '16px',
              color: '#424770',
              '::placeholder': {
                color: '#aab7c4',
              },
            },
            invalid: {
              color: '#9e2146',
            },
          },
        }} />
      </div>

      <div>
        <label>
          <input type="checkbox" />
          Make this contribution anonymous
        </label>
      </div>

      <div>
        <label>Message to Creator (Optional)</label>
        <textarea maxLength={500} />
      </div>

      <button type="submit" disabled={!stripe || processing}>
        {processing ? 'Processing...' : 'Contribute €50'}
      </button>
    </form>
  );
}

// Wrap component with Stripe Elements
function ContributePage({ projectId }: { projectId: string }) {
  return (
    <Elements stripe={stripePromise}>
      <ContributionForm projectId={projectId} />
    </Elements>
  );
}
```

**Contribution Limits**:
- **Minimum**: €10 per contribution
- **Maximum per contribution**: €1,000 (basic KYC) or €100,000 (enhanced KYC)
- **Daily limit**: Varies by user KYC level
- **Monthly limit**: €1,000 (basic) / €100,000 (enhanced)

**Escrow System**:
- All contributions are held in escrow
- Funds released milestone-by-milestone after audit approval
- Automatic refund if project fails or is cancelled

---

### 3.2. Confirm Payment

**Firebase Function**: `confirmPayment`

**Description**: Confirm successful payment (called after Stripe confirmation).

**Request**:
```typescript
interface ConfirmPaymentRequest {
  paymentIntentId: string;
  stripeClientSecret: string;
}
```

**Response**:
```typescript
interface ConfirmPaymentResponse {
  status: 'succeeded';
  receiptUrl: string;
  transactionId: string;
  escrowDetails: {
    amount: number;
    heldUntil: string;
    releaseSchedule: Array<{
      milestoneId: string;
      amount: number;
      conditions: string;
    }>;
  };
}
```

---

### 3.3. Get User Contributions

**REST Endpoint**: `GET /v2/users/me/contributions`

**Authentication**: Required

**Query Parameters**:
```typescript
interface ContributionsParams {
  status?: 'pending' | 'confirmed' | 'refunded';
  limit?: number;
  offset?: number;
}
```

**Response**:
```typescript
interface ContributionPortfolioResponse {
  summary: {
    totalInvested: number;
    activeContributions: number;
    completedProjects: number;
    totalImpact: {
      beneficiariesHelped: number;
      projectsSupported: number;
    };
  };
  contributions: Array<{
    id: string;
    amount: number;
    date: string;
    status: string;
    project: {
      id: string;
      title: string;
      coverImage: string;
      status: string;
      progress: {
        milestonesCompleted: number;
        totalMilestones: number;
        percentageComplete: number;
      };
    };
    returns: {
      expectedImpact: string;
      actualImpact?: string;
    };
  }>;
}
```

**Example**:
```typescript
import { apiClient } from '@/lib/api-client';
import { useQuery } from '@tanstack/react-query';

function MyContributions() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-contributions'],
    queryFn: () => apiClient.get<ContributionPortfolioResponse>('/users/me/contributions'),
  });

  if (isLoading) return <div>Loading...</div>;
  if (!data) return null;

  return (
    <div>
      <h1>My Contributions</h1>

      <div className="summary">
        <div>Total Invested: €{data.summary.totalInvested / 100}</div>
        <div>Active Contributions: {data.summary.activeContributions}</div>
        <div>Completed Projects: {data.summary.completedProjects}</div>
        <div>People Helped: {data.summary.totalImpact.beneficiariesHelped}</div>
      </div>

      <div className="contributions-list">
        {data.contributions.map((contribution) => (
          <div key={contribution.id} className="contribution-card">
            <img src={contribution.project.coverImage} alt={contribution.project.title} />
            <h3>{contribution.project.title}</h3>
            <p>Amount: €{contribution.amount / 100}</p>
            <p>Status: {contribution.status}</p>
            <div className="progress">
              Progress: {contribution.project.progress.milestonesCompleted}/
              {contribution.project.progress.totalMilestones} milestones
              ({contribution.project.progress.percentageComplete}%)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

*Continue to sections 4, 5, and 6...*
