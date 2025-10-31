# Production Configuration Checklist
## Social Impact Platform - Complete Setup Guide

This document lists **ALL** configuration values, API keys, and settings required to make the backend 100% production-ready.

---

## 📋 Table of Contents

1. [Firebase Configuration](#1-firebase-configuration)
2. [Stripe Payment Configuration](#2-stripe-payment-configuration)
3. [Sumsub KYC Configuration](#3-sumsub-kyc-configuration)
4. [SendGrid Email Configuration](#4-sendgrid-email-configuration)
5. [Frontend Application URLs](#5-frontend-application-urls)
6. [Security Configuration](#6-security-configuration)
7. [External Services (Optional)](#7-external-services-optional)
8. [Business Configuration](#8-business-configuration)
9. [Feature Flags](#9-feature-flags)
10. [Deployment Steps](#10-deployment-steps)

---

## ✅ Configuration Overview

**Total Required Configurations**: 28 mandatory + 15 optional
**Estimated Setup Time**: 2-3 hours
**Difficulty**: Intermediate

---

## 1. Firebase Configuration

### 1.1 Firebase Project Setup

**Platform**: Firebase Console
**URL**: https://console.firebase.google.com/

#### Required Steps:

1. **Create Firebase Project**
   ```
   - Go to Firebase Console
   - Click "Add project"
   - Enter project name: "social-impact-platform" (or your choice)
   - Enable Google Analytics (recommended)
   - Choose or create Analytics account
   ```

2. **Enable Required Services**
   ```
   ✓ Authentication (Email/Password + Google)
   ✓ Firestore Database
   ✓ Cloud Storage
   ✓ Cloud Functions
   ✓ Firebase Hosting (optional)
   ```

3. **Configure Authentication**
   ```
   - Go to Authentication > Sign-in method
   - Enable "Email/Password"
   - Enable "Google" (optional)
   - Configure authorized domains
   ```

#### Environment Variables:

| Variable | Where to Find | Example | Required |
|----------|---------------|---------|----------|
| `FIREBASE_PROJECT_ID` | Project Settings > General | `social-impact-prod` | ✅ |
| `FIREBASE_REGION` | Default region for your project | `europe-west1` | ✅ |
| `FIREBASE_DATABASE_URL` | Realtime Database (if used) | `https://project.firebasedatabase.app` | ❌ |
| `FIREBASE_STORAGE_BUCKET` | Project Settings > General | `project.appspot.com` | ✅ |

**How to Get**:
1. Go to Firebase Console
2. Select your project
3. Click ⚙️ (Settings) > Project settings
4. Copy "Project ID" and "Storage bucket"

---

### 1.2 Service Account Key

**What**: JSON credentials for server-side Firebase Admin SDK
**Where**: Firebase Console > Project Settings > Service Accounts

#### Steps:

```bash
1. Go to Firebase Console
2. Project Settings > Service Accounts
3. Click "Generate new private key"
4. Save the JSON file securely
5. Convert to base64 (for environment variable):

   # On Linux/Mac:
   base64 -w 0 serviceAccountKey.json

   # On Windows (PowerShell):
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json"))
```

| Variable | Value | Required |
|----------|-------|----------|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Base64 encoded JSON | ✅ |

⚠️ **SECURITY WARNING**: Never commit this file to version control!

---

## 2. Stripe Payment Configuration

### 2.1 Stripe Account Setup

**Platform**: Stripe
**URL**: https://dashboard.stripe.com/
**Registration**: https://dashboard.stripe.com/register

#### Required Steps:

1. **Create Stripe Account**
   - Sign up at https://dashboard.stripe.com/register
   - Complete business verification
   - Activate your account

2. **Get API Keys**
   - Go to Developers > API keys
   - Copy "Publishable key" (starts with `pk_`)
   - Reveal and copy "Secret key" (starts with `sk_`)

3. **Enable Stripe Connect** (for creator payouts)
   - Go to Settings > Connect settings
   - Enable Connect
   - Copy "Client ID" (starts with `ca_`)

4. **Setup Webhooks**
   - Go to Developers > Webhooks
   - Click "Add endpoint"
   - URL: `https://YOUR_DOMAIN/api/v2/webhooks/stripe`
   - Select events:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `charge.refunded`
     - `customer.created`
     - `account.updated` (Connect)
   - Copy "Signing secret" (starts with `whsec_`)

#### Environment Variables:

| Variable | Where to Find | Starts With | Required |
|----------|---------------|-------------|----------|
| `STRIPE_SECRET_KEY` | Developers > API keys | `sk_test_` or `sk_live_` | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | Developers > API keys | `pk_test_` or `pk_live_` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | Developers > Webhooks | `whsec_` | ✅ |
| `STRIPE_CONNECT_CLIENT_ID` | Settings > Connect settings | `ca_` | ✅ |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connect webhooks endpoint | `whsec_` | ✅ |

#### Additional Configuration:

**Escrow Account** (Choose one option):

**Option A: Platform Escrow Account** (Recommended)
```env
STRIPE_ESCROW_ACCOUNT_ID=acct_1234567890abcdef
```
- Create a Stripe Connect Express account for platform escrow
- Go to Connect > Accounts > Create account
- Use for holding funds before release

**Option B: Direct to Creator**
```env
# Leave empty to transfer directly to creator's Connect account
# Each project will have: project.stripeConnectAccountId
```

---

### 2.2 Stripe Connect Setup

**Purpose**: Allow project creators to receive payouts

#### Steps:

1. **Enable Connect in Stripe Dashboard**
   - Settings > Connect settings
   - Choose "Express" or "Standard" accounts
   - Configure branding and onboarding

2. **Configure Onboarding**
   - Set return URL: `https://yoursite.com/creator/onboarding/complete`
   - Set refresh URL: `https://yoursite.com/creator/onboarding/retry`

3. **Test Mode First**
   - Use test API keys initially
   - Create test Connect accounts
   - Test full payment flow

---

## 3. Sumsub KYC Configuration

### 3.1 Sumsub Account Setup

**Platform**: Sumsub
**URL**: https://sumsub.com/
**Dashboard**: https://cockpit.sumsub.com/

#### Required Steps:

1. **Create Sumsub Account**
   - Sign up at https://sumsub.com/
   - Complete business verification
   - Choose pricing plan (Startup or Business recommended)

2. **Get API Credentials**
   - Go to Settings > Developer section
   - Copy "App Token" (starts with `sbx:` for sandbox)
   - Copy "Secret Key" (long alphanumeric string)

3. **Configure Verification Levels**

   **Basic KYC Level**:
   - Name: `basic-kyc-level` (must match SUMSUB_LEVEL_BASIC)
   - Requirements:
     - Identity document (ID card, passport, or driver's license)
     - Selfie with document
   - Auto-verification: Enabled
   - Max contribution limit: €1,000

   **Enhanced KYC Level**:
   - Name: `full-kyc-level` (must match SUMSUB_LEVEL_FULL)
   - Requirements:
     - Identity document
     - Proof of address (utility bill, bank statement)
     - Selfie
     - Manual review
   - Auto-verification: Partial
   - Max contribution limit: €100,000

4. **Setup Webhooks**
   - Go to Settings > Webhooks
   - Add webhook URL: `https://YOUR_DOMAIN/handleKYCWebhook`
   - Select events:
     - Applicant created
     - Applicant approved
     - Applicant rejected
     - Review completed
   - Copy webhook secret

#### Environment Variables:

| Variable | Where to Find | Example | Required |
|----------|---------------|---------|----------|
| `SUMSUB_APP_TOKEN` | Settings > Developer | `sbx:1234567890abcdef` | ✅ |
| `SUMSUB_SECRET_KEY` | Settings > Developer | `32_char_secret_key` | ✅ |
| `SUMSUB_BASE_URL` | Fixed value | `https://api.sumsub.com` | ✅ |
| `SUMSUB_WEBHOOK_SECRET` | Settings > Webhooks | Your webhook secret | ✅ |
| `SUMSUB_LEVEL_BASIC` | Your level name | `basic-kyc-level` | ✅ |
| `SUMSUB_LEVEL_FULL` | Your level name | `full-kyc-level` | ✅ |

**Pricing Note**:
- Sandbox: Free for testing
- Production: ~€1-3 per verification
- Volume discounts available

---

## 4. SendGrid Email Configuration

### 4.1 SendGrid Account Setup

**Platform**: SendGrid (by Twilio)
**URL**: https://sendgrid.com/
**Dashboard**: https://app.sendgrid.com/

#### Required Steps:

1. **Create SendGrid Account**
   - Sign up at https://signup.sendgrid.com/
   - Verify your email
   - Complete sender verification

2. **Create API Key**
   - Go to Settings > API Keys
   - Click "Create API Key"
   - Name: "Social Impact Platform Production"
   - Permissions: "Full Access" or "Mail Send"
   - Copy the key (starts with `SG.`)
   - ⚠️ Save it immediately (shown only once)

3. **Verify Sender Email**
   - Go to Settings > Sender Authentication
   - Choose "Single Sender Verification" (simple) or "Domain Authentication" (recommended)

   **Single Sender**:
   - Add email: `noreply@yoursite.com`
   - Verify via email link

   **Domain Authentication** (Better for deliverability):
   - Add your domain: `yoursite.com`
   - Add DNS records provided by SendGrid
   - Wait for verification (can take 24-48 hours)

4. **Create Email Templates**

   Go to Email API > Dynamic Templates > Create Template

   Create these templates (copy Template ID for each):

   | Template Name | Template ID Variable | Purpose |
   |---------------|---------------------|---------|
   | Welcome Email | `SENDGRID_TEMPLATE_WELCOME` | New user welcome |
   | KYC Approved | `SENDGRID_TEMPLATE_KYC_APPROVED` | KYC verification approved |
   | KYC Rejected | `SENDGRID_TEMPLATE_KYC_REJECTED` | KYC verification rejected |
   | Project Approved | `SENDGRID_TEMPLATE_PROJECT_APPROVED` | Project published |
   | Contribution Confirmed | `SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED` | Payment successful |
   | Audit Assignment | `SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT` | Auditor assigned |
   | Monthly Report | `SENDGRID_TEMPLATE_MONTHLY_REPORT` | Monthly activity report |
   | Daily Digest | `SENDGRID_TEMPLATE_DIGEST_DAILY` | Daily digest email |
   | Refund Processed | `SENDGRID_TEMPLATE_REFUND_PROCESSED` | Refund notification |

   Each template ID looks like: `d-1234567890abcdef1234567890abcdef`

#### Environment Variables:

| Variable | Where to Find | Example | Required |
|----------|---------------|---------|----------|
| `SENDGRID_API_KEY` | Settings > API Keys | `SG.1234567890abcdef...` | ✅ |
| `SENDGRID_FROM_EMAIL` | Verified sender email | `noreply@yoursite.com` | ✅ |
| `SENDGRID_FROM_NAME` | Your platform name | `Social Impact Platform` | ✅ |
| `SENDGRID_REPLY_TO` | Support email | `support@yoursite.com` | ✅ |
| `SENDGRID_TEMPLATE_WELCOME` | Template ID | `d-abc123...` | ✅ |
| `SENDGRID_TEMPLATE_KYC_APPROVED` | Template ID | `d-def456...` | ✅ |
| `SENDGRID_TEMPLATE_KYC_REJECTED` | Template ID | `d-ghi789...` | ✅ |
| `SENDGRID_TEMPLATE_PROJECT_APPROVED` | Template ID | `d-jkl012...` | ✅ |
| `SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED` | Template ID | `d-mno345...` | ✅ |
| `SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT` | Template ID | `d-pqr678...` | ✅ |
| `SENDGRID_TEMPLATE_MONTHLY_REPORT` | Template ID | `d-stu901...` | ✅ |
| `SENDGRID_TEMPLATE_DIGEST_DAILY` | Template ID | `d-vwx234...` | ✅ |
| `SENDGRID_TEMPLATE_REFUND_PROCESSED` | Template ID | `d-yz5678...` | ✅ |

**Pricing Note**:
- Free tier: 100 emails/day (good for testing)
- Essentials: $19.95/month for 50K emails
- Production: Scale as needed

---

## 5. Frontend Application URLs

### 5.1 Frontend Deployment

**Purpose**: URLs used in emails, redirects, and deep links

#### Environment Variables:

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `FRONTEND_URL` | Main frontend application | `https://socialimpact.finance` | ✅ |
| `ADMIN_DASHBOARD_URL` | Admin panel (can be same as frontend) | `https://admin.socialimpact.finance` | ❌ |
| `API_BASE_URL` | Backend API URL | `https://api.socialimpact.finance` | ✅ |

#### Used In:

These URLs appear in:
- ✉️ Email templates (action buttons, links)
- 🔗 Password reset links
- 📧 Email verification links
- 🔔 Notification action URLs
- 📱 Deep links (mobile apps)

#### Examples of Generated URLs:

```javascript
// Project page
`${FRONTEND_URL}/projects/${project.slug}`

// Contribution receipt
`${FRONTEND_URL}/contributions/${contributionId}/receipt`

// Auditor workspace
`${FRONTEND_URL}/auditor/workspace/${auditId}`

// Creator dashboard
`${FRONTEND_URL}/projects/${projectId}/dashboard`

// Email verification
`${FRONTEND_URL}/verify-email?token=${token}`

// Password reset
`${FRONTEND_URL}/reset-password?token=${token}`
```

### 5.2 Mobile App URLs (Optional)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `MOBILE_APP_SCHEME` | Deep link scheme | `socialimpact://` | ❌ |
| `MOBILE_APP_IOS_URL` | App Store link | `https://apps.apple.com/app/id123` | ❌ |
| `MOBILE_APP_ANDROID_URL` | Play Store link | `https://play.google.com/store/apps/details?id=com.socialimpact` | ❌ |

---

## 6. Security Configuration

### 6.1 Encryption Keys

**Purpose**: Encrypt sensitive data in database

#### Generate Keys:

```bash
# Generate 32-character encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT secret (minimum 64 characters)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate webhook signature secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate encryption pepper (optional, additional security)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

| Variable | Purpose | Length | Required |
|----------|---------|--------|----------|
| `ENCRYPTION_KEY` | Encrypt sensitive DB fields | 32 bytes (64 hex chars) | ✅ |
| `JWT_SECRET` | Sign JWT tokens | 64+ bytes | ✅ |
| `WEBHOOK_SIGNATURE_SECRET` | Verify webhook signatures | 32 bytes | ✅ |
| `ENCRYPTION_PEPPER` | Additional encryption salt | 16 bytes | ❌ |

⚠️ **CRITICAL**:
- Generate NEW keys for production
- Never reuse keys from examples
- Store securely (use secrets manager in production)
- Rotate regularly (every 90 days recommended)

---

### 6.2 CORS Configuration

**Purpose**: Control which domains can access your API

| Variable | Value | Required |
|----------|-------|----------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated domains | ✅ |

**Example**:
```env
CORS_ALLOWED_ORIGINS=https://yoursite.com,https://admin.yoursite.com,https://app.yoursite.com
```

**Development**:
```env
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

---

### 6.3 Rate Limiting

**Purpose**: Prevent abuse and DDoS attacks

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `RATE_LIMIT_WINDOW_MS` | Time window in milliseconds | `900000` (15 min) | ❌ |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `100` | ❌ |
| `API_RATE_LIMIT_REQUESTS_PER_MINUTE` | API requests per minute | `60` | ❌ |

---

## 7. External Services (Optional)

### 7.1 Error Tracking - Sentry

**Platform**: Sentry
**URL**: https://sentry.io/
**Purpose**: Track errors and exceptions

#### Setup:

1. Create Sentry account at https://sentry.io/signup/
2. Create new project (Node.js)
3. Copy DSN from Settings > Projects > [Your Project] > Client Keys

| Variable | Where to Find | Example | Required |
|----------|---------------|---------|----------|
| `SENTRY_DSN` | Project Settings > Client Keys | `https://abc@sentry.io/123` | ❌ |

**Free Tier**: 5,000 events/month

---

### 7.2 Analytics - Google Analytics

**Platform**: Google Analytics
**URL**: https://analytics.google.com/

| Variable | Where to Find | Example | Required |
|----------|---------------|---------|----------|
| `GOOGLE_ANALYTICS_ID` | Admin > Property > Data Streams | `G-1234567890` | ❌ |

---

### 7.3 File Storage - Cloudinary (Optional Alternative)

**Platform**: Cloudinary
**URL**: https://cloudinary.com/

If using Cloudinary instead of Firebase Storage:

| Variable | Where to Find | Required |
|----------|---------------|----------|
| `CLOUDINARY_CLOUD_NAME` | Dashboard | ❌ |
| `CLOUDINARY_API_KEY` | Dashboard | ❌ |
| `CLOUDINARY_API_SECRET` | Dashboard | ❌ |

---

### 7.4 Team Communication - Slack/Discord (Optional)

**Purpose**: Receive platform notifications

**Slack**:
1. Go to https://api.slack.com/apps
2. Create app > Incoming Webhooks
3. Copy webhook URL

**Discord**:
1. Server Settings > Integrations > Webhooks
2. Create webhook
3. Copy URL

| Variable | Example | Required |
|----------|---------|----------|
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/T00/B00/xxx` | ❌ |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/123/xxx` | ❌ |

---

## 8. Business Configuration

### 8.1 Platform Settings

**Purpose**: Configure business rules and limits

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PLATFORM_NAME` | Your platform name | `Social Impact Platform` | ✅ |
| `PLATFORM_FEE_PERCENTAGE` | Platform fee (%) | `5` (5%) | ✅ |
| `PAYMENT_PROCESSING_FEE_PERCENTAGE` | Stripe fee (%) | `2.9` | ✅ |
| `MIN_CONTRIBUTION_AMOUNT` | Minimum contribution (cents) | `1000` (€10) | ✅ |
| `MAX_CONTRIBUTION_AMOUNT` | Maximum contribution (cents) | `100000` (€1,000) | ✅ |

**Note**: Fees are configured in code at `backend/functions/src/utils/constants.ts`:
- Platform Fee: 5% (FEES.PLATFORM_PERCENTAGE)
- Audit Fee: 3% (FEES.AUDIT_PERCENTAGE)
- Stripe Fee: 2.9% + €0.30 (FEES.STRIPE_PERCENTAGE + FEES.STRIPE_FIXED_FEE)

---

### 8.2 Interest Calculation (Optional)

**Purpose**: If offering interest on held funds

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BASE_INTEREST_RATE` | Annual interest rate | `0.02` (2%) | ❌ |
| `MAX_INTEREST_RATE` | Maximum interest rate | `0.05` (5%) | ❌ |
| `INTEREST_CALCULATION_FREQUENCY` | Calculation frequency | `daily` | ❌ |

---

### 8.3 Audit Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `AUDIT_ASSIGNMENT_TIMEOUT_HOURS` | Hours before auto-reassign | `72` | ❌ |
| `MAX_CONCURRENT_AUDITS` | Max audits per auditor | `5` | ❌ |
| `AUDIT_QUALITY_THRESHOLD` | Minimum quality score | `80` | ❌ |

---

## 9. Feature Flags

### 9.1 Core Features

**Purpose**: Enable/disable platform features

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ENABLE_KYC_VERIFICATION` | Require KYC | `true` | ✅ |
| `ENABLE_AUDIT_SYSTEM` | Enable audits | `true` | ✅ |
| `ENABLE_INTEREST_CALCULATION` | Calculate interest | `false` | ❌ |
| `ENABLE_AUTOMATIC_REFUNDS` | Auto-refund failed projects | `true` | ❌ |

### 9.2 Communication Features

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ENABLE_EMAIL_NOTIFICATIONS` | Send emails | `true` | ✅ |
| `ENABLE_PUSH_NOTIFICATIONS` | Send push notifications | `true` | ❌ |
| `ENABLE_DIGEST_EMAILS` | Daily/weekly digests | `true` | ❌ |
| `ENABLE_MONTHLY_REPORTS` | Monthly reports | `true` | ❌ |

---

## 10. Deployment Steps

### Step 1: Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### Step 2: Initialize Firebase Project

```bash
cd backend
firebase use --add
# Select your Firebase project
# Enter alias: production
```

### Step 3: Create .env File

```bash
cd functions
cp .env.example .env
# Edit .env with your actual values
```

### Step 4: Set Environment Variables in Firebase

Firebase Functions don't use `.env` files in production. Use Firebase config:

```bash
# Set all environment variables
firebase functions:config:set \
  stripe.secret_key="sk_live_..." \
  stripe.webhook_secret="whsec_..." \
  stripe.connect_client_id="ca_..." \
  sumsub.app_token="sbx:..." \
  sumsub.secret_key="..." \
  sumsub.webhook_secret="..." \
  sendgrid.api_key="SG...." \
  sendgrid.from_email="noreply@yoursite.com" \
  app.frontend_url="https://yoursite.com" \
  app.api_url="https://api.yoursite.com" \
  security.encryption_key="..." \
  security.jwt_secret="..."

# View current config
firebase functions:config:get
```

**Alternative (Recommended for Production)**:
Use Google Cloud Secret Manager:

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Create secrets
echo "sk_live_..." | gcloud secrets create stripe-secret-key --data-file=-
echo "SG...." | gcloud secrets create sendgrid-api-key --data-file=-
# etc.

# Grant access to Cloud Functions
gcloud secrets add-iam-policy-binding stripe-secret-key \
  --member=serviceAccount:PROJECT_ID@appspot.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

### Step 5: Deploy Functions

```bash
# Build TypeScript
npm run build

# Deploy all functions
firebase deploy --only functions

# Or deploy specific function
firebase deploy --only functions:api
```

### Step 6: Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

### Step 7: Deploy Storage Rules

```bash
firebase deploy --only storage
```

### Step 8: Verify Deployment

```bash
# Check function logs
firebase functions:log

# Test API endpoint
curl https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/api/health

# Test specific endpoints
curl https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/api/v2/status
```

---

## 📊 Quick Reference: All Required Variables

### Critical (Must Have - 28 variables)

```env
# Firebase (4)
FIREBASE_PROJECT_ID=
FIREBASE_REGION=europe-west1
FIREBASE_STORAGE_BUCKET=
FIREBASE_SERVICE_ACCOUNT_KEY=

# Stripe (5)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
STRIPE_CONNECT_WEBHOOK_SECRET=

# Sumsub (6)
SUMSUB_APP_TOKEN=
SUMSUB_SECRET_KEY=
SUMSUB_BASE_URL=https://api.sumsub.com
SUMSUB_WEBHOOK_SECRET=
SUMSUB_LEVEL_BASIC=basic-kyc-level
SUMSUB_LEVEL_FULL=full-kyc-level

# SendGrid (4 + 9 templates = 13)
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_FROM_NAME=
SENDGRID_REPLY_TO=
SENDGRID_TEMPLATE_WELCOME=
SENDGRID_TEMPLATE_KYC_APPROVED=
SENDGRID_TEMPLATE_KYC_REJECTED=
SENDGRID_TEMPLATE_PROJECT_APPROVED=
SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED=
SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT=
SENDGRID_TEMPLATE_MONTHLY_REPORT=
SENDGRID_TEMPLATE_DIGEST_DAILY=
SENDGRID_TEMPLATE_REFUND_PROCESSED=

# URLs (2)
FRONTEND_URL=
API_BASE_URL=

# Security (3)
ENCRYPTION_KEY=
JWT_SECRET=
WEBHOOK_SIGNATURE_SECRET=

# Business (1)
PLATFORM_NAME=
```

### Optional but Recommended (15 variables)

```env
# URLs
ADMIN_DASHBOARD_URL=

# Security
CORS_ALLOWED_ORIGINS=
ENCRYPTION_PEPPER=

# Monitoring
SENTRY_DSN=
GOOGLE_ANALYTICS_ID=

# Communication
SLACK_WEBHOOK_URL=
DISCORD_WEBHOOK_URL=

# File Storage (if using Cloudinary)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Mobile
MOBILE_APP_SCHEME=
MOBILE_APP_IOS_URL=
MOBILE_APP_ANDROID_URL=

# Feature Flags
ENABLE_DIGEST_EMAILS=true
ENABLE_MONTHLY_REPORTS=true
ENABLE_PUSH_NOTIFICATIONS=true
```

---

## 🔐 Security Checklist

Before going to production:

- [ ] All API keys are production keys (not test keys)
- [ ] Encryption keys are newly generated (not from examples)
- [ ] Service account JSON is base64 encoded
- [ ] `.env` file is in `.gitignore`
- [ ] Webhooks are configured with secrets
- [ ] CORS is restricted to your domains only
- [ ] Rate limiting is enabled
- [ ] Sentry or error tracking is configured
- [ ] All secrets use Google Secret Manager (not functions:config)
- [ ] Firestore rules are configured
- [ ] Storage rules are configured
- [ ] All email templates are created in SendGrid
- [ ] Sumsub levels are properly configured
- [ ] Stripe Connect is enabled and tested
- [ ] Test the complete flow end-to-end

---

## 📞 Support Resources

### Platform Documentation

| Service | Documentation URL |
|---------|------------------|
| Firebase | https://firebase.google.com/docs |
| Stripe | https://stripe.com/docs |
| Sumsub | https://docs.sumsub.com |
| SendGrid | https://docs.sendgrid.com |
| Google Cloud | https://cloud.google.com/docs |

### Get API Keys

| Service | Dashboard URL | Sign Up URL |
|---------|---------------|-------------|
| Firebase | https://console.firebase.google.com | https://firebase.google.com |
| Stripe | https://dashboard.stripe.com | https://dashboard.stripe.com/register |
| Sumsub | https://cockpit.sumsub.com | https://sumsub.com/contact-sales |
| SendGrid | https://app.sendgrid.com | https://signup.sendgrid.com |

---

## 💰 Estimated Monthly Costs

### Minimal Production Setup (100 users, 50 projects)

| Service | Usage | Cost |
|---------|-------|------|
| **Firebase** | Functions (1M invocations) | ~$5 |
| | Firestore (1GB + 1M reads) | ~$2 |
| | Storage (10GB) | ~$3 |
| **Stripe** | 100 transactions @ €50 avg | 2.9% + €0.30 = ~€160 |
| **Sumsub** | 50 KYC verifications | ~€75-150 |
| **SendGrid** | 5,000 emails/month | Free - $19.95 |
| **Total** | | **~€245-340/month** |

### Scaling Costs

At 1,000 users, 500 projects/month:
- Firebase: ~$50
- Stripe fees: ~€1,600 (on €50K volume)
- Sumsub: ~€750-1,500
- SendGrid: ~$89
- **Total: ~€2,490-3,240/month**

*(Plus platform revenue from 5% platform fee on contributions)*

---

## ✅ Deployment Verification

After deployment, test these critical flows:

1. **Health Check**
   ```bash
   curl https://YOUR_API_URL/health
   # Should return: {"status":"healthy"}
   ```

2. **User Registration**
   - Create account with email/password
   - Verify email received
   - Complete profile
   - Initiate KYC

3. **Project Creation**
   - Create project as verified creator
   - Submit for review
   - Verify project visible

4. **Contribution Flow**
   - Make test contribution
   - Verify Stripe payment
   - Check escrow holding
   - Verify email receipts

5. **Audit System**
   - Submit milestone
   - Assign auditor
   - Complete audit
   - Verify fund release

6. **Webhooks**
   - Check Stripe webhook events
   - Check Sumsub webhook events
   - Verify all events processed

---

## 🎉 You're Ready!

Once all variables are configured and tests pass, your backend is **100% production-ready**.

**Next Steps**:
1. Configure monitoring and alerts
2. Set up automated backups
3. Create incident response plan
4. Train support team
5. Launch! 🚀

---

**Document Version**: 1.0
**Last Updated**: 2024
**Maintained By**: Social Impact Platform Team
