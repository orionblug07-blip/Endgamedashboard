/**
 * lib/email.ts
 * Email service using Resend (resend.com — generous free tier, great DX).
 * Drop-in replacement for Nodemailer if needed: just swap the send function.
 */

import { StaffKPIScore } from "./kpiEngine";
import { AirtableUser } from "./airtable";

const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const FROM_EMAIL = process.env.FROM_EMAIL ?? "performance@yourorg.com";

// ─── Core send function ───────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Email send failed: ${JSON.stringify(err)}`);
  }

  return res.json();
}

// ─── Staff performance email ───────────────────────────────────────────────────

interface StaffEmailOptions {
  to: string;
  name: string;
  week: number;
  year: number;
  score: StaffKPIScore;
  suggestions: string[];
}

export async function sendStaffEmail(options: StaffEmailOptions) {
  const { to, name, week, year, score, suggestions } = options;
  const subject = `Your Week ${week} Performance Report — ${getStatusEmoji(score.status)} ${score.overallScore}/100`;
  const html = buildStaffEmailHTML(name, week, year, score, suggestions);
  return sendEmail(to, subject, html);
}

function buildStaffEmailHTML(
  name: string,
  week: number,
  year: number,
  score: StaffKPIScore,
  suggestions: string[]
): string {
  const statusColor = {
    excellent: "#16a34a",
    good: "#2563eb",
    at_risk: "#d97706",
    underperforming: "#dc2626",
  }[score.status];

  const kpiRows = score.kpiScores
    .map(
      (k) => `
      <tr>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb;">
          ${k.kpiName}
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${k.actualHours.toFixed(1)}h / ${k.targetHours}h
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          <span style="
            display: inline-block;
            padding: 2px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            background: ${k.status === "met" ? "#dcfce7" : k.status === "at_risk" ? "#fef9c3" : "#fee2e2"};
            color: ${k.status === "met" ? "#15803d" : k.status === "at_risk" ? "#854d0e" : "#991b1b"};
          ">
            ${k.completionPercent}%
          </span>
        </td>
        <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">
          ${k.performanceScore}/100
        </td>
      </tr>
    `
    )
    .join("");

  const suggestionsHTML = suggestions.length > 0
    ? `
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px 20px; border-radius: 4px; margin: 24px 0;">
        <p style="margin: 0 0 10px; font-weight: 600; color: #92400e;">Improvement suggestions</p>
        <ul style="margin: 0; padding-left: 20px; color: #78350f;">
          ${suggestions.map((s) => `<li style="margin-bottom: 6px;">${s}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb;">
  <div style="max-width: 600px; margin: 0 auto; padding: 32px 16px;">

    <!-- Header -->
    <div style="background: #1e293b; padding: 32px; border-radius: 12px 12px 0 0; text-align: center;">
      <p style="margin: 0; color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
        Week ${week}, ${year}
      </p>
      <h1 style="margin: 8px 0 0; color: #fff; font-size: 24px; font-weight: 700;">
        Your Performance Report
      </h1>
    </div>

    <!-- Body -->
    <div style="background: #fff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: 0;">

      <p style="color: #374151; font-size: 16px;">Hi ${name},</p>
      <p style="color: #6b7280;">Here's your performance summary for the week. Keep up the great work!</p>

      <!-- Overall score -->
      <div style="text-align: center; padding: 28px; background: #f8fafc; border-radius: 12px; margin: 24px 0;">
        <p style="margin: 0; color: #6b7280; font-size: 14px;">Overall Performance Score</p>
        <p style="margin: 8px 0; font-size: 64px; font-weight: 800; color: ${statusColor}; line-height: 1;">
          ${score.overallScore}
          <span style="font-size: 28px; color: #9ca3af;">/100</span>
        </p>
        <span style="
          display: inline-block;
          padding: 4px 16px;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
          background: ${statusColor}22;
          color: ${statusColor};
          text-transform: capitalize;
        ">
          ${getStatusEmoji(score.status)} ${score.status.replace("_", " ")}
        </span>
        <p style="margin: 12px 0 0; color: #6b7280; font-size: 13px;">
          Total hours logged: <strong>${score.totalHoursWorked}h</strong>
        </p>
      </div>

      ${score.twoWeekDropAlert ? `
      <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 14px 18px; border-radius: 4px; margin-bottom: 24px;">
        <p style="margin: 0; color: #991b1b; font-weight: 600;">⚠️ Attention needed</p>
        <p style="margin: 6px 0 0; color: #7f1d1d; font-size: 14px;">
          Performance has declined for two consecutive weeks. Please review your task log and reach out to your manager.
        </p>
      </div>
      ` : ""}

      <!-- KPI breakdown -->
      <h2 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 12px;">KPI Breakdown</h2>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">KPI</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Hours</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Completion</th>
            <th style="padding: 10px 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase;">Score</th>
          </tr>
        </thead>
        <tbody>${kpiRows}</tbody>
      </table>

      ${suggestionsHTML}

      <p style="margin: 24px 0 0; color: #6b7280; font-size: 13px;">
        Questions about your score? Contact your manager or 
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/staff/dashboard" style="color: #2563eb;">view your full dashboard</a>.
      </p>
    </div>

    <p style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
      This is an automated report. © ${year} Your Organisation
    </p>
  </div>
</body>
</html>`;
}

// ─── CEO summary report ───────────────────────────────────────────────────────

interface CEOReportOptions {
  to: string;
  week: number;
  year: number;
  rankedScores: StaffKPIScore[];
  userMap: Record<string, AirtableUser["fields"]>;
  allScores: StaffKPIScore[];
}

export async function sendCEOReport(options: CEOReportOptions) {
  const { to, week, year } = options;
  const subject = `[CEO Report] Week ${week} Team Performance Summary`;
  const html = buildCEOReportHTML(options);
  return sendEmail(to, subject, html);
}

function buildCEOReportHTML(options: CEOReportOptions): string {
  const { week, year, rankedScores, userMap, allScores } = options;

  const excellent = allScores.filter((s) => s.overallScore >= 90).length;
  const good = allScores.filter((s) => s.overallScore >= 75 && s.overallScore < 90).length;
  const atRisk = allScores.filter((s) => s.overallScore >= 60 && s.overallScore < 75).length;
  const underperforming = allScores.filter((s) => s.overallScore < 60).length;
  const avgScore = Math.round(allScores.reduce((a, b) => a + b.overallScore, 0) / allScores.length);
  const alerts = allScores.filter((s) => s.twoWeekDropAlert);

  const staffRows = rankedScores
    .map(
      (score, i) => `
      <tr style="background: ${i % 2 === 0 ? "#fff" : "#f9fafb"}">
        <td style="padding: 12px; color: #6b7280; font-weight: 500;">#${i + 1}</td>
        <td style="padding: 12px; font-weight: 500;">${userMap[score.staffId]?.Name ?? "—"}</td>
        <td style="padding: 12px; color: #6b7280;">${userMap[score.staffId]?.Department ?? "—"}</td>
        <td style="padding: 12px; text-align: center;">
          <strong style="color: ${score.overallScore >= 90 ? "#16a34a" : score.overallScore >= 75 ? "#2563eb" : score.overallScore >= 60 ? "#d97706" : "#dc2626"}">
            ${score.overallScore}/100
          </strong>
        </td>
        <td style="padding: 12px; text-align: center;">${score.totalHoursWorked}h</td>
        <td style="padding: 12px; text-align: center;">${score.twoWeekDropAlert ? "⚠️ Alert" : "—"}</td>
      </tr>
    `
    )
    .join("");

  const alertsSection = alerts.length > 0
    ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px; color: #991b1b; font-size: 15px;">⚠️ Consecutive Drop Alerts (${alerts.length})</h3>
        <ul style="margin: 0; padding-left: 20px; color: #7f1d1d;">
          ${alerts.map((a) => `<li><strong>${userMap[a.staffId]?.Name}</strong> — Score: ${a.overallScore}/100 (${a.status})</li>`).join("")}
        </ul>
        <p style="margin: 12px 0 0; font-size: 13px; color: #991b1b;">
          These staff members have shown declining performance for 2+ consecutive weeks and may need intervention.
        </p>
      </div>
    `
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb;">
  <div style="max-width: 700px; margin: 0 auto; padding: 32px 16px;">

    <div style="background: #0f172a; padding: 32px; border-radius: 12px 12px 0 0;">
      <p style="margin: 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Confidential — CEO Only</p>
      <h1 style="margin: 8px 0 0; color: #fff; font-size: 26px;">Week ${week} Team Performance</h1>
      <p style="margin: 6px 0 0; color: #94a3b8;">${year} · ${allScores.length} staff members</p>
    </div>

    <div style="background: #fff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: 0;">

      <!-- Summary stats -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px;">
        ${[
          { label: "Avg score", value: `${avgScore}/100`, color: "#1e293b" },
          { label: "Excellent", value: excellent, color: "#16a34a" },
          { label: "At risk", value: atRisk, color: "#d97706" },
          { label: "Underperforming", value: underperforming, color: "#dc2626" },
        ]
          .map(
            (stat) => `
          <div style="background: #f8fafc; padding: 16px; border-radius: 8px; text-align: center;">
            <p style="margin: 0; font-size: 24px; font-weight: 700; color: ${stat.color};">${stat.value}</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">${stat.label}</p>
          </div>
        `
          )
          .join("")}
      </div>

      ${alertsSection}

      <!-- Staff leaderboard -->
      <h2 style="font-size: 16px; font-weight: 600; margin: 0 0 12px; color: #111827;">Staff Rankings</h2>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280;">#</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280;">Name</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #6b7280;">Dept</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 12px; color: #6b7280;">Score</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 12px; color: #6b7280;">Hours</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 12px; color: #6b7280;">Alert</th>
          </tr>
        </thead>
        <tbody>${staffRows}</tbody>
      </table>

      <p style="margin: 24px 0 0; color: #6b7280; font-size: 13px;">
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="color: #2563eb;">Open Admin Dashboard</a>
        for detailed KPI breakdowns and historical trends.
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStatusEmoji(status: StaffKPIScore["status"]): string {
  return { excellent: "🌟", good: "✅", at_risk: "⚠️", underperforming: "🔴" }[status];
}
