/**
 * lib/taskParser.ts
 * Converts raw text like "9:00–10:00 Attendance review" into structured data.
 * Strategy: regex first (fast, free), OpenAI fallback (handles edge cases).
 */

export interface ParsedTaskResult {
  startTime: string;        // "09:00"
  endTime: string;          // "10:00"
  durationMinutes: number;
  category: TaskCategory;
  description: string;
  confidence: "high" | "medium" | "low";
  parsedBy: "regex" | "ai";
}

export type TaskCategory =
  | "Attendance"
  | "Support"
  | "Development"
  | "Admin"
  | "Meeting"
  | "Research"
  | "Training"
  | "Reporting"
  | "Outreach"
  | "Review"
  | "Other";

// ─── Category keyword map ─────────────────────────────────────────────────────
// Maps lowercase keywords → TaskCategory. Add your org's own terms here.

const CATEGORY_KEYWORDS: Record<string, TaskCategory> = {
  // Attendance
  attendance: "Attendance",
  register: "Attendance",
  enrollment: "Attendance",

  // Support
  support: "Support",
  helpdesk: "Support",
  ticket: "Support",
  "help desk": "Support",
  client: "Support",
  customer: "Support",

  // Development
  development: "Development",
  coding: "Development",
  programming: "Development",
  feature: "Development",
  bug: "Development",
  deploy: "Development",
  github: "Development",
  sprint: "Development",
  implementation: "Development",

  // Meeting
  meeting: "Meeting",
  standup: "Meeting",
  "stand-up": "Meeting",
  sync: "Meeting",
  call: "Meeting",
  zoom: "Meeting",
  presentation: "Meeting",
  briefing: "Meeting",

  // Admin
  admin: "Admin",
  administrative: "Admin",
  paperwork: "Admin",
  filing: "Admin",
  scheduling: "Admin",

  // Research
  research: "Research",
  analysis: "Research",
  investigation: "Research",
  study: "Research",

  // Training
  training: "Training",
  workshop: "Training",
  course: "Training",
  learning: "Training",
  webinar: "Training",

  // Reporting
  report: "Reporting",
  reporting: "Reporting",
  documentation: "Reporting",
  summary: "Reporting",
  dashboard: "Reporting",

  // Outreach
  outreach: "Outreach",
  partnership: "Outreach",
  stakeholder: "Outreach",
  email: "Outreach",
  communication: "Outreach",

  // Review
  review: "Review",
  audit: "Review",
  assessment: "Review",
  evaluation: "Review",
  feedback: "Review",
};

// ─── Regex patterns ───────────────────────────────────────────────────────────

const TIME_PATTERNS = [
  // "9:00–10:00" or "9:00-10:00" or "9:00 – 10:00"
  /(\d{1,2}):(\d{2})\s*[–\-—to]+\s*(\d{1,2}):(\d{2})/,
  // "9am-10am" or "9am – 10am"
  /(\d{1,2})(am|pm)\s*[–\-—to]+\s*(\d{1,2})(am|pm)/i,
  // "09:00 10:00" (space-separated)
  /(\d{1,2}):(\d{2})\s+(\d{1,2}):(\d{2})/,
  // "9-10am" (e.g., "9-10am Meeting")
  /(\d{1,2})\s*[–\-—]\s*(\d{1,2})(am|pm)/i,
];

// ─── Core parser ──────────────────────────────────────────────────────────────

