# Project: Industrial Jenkins MCP Server
**Role:** Senior DevOps AI Architect
**Context:** Director of Engineering leading a transition to Agentic AI workflows.

## Objectives
Build a production-grade MCP server for Jenkins Open Source to enable:
1. Automated build status monitoring and failure analysis.
2. Model-controlled build triggering with human-in-the-loop safety.
3. Resource streaming for real-time Jenkins console logs.

## Technical Stack
- **Language:** TypeScript (Node.js 20+)
- **Protocol:** Model Context Protocol (MCP) @modelcontextprotocol/sdk
- **Transport:** stdio (Development) -> SSE (Production)
- **Validation:** Zod for runtime type safety.

## Key Primitives to Implement
- **Tools:** `list_jobs`, `get_build_status`, `trigger_build`
- **Resources:** `jenkins://{job}/logs/{id}` for console output.
- **Prompts:** `analyze-failure` (Template for debugging log errors).

## Safety Guardrails
- All "Write" actions (triggering/stopping builds) must return a confirmation request.
- Use environment variables for JENKINS_URL and JENKINS_TOKEN.