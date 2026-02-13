# Claude Code Development Rules - Social Finance Impact Platform Backend

## DOCUMENTATION USAGE - CRITICAL
RULE: ALWAYS read claude_code_documentation_usage_guide.md FIRST
RULE: Follow the 3-phase reading order specified in the guide
RULE: Use the exact validation patterns described in the guide

## MANDATORY EXECUTION ORDER  
RULE: NEVER generate files out of sequence in llm_development_execution_plan.md
RULE: Generate exactly 86 files in the precise order specified
RULE: Validate after every 5 files using npm run build

## CODE QUALITY STANDARDS
RULE: Every file MUST pass TypeScript strict mode compilation
RULE: Every function MUST have >80% test coverage
RULE: Use EXACT templates from llm_code_templates.md
RULE: Match API specs in backend_api_documentation.md exactly

## SECURITY REQUIREMENTS
RULE: Every Firebase Function MUST verify authentication
RULE: All user inputs MUST be validated with Joi schemas
RULE: Follow backend_security_integrations.md patterns precisely

## OTHERS
RULE: Whenever you need to fix an error, make sure to consider the project specifications and the implementation context of the code in relation to the overall project. Correcting an error in isolation—without accounting for the broader project and its specifications—may lead to an irrelevant or inappropriate fix. Also ensure that your corrections do not introduce new issues or cause regressions in other existing functionalities.
RULE: If resolving an error or modifying a feature requires adjustments or actions on the frontend side, inform me clearly and in detail. Specify exactly what needs to be done on the frontend to ensure everything works properly, taking into account the application's specifications and the implementation context of the code or feature in question.
RULE: If you need any information from me—no matter how minor—in order to perform a task correctly and appropriately, ask for it.
RULE: For each of your responses, verify that it does not negatively impact or cause regressions in other functionalities that are already working.
RULE: Before providing any response or taking any action, check whether you have all the necessary information to deliver the expected and effective response or action. If not, ask me the relevant questions.
RULE: After giving a response or performing an action, provide a summary of what has already been done and what remains to be done.

## FRONTEND CORRECTIONS PROTOCOL
RULE: When identifying issues that require frontend corrections, ALWAYS create a comprehensive documentation file (e.g., FRONTEND_CORRECTIONS_REQUISES.md) that includes:
  - Clear problem description with root cause analysis
  - Exact file paths and line numbers where changes are needed (when known)
  - Complete, production-ready code examples showing BEFORE and AFTER states
  - Step-by-step implementation instructions
  - Impact analysis explaining why each change is necessary
  - Validation checklist to verify the fix works correctly
  - Alternative solutions when applicable, with pros/cons for each
  - Security and performance considerations
  - Migration path for existing data if needed
RULE: Code examples provided for frontend corrections must be:
  - Complete and ready to use (not pseudo-code)
  - Follow the project's existing code style and architecture
  - Include proper error handling and edge cases
  - Include comments explaining critical logic
  - Show the full context, not just snippets
RULE: For each frontend issue, clearly indicate:
  - Priority level (CRITICAL, HIGH, MEDIUM, LOW)
  - Estimated complexity (Simple, Medium, Complex)
  - Dependencies on other fixes or backend changes
  - Whether the issue blocks core functionality
RULE: When frontend issues stem from backend-frontend inconsistencies (e.g., different field names, incompatible data models), document BOTH sides and explain how to align them.
RULE: Always provide a summary table of all required frontend actions for quick reference.

ABSOLUTE PROHIBITION: Never skip documentation reading or execution sequence.