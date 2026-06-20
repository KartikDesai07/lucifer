# Implementation Plan — Lucifer Cafe POS

> Each phase is one session. Complete the checkpoint before moving to the next phase.
> New session = new phase. Always start by reading CLAUDE.md + memory.

## Phase Overview

| Phase | Name | Est. Time | Status |
|-------|------|-----------|--------|
| [0](phase-00-foundation.md) | Foundation & Migration to Next.js | 1 day | ⏳ Pending |
| [1](phase-01-auth.md) | Authentication & Role System | 1 day | ⏳ Pending |
| [2](phase-02-database.md) | Database Models & Seed Data | 1 day | ⏳ Pending |
| [3](phase-03-core-api.md) | Core API Routes + Caching | 2 days | ⏳ Pending |
| [4](phase-04-pos-terminal.md) | POS Terminal UI + Order Flow | 2 days | ⏳ Pending |
| [5](phase-05-management.md) | Management Pages (Products, Customers, Staff, etc.) | 2 days | ⏳ Pending |
| [6](phase-06-dashboard-reports.md) | Dashboard + Reports + Analytics | 1.5 days | ⏳ Pending |
| [7](phase-07-billing-printing.md) | Billing, Receipts & Printing | 1 day | ⏳ Pending |
| [8](phase-08-security-polish.md) | Security Hardening + Polish + Migration | 1.5 days | ⏳ Pending |
| [9](phase-09-deploy.md) | Deploy to Vercel + MongoDB Atlas + Cloudinary | 0.5 day | ⏳ Pending |

**Total estimated:** 13–15 days of focused work

## Dependency Map

```
Phase 0 (Foundation)
    ↓
Phase 1 (Auth)         ← Blocks everything else
    ↓
Phase 2 (DB Models)    ← Blocks API
    ↓
Phase 3 (Core API)     ← Blocks UI pages
    ↓
Phase 4 (POS)  Phase 5 (Management)  ← Can run in parallel
    ↓                ↓
Phase 6 (Dashboard + Reports)
    ↓
Phase 7 (Billing + Printing)
    ↓
Phase 8 (Security + Polish)
    ↓
Phase 9 (Deploy)
```

## Status Legend
- ⏳ Pending — not started
- 🔄 In Progress — current session
- ✅ Complete — checkpoint passed
- ❌ Blocked — dependency not met
