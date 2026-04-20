# Staff Performance Dashboard — Complete Build Guide

## 1. Project Folder Structure

```
staff-performance-dashboard/
├── app/
│   ├── api/
│   │   ├── webhook/
│   │   │   └── clickup/route.ts       ← Receives ClickUp data
│   │   ├── admin/
│   │   │   └── dashboard/route.ts     ← Serves admin dashboard data
│   │   ├── staff/
│   │   │   └── me/dashboard/route.ts  ← Serves personal staff data
│   │   ├── kpi/
│   │   │   └── calculate/route.ts     ← On-demand KPI calculation
│   │   └── cron/
│   │       └── weekly-report/route.ts ← Monday morning automation
│   ├── dashboard/
│   │   └── page.tsx                   ← Admin dashboard UI
│   ├── staff/
│   │   └── dashboard/page.tsx         ← Staff personal dashboard
│   ├── sign-in/[[...sign-in]]/page.tsx
│   ├── sign-up/[[...sign-up]]/page.tsx
│   ├── layout.tsx
│   └── middleware.ts                  ← Auth protection
├── lib/
│   ├── airtable.ts                    ← Database layer (swap for PostgreSQL later)
│   ├── taskParser.ts                  ← Regex + OpenAI task parser
│   ├── kpiEngine.ts                   ← KPI scoring and intelligence
│   └── email.ts                       ← Resend email templates
├── types/
│   └── index.ts                       ← Shared TypeScript types
├── components/
│   ├── ui/                            ← Reusable UI components
│   └── charts/                        ← Recharts wrappers
├── .env.example                       ← Copy to .env.local
├── .env.local                         ← Your actual secrets (gitignored)
├── vercel.json                        ← Cron job config
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

---

## 2. Airtable Database Design

### Base name: `Staff Performance`

---

### Table 1: Users

| Field Name     | Field Type       | Notes                                    |
|---------------|------------------|------------------------------------------|
| Name           | Single line text | Full name                                |
| Email          | Email            | Used for sending reports                 |
| Role           | Single select    | Options: staff, admin, ceo               |
| Department     | Single select    | e.g., Tech, Finance, Programs, Admin     |
| ClickUpUserId  | Single line text | Matches ClickUp user ID for webhook link |
| IsActive       | Checkbox         | Uncheck to exclude from reports          |
| CreatedAt      | Created time     | Auto                                     |

---

### Table 2: Tasks (raw submissions)

| Field Name     | Field Type       | Notes                                    |
|---------------|------------------|------------------------------------------|
| RawText        | Long text        | "9:00–10:00 Attendance review"           |
| SubmittedAt    | Date/time        | When the task was received               |
| ClickUpTaskId  | Single line text | ClickUp task ID if from webhook          |
| StaffId        | Link → Users     | Which staff member submitted             |
| Status         | Single select    | pending, parsed, error                   |
| WeekNumber     | Number           | ISO week number (1–53)                   |
| Year           | Number           | 4-digit year                             |

---

### Table 3: ParsedTasks (structured data)

| Field Name       | Field Type       | Notes                                  |
|-----------------|------------------|----------------------------------------|
| TaskId           | Link → Tasks     | Source raw task                        |
| StaffId          | Link → Users     | Denormalized for fast queries          |
| StartTime        | Single line text | "09:00"                                |
| EndTime          | Single line text | "10:00"                                |
| DurationMinutes  | Number           | Calculated: (EndTime - StartTime)      |
| Category         | Single select    | Attendance, Support, Dev, Meeting, etc.|
| Description      | Single line text | "Attendance review"                    |
| TaskDate         | Date             | The day the task happened              |
| WeekNumber       | Number           | ISO week number                        |
| Year             | Number           | 4-digit year                           |

---

### Table 4: KPIs

| Field Name           | Field Type       | Notes                                 |
|---------------------|------------------|---------------------------------------|
| Name                 | Single line text | "Weekly Attendance Reviews"           |
| Category             | Single select    | Must match ParsedTask.Category        |
| Department           | Single select    | Which dept this KPI applies to        |
| TargetHoursPerWeek   | Number           | e.g., 5 (meaning 5h on Attendance)   |
| TargetCountPerWeek   | Number           | Optional: number of tasks (not hours) |
| Weight               | Number           | 0–100 (importance in overall score)   |
| Description          | Long text        | What this KPI measures                |

**Example KPI records:**

| Name                        | Category    | Dept  | TargetHours | Weight |
|-----------------------------|-------------|-------|-------------|--------|
| Weekly attendance reviews    | Attendance  | All   | 5           | 20     |
| Client support responses     | Support     | All   | 8           | 25     |
| Development tasks            | Development | Tech  | 20          | 35     |
| Internal meetings            | Meeting     | All   | 4           | 10     |
| Documentation & reporting    | Reporting   | All   | 3           | 10     |

---

### Table 5: KPIResults (weekly scores)

| Field Name       | Field Type       | Notes                                   |
|-----------------|------------------|-----------------------------------------|
| StaffId          | Link → Users     |                                         |
| KPIId            | Link → KPIs      |                                         |
| WeekNumber       | Number           |                                         |
| Year             | Number           |                                         |
| ActualHours      | Number           | Summed from ParsedTasks                 |
| ActualCount      | Number           | Number of tasks in this category        |
| CompletionPercent| Number           | (ActualHours / TargetHours) × 100       |
| PerformanceScore | Number           | 0–100 scoring curve                     |
| PrevWeekScore    | Number           | For trend detection                     |
| Status           | Single select    | met, at_risk, missed                    |
| Notes            | Long text        | Intelligence layer flags                |

---

## 3. KPI Scoring Formulas

```
Completion % = min(ActualHours / TargetHoursPerWeek × 100, 120%)

