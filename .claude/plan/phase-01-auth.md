# Phase 1 — Authentication & Role System

**Status:** ⏳ Pending  
**Prerequisites:** Phase 0 complete (Next.js running, MongoDB connected)  
**Estimated time:** 1 day

---

## Goal

Full authentication system:
- Admin can log in with username + password
- Staff added by admin can log in
- Role-based access: admin vs staff
- All dashboard routes protected — redirect to `/login` if no session
- Admin-only routes return 403 for staff
- Secure JWT session via Auth.js v5

---

## Steps

### Step 1.1 — Create auth.config.ts (edge-compatible)
This is used by middleware — must NOT import Mongoose or Node-only modules.
```typescript
// auth.config.ts
import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

export default {
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      // Authorize is NOT here — it needs bcrypt (Node-only)
      // Actual verify happens in auth.ts
      async authorize() { return null }
    })
  ],
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnDashboard = nextUrl.pathname.startsWith('/')
        && !nextUrl.pathname.startsWith('/login')
        && !nextUrl.pathname.startsWith('/api')
      if (isOnDashboard) return isLoggedIn
      if (isLoggedIn) return Response.redirect(new URL('/', nextUrl))
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      ;(session.user as any).role = token.role
      return session
    },
  },
} satisfies NextAuthConfig
```

### Step 1.2 — Create Staff model
```typescript
// models/Staff.ts
import mongoose, { Schema, Document } from 'mongoose'

export interface IStaff extends Document {
  name: string
  mobile: string
  username: string
  password: string
  role: 'admin' | 'staff'
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const staffSchema = new Schema<IStaff>({
  name:     { type: String, required: true, trim: true },
  mobile:   { type: String, required: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false }, // never returned by default
  role:     { type: String, enum: ['admin', 'staff'], default: 'staff' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

export const Staff = mongoose.models.Staff ?? mongoose.model<IStaff>('Staff', staffSchema)
```

### Step 1.3 — Create auth.ts (full auth with bcrypt)
```typescript
// lib/auth.ts
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { connectDB } from './db'
import { Staff } from '@/models/Staff'
import authConfig from '../auth.config'

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null
        
        await connectDB()
        const staff = await Staff.findOne({ 
          username: credentials.username, 
          isActive: true 
        }).select('+password')
        
        if (!staff) return null
        
        const isValid = await bcrypt.compare(credentials.password as string, staff.password)
        if (!isValid) return null
        
        return { id: staff._id.toString(), name: staff.name, role: staff.role }
      }
    })
  ],
  session: { strategy: 'jwt' },
})
```

### Step 1.4 — Create middleware.ts
```typescript
// middleware.ts
import NextAuth from 'next-auth'
import authConfig from './auth.config'

export const { auth: middleware } = NextAuth(authConfig)

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
}
```

### Step 1.5 — Create API auth route
```typescript
// app/api/auth/[...nextauth]/route.ts
import { handlers } from '@/lib/auth'
export const { GET, POST } = handlers
```

### Step 1.6 — Create seed script for admin
```typescript
// scripts/seed-admin.ts
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

async function seedAdmin() {
  await mongoose.connect(process.env.MONGODB_URI!)
  
  const { Staff } = await import('../models/Staff')
  
  const exists = await Staff.findOne({ role: 'admin' })
  if (exists) {
    console.log('Admin already exists:', exists.username)
    process.exit(0)
  }
  
  const password = await bcrypt.hash('Admin@123', 12)
  await Staff.create({
    name: 'Admin',
    username: 'admin',
    mobile: '0000000000',
    password,
    role: 'admin',
    isActive: true,
  })
  
  console.log('Admin created. Username: admin, Password: Admin@123')
  console.log('CHANGE THE PASSWORD AFTER FIRST LOGIN!')
  process.exit(0)
}

seedAdmin().catch(console.error)
```

Add to package.json:
```json
"scripts": {
  "seed:admin": "ts-node --project tsconfig.json scripts/seed-admin.ts"
}
```

### Step 1.7 — Update Login page with auth logic
```typescript
// app/(auth)/login/page.tsx
'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Full login form with username/password
// On submit: call signIn('credentials', { username, password, redirect: false })
// On success: redirect to '/'
// On error: show error message "Invalid username or password"
// Loading state on submit button
```

### Step 1.8 — Create useSession wrapper hook
```typescript
// hooks/use-auth.ts
'use client'
import { useSession, signOut } from 'next-auth/react'

export function useAuth() {
  const { data: session, status } = useSession()
  
  const isAdmin = session?.user && (session.user as any).role === 'admin'
  const isStaff = session?.user && (session.user as any).role === 'staff'
  const isLoading = status === 'loading'
  
  return {
    user: session?.user,
    role: (session?.user as any)?.role,
    isAdmin,
    isStaff,
    isLoading,
    logout: () => signOut({ callbackUrl: '/login' }),
  }
}
```

### Step 1.9 — Update dashboard layout with session provider
```typescript
// app/layout.tsx — wrap with SessionProvider
import { SessionProvider } from 'next-auth/react'
import { auth } from '@/lib/auth'

export default async function RootLayout({ children }) {
  const session = await auth()
  return (
    <html>
      <body>
        <SessionProvider session={session}>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
```

### Step 1.10 — Update Sidebar to show user + role badge
- Show logged-in user name in sidebar footer
- Show "Admin" badge if admin role
- Show logout button
- Hide "Staff" menu item for staff role (show only for admin)

### Step 1.11 — Create admin-only route guard component
```typescript
// components/shared/AdminGuard.tsx
'use client'
import { useAuth } from '@/hooks/use-auth'
import { redirect } from 'next/navigation'

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth()
  if (isLoading) return <LoadingSkeleton />
  if (!isAdmin) redirect('/')
  return <>{children}</>
}
```

### Step 1.12 — Create change password API + UI
```
POST /api/staff/change-password
Body: { currentPassword, newPassword }
Auth: any logged-in user (changes their own password)
```
- Verify current password with bcrypt.compare
- Hash new password with bcrypt.hash (12 rounds)
- Update Staff document

---

## Checkpoint Criteria

- [ ] `npm run dev` — visit `/` → redirects to `/login`
- [ ] Login with `admin / Admin@123` → redirects to dashboard
- [ ] Sidebar shows "Admin" badge
- [ ] `/login` with wrong password → shows error message
- [ ] API route `GET /api/auth/session` returns user + role
- [ ] Direct access to `/staff` (admin only) by staff user → redirects to `/`
- [ ] `npm run build` passes with 0 errors

---

## Files Created This Phase

```
auth.config.ts
lib/auth.ts
middleware.ts
models/Staff.ts
hooks/use-auth.ts
app/api/auth/[...nextauth]/route.ts
app/(auth)/login/page.tsx (updated with logic)
app/(dashboard)/layout.tsx (updated with session provider)
components/shared/AdminGuard.tsx
scripts/seed-admin.ts
```

---

## Security Notes

- Password field: `select: false` on Staff model — never returned in queries
- `bcrypt` rounds: 12 (takes ~250ms — rate-limit friendly)
- JWT strategy: stateless, no DB session table
- Change default password immediately after first login
- Admin username should be changed from `admin` to something less guessable

---

## Next Session Prompt

```
Phase 2 — Database Models & Seed Data

Context: Phase 1 complete. Auth works. Admin can log in. Role-based access is working.
Staff model created with admin account seeded.

Resume from: Step 2.1 — Create Product model
Check: Run `npm run build` — must pass. Test login works at /login.

Read CLAUDE.md, .claude-memory/MEMORY.md, .claude/plan/phase-02-database.md before starting.
```
