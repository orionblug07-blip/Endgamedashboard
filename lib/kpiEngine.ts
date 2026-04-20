/**
 * lib/kpiEngine.ts
 * Maps parsed tasks to KPIs, calculates performance scores.
 * Called by: cron job (weekly), on-demand via API.
 */

import { db, AirtableParsedTask, AirtableKPI, AirtableKPIResult, getISOWeek } from "./airtable";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StaffKPIScore {
  staffId: string;
  week: number;
  year: number;
  kpiScores: KPIScore[];
  overallScore: number;       // 0–100 weighted average
  totalHoursWorked: number;
  status: "excellent" | "good" | "at_risk" | "underperforming";
  twoWeekDropAlert: boolean;
}

export interface KPIScore {
  kpiId: string;
  kpiName: string;
  category: string;
  targetHours: number;
  actualHours: number;
  completionPercent: number;
  performanceScore: number;   // 0–100
  weight: number;
  status: "met" | "at_risk" | "missed";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  excellent: 90,
  good: 75,
  at_risk: 60,
  // below at_risk = underperforming
};

const UNDERPERFORMANCE_THRESHOLD = 70; // % — flag if below this

// ─── Core scoring logic ───────────────────────────────────────────────────────

/**
 * scoreKPI — given actual hours vs target, returns a 0-100 score.
 * 
 * Scoring curve:
 * - 100% of target → score 100
 * - 90% of target → score 85
 * - 75% of target → score 70
 * - below 50% → score drops sharply
 * - above 120% → capped at 100 (avoid over-inflating)
 */
function scoreKPI(actualHours: number, targetHours: number): number {
  if (targetHours === 0) return 100;
  
  const ratio = Math.min(actualHours / targetHours, 1.2); // cap at 120%
  
  if (ratio >= 1.0) return 100;
  if (ratio >= 0.9) return Math.round(85 + (ratio - 0.9) * 150);
  if (ratio >= 0.75) return Math.round(70 + (ratio - 0.75) * 100);
  if (ratio >= 0.5) return Math.round(50 + (ratio - 0.5) * 80);
  return Math.round(ratio * 100); // linear below 50%
}

/**
 * weightedAverage — compute overall score from individual KPI scores.
 * Uses the Weight field on each KPI. If all weights are equal, this is a simple average.
 */
function weightedAverage(scores: KPIScore[]): number {
  if (scores.length === 0) return 0;

  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) {
    return Math.round(scores.reduce((sum, s) => sum + s.performanceScore, 0) / scores.length);
  }

  return Math.round(
    scores.reduce((sum, s) => sum + s.performanceScore * s.weight, 0) / totalWeight
  );
}

/**
 * aggregateHoursByCategory — sums hours from parsed tasks, grouped by category.
 */
function aggregateHoursByCategory(tasks: AirtableParsedTask[]): Record<string, number> {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    const cat = task.fields.Category;
    const hours = task.fields.DurationMinutes / 60;
    acc[cat] = (acc[cat] ?? 0) + hours;
    return acc;
  }, {});
}

// ─── Main calculation function ─────────────────────────────────────────────────

/**
 * calculateStaffKPI — compute KPI scores for a single staff member for a given week.
 * Reads from Airtable, writes results back.
 */
export async function calculateStaffKPI(
  staffId: string,
  week: number,
  year: number
): Promise<StaffKPIScore> {
  // Fetch data in parallel
  const [parsedTasks, kpis] = await Promise.all([
    db.parsedTasks.listByStaffWeek(staffId, week, year),
    db.kpis.list(),
  ]);

  const hoursByCategory = aggregateHoursByCategory(parsedTasks);
  const totalHours = Object.values(hoursByCategory).reduce((a, b) => a + b, 0);

  const kpiScores: KPIScore[] = kpis.map((kpi) => {
    const actualHours = hoursByCategory[kpi.fields.Category] ?? 0;
    const targetHours = kpi.fields.TargetHoursPerWeek;
    const completionPercent = targetHours > 0
      ? Math.min((actualHours / targetHours) * 100, 120)
      : 100;
    const performanceScore = scoreKPI(actualHours, targetHours);

    const status: KPIScore["status"] =
      completionPercent >= 90 ? "met"
      : completionPercent >= 70 ? "at_risk"
      : "missed";

    return {
      kpiId: kpi.id,
      kpiName: kpi.fields.Name,
      category: kpi.fields.Category,
      targetHours,
      actualHours,
      completionPercent: Math.round(completionPercent),
      performanceScore,
      weight: kpi.fields.Weight,
      status,
    };
  });

  const overallScore = weightedAverage(kpiScores);

  const staffStatus: StaffKPIScore["status"] =
    overallScore >= THRESHOLDS.excellent ? "excellent"
    : overallScore >= THRESHOLDS.good ? "good"
    : overallScore >= THRESHOLDS.at_risk ? "at_risk"
    : "underperforming";

  // Check for 2-week consecutive drop (intelligence layer)
  const recentResults = await db.kpiResults.getRecentByStaff(staffId, 4);
  const twoWeekDropAlert = detectConsecutiveDrop(recentResults, overallScore);

  // Write results back to Airtable
  await Promise.all(
    kpiScores.map((score) =>
      db.kpiResults.upsert(staffId, score.kpiId, week, year, {
        ActualHours: score.actualHours,
        ActualCount: parsedTasks.filter(
          (t) => t.fields.Category === score.category
        ).length,
        CompletionPercent: score.completionPercent,
        PerformanceScore: score.performanceScore,
        Status: score.status,
        Notes: twoWeekDropAlert ? "⚠️ Consecutive performance drop detected" : undefined,
      })
    )
  );

  return {
    staffId,
    week,
    year,
    kpiScores,
    overallScore,
    totalHoursWorked: Math.round(totalHours * 10) / 10,
    status: staffStatus,
    twoWeekDropAlert,
  };
}

