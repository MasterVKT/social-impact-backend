# GitHub Copilot Instructions - Social Finance Impact Platform

## 🎯 PROJECT CONTEXT

This is a **Social Finance Impact Platform** MVP built with:
- **Backend:** Firebase Functions (TypeScript), Django (Python)
- **Database:** Firestore
- **Authentication:** Firebase Auth
- **Payments:** Stripe
- **KYC:** Sumsub
- **Storage:** Firebase Storage
- **Notifications:** SendGrid

The platform enables social impact project creators to receive funding and independent auditors to verify project outcomes.

---

## 📚 DOCUMENTATION HIERARCHY - MANDATORY READING ORDER

### Phase 1: Architecture & Strategy
**ALWAYS CONSULT BEFORE MAKING CHANGES:**
1. `./Docs MVP/claude_code_documentation_usage_guide.md` - How to use documentation
2. `./Docs MVP/llm_project_structure.md` - Complete project architecture
3. `./mvp-development-plan.md` - Strategic development plan
4. `./initial-prompt.md` - Project initialization context

### Phase 2: Technical Specifications
**READ BEFORE IMPLEMENTING FEATURES:**
1. `./Docs MVP/firebase_functions_specs.md` - Complete Firebase Functions specifications
2. `./Docs MVP/firestore_data_model.md` - Database schema and data models
3. `./Docs MVP/backend_api_documentation.md` - All API endpoints documentation
4. `./Docs MVP/llm_code_templates.md` - Exact code templates to use

### Phase 3: Advanced Features & Operations
**REFERENCE DURING IMPLEMENTATION:**
1. `./Docs MVP/backend_security_integrations.md` - Security patterns and integrations
2. `./Docs MVP/backend_webhooks_endpoints.md` - Webhook handling patterns
3. `./Docs MVP/backend_automated_troubleshooting.md` - Debugging and troubleshooting
4. `./Docs MVP/llm_validation_testing.md` - Testing requirements and patterns

---

## 🔒 CRITICAL DEVELOPMENT RULES

### 1. Sequential Development Order
- **NEVER skip steps** in `./Docs MVP/llm_development_execution_plan.md`
- Generate **exactly 86 files** in the precise order specified
- **Validate after every 5 files** using `npm run build`
- Complete one phase entirely before moving to the next

### 2. Code Quality Standards
- **ALL code MUST pass TypeScript strict mode** compilation
- **Every function MUST have ≥80% test coverage**
- Use **EXACT templates** from `llm_code_templates.md`
- Match **API specifications** in `backend_api_documentation.md` exactly
- Follow **TypeScript best practices** and idiomatic patterns
- Use proper **error handling** with try-catch blocks
- Implement **proper logging** for debugging and monitoring

### 3. Security Requirements (NON-NEGOTIABLE)
- **Every Firebase Function MUST verify authentication** before processing
- **All user inputs MUST be validated** using Joi schemas
- **Never expose sensitive data** in logs or error messages
- **Always sanitize database queries** to prevent injection attacks
- Follow **least privilege principle** for permissions
- Implement **rate limiting** on all public endpoints
- Use **secure environment variables** for sensitive configuration

### 4. Firestore Data Access Patterns
- **Always use transactions** for multi-document updates
- **Implement proper error handling** for all Firestore operations
- **Use batched writes** when updating multiple documents
- **Validate document existence** before operations
- **Use proper indexes** as defined in `firestore.indexes.json`
- **Follow data model** specified in `firestore_data_model.md`

### 5. API Response Standards
- **Always return consistent response format:**
  ```typescript
  // Success
  { success: true, data: {...}, message?: string }
  
  // Error
  { success: false, error: string, code?: string }
  ```
- **Use appropriate HTTP status codes:**
  - 200: Success
  - 201: Created
  - 400: Bad Request
  - 401: Unauthorized
  - 403: Forbidden
  - 404: Not Found
  - 500: Internal Server Error
- **Include request correlation IDs** for tracing
- **Log all API calls** with relevant context

### 6. Firestore Rules Synchronization (AUTOMATED)
- **CRITICAL:** The file `backend/functions/firestore.rules` is the **SOURCE OF TRUTH**
- **AFTER EVERY MODIFICATION** of `firestore.rules`, **AUTOMATICALLY execute:**
  ```bash
  npm run sync:firestore-rules
  ```
- **This script synchronizes** `firestore.rules` to all required locations:
  - `backend/functions/firestore.rules` → `firestore.rules` (project root)
- **Always verify** synchronization completed successfully before committing changes
- **If synchronization fails**, investigate immediately before proceeding
- **Never manually copy** `firestore.rules` - always use the sync script
- **Backup files** are automatically created at `*.backup-TIMESTAMP` for safety

---

## 🚨 CONTEXT-AWARE DEVELOPMENT

### Before Every Response or Action:
1. ✅ **Check project specifications** in `./Docs MVP/` folder
2. ✅ **Verify development plan sequence** is followed
3. ✅ **Confirm you have ALL necessary information** (if not, ASK)
4. ✅ **Consider impact on existing functionalities** (avoid regressions)
5. ✅ **Verify alignment with overall architecture**

