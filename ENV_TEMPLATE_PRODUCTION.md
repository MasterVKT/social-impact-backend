# Production Environment Template

Copy this template to `backend/functions/.env` and fill in your actual values.

---

## 📋 How to Use This Template

```bash
# 1. Navigate to functions directory
cd backend/functions

# 2. Copy this content to .env file
nano .env
# Or use your preferred editor

# 3. Fill in all values marked with [REQUIRED]
# 4. Optional values can be left commented out (#)

# 5. Never commit .env to git!
# It's already in .gitignore, but double-check
```

---

## 🔥 FIREBASE CONFIGURATION [REQUIRED]

```bash
# Get from: https://console.firebase.google.com
# Location: Project Settings > General

FIREBASE_PROJECT_ID=[REQUIRED - Your Firebase Project ID]
# Example: social-impact-production

FIREBASE_REGION=europe-west1
# Default region for Cloud Functions (keep as is unless you need different region)

FIREBASE_STORAGE_BUCKET=[REQUIRED - Your Storage Bucket]
# Example: social-impact-production.appspot.com

# Get from: Project Settings > Service Accounts > Generate new private key
# Then convert to base64: base64 -w 0 serviceAccountKey.json
FIREBASE_SERVICE_ACCOUNT_KEY=[REQUIRED - Base64 encoded service account JSON]
# This will be a very long string starting with: eyJhbGc...
```

---

## 💳 STRIPE CONFIGURATION [REQUIRED]

```bash
# Get from: https://dashboard.stripe.com/apikeys
# IMPORTANT: Use test keys (sk_test_) for development, live keys (sk_live_) for production

STRIPE_SECRET_KEY=[REQUIRED - Stripe Secret Key]
# Development: sk_test_51...
# Production: sk_live_51...

STRIPE_PUBLISHABLE_KEY=[REQUIRED - Stripe Publishable Key]
# Development: pk_test_51...
# Production: pk_live_51...

# Get from: Developers > Webhooks > Add endpoint
# Endpoint URL: https://YOUR_DOMAIN/api/v2/webhooks/stripe
# Events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
STRIPE_WEBHOOK_SECRET=[REQUIRED - Webhook Signing Secret]
# Example: whsec_1234567890abcdef...

# Get from: Settings > Connect > Connect settings
STRIPE_CONNECT_CLIENT_ID=[REQUIRED - Connect Application Client ID]
# Example: ca_1234567890abcdef...

# Get from: Developers > Webhooks > Connect endpoint
STRIPE_CONNECT_WEBHOOK_SECRET=[REQUIRED - Connect Webhook Secret]
# Example: whsec_connect_1234567890abcdef...

# Optional: Platform escrow account ID (if using platform escrow)
# STRIPE_ESCROW_ACCOUNT_ID=acct_1234567890abcdef
# Leave commented to use direct-to-creator model
```

---

## 🔐 SUMSUB KYC CONFIGURATION [REQUIRED]

```bash
# Get from: https://cockpit.sumsub.com/
# Location: Settings > Developer

SUMSUB_APP_TOKEN=[REQUIRED - Sumsub App Token]
# Development: sbx:1234567890abcdef...
# Production: prod:1234567890abcdef...

SUMSUB_SECRET_KEY=[REQUIRED - Sumsub Secret Key]
# Example: 1234567890abcdefghijklmnopqrstuv

SUMSUB_BASE_URL=https://api.sumsub.com
# Keep as is (standard Sumsub API URL)

# Get from: Settings > Webhooks
# Webhook URL: https://YOUR_DOMAIN/handleKYCWebhook
SUMSUB_WEBHOOK_SECRET=[REQUIRED - Webhook Secret]
# Example: your_webhook_secret_key

# These must match level names configured in Sumsub dashboard
# Get from: Settings > Levels
SUMSUB_LEVEL_BASIC=basic-kyc-level
# Change if you used different name in Sumsub

SUMSUB_LEVEL_FULL=full-kyc-level
# Change if you used different name in Sumsub
```

---

## 📧 SENDGRID EMAIL CONFIGURATION [REQUIRED]

