# GoodJobs — Infrastructure for Social Good

## Overview

GoodJobs is an India-first nonprofit operating system designed to streamline operations for social good organizations. It features an agentic FastAPI backend and a React (Vite) frontend. The platform aims to provide a comprehensive solution for NGOs, covering areas from FCRA-compliant fund accounting and AI-driven workflows to donor management and regulatory compliance (DPDP Act 2023). Key capabilities include WhatsApp-first field data entry, automated 80G receipt generation, and a robust suite of tools for CRM, CSR prospecting, fundraising, and volunteer management. The project's vision is to empower nonprofits with efficient, intelligent, and compliant infrastructure, facilitating their impact and growth.

## User Preferences

The user wants the agent to understand and maintain the existing design language, including specific color palettes, shadow designs, and radii. The user prefers the agent to prioritize high-level features and architectural decisions over granular implementation details. The user also wants the agent to respect existing module interdependencies and established cross-module workflows. The user expects the agent to use `npm` for frontend package management and `pip` for backend. When working with the backend, the agent should recognize `localhost:8000` for development and use in-memory demo stores if `DATABASE_URL` is not set.

## System Architecture

The system comprises a React 19 + TypeScript + Vite frontend served on port 5000, and a FastAPI + Uvicorn Python backend intended for port 8000. State management on the frontend uses Zustand, with UI components built with framer-motion, lucide-react, and react-hot-toast. Authentication is JWT-based with role-based access control using `python-jose`.

### UI/UX Design

The design language is centralized in `src/index.css` using CSS variables for consistency.
- **Primary Color**: `#0F766E` (teal-700), with defined hover and active states.
- **Active Accent**: `#2DD4BF` (teal-400) for active rail and brand marks.
- **Secondary Accent**: `#7C3AED` (violet-600) for AI/Copilot identity, replacing older indigo tones.
- **Gradients**: Sidebar/auth uses a `#0d3d39 → #134e4a → #0F766E` gradient.
- **Text Contrast**: Specific `text-primary`, `text-secondary`, `text-tertiary`, and `text-muted` tokens ensure AA accessibility standards.
- **Shadows**: Neutral-tinted layered drop shadows (`--shadow-sm/md/lg/xl`) and a brand-tinted `--shadow-primary` for CTAs.
- **Radii**: Modern, purposeful curve with defined `xs` to `2xl` values.
- **Semantic Colors**: Dedicated `*-text` tokens for consistent badge and delta colors.

### Technical Implementations and Features

- **Onboarding**: Features a public signup flow with mock Google OAuth and email verification, followed by a 5-step Signup Wizard (Org Profile, First Program, Invite Team, Import Beneficiaries, Connect WhatsApp). The wizard is gated, redirecting users to `/onboarding` until `user.needsWizard` is false.
- **Trial Management**: A 30-day trial is tracked per organization (`localStorage.gj_org_billing_v1`), with nudges at day 7, 21, and 28. Trial expiration enforces `subscriptionTier='starter'` with predefined limits (e.g., 50 beneficiaries).
- **Today Screen (Dashboard)**: Displays "Yesterday's wins," priority sections (Urgent, Needs Attention, Going Well), and role-based quick actions. Features inline action execution for tasks like receipt generation and WhatsApp follow-ups.
- **Agent HQ (AI Copilot)**: Implements a Human-in-the-Loop (HITL) intent card system with risk badges, evidence packs, impact previews, reversibility badges, and live countdown timers. Supports Approve/Modify/Reject actions for AI-generated intents.
- **Finance & FCRA**: Includes an FCRA Admin Overhead Monitor with a real-time 4-level gauge and animated progress bar, displaying percentage readout, headroom, and detailed breakdown.
- **Insights (M&E)**: Provides KPI cards with sector-average benchmarks, AI interpretation panels, campaign bar charts, staff-wise data quality breakdown, and one-click funder-formatted CSV export.
- **Programs**: Features CSV import with real-time duplicate detection based on name and phone number.
- **Cross-Module Integrations**:
    - **Programs ↔ Finance**: `ProgramBudgetBar` for planned vs. spent tracking and restricted-grant alerts.
    - **Beneficiary → Outcomes**: Violet Activity icon opens `OutcomeForm` for measuring outcomes.
    - **Outcomes Aggregate**: `OutcomesAggregateCard` on Insights shows measured beneficiaries, output-to-outcome ratio, and SROI.
    - **Grant Lifecycle**: `GrantTrancheCard` with gated release based on utilization reports.
    - **MIS → Supervisor Review**: Conversational MIS submissions route to a HITL `MisReviewQueue` in Agent HQ, requiring supervisor approval.
    - **Notification → Action**: `NotificationCenter` supports deep-links, snooze, and dismiss controls.
    - **Volunteer ↔ Program**: `volunteerAssignments` track hours/role/last-visit, rolled up in `ProgramEffortSummary`.
    - **Compliance → Grant Cascade**: `complianceGrantLinks` flag grants with expiring or expired linked documents, surfaced as an `AtRiskGrantsBanner` and `ComplianceCascadeQueue` in Agent HQ.
    - **Donor → Program → Impact Trail**: `DonorImpactPanel` tracks donor impact through campaigns and programs to measured outcomes.
    - **Finance ↔ Grant Budget Heads**: Expenses are tagged to specific grant budget heads, with real-time utilization tracking and sanity checks. The Finance page includes a "Tag expenses to grants" card and an "Expenses by grant" CSV export.
    - **Add Program**: Explicit "Add Program" functionality now allows creating new programs independently of beneficiaries, merging derived and custom programs in selection dropdowns.

### System Design Choices

- **Project Structure**: Organized into `src` (React frontend), `public` (static assets), and `backend` (FastAPI backend). Backend includes `api`, `core` (Auth, DB, AI, analytics), `agents` (LangGraph), and `jobs`.
- **Deployment Target**: Static, with `npm run build` outputting to the `dist` directory.
- **Navigation**: Seven primary routes within a main Layout, plus legacy module pages.
- **Backend Persistence**: Falls back to in-memory demo stores if `DATABASE_URL` is not set.
- **Per-User Isolation**: Unique IDs based on email ensure isolated onboarding and trial states.

## External Dependencies

- **Frontend Framework**: React 19
- **Frontend Build Tool**: Vite
- **Frontend Language**: TypeScript
- **Frontend Package Manager**: npm
- **Backend Framework**: FastAPI
- **Backend Server**: Uvicorn
- **Backend Language**: Python
- **Backend Package Manager**: pip
- **State Management**: Zustand
- **UI Libraries**: framer-motion, lucide-react, react-hot-toast
- **Authentication**: python-jose (JWT)
- **AI/Agent Frameworks**: LangChain, LangGraph
- **Database**: (Implied, but not explicitly named - relies on `DATABASE_URL` environment variable)
- **Messaging**: WhatsApp (for field data entry and follow-ups)
- **OAuth**: Google OAuth (mocked for signup)