---
name: project-overview
description: High-level overview of Lucifer Cafe POS — purpose, scope, and current state
metadata:
  type: project
---

# Lucifer Cafe POS — Project Overview

**What it is:** A single-restaurant POS and management system inspired by PetPooja, but simpler. Not multi-tenant. One cafe, one shared data pool, all staff use same account space.

**Built with:** Lovable.dev (AI-generated React app). Base is solid UI-first code with no backend API layer.

**Current state (as of 2026-06-20):**
- All data lives in either `localStorage` (offline) or a single Supabase `app_kv` JSONB table (cloud)
- No proper normalized database schema
- No backend API — frontend queries Supabase directly
- Deployed to Cloudflare Workers

**What the user wants to build:**
- Proper MongoDB backend with Express API
- Frontend stays React but connects to Express API instead of Supabase directly
- Keep all existing UI/UX — just swap the data layer
- One restaurant only (no multi-tenancy needed)

**Why:** PetPooja-type features but lightweight, self-hosted, owned by the restaurant itself.

**How to apply:** All suggestions should assume single-restaurant, shared staff model. No per-user isolation needed. Keep UI changes minimal — this is a backend/data layer migration.
