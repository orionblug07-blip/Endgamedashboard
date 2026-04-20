/**
 * app/api/cron/weekly-report/route.ts
 * Vercel cron job — runs every Monday at 08:00 WAT (07:00 UTC).
 * 
 * Configure in vercel.json:
 * {
 *   "crons": [{ "path": "/api/cron/weekly-report", "schedule": "0 7 * * 1" }]
 * }
 * 
 * Only Vercel can call this endpoint in production (verified via CRON_SECRET).
 */

import { NextRequest, NextResponse } from "next/server";
import { calculateWeeklyReport, generateImprovementSuggestions, rankStaff } from "@/lib/kpiEngine";
import { db, getISOWeek } from "@/lib/airtable";
import { sendStaffEmail, sendCEOReport } from "@/lib/email";

export const maxDuration = 300; // 5 minutes — Vercel Pro limit

export async function GET(req: NextRequest) {
  // Verify the request is from Vercel's cron system
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Report is for the PREVIOUS week (cron runs Monday, reports on last week)
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - 7);
  
  const week = getISOWeek(lastMonday);
  const year = lastMonday.getFullYear();

  console.log(`Running weekly report for week ${week}/${year}`);

  try {
    // 1. Calculate KPI scores for all staff
    const allScores = await calculateWeeklyReport(week, year);
    const rankedScores = rankStaff(allScores);

    // 2. Fetch user details for emails
    const allUsers = await db.users.list({ isActive: true });
    const userMap = Object.fromEntries(allUsers.map((u) => [u.id, u.fields]));

    // 3. Send individual staff emails
    const emailResults = await Promise.allSettled(
      allScores.map(async (score) => {
        const user = userMap[score.staffId];
        if (!user?.Email) return;

        const suggestions = generateImprovementSuggestions(score);

        await sendStaffEmail({
          to: user.Email,
          name: user.Name,
          week,
          year,
          score,
          suggestions,
        });
      })
    );

    const emailErrors = emailResults.filter((r) => r.status === "rejected");
    if (emailErrors.length > 0) {
      console.warn(`${emailErrors.length} staff emails failed to send`);
    }

    // 4. Send CEO summary report
    const ceoUser = allUsers.find((u) => u.fields.Role === "ceo");
    if (ceoUser) {
      await sendCEOReport({
        to: ceoUser.fields.Email,
        week,
        year,
        rankedScores,
        userMap,
        allScores,
      });
    }

    return NextResponse.json({
      success: true,
      week,
      year,
      staffProcessed: allScores.length,
      emailsSent: allScores.length - emailErrors.length,
      underperformers: allScores.filter((s) => s.overallScore < 70).length,
      alerts: allScores.filter((s) => s.twoWeekDropAlert).length,
    });
  } catch (err: any) {
    console.error("Cron job failed:", err);
    return NextResponse.json(
      { error: "Cron job failed", detail: err.message },
      { status: 500 }
    );
  }
}