```bash
# Get from: https://app.sendgrid.com/settings/api_keys
# Create API Key with "Full Access" or "Mail Send" permission

SENDGRID_API_KEY=[REQUIRED - SendGrid API Key]
# Example: SG.1234567890abcdefghijklmnopqrstuv.1234567890abcdefghijklmnopqrstuv

# Your verified sender email
# Verify at: Settings > Sender Authentication
SENDGRID_FROM_EMAIL=[REQUIRED - Verified Sender Email]
# Example: noreply@yoursite.com

SENDGRID_FROM_NAME=Social Impact Platform
# Change to your platform name

SENDGRID_REPLY_TO=[REQUIRED - Support/Reply Email]
# Example: support@yoursite.com

# Template IDs - Create these in SendGrid dashboard
# Location: Email API > Dynamic Templates > Create Template
# After creating, copy the Template ID (starts with d-)

SENDGRID_TEMPLATE_WELCOME=[REQUIRED - Welcome Email Template ID]
# Example: d-1234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_KYC_APPROVED=[REQUIRED - KYC Approved Template ID]
# Example: d-2234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_KYC_REJECTED=[REQUIRED - KYC Rejected Template ID]
# Example: d-3234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_PROJECT_APPROVED=[REQUIRED - Project Approved Template ID]
# Example: d-4234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_CONTRIBUTION_CONFIRMED=[REQUIRED - Contribution Confirmed Template ID]
# Example: d-5234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_AUDIT_ASSIGNMENT=[REQUIRED - Audit Assignment Template ID]
# Example: d-6234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_MONTHLY_REPORT=[REQUIRED - Monthly Report Template ID]
# Example: d-7234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_DIGEST_DAILY=[REQUIRED - Daily Digest Template ID]
# Example: d-8234567890abcdef1234567890abcdef

SENDGRID_TEMPLATE_REFUND_PROCESSED=[REQUIRED - Refund Processed Template ID]
# Example: d-9234567890abcdef1234567890abcdef
```

---

## 🌐 FRONTEND & API URLS [REQUIRED]

```bash
# Your frontend application URL (where users access the platform)
FRONTEND_URL=[REQUIRED - Frontend URL]
# Development: http://localhost:3000
# Production: https://yoursite.com

# Your API base URL (where backend is hosted)
API_BASE_URL=[REQUIRED - API URL]
# Development: http://localhost:5001/PROJECT-ID/europe-west1/api
# Production: https://europe-west1-PROJECT-ID.cloudfunctions.net/api

# Optional: Admin dashboard URL (can be same as FRONTEND_URL)
# ADMIN_DASHBOARD_URL=https://admin.yoursite.com
```

---

## 🔒 SECURITY CONFIGURATION [REQUIRED]

```bash
# Generate these keys yourself - NEVER use example values!
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

ENCRYPTION_KEY=[REQUIRED - 32-byte encryption key]
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2

JWT_SECRET=[REQUIRED - 64-byte JWT signing key]
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Example: (128 character hex string)

WEBHOOK_SIGNATURE_SECRET=[REQUIRED - Webhook verification key]
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example: f1e2d3c4b5a69788...

# Optional: Additional encryption pepper
# ENCRYPTION_PEPPER=
# Generate: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

---

## 🎯 PLATFORM CONFIGURATION [REQUIRED]

```bash
# Your platform's name
PLATFORM_NAME=Social Impact Platform
# Change to your actual platform name
```

---

## 🌍 CORS CONFIGURATION [OPTIONAL]

```bash
# Comma-separated list of allowed origins
# CORS_ALLOWED_ORIGINS=https://yoursite.com,https://admin.yoursite.com

# Development example:
# CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

---

## 📱 MOBILE APP URLS [OPTIONAL]

```bash
# Only if you have mobile apps
# MOBILE_APP_SCHEME=socialimpact
# MOBILE_APP_IOS_URL=https://apps.apple.com/app/your-app-id
# MOBILE_APP_ANDROID_URL=https://play.google.com/store/apps/details?id=com.yourapp
```

---

## 📊 MONITORING & ANALYTICS [OPTIONAL]

```bash
# Sentry for error tracking
# Get from: https://sentry.io/ > Settings > Projects > Client Keys
# SENTRY_DSN=https://1234567890abcdef@o123456.ingest.sentry.io/1234567

# Google Analytics
# Get from: https://analytics.google.com/ > Admin > Data Streams
# GOOGLE_ANALYTICS_ID=G-1234567890

# Slack notifications (optional)
# Get from: https://api.slack.com/apps > Incoming Webhooks
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxxxxxxxxxxxxxx

# Discord notifications (optional)
# Get from: Server Settings > Integrations > Webhooks
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/xxxxxxxxxxxxxxxxxxxx
```

---

## 🗄️ FILE STORAGE [OPTIONAL]

```bash
# Only if using Cloudinary instead of Firebase Storage
# Get from: https://cloudinary.com/console
# CLOUDINARY_CLOUD_NAME=your-cloud-name
# CLOUDINARY_API_KEY=123456789012345
# CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvwxyz
```

---

## 💼 BUSINESS CONFIGURATION [OPTIONAL]