Performance score:
  ≥ 100% completion → 100
  90–99%            → 85 + ((completion - 90) × 1.5)
  75–89%            → 70 + ((completion - 75) × 1.0)
  50–74%            → 50 + ((completion - 50) × 0.8)
  < 50%             → completion × 1 (linear penalty)

Overall score = Σ(KPIScore × KPIWeight) / Σ(KPIWeight)

Status thresholds:
  Excellent:        score ≥ 90
  Good:             score ≥ 75
  At risk:          score ≥ 60
  Underperforming:  score < 60
```

---

## 4. ClickUp Integration Setup

### Option A: ClickUp Webhook (recommended)

1. In ClickUp: **Settings → Integrations → Webhooks → New webhook**
2. Endpoint: `https://your-app.vercel.app/api/webhook/clickup`
3. Events: check `taskCreated` and `taskUpdated`
4. Copy the webhook secret → add to `.env.local` as `CLICKUP_WEBHOOK_SECRET`

**Staff workflow:**
- Staff fill in a ClickUp **task** (or custom field named "Daily Activity")
- Format: `9:00–10:00 Attendance review` (one per line for multiple)
- ClickUp fires webhook → Vercel parses → stored in Airtable

### Option B: Manual dashboard submission

Staff use the form on `/staff/dashboard` — no ClickUp needed.
The `PUT /api/webhook/clickup` endpoint handles this.

### Option C: ClickUp API polling (if webhooks aren't available)

Create a cron job at `/api/cron/sync-clickup` that polls the ClickUp API
every hour and pulls task updates from the past day.

---

## 5. Clerk Auth Setup

```bash
npm install @clerk/nextjs
```

**app/middleware.ts:**
```typescript
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  publicRoutes: ["/sign-in", "/sign-up", "/api/webhook/clickup"],
  
  // After sign-in, redirect based on role
  // Set role in Clerk user metadata: { role: "admin" | "staff" | "ceo" }
  afterAuth(auth, req) {
    if (!auth.userId && !auth.isPublicRoute) {
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  },
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
```