/**
 * calculateWeeklyReport — compute KPI scores for ALL active staff for a given week.
 * Called by the cron job.
 */
export async function calculateWeeklyReport(
  week?: number,
  year?: number
): Promise<StaffKPIScore[]> {
  const now = new Date();
  const targetWeek = week ?? getISOWeek(now);
  const targetYear = year ?? now.getFullYear();

  const activeStaff = await db.users.list({ isActive: true });

  const results = await Promise.allSettled(
    activeStaff.map((user) =>
      calculateStaffKPI(user.id, targetWeek, targetYear)
    )
  );

  return results
    .filter((r): r is PromiseFulfilledResult<StaffKPIScore> => r.status === "fulfilled")
    .map((r) => r.value);
}

// ─── Intelligence layer ───────────────────────────────────────────────────────

/**
 * detectConsecutiveDrop — returns true if performance has dropped for 2+ consecutive weeks.
 */
function detectConsecutiveDrop(
  recentResults: AirtableKPIResult[],
  currentScore: number
): boolean {
  if (recentResults.length < 2) return false;

  // Group results by week, compute average score per week
  const weekScores: Record<string, number[]> = {};
  for (const result of recentResults) {
    const key = `${result.fields.Year}-${result.fields.WeekNumber}`;
    weekScores[key] = weekScores[key] ?? [];
    weekScores[key].push(result.fields.PerformanceScore);
  }

  const weekAverages = Object.entries(weekScores)
    .map(([key, scores]) => ({
      key,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (weekAverages.length < 2) return false;

  const lastWeekAvg = weekAverages[weekAverages.length - 1].avg;
  const twoWeeksAgoAvg = weekAverages[weekAverages.length - 2].avg;

  return (
    currentScore < UNDERPERFORMANCE_THRESHOLD &&
    lastWeekAvg < UNDERPERFORMANCE_THRESHOLD &&
    currentScore < lastWeekAvg &&
    lastWeekAvg < twoWeeksAgoAvg
  );
}

/**
 * generateImprovementSuggestions — smart recommendations based on KPI gaps.
 * Purely rule-based — no AI needed for this.
 */
export function generateImprovementSuggestions(score: StaffKPIScore): string[] {
  const suggestions: string[] = [];
  const missedKPIs = score.kpiScores.filter((k) => k.status === "missed");
  const atRiskKPIs = score.kpiScores.filter((k) => k.status === "at_risk");

  for (const kpi of missedKPIs) {
    const gap = kpi.targetHours - kpi.actualHours;
    suggestions.push(
      `${kpi.category}: ${gap.toFixed(1)}h below target. Prioritise ${kpi.kpiName} tasks early in the week.`
    );
  }

  for (const kpi of atRiskKPIs) {
    suggestions.push(
      `${kpi.category}: Close to target — ${kpi.completionPercent}% complete. A small effort will close this gap.`
    );
  }

  if (score.twoWeekDropAlert) {
    suggestions.push(
      "⚠️ Performance has declined for two consecutive weeks. Consider scheduling a check-in with your manager."
    );
  }

  if (score.totalHoursWorked < 30) {
    suggestions.push(
      `Total logged hours this week: ${score.totalHoursWorked}h. Ensure all tasks are being submitted via ClickUp.`
    );
  }

  return suggestions;
}

/**
 * rankStaff — sort an array of StaffKPIScores for the leaderboard.
 */
export function rankStaff(scores: StaffKPIScore[]): StaffKPIScore[] {
  return [...scores].sort((a, b) => b.overallScore - a.overallScore);
}