### After Every Response or Action:
1. 📋 **Provide a summary** of what was done
2. 📋 **Indicate what remains** to be completed
3. 📋 **Highlight any dependencies** or blockers
4. 📋 **Mention required frontend changes** if applicable

---

## 🔄 FRONTEND-BACKEND COORDINATION

### When Frontend Changes Are Required:
**ALWAYS create comprehensive documentation** following this structure:

```markdown
## [ISSUE-NAME] - Frontend Changes Required

### 🔴 Priority: [CRITICAL/HIGH/MEDIUM/LOW]
### ⚙️ Complexity: [Simple/Medium/Complex]

### Problem Description
[Clear explanation of the issue and root cause]

### Files to Modify
- `path/to/file.tsx` - Line XX-XX
- `path/to/another/file.ts` - Line YY-YY

### BEFORE (Current Code)
```typescript
// Show exact current code
```

### AFTER (Required Code)
```typescript
// Show complete, production-ready solution
```

### Implementation Steps
1. Step-by-step instructions
2. With exact commands if needed
3. Include testing instructions

### Impact Analysis
- Why this change is necessary
- What will break if not fixed
- Dependencies on other components

### Validation Checklist
- [ ] Feature X works correctly
- [ ] No console errors
- [ ] Data flows as expected
- [ ] Edge cases handled

### Alternative Solutions (if applicable)
**Option A:** [Description] - Pros/Cons
**Option B:** [Description] - Pros/Cons
```

---

## 🛠️ PRACTICAL CODING GUIDELINES

### TypeScript/Firebase Functions

#### Authentication Check Pattern
```typescript
export const functionName = onCall({ cors: true }, async (request) => {
  // 1. Verify authentication
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const userId = request.auth.uid;
  
  // 2. Validate input
  const schema = Joi.object({
    field: Joi.string().required(),
    // ...
  });
  
  const { error, value } = schema.validate(request.data);
  if (error) {
    throw new HttpsError('invalid-argument', error.details[0].message);
  }
  
  try {
    // 3. Business logic
    // ...
    
    // 4. Return success
    return { success: true, data: result };
  } catch (err) {
    logger.error('Error in functionName', { userId, error: err });
    throw new HttpsError('internal', 'Operation failed');
  }
});
```

#### Firestore Transaction Pattern
```typescript
await db.runTransaction(async (transaction) => {
  const docRef = db.collection('collectionName').doc(docId);
  const doc = await transaction.get(docRef);
  
  if (!doc.exists) {
    throw new Error('Document not found');
  }
  
  // Perform updates
  transaction.update(docRef, {
    field: newValue,
    updatedAt: FieldValue.serverTimestamp(),
  });
  
  return doc.data();
});
```

### Django/Python Backend

#### View Pattern
```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def function_name(request):
    """
    Brief description of what this view does.
    """
    try:
        # 1. Validate input
        serializer = DataSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({
                'success': False,
                'error': serializer.errors
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # 2. Business logic
        result = perform_operation(serializer.validated_data)
        
        # 3. Return success
        return Response({
            'success': True,
            'data': result
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f'Error in function_name: {str(e)}')
        return Response({
            'success': False,
            'error': 'Internal server error'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

---

## 🧪 TESTING REQUIREMENTS

### Every Function Must Include:
1. **Unit tests** for all business logic
2. **Integration tests** for API endpoints
3. **Mock tests** for external services (Stripe, Sumsub, etc.)
4. **Edge case tests** (empty data, invalid formats, etc.)
5. **Error handling tests** (network failures, timeouts, etc.)

### Test File Pattern:
```typescript
import { functionName } from '../functionName';