export function parseTaskWithRegex(rawText: string): ParsedTaskResult | null {
  const text = rawText.trim();

  let startTime: string | null = null;
  let endTime: string | null = null;
  let matchEnd = 0;

  // Try each time pattern
  for (const pattern of TIME_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;

    matchEnd = (match.index ?? 0) + match[0].length;

    // Pattern 1: HH:MM–HH:MM
    if (pattern === TIME_PATTERNS[0]) {
      startTime = formatTime(parseInt(match[1]), parseInt(match[2]));
      endTime = formatTime(parseInt(match[3]), parseInt(match[4]));
      break;
    }

    // Pattern 2: HHam/pm – HHam/pm
    if (pattern === TIME_PATTERNS[1]) {
      const startHour = to24Hour(parseInt(match[1]), match[2] as "am" | "pm");
      const endHour = to24Hour(parseInt(match[3]), match[4] as "am" | "pm");
      startTime = formatTime(startHour, 0);
      endTime = formatTime(endHour, 0);
      break;
    }

    // Pattern 3: HH:MM HH:MM
    if (pattern === TIME_PATTERNS[2]) {
      startTime = formatTime(parseInt(match[1]), parseInt(match[2]));
      endTime = formatTime(parseInt(match[3]), parseInt(match[4]));
      break;
    }

    // Pattern 4: H-Ham/pm
    if (pattern === TIME_PATTERNS[3]) {
      const period = match[3] as "am" | "pm";
      const startHour = to24Hour(parseInt(match[1]), period);
      const endHour = to24Hour(parseInt(match[2]), period);
      startTime = formatTime(startHour, 0);
      endTime = formatTime(endHour, 0);
      break;
    }
  }

  if (!startTime || !endTime) return null;

  const durationMinutes = calculateDuration(startTime, endTime);
  if (durationMinutes <= 0 || durationMinutes > 720) return null; // sanity check

  const description = text.slice(matchEnd).trim().replace(/^[:\-–]\s*/, "");
  const category = detectCategory(description);

  return {
    startTime,
    endTime,
    durationMinutes,
    category,
    description: description || rawText,
    confidence: description ? "high" : "medium",
    parsedBy: "regex",
  };
}

// ─── AI fallback ──────────────────────────────────────────────────────────────

export async function parseTaskWithAI(
  rawText: string
): Promise<ParsedTaskResult | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const categories = Object.keys(
    Object.fromEntries(
      Object.entries(CATEGORY_KEYWORDS).map(([, v]) => [v, true])
    )
  ).join(", ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You parse staff task log entries. Extract time and category. 
Return ONLY valid JSON matching this shape:
{
  "startTime": "HH:MM",
  "endTime": "HH:MM", 
  "durationMinutes": number,
  "category": one of [${categories}],
  "description": "clean task description"
}
If you cannot extract valid times, return {"error": "unparseable"}.`,
          },
          {
            role: "user",
            content: rawText,
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    if (parsed.error || !parsed.startTime || !parsed.endTime) return null;

    return {
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      durationMinutes:
        parsed.durationMinutes ?? calculateDuration(parsed.startTime, parsed.endTime),
      category: parsed.category as TaskCategory,
      description: parsed.description ?? rawText,
      confidence: "medium",
      parsedBy: "ai",
    };
  } catch {
    return null;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * parseTask - tries regex first, falls back to AI if regex fails.
 * Multiple entries separated by newlines are handled individually.
 */
export async function parseTask(rawText: string): Promise<ParsedTaskResult[]> {
  // Handle multi-line submissions (staff may submit multiple tasks at once)
  const lines = rawText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3);

  const results: ParsedTaskResult[] = [];

  for (const line of lines) {
    const regexResult = parseTaskWithRegex(line);

    if (regexResult) {
      results.push(regexResult);
    } else if (process.env.OPENAI_API_KEY) {
      // Only call AI if env var is set
      const aiResult = await parseTaskWithAI(line);
      if (aiResult) results.push(aiResult);
    }
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function to24Hour(hour: number, period: "am" | "pm"): number {
  if (period.toLowerCase() === "pm" && hour !== 12) return hour + 12;
  if (period.toLowerCase() === "am" && hour === 12) return 0;
  return hour;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function calculateDuration(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function detectCategory(text: string): TaskCategory {
  const lower = text.toLowerCase();

  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lower.includes(keyword)) return category;
  }

  return "Other";
}

// ─── Tests (run with: npx ts-node lib/taskParser.ts) ─────────────────────────

if (require.main === module) {
  const testCases = [
    "9:00–10:00 Attendance review",
    "10:00am - 11:30am Team standup meeting",
    "14:00-16:00 Bug fix for login page",
    "2pm-3pm Client support call",
    "08:30 – 09:30 Report writing",
    "Invalid entry without time",
  ];

  console.log("\n── Task Parser Test ──\n");
  for (const tc of testCases) {
    const result = parseTaskWithRegex(tc);
    console.log(`Input: "${tc}"`);
    console.log("Output:", result ?? "❌ unparseable");
    console.log();
  }
}
