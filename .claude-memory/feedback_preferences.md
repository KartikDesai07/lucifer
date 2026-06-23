---
name: feedback-preferences
description: How the user wants Claude to behave — confirmed preferences and working style
metadata:
  type: feedback
---

# Collaboration Preferences

## Review Before Code
**Rule:** Always review and understand the full codebase before making any changes. No code edits until explicitly instructed.

**Why:** User asked specifically — "abhi code side koi change nahi karna hai" (no code changes right now). First understand everything.

**How to apply:** Treat every new session as: read → understand → plan → only then code (when asked).

## .claude-memory is the Memory Store
**Rule:** Use `.claude-memory/` (at project root) for all persistent memory files, NOT the global Claude memory path.

**Why:** User explicitly specified `.claude-memory` folder for project-level memory.

**How to apply:** Write all project memory files to `f:\lucifer\.claude-memory\`. Update MEMORY.md index whenever adding a new file.

## Proper Folder Structure Matters
**Rule:** `.claude/` folder must have `skills/`, `hooks/`, and `research/` subfolders. Keep them organized.

**Why:** User asked for this structure explicitly before any implementation work.

**How to apply:** Before adding any skill or research doc, place it in the correct subfolder.

## Hindi/English Mix is Normal
**Rule:** User communicates in Hinglish. Respond in clear English (or match their language if they prefer).

**Why:** This is the user's natural communication style — don't flag it or ask them to use one language.

**How to apply:** Parse Hinglish naturally. Respond in plain English unless user switches.

## Single Restaurant Scope
**Rule:** Keep all suggestions scoped to one restaurant. Don't suggest multi-tenant patterns.

**Why:** User confirmed: "only one restaurant ke liye hai".

**How to apply:** No `restaurantId` fields, no tenant isolation, no org-level abstractions.

## Smoothness > defensive friction (Login rate limiting SKIPPED)
**Rule:** Do NOT implement login/auth rate limiting. Decided 2026-06-21 (Phase 8, Step 8.1).
This intentionally overrides CLAUDE.md §8's rate-limiting mandate and the Phase 8 checkpoint.

**Why:** Internal single-cafe POS — only 1 admin + N staff log in, no public sign-up, so
brute-force risk is low. User's hard priority is a *very smooth* panel during service:
"rate limit skip karo ... customer aaye and panel me rate limit issue aaye wo bilkul nahi
chalega" — a limiter that locks out real staff mid-rush is worse than the risk it prevents.

**How to apply:** Never add a login limiter (in-memory or otherwise). More broadly, prefer
the smooth-for-staff path over defensive friction unless the user asks. If revisited, the
only viable store is a Mongo-backed counter inside `authorize()` (host-agnostic) — NOT an
in-memory Map (per-isolate false security on Workers/serverless) and NOT middleware (its
matcher excludes /api).
