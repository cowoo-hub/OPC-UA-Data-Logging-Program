# AGENTS.md

## Project goal
Build a simulator-first industrial IO-Link monitor that later supports real ICE2 hardware, ISDU, OPC UA, and AI diagnostics.

## Current phase
Phase 2: Frontend PDI monitor only.

## Rules
- Do not break existing backend API contracts.
- Prefer clean reusable TypeScript components.
- Keep the UI dark, premium, industrial, and modern.
- Keep future extension in mind for ISDU, OPC UA, AI diagnostics, and multi-page layout.
- Avoid unnecessary dependencies.
- Always inspect current backend code before changing frontend API assumptions.

## Run commands
- Backend: uvicorn app:app --reload
- Frontend: npm install && npm run dev