describe('functionName', () => {
  beforeEach(() => {
    // Setup
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  it('should succeed with valid input', async () => {
    // Arrange
    const input = { ... };
    
    // Act
    const result = await functionName(input);
    
    // Assert
    expect(result.success).toBe(true);
  });
  
  it('should fail with invalid input', async () => {
    // Test error cases
  });
  
  it('should handle edge cases', async () => {
    // Test edge cases
  });
});
```

---

## 🌍 INTERNATIONALIZATION (i18n)

This application **must support multiple languages**.

### Rules:
- **Never hardcode user-facing strings** in code
- Use **i18n keys** for all UI text
- Store translations in appropriate i18n files
- Consider **locale-specific formatting** (dates, numbers, currency)
- Test with **multiple languages** enabled

```typescript
// ❌ BAD
throw new HttpsError('invalid-argument', 'Email is required');

// ✅ GOOD
throw new HttpsError('invalid-argument', i18n.t('errors.emailRequired'));
```

---

## 📊 LOGGING & MONITORING

### Logging Standards:
```typescript
import { logger } from 'firebase-functions';

// Info: General information
logger.info('User profile updated', { userId, changes });

// Warning: Potentially problematic situations
logger.warn('Rate limit approaching', { userId, requestCount });

// Error: Errors requiring attention
logger.error('Payment processing failed', { userId, error, orderId });

// Debug: Detailed diagnostic information (development only)
logger.debug('Processing step completed', { step, data });
```

### What to Log:
- ✅ All API calls with userId and timestamp
- ✅ All errors with full context
- ✅ Business-critical operations (payments, audits, etc.)
- ✅ Performance metrics for slow operations
- ❌ Sensitive data (passwords, tokens, PII)
- ❌ Excessive debug information in production

---

## 🚀 TERMINAL & COMMAND EXECUTION

### Environment Preference:
- Use **Command Prompt (cmd)** by default on Windows
- Only use PowerShell when explicitly required
- Always explain the purpose of commands before executing

### Common Commands:
```bash
# Firebase Functions
cd backend/functions
npm run build              # Compile TypeScript
npm run test              # Run tests
npm run lint              # Lint code
firebase emulators:start  # Start local emulators

# Django Backend
python manage.py runserver        # Start dev server
python manage.py migrate         # Run migrations
python manage.py test            # Run tests
python manage.py collectstatic   # Collect static files
```

---

## ⚠️ ABSOLUTE PROHIBITIONS

### NEVER:
- ❌ Skip documentation reading
- ❌ Generate files out of execution sequence
- ❌ Use mock data instead of real production-ready logic
- ❌ Hardcode sensitive credentials or API keys
- ❌ Ignore error handling
- ❌ Deploy without testing
- ❌ Make breaking changes without documenting frontend impact
- ❌ Use deprecated APIs or libraries
- ❌ Create temporary solutions that will need refactoring later
- ❌ Ignore TypeScript compilation errors
- ❌ Bypass authentication checks
- ❌ Commit commented-out code or debug logs

### ALWAYS:
- ✅ Ask for clarification when requirements are unclear
- ✅ Consider the full project context before making changes
- ✅ Test thoroughly before considering a feature complete
- ✅ Document complex logic with inline comments
- ✅ Update relevant documentation when changing functionality
- ✅ Think about scalability and performance
- ✅ Consider security implications of every change
- ✅ Write production-ready, maintainable code

---

## 🎓 LEARNING & ADAPTATION

### When Encountering Errors:
1. **Analyze the full context** - Don't fix in isolation
2. **Check project specifications** - Ensure fix aligns with requirements
3. **Consider side effects** - Will this break other features?
4. **Test thoroughly** - Verify fix doesn't introduce new issues
5. **Document if needed** - Update docs if behavior changes

### When Implementing New Features:
1. **Review the development plan** - Is this the right time?
2. **Check dependencies** - What needs to be done first?
3. **Read relevant documentation** - Follow exact specifications
4. **Use provided templates** - Don't reinvent patterns
5. **Write tests first** - TDD approach when possible
6. **Validate incrementally** - Test as you build

---

## 📋 SUMMARY TEMPLATE

After completing any task, provide a summary using this format:

```markdown
## ✅ Completed Actions
- [List what was done]
- [Include files modified/created]
- [Mention tests written/run]

## 📌 Current Status
- [Current phase/step in development plan]
- [Overall progress percentage if applicable]

## 🔜 Next Steps
1. [Immediate next action]
2. [Subsequent actions]
3. [Any blockers or dependencies]

## ⚠️ Frontend Actions Required (if applicable)
- [List any frontend changes needed]
- [Reference documentation created]

## 🐛 Known Issues (if any)
- [List any issues discovered]
- [Planned resolution approach]
```

---

## 🤝 COLLABORATION PRINCIPLES

### Communication:
- Be **clear and concise** in explanations
- Ask questions when **any information is missing**
- Explain **complex technical decisions**
- Provide **context for trade-offs**

### Code Reviews:
- Consider **readability and maintainability**
- Check **consistency with project patterns**
- Verify **proper error handling**
- Ensure **adequate test coverage**

### Problem Solving:
- **Think before coding** - Plan the approach
- **Consider alternatives** - Is there a better way?
- **Optimize when necessary** - But prioritize clarity first
- **Refactor with confidence** - But test thoroughly

---

## 🎯 SUCCESS CRITERIA

A feature is **COMPLETE** only when:
- ✅ Code compiles without errors or warnings
- ✅ All tests pass with ≥80% coverage
- ✅ API documentation is updated
- ✅ Security requirements are met
- ✅ Frontend changes are documented (if needed)
- ✅ Code follows project patterns and standards
- ✅ Performance is acceptable (no obvious bottlenecks)
- ✅ Error handling is comprehensive
- ✅ Logging is appropriate
- ✅ No regressions in existing features

---

## 📞 GETTING HELP

### When Stuck:
1. **Check documentation first** - Answer is likely there
2. **Review similar implementations** - Look for patterns
3. **Ask specific questions** - Provide context and what you've tried
4. **Propose solutions** - Suggest approaches for validation

### Resources:
- `./Docs MVP/` - Complete technical specifications
- `./claude-rules.md` - Development rules and patterns
- `./DOCUMENTATION_INDEX.md` - Quick reference to all docs
- Firebase documentation: https://firebase.google.com/docs
- TypeScript handbook: https://www.typescriptlang.org/docs/

---

**Last Updated:** January 2026
**Maintained by:** Development Team
**For:** GitHub Copilot AI Assistant in VS Code