**app/layout.tsx:**
```typescript
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

---

## 6. Vercel Cron Job

The cron runs every Monday at 07:00 UTC (08:00 WAT):

**vercel.json:**
```json
{
  "crons": [
    {
      "path": "/api/cron/weekly-report",
      "schedule": "0 7 * * 1"
    }
  ]
}
```

Cron jobs on Vercel are protected: Vercel passes an `Authorization: Bearer <CRON_SECRET>` header.
The endpoint checks this header in production.

**To test locally:**
```bash
curl -H "Authorization: Bearer your-cron-secret" http://localhost:3000/api/cron/weekly-report
```

---

## 7. Step-by-Step Deployment

### Step 1: Create Airtable base

1. Go to [airtable.com](https://airtable.com) → Create new base → "Staff Performance"
2. Create the 5 tables from Section 2 above (field by field)
3. Add your KPI records to the KPIs table
4. Add staff to the Users table with correct emails
5. **Get your API credentials:**
   - API key: `airtable.com/create/tokens` → Create token → scope: `data.records:read`, `data.records:write`
   - Base ID: open your base → Help → API documentation → copy `appXXXXXXXX` from the URL

### Step 2: Set up Clerk

1. Create account at [clerk.com](https://clerk.com)
2. Create new application
3. Copy publishable key and secret key
4. In Clerk dashboard: Users → select a user → Metadata → set `role: "admin"` or `role: "staff"`

### Step 3: Set up Resend

1. Create account at [resend.com](https://resend.com)
2. Add your domain (e.g., `yourorganisation.com`)
3. Follow DNS verification steps
4. Create an API key → copy it

### Step 4: Create Next.js project

```bash
npx create-next-app@latest staff-dashboard --typescript --tailwind --app
cd staff-dashboard

# Install dependencies
npm install @clerk/nextjs recharts resend
npm install -D @types/node
```

### Step 5: Copy project files

Copy all files from this repository into your project:
- `lib/` → `lib/`
- `app/api/` → `app/api/`
- `app/dashboard/` → `app/dashboard/`
- `app/staff/` → `app/staff/`
- `vercel.json` → project root

### Step 6: Configure environment variables

```bash
cp .env.example .env.local
# Edit .env.local with your actual values
```

### Step 7: Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel
# Follow prompts to link to your Vercel account
```

**Add environment variables in Vercel:**
- Go to your project on vercel.com
- Settings → Environment Variables
- Add each variable from `.env.example` with your real values
- This is important: Vercel reads env vars from its own system, not from your `.env.local`

### Step 8: Set up ClickUp webhook

1. In ClickUp: Settings → Integrations → Webhooks
2. Create webhook pointing to `https://your-app.vercel.app/api/webhook/clickup`
3. Select events: taskCreated, taskUpdated
4. Add the webhook secret to Vercel env vars

### Step 9: Test the system

```bash
# 1. Test webhook locally
npx vercel dev

# 2. Submit a test task
curl -X PUT http://localhost:3000/api/webhook/clickup \
  -H "Content-Type: application/json" \
  -d '{"staffId": "recXXXXXX", "rawText": "9:00–10:00 Attendance review\n10:00–12:00 Client support"}'

# 3. Test cron locally  
curl -H "Authorization: Bearer your-cron-secret" \
  http://localhost:3000/api/cron/weekly-report

# 4. Verify emails arrive in your inbox
```

---

## 8. Future: Migrating from Airtable to PostgreSQL

The `lib/airtable.ts` file is the only database layer. All other code calls `db.*` methods.

To migrate:
1. Create a new `lib/postgres.ts` that implements the same `db` export shape
2. Replace all Airtable API calls with your PostgreSQL queries (using `pg` or `drizzle`)
3. Update imports in `lib/kpiEngine.ts` and API routes from `./airtable` to `./postgres`
4. Run your data migration script to copy existing Airtable records to PostgreSQL
5. Done — zero changes to API routes, cron jobs, or UI

Recommended PostgreSQL stack for Vercel: **Vercel Postgres** (powered by Neon) or **Supabase**.

---

## 9. Package.json Dependencies

```json
{
  "dependencies": {
    "next": "14.x",
    "@clerk/nextjs": "^5.x",
    "recharts": "^2.x",
    "resend": "^3.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "@types/react": "^18.x",
    "@types/node": "^20.x",
    "tailwindcss": "^3.x",
    "autoprefixer": "^10.x",
    "postcss": "^8.x"
  }
}
```

Install with: `npm install @clerk/nextjs recharts resend`
