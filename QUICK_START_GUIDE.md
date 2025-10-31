# Quick Start Guide - Social Impact Platform Frontend

Step-by-step guide to integrate your frontend with the Social Impact Platform backend.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Installation](#installation)
4. [Authentication Flow](#authentication-flow)
5. [Common Use Cases](#common-use-cases)
6. [Complete Examples](#complete-examples)
7. [Testing](#testing)
8. [Deployment](#deployment)

---

## Prerequisites

- Node.js 18+ and npm/yarn
- Firebase project credentials
- Stripe account and API keys
- Sumsub account for KYC (optional for development)

---

## Environment Setup

### 1. Environment Variables

Create `.env.local` file:

```bash
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef

# API Configuration
NEXT_PUBLIC_API_URL=https://europe-west1-your_project.cloudfunctions.net/api
NEXT_PUBLIC_API_VERSION=v2

# Stripe Configuration
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Sumsub Configuration (optional)
NEXT_PUBLIC_SUMSUB_APP_TOKEN=your_sumsub_token

# Environment
NEXT_PUBLIC_ENV=development
```

---

## Installation

### 1. Install Dependencies

```bash
npm install firebase
npm install @stripe/stripe-js @stripe/react-stripe-js
npm install @tanstack/react-query
npm install @sumsub/websdk-react
npm install axios
npm install date-fns
npm install zod # for validation
```

### 2. Project Structure

```
src/
├── lib/
│   ├── firebase.ts           # Firebase initialization
│   ├── api-client.ts         # API client
│   ├── functions.ts          # Firebase Functions wrappers
│   └── queries.ts            # React Query hooks
├── contexts/
│   ├── AuthContext.tsx       # Auth provider
│   └── ToastContext.tsx      # Notifications
├── components/
│   ├── auth/
│   ├── projects/
│   ├── contributions/
│   └── common/
├── hooks/
│   ├── useAuth.ts
│   ├── useProjects.ts
│   └── useContributions.ts
├── types/
│   ├── global.ts
│   ├── user.ts
│   ├── project.ts
│   └── contribution.ts
└── utils/
    ├── formatting.ts
    ├── validation.ts
    └── constants.ts
```

---

## Authentication Flow

### Complete Authentication Implementation

```typescript
// pages/_app.tsx
import { AuthProvider } from '@/contexts/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Component {...pageProps} />
        <Toaster position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default MyApp;
```

```typescript
// pages/login.tsx
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/router';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await signIn(email, password);
      router.push('/dashboard');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Loading...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
```

```typescript
// pages/onboarding/complete-profile.tsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { firebaseFunctions } from '@/lib/functions';
import { CompleteProfileData } from '@/types/user';

export default function CompleteProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CompleteProfileData>({
    userType: 'contributor',
    firstName: '',
    lastName: '',
    phoneNumber: '',
    dateOfBirth: '',
    address: {
      street: '',
      city: '',
      postalCode: '',
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
      interestedCategories: [],
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await firebaseFunctions.completeProfile(formData);

      if (result.kycRequired) {
        router.push('/onboarding/kyc');
      } else {
        router.push('/dashboard');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="complete-profile-page">
      <h1>Complete Your Profile</h1>
      <form onSubmit={handleSubmit}>
        {/* User Type Selection */}
        <div>
          <label>I am a:</label>
          <select
            value={formData.userType}
            onChange={(e) => setFormData({ ...formData, userType: e.target.value as any })}
          >
            <option value="contributor">Contributor</option>
            <option value="creator">Project Creator</option>
          </select>
        </div>

        {/* Personal Information */}
        <div>
          <input
            type="text"
            placeholder="First Name"
            value={formData.firstName}
            onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Last Name"
            value={formData.lastName}
            onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            required
          />
          <input
            type="tel"
            placeholder="Phone Number (+33...)"
            value={formData.phoneNumber}
            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
          />
          <input
            type="date"
            placeholder="Date of Birth"
            value={formData.dateOfBirth}
            onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
            required
          />
        </div>

        {/* Address */}
        <div>
          <h3>Address</h3>
          <input
            type="text"
            placeholder="Street Address"
            value={formData.address.street}
            onChange={(e) =>
              setFormData({
                ...formData,
                address: { ...formData.address, street: e.target.value },
              })
            }
            required
          />
          <input
            type="text"
            placeholder="City"
            value={formData.address.city}
            onChange={(e) =>
              setFormData({
                ...formData,
                address: { ...formData.address, city: e.target.value },
              })
            }
            required
          />
          <input
            type="text"
            placeholder="Postal Code"
            value={formData.address.postalCode}
            onChange={(e) =>
              setFormData({
                ...formData,
                address: { ...formData.address, postalCode: e.target.value },
              })
            }
            required
          />
          <select
            value={formData.address.country}
            onChange={(e) =>
              setFormData({
                ...formData,
                address: { ...formData.address, country: e.target.value },
              })
            }
            required
          >
            <option value="FR">France</option>
            <option value="BE">Belgium</option>
            <option value="CH">Switzerland</option>
            {/* Add more countries */}
          </select>
        </div>

        {/* Interested Categories */}
        <div>
          <h3>Interested In</h3>
          {['environment', 'education', 'health', 'community', 'innovation'].map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={formData.preferences.interestedCategories.includes(category as any)}
                onChange={(e) => {
                  const categories = e.target.checked
                    ? [...formData.preferences.interestedCategories, category as any]
                    : formData.preferences.interestedCategories.filter((c) => c !== category);

                  setFormData({
                    ...formData,
                    preferences: {
                      ...formData.preferences,
                      interestedCategories: categories,
                    },
                  });
                }}
              />
              {category}
            </label>
          ))}
        </div>

        <button type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Complete Profile'}
        </button>
      </form>
    </div>
  );
}
```

---

## Common Use Cases

### 1. Display Projects List

```typescript
// components/projects/ProjectsList.tsx
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ProjectListItem, ProjectListResponse } from '@/types/project';

interface ProjectsListProps {
  category?: string;
  status?: string;
}

export function ProjectsList({ category, status }: ProjectsListProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects', { category, status }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (status) params.set('status', status);
      params.set('limit', '20');

      return apiClient.get<ProjectListResponse>(`/projects/search?${params}`);
    },
  });

  if (isLoading) return <div>Loading projects...</div>;
  if (error) return <div>Error loading projects</div>;
  if (!data || data.data.length === 0) return <div>No projects found</div>;

  return (
    <div className="projects-grid">
      {data.data.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <div className="project-card">
      <img src={project.coverImageUrl} alt={project.title} />
      <h3>{project.title}</h3>
      <p>{project.shortDescription}</p>

      <div className="funding-progress">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${project.funding.percentage}%` }}
          />
        </div>
        <div className="funding-stats">
          <span>€{project.funding.raised / 100} raised</span>
          <span>of €{project.funding.goal / 100}</span>
        </div>
        <div className="contributors">
          {project.funding.contributorsCount} contributors
        </div>
      </div>

      <div className="project-meta">
        <span className="category">{project.category}</span>
        <span className="status">{project.status}</span>
      </div>

      <a href={`/projects/${project.id}`} className="view-button">
        View Project
      </a>
    </div>
  );
}
```

### 2. Project Details Page

```typescript
// pages/projects/[id].tsx
import { useRouter } from 'next/router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { ProjectDetailsResponse } from '@/types/project';

export default function ProjectDetailsPage() {
  const router = useRouter();
  const { id } = router.query;

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => apiClient.get<ProjectDetailsResponse>(`/projects/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <div>Loading...</div>;
  if (!project) return <div>Project not found</div>;

  return (
    <div className="project-details">
      {/* Header */}
      <div className="project-header">
        <img src={project.media.coverImageUrl} alt={project.title} />
        <h1>{project.title}</h1>
        <p className="category">{project.category}</p>
      </div>

      {/* Funding Section */}
      <div className="funding-section">
        <div className="funding-goal">
          <h2>€{project.funding.raised / 100}</h2>
          <p>raised of €{project.funding.goal / 100} goal</p>
        </div>

        <div className="progress-bar">
          <div
            className="fill"
            style={{ width: `${project.funding.percentage}%` }}
          />
        </div>

        <div className="stats">
          <div>{project.funding.contributorsCount} contributors</div>
          <div>{project.timeline.daysRemaining} days remaining</div>
        </div>

        {project.userInteraction.canContribute && (
          <button
            onClick={() => router.push(`/projects/${id}/contribute`)}
            className="contribute-button"
          >
            Contribute Now
          </button>
        )}
      </div>

      {/* Description */}
      <div className="description">
        <h2>About This Project</h2>
        <p>{project.fullDescription}</p>
      </div>

      {/* Milestones */}
      <div className="milestones">
        <h2>Milestones</h2>
        {project.milestones.map((milestone, index) => (
          <div key={milestone.id} className="milestone">
            <div className="milestone-header">
              <h3>
                {index + 1}. {milestone.title}
              </h3>
              <span className={`status ${milestone.status}`}>
                {milestone.status}
              </span>
            </div>
            <p>{milestone.description}</p>
            <div className="milestone-meta">
              <span>{milestone.budgetPercentage}% of budget</span>
              <span>Due: {new Date(milestone.dueDate).toLocaleDateString()}</span>
            </div>
            {milestone.audit && (
              <div className="audit-info">
                <p>Audited by {milestone.audit.auditorName}</p>
                <p>Status: {milestone.audit.status}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Creator */}
      <div className="creator-section">
        <h2>Created By</h2>
        <div className="creator">
          <img src={project.creator.profilePicture} alt={project.creator.displayName} />
          <div>
            <h3>{project.creator.displayName}</h3>
            <p>{project.creator.bio}</p>
            <div className="creator-stats">
              <span>{project.creator.stats.projectsCreated} projects</span>
              <span>{project.creator.stats.successRate}% success rate</span>
            </div>
          </div>
        </div>
      </div>

      {/* Impact Metrics */}
      <div className="impact-metrics">
        <h2>Expected Impact</h2>
        <div className="metrics">
          <div>
            <strong>{project.impactMetrics.beneficiariesCount}</strong>
            <span>people helped</span>
          </div>
          {/* Add more metrics */}
        </div>
      </div>
    </div>
  );
}
```

### 3. Contribute to Project

```typescript
// pages/projects/[id]/contribute.tsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { firebaseFunctions } from '@/lib/functions';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function ContributeForm({ projectId }: { projectId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();

  const [amount, setAmount] = useState(5000); // €50 in cents
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [loading, setLoading] = useState(false);

  // Calculate fees
  const platformFee = Math.round(amount * 0.05); // 5%
  const stripeFee = Math.round(amount * 0.029) + 30; // 2.9% + €0.30
  const totalFees = platformFee + stripeFee;
  const totalAmount = amount + totalFees;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      alert('Stripe not loaded');
      return;
    }

    setLoading(true);

    try {
      // Step 1: Create contribution
      const contribution = await firebaseFunctions.createContribution({
        projectId,
        amount,
        message,
        anonymous,
        paymentMethod: {
          type: 'card',
          source: 'form',
        },
      });

      console.log('Contribution created:', contribution);

      // Step 2: Confirm payment with Stripe
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error, paymentIntent } = await stripe.confirmCardPayment(
        contribution.paymentIntent.clientSecret,
        {
          payment_method: {
            card: cardElement,
          },
        }
      );

      if (error) {
        throw new Error(error.message);
      }

      if (paymentIntent?.status === 'succeeded') {
        // Step 3: Confirm in backend
        await firebaseFunctions.confirmPayment({
          paymentIntentId: paymentIntent.id,
          stripeClientSecret: contribution.paymentIntent.clientSecret,
        });

        // Success!
        alert('Contribution successful! Thank you for your support.');
        router.push(`/contributions/${contribution.contributionId}/receipt`);
      }
    } catch (error: any) {
      alert('Payment failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="contribute-form">
      <h2>Contribute to Project</h2>

      {/* Amount Selection */}
      <div className="amount-section">
        <label>Contribution Amount</label>
        <div className="preset-amounts">
          {[2000, 5000, 10000, 20000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(preset)}
              className={amount === preset ? 'active' : ''}
            >
              €{preset / 100}
            </button>
          ))}
        </div>

        <input
          type="number"
          min="10"
          max="1000"
          value={amount / 100}
          onChange={(e) => setAmount(parseFloat(e.target.value) * 100)}
          placeholder="Custom amount (€)"
        />
      </div>

      {/* Fee Breakdown */}
      <div className="fee-breakdown">
        <div>
          <span>Contribution</span>
          <span>€{amount / 100}</span>
        </div>
        <div>
          <span>Platform Fee (5%)</span>
          <span>€{platformFee / 100}</span>
        </div>
        <div>
          <span>Payment Processing</span>
          <span>€{stripeFee / 100}</span>
        </div>
        <div className="total">
          <span>Total</span>
          <span>€{totalAmount / 100}</span>
        </div>
      </div>

      {/* Card Details */}
      <div className="card-section">
        <label>Card Details</label>
        <CardElement
          options={{
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
          }}
        />
      </div>

      {/* Message */}
      <div className="message-section">
        <label>Message to Creator (Optional)</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          placeholder="Share your thoughts..."
        />
      </div>

      {/* Anonymous Option */}
      <div className="options">
        <label>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          Make this contribution anonymous
        </label>
      </div>

      <button type="submit" disabled={!stripe || loading}>
        {loading ? 'Processing...' : `Contribute €${totalAmount / 100}`}
      </button>

      <p className="escrow-notice">
        Your contribution will be held in escrow and released milestone-by-milestone
        after independent audit verification.
      </p>
    </form>
  );
}

export default function ContributePage() {
  const router = useRouter();
  const { id } = router.query;

  return (
    <Elements stripe={stripePromise}>
      <ContributeForm projectId={id as string} />
    </Elements>
  );
}
```

### 4. Create Project Form

```typescript
// pages/projects/create.tsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/contexts/AuthContext';
import { firebaseFunctions } from '@/lib/functions';
import { CreateProjectData } from '@/types/project';
import { ProtectedRoute } from '@/components/ProtectedRoute';

function CreateProjectForm() {
  const router = useRouter();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState<CreateProjectData>({
    title: '',
    shortDescription: '',
    description: '',
    category: 'environment',
    tags: [],
    impactGoals: {
      primary: '',
      metrics: [],
    },
    funding: {
      goal: 100000, // €1,000 minimum
      currency: 'EUR',
      deadline: '',
    },
    milestones: [
      {
        title: '',
        description: '',
        targetDate: '',
        fundingPercentage: 100,
        deliverables: [''],
      },
    ],
    media: {
      coverImage: '',
    },
    location: {
      country: 'FR',
    },
    team: [
      {
        name: `${profile?.firstName} ${profile?.lastName}`,
        role: 'Project Lead',
      },
    ],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validate
      if (formData.milestones.reduce((sum, m) => sum + m.fundingPercentage, 0) !== 100) {
        alert('Milestone funding percentages must sum to 100%');
        return;
      }

      // Create project
      const result = await firebaseFunctions.createProject(formData);

      alert('Project created successfully!');
      router.push(`/projects/${result.slug}`);
    } catch (error: any) {
      alert('Error creating project: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="create-project-form">
      <h1>Create New Project</h1>

      {/* Basic Information */}
      <section>
        <h2>Basic Information</h2>

        <div>
          <label>Project Title *</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            minLength={3}
            maxLength={100}
            required
          />
        </div>

        <div>
          <label>Short Description * (shown on cards)</label>
          <input
            type="text"
            value={formData.shortDescription}
            onChange={(e) => setFormData({ ...formData, shortDescription: e.target.value })}
            minLength={10}
            maxLength={200}
            required
          />
        </div>

        <div>
          <label>Full Description *</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            minLength={10}
            maxLength={2000}
            rows={10}
            required
          />
        </div>

        <div>
          <label>Category *</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
            required
          >
            <option value="environment">🌱 Environment</option>
            <option value="education">📚 Education</option>
            <option value="health">🏥 Health</option>
            <option value="community">🤝 Community</option>
            <option value="innovation">💡 Innovation</option>
          </select>
        </div>

        <div>
          <label>Tags (comma-separated)</label>
          <input
            type="text"
            placeholder="e.g., reforestation, climate, biodiversity"
            onChange={(e) =>
              setFormData({
                ...formData,
                tags: e.target.value.split(',').map((t) => t.trim()),
              })
            }
          />
        </div>
      </section>

      {/* Funding */}
      <section>
        <h2>Funding</h2>

        <div>
          <label>Funding Goal (€) *</label>
          <input
            type="number"
            min="1000"
            max="50000"
            value={formData.funding.goal / 100}
            onChange={(e) =>
              setFormData({
                ...formData,
                funding: {
                  ...formData.funding,
                  goal: parseFloat(e.target.value) * 100,
                },
              })
            }
            required
          />
          <small>Minimum: €1,000 | Maximum: €50,000</small>
        </div>

        <div>
          <label>Campaign End Date *</label>
          <input
            type="date"
            min={new Date().toISOString().split('T')[0]}
            max={new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0]}
            value={formData.funding.deadline.split('T')[0]}
            onChange={(e) =>
              setFormData({
                ...formData,
                funding: {
                  ...formData.funding,
                  deadline: new Date(e.target.value).toISOString(),
                },
              })
            }
            required
          />
          <small>Campaign duration: 30-90 days</small>
        </div>
      </section>

      {/* Milestones */}
      <section>
        <h2>Milestones</h2>
        <p>Break your project into milestones with clear deliverables</p>

        {formData.milestones.map((milestone, index) => (
          <div key={index} className="milestone-form">
            <h3>Milestone {index + 1}</h3>

            <input
              type="text"
              placeholder="Milestone title"
              value={milestone.title}
              onChange={(e) => {
                const milestones = [...formData.milestones];
                milestones[index].title = e.target.value;
                setFormData({ ...formData, milestones });
              }}
              required
            />

            <textarea
              placeholder="Description"
              value={milestone.description}
              onChange={(e) => {
                const milestones = [...formData.milestones];
                milestones[index].description = e.target.value;
                setFormData({ ...formData, milestones });
              }}
              required
            />

            <input
              type="date"
              value={milestone.targetDate.split('T')[0]}
              onChange={(e) => {
                const milestones = [...formData.milestones];
                milestones[index].targetDate = new Date(e.target.value).toISOString();
                setFormData({ ...formData, milestones });
              }}
              required
            />

            <input
              type="number"
              min="1"
              max="100"
              placeholder="Budget %"
              value={milestone.fundingPercentage}
              onChange={(e) => {
                const milestones = [...formData.milestones];
                milestones[index].fundingPercentage = parseFloat(e.target.value);
                setFormData({ ...formData, milestones });
              }}
              required
            />

            {index > 0 && (
              <button
                type="button"
                onClick={() => {
                  const milestones = formData.milestones.filter((_, i) => i !== index);
                  setFormData({ ...formData, milestones });
                }}
              >
                Remove Milestone
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => {
            setFormData({
              ...formData,
              milestones: [
                ...formData.milestones,
                {
                  title: '',
                  description: '',
                  targetDate: '',
                  fundingPercentage: 0,
                  deliverables: [''],
                },
              ],
            });
          }}
          disabled={formData.milestones.length >= 5}
        >
          Add Milestone
        </button>
      </section>

      {/* Media */}
      <section>
        <h2>Media</h2>

        <div>
          <label>Cover Image URL *</label>
          <input
            type="url"
            value={formData.media.coverImage}
            onChange={(e) =>
              setFormData({
                ...formData,
                media: { ...formData.media, coverImage: e.target.value },
              })
            }
            required
          />
          <small>Upload image to Firebase Storage first</small>
        </div>
      </section>

      {/* Submit */}
      <button type="submit" disabled={loading}>
        {loading ? 'Creating Project...' : 'Create Project'}
      </button>
    </form>
  );
}

export default function CreateProjectPage() {
  return (
    <ProtectedRoute requireProfile requireKYC allowedRoles={['creator', 'admin']}>
      <CreateProjectForm />
    </ProtectedRoute>
  );
}
```

---

## Testing

### Test User Accounts

For development, you can bypass KYC and use test accounts:

```typescript
// Test credentials (development only)
const TEST_ACCOUNTS = {
  contributor: {
    email: 'test-contributor@example.com',
    password: 'TestPass123!',
  },
  creator: {
    email: 'test-creator@example.com',
    password: 'TestPass123!',
  },
  auditor: {
    email: 'test-auditor@example.com',
    password: 'TestPass123!',
  },
};
```

### Test Stripe Cards

Use these test cards in development:

```
Success: 4242 4242 4242 4242
Decline: 4000 0000 0000 0002
3D Secure: 4000 0025 0000 3155

Expiry: Any future date
CVC: Any 3 digits
ZIP: Any valid ZIP code
```

---

## Deployment

### Build Configuration

```bash
# Install dependencies
npm install

# Build
npm run build

# Start production server
npm start
```

### Environment Variables Checklist

✅ All Firebase config variables
✅ Stripe publishable key
✅ API URL pointing to production
✅ Sumsub app token (if using KYC)

### Pre-launch Checklist

- [ ] Test complete user registration flow
- [ ] Test KYC verification process
- [ ] Test project creation and publication
- [ ] Test contribution flow with real payment
- [ ] Test milestone submission and audit
- [ ] Test notifications delivery
- [ ] Verify all API endpoints work
- [ ] Check error handling and user feedback
- [ ] Test on mobile devices
- [ ] Load testing for concurrent users

---

## Support

For questions or issues:
- Backend API Documentation: See `API_ENDPOINTS_REFERENCE.md`
- TypeScript Types: See `TYPESCRIPT_TYPES_REFERENCE.md`
- Full Integration Guide: See `FRONTEND_API_DOCUMENTATION.md`

---

**Ready to build!** All backend systems are operational and fully documented for frontend integration.
