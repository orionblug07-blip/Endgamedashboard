/**
 * app/api/admin/dashboard/route.ts
 * Serves aggregated staff performance data for the admin dashboard.
 * All Airtable reads happen here — never in the browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, getISOWeek } from "@/lib/airtable";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get("week");
  const department = searchParams.get("department");

  const now = new Date();
  const week = weekParam ? parseInt(weekParam) : getISOWeek(now);
  const year = now.getFullYear();

  try {
    // Fetch data in parallel
    const [users, kpiResults, kpis] = await Promise.all([
      db.users.list({ isActive: true, ...(department ? { department } : {}) }),
      db.kpiResults.listByWeek(week, year),
      db.kpis.list(),
    ]);

    const kpiMap = Object.fromEntries(kpis.map((k) => [k.id, k.fields]));

    // Build per-staff summary
    const staff = users.map((user) => {
      const userResults = kpiResults.filter((r) =>
        r.fields.StaffId.includes(user.id)
      );

      const kpiScores = userResults.map((r) => {
        const kpi = kpiMap[r.fields.KPIId[0]];
        return {
          kpiName: kpi?.Name ?? "Unknown",
          category: kpi?.Category ?? "Other",
          completionPercent: r.fields.CompletionPercent,
          performanceScore: r.fields.PerformanceScore,
          status: r.fields.Status,
        };
      });

      const overallScore =
        kpiScores.length > 0
          ? Math.round(
              kpiScores.reduce((a, b) => a + b.performanceScore, 0) /
                kpiScores.length
            )
          : 0;

      const twoWeekDropAlert = userResults.some((r) =>
        r.fields.Notes?.includes("Consecutive")
      );

      const status: "excellent" | "good" | "at_risk" | "underperforming" =
        overallScore >= 90
          ? "excellent"
          : overallScore >= 75
          ? "good"
          : overallScore >= 60
          ? "at_risk"
          : "underperforming";

      return {
        staffId: user.id,
        name: user.fields.Name,
        department: user.fields.Department,
        overallScore,
        status,
        totalHoursWorked: 0, // would need to sum ParsedTasks — add if needed
        twoWeekDropAlert,
        kpiScores,
      };
    });

    return NextResponse.json({
      week,
      year,
      staff,
      meta: {
        total: staff.length,
        avgScore: Math.round(
          staff.reduce((a, b) => a + b.overallScore, 0) / (staff.length || 1)
        ),
      },
    });
  } catch (err: any) {
    console.error("Dashboard API error:", err);
    return NextResponse.json(
      { error: "Failed to fetch dashboard data", detail: err.message },
      { status: 500 }
    );
  }
}