```bash
# These have defaults in code, only override if needed

# Platform fee percentage (default: 5%)
# PLATFORM_FEE_PERCENTAGE=5

# Payment processing fee (default: 2.9%)
# PAYMENT_PROCESSING_FEE_PERCENTAGE=2.9

# Minimum contribution in cents (default: 1000 = €10)
# MIN_CONTRIBUTION_AMOUNT=1000

# Maximum contribution in cents (default: 100000 = €1,000)
# MAX_CONTRIBUTION_AMOUNT=100000
```

---

## 🎛️ FEATURE FLAGS [OPTIONAL]

```bash
# Core Features (defaults shown)
# ENABLE_KYC_VERIFICATION=true
# ENABLE_AUDIT_SYSTEM=true
# ENABLE_INTEREST_CALCULATION=false
# ENABLE_AUTOMATIC_REFUNDS=true

# Communication Features
# ENABLE_EMAIL_NOTIFICATIONS=true
# ENABLE_PUSH_NOTIFICATIONS=true
# ENABLE_DIGEST_EMAILS=true
# ENABLE_MONTHLY_REPORTS=true

# Advanced Features
# ENABLE_RECOMMENDATION_ENGINE=true
# ENABLE_TRENDING_ALGORITHM=true
# ENABLE_SOCIAL_SHARING=true
```

---

## 🔧 DEVELOPMENT SETTINGS [DEVELOPMENT ONLY]

```bash
# Environment type
NODE_ENV=production
# Development: development
# Production: production

# Logging level
LOG_LEVEL=info
# Development: debug
# Production: info or warn

# Use Firebase emulators (development only)
# USE_EMULATORS=false
# Development: true
# Production: false (or remove)
```

---

## ✅ Verification Commands

After creating your .env file, verify it's correct:

```bash
# 1. Check file exists
ls -la .env

# 2. Check required variables are set (should show your values)
grep "FIREBASE_PROJECT_ID" .env
grep "STRIPE_SECRET_KEY" .env
grep "SUMSUB_APP_TOKEN" .env
grep "SENDGRID_API_KEY" .env
grep "FRONTEND_URL" .env
grep "ENCRYPTION_KEY" .env

# 3. Count total variables (should be at least 28)
grep -c "^[A-Z]" .env

# 4. Test Firebase Functions locally
npm run serve
```

---

## 🚨 Security Checklist

Before deploying to production:

- [ ] All API keys are production keys (not test/sandbox)
- [ ] ENCRYPTION_KEY is newly generated (not from examples)
- [ ] JWT_SECRET is newly generated
- [ ] WEBHOOK_SIGNATURE_SECRET is newly generated
- [ ] .env file is in .gitignore
- [ ] No .env file committed to git (check: `git log --all --full-history --source -- .env`)
- [ ] Stripe keys start with `sk_live_` (not `sk_test_`)
- [ ] Sumsub token starts with `prod:` (not `sbx:`)
- [ ] SendGrid sender email is verified
- [ ] All webhook endpoints are HTTPS (not HTTP)
- [ ] CORS_ALLOWED_ORIGINS only includes your domains

---

## 📋 Quick Copy-Paste Template

**Minimal production .env (28 required variables)**:

```env
# FIREBASE
FIREBASE_PROJECT_ID=
FIREBASE_REGION=europe-west1
FIREBASE_STORAGE_BUCKET=
FIREBASE_SERVICE_ACCOUNT_KEY=

# STRIPE
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
STRIPE_CONNECT_WEBHOOK_SECRET=

# SUMSUB
SUMSUB_APP_TOKEN=
SUMSUB_SECRET_KEY=
SUMSUB_BASE_URL=https://api.sumsub.com
SUMSUB_WEBHOOK_SECRET=
SUMSUB_LEVEL_BASIC=basic-kyc-level
SUMSUB_LEVEL_FULL=full-kyc-level

# SENDGRID
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_FROM_NAME=Social Impact Platform
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

# URLS
FRONTEND_URL=
API_BASE_URL=

# SECURITY (Generate with crypto)
ENCRYPTION_KEY=
JWT_SECRET=
WEBHOOK_SIGNATURE_SECRET=

# PLATFORM
PLATFORM_NAME=Social Impact Platform

# ENVIRONMENT
NODE_ENV=production
LOG_LEVEL=info
```

---

## 🎉 You're Done!

After filling in all values:

1. Save the file as `backend/functions/.env`
2. Test locally: `npm run serve`
3. If working, deploy: `firebase deploy --only functions`
4. Monitor logs: `firebase functions:log`

---

**Need Help?** See `PRODUCTION_CONFIGURATION_CHECKLIST.md` for detailed setup instructions.
