/**
 * app/staff/dashboard/page.tsx
 * Personal dashboard for individual staff members.
 * Shows own stats, weekly KPI breakdown, trend, and task submission form.
 */

"use client";

import { useState, useEffect } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface StaffDashboardData {
  name: string;
  week: number;
  year: number;
  overallScore: number;
  status: string;
  totalHoursWorked: number;
  twoWeekDropAlert: boolean;
  kpiScores: {
    kpiName: string;
    category: string;
    targetHours: number;
    actualHours: number;
    completionPercent: number;
    performanceScore: number;
    status: "met" | "at_risk" | "missed";
  }[];
  trend: { week: number; score: number }[];
  suggestions: string[];
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 90 ? "#16a34a" : score >= 75 ? "#3b82f6" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
        <text x="70" y="65" textAnchor="middle" fill={color} fontSize="28" fontWeight="700">
          {score}
        </text>
        <text x="70" y="82" textAnchor="middle" fill="#94a3b8" fontSize="13">
          / 100
        </text>
      </svg>
    </div>
  );
}

export default function StaffDashboard() {
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [taskInput, setTaskInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState("");

  useEffect(() => {
    fetch("/api/staff/me/dashboard")
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  async function submitTask() {
    if (!taskInput.trim()) return;
    setSubmitting(true);
    setSubmitMsg("");

    try {
      const res = await fetch("/api/webhook/clickup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: taskInput }),
      });
      const result = await res.json();

      if (result.parsed > 0) {
        setSubmitMsg(`✅ Logged ${result.parsed} task${result.parsed > 1 ? "s" : ""} successfully.`);
        setTaskInput("");
      } else {
        setSubmitMsg("⚠️ Could not parse the task. Check the format: HH:MM–HH:MM Description");
      }
    } catch {
      setSubmitMsg("❌ Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400">
        Loading your dashboard...
      </div>
    );
  }

  if (!data) return null;

  const radarData = data.kpiScores.map((k) => ({
    subject: k.category,
    score: k.performanceScore,
    fullMark: 100,
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4">
        <h1 className="text-xl font-bold">My Dashboard</h1>
        <p className="text-slate-400 text-sm">
          Week {data.week}, {data.year} · {data.name}
        </p>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Alert */}
        {data.twoWeekDropAlert && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-r-xl p-4">
            <p className="text-red-800 font-semibold text-sm">
              ⚠️ Your performance has dropped for 2 consecutive weeks. Consider reviewing your task log with your manager.
            </p>
          </div>
        )}

        {/* Score + Trend */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 flex flex-col items-center justify-center">
            <p className="text-sm text-slate-500 mb-2">This week's score</p>
            <ScoreRing score={data.overallScore} />
            <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold
              ${data.status === "excellent" ? "bg-green-100 text-green-800" : 
                data.status === "good" ? "bg-blue-100 text-blue-800" : 
                data.status === "at_risk" ? "bg-yellow-100 text-yellow-800" : 
                "bg-red-100 text-red-800"}`}>
              {data.status.replace("_", " ")}
            </span>
            <p className="text-slate-400 text-xs mt-2">{data.totalHoursWorked}h logged</p>
          </div>

          <div className="md:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">8-Week Trend</h2>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => `W${v}`} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${v}/100`} />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* KPI Breakdown */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">KPI Radar</h2>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                <Radar
                  name="Score"
                  dataKey="score"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">KPI Details</h2>
            <div className="space-y-3">
              {data.kpiScores.map((k) => (
                <div key={k.kpiName}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700">{k.kpiName}</span>
                    <span className="text-slate-500">
                      {k.actualHours.toFixed(1)}h / {k.targetHours}h
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(k.completionPercent, 100)}%`,
                        backgroundColor:
                          k.status === "met"
                            ? "#16a34a"
                            : k.status === "at_risk"
                            ? "#f59e0b"
                            : "#ef4444",
                      }}
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{k.completionPercent}% complete</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Suggestions */}
        {data.suggestions.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h2 className="font-semibold text-amber-900 mb-3">💡 Improvement tips</h2>
            <ul className="space-y-2">
              {data.suggestions.map((s, i) => (
                <li key={i} className="text-sm text-amber-800 flex gap-2">
                  <span className="mt-0.5">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Task submission form */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
          <h2 className="font-semibold text-slate-800 mb-1">Log a task</h2>
          <p className="text-slate-400 text-sm mb-4">
            Format: <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">HH:MM–HH:MM Description</code>
            &nbsp;— one entry per line for multiple tasks.
          </p>
          <textarea
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder={"9:00–10:00 Attendance review\n10:00–11:30 Client support call\n14:00–16:00 Report writing"}
            rows={4}
            className="w-full border border-slate-200 rounded-lg p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {submitMsg && (
            <p className="text-sm mt-2 text-slate-600">{submitMsg}</p>
          )}
          <button
            onClick={submitTask}
            disabled={submitting || !taskInput.trim()}
            className="mt-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {submitting ? "Submitting…" : "Submit tasks"}
          </button>
        </div>
      </main>
    </div>
  );
}
