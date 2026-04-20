/**
 * app/dashboard/page.tsx
 * Admin dashboard — shows all staff performance, rankings, KPI overview.
 * Protected: only accessible by admin/CEO role (via middleware).
 */

"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaffSummary {
  staffId: string;
  name: string;
  department: string;
  overallScore: number;
  status: "excellent" | "good" | "at_risk" | "underperforming";
  totalHoursWorked: number;
  twoWeekDropAlert: boolean;
  kpiScores: {
    kpiName: string;
    category: string;
    completionPercent: number;
    performanceScore: number;
  }[];
}

// ─── Score colour helper ───────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 90) return "#16a34a";
  if (score >= 75) return "#2563eb";
  if (score >= 60) return "#d97706";
  return "#dc2626";
}

function getStatusBadge(status: StaffSummary["status"]) {
  const styles: Record<string, string> = {
    excellent: "bg-green-100 text-green-800",
    good: "bg-blue-100 text-blue-800",
    at_risk: "bg-yellow-100 text-yellow-800",
    underperforming: "bg-red-100 text-red-800",
  };
  const labels = {
    excellent: "🌟 Excellent",
    good: "✅ Good",
    at_risk: "⚠️ At Risk",
    underperforming: "🔴 Underperforming",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score" | "name" | "hours">("score");

  useEffect(() => {
    fetchDashboardData();
  }, [selectedWeek, selectedDept]);

  async function fetchDashboardData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedWeek) params.set("week", String(selectedWeek));
      if (selectedDept !== "all") params.set("department", selectedDept);

      const res = await fetch(`/api/admin/dashboard?${params.toString()}`);
      const data = await res.json();
      setStaff(data.staff ?? []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = staff
    .filter((s) => selectedDept === "all" || s.department === selectedDept)
    .sort((a, b) => {
      if (sortBy === "score") return b.overallScore - a.overallScore;
      if (sortBy === "hours") return b.totalHoursWorked - a.totalHoursWorked;
      return a.name.localeCompare(b.name);
    });

  const departments = [...new Set(staff.map((s) => s.department))];
  const avgScore = staff.length
    ? Math.round(staff.reduce((a, b) => a + b.overallScore, 0) / staff.length)
    : 0;
  const alerts = staff.filter((s) => s.twoWeekDropAlert);

  // Chart data
  const kpiCategories: Record<string, number[]> = {};
  for (const s of staff) {
    for (const k of s.kpiScores) {
      kpiCategories[k.category] = kpiCategories[k.category] ?? [];
      kpiCategories[k.category].push(k.completionPercent);
    }
  }

  const kpiChartData = Object.entries(kpiCategories).map(([cat, vals]) => ({
    category: cat,
    avgCompletion: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
  }));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Admin Dashboard</h1>
          <p className="text-slate-400 text-sm">Staff Performance Overview</p>
        </div>
        <div className="flex gap-3">
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700"
          >
            <option value="score">Sort: Score</option>
            <option value="hours">Sort: Hours</option>
            <option value="name">Sort: Name</option>
          </select>
          <button
            onClick={() => fetchDashboardData()}
            className="bg-blue-600 hover:bg-blue-700 text-sm px-4 py-2 rounded-lg font-medium"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Team avg score", value: `${avgScore}/100`, color: getScoreColor(avgScore) },
            { label: "Staff tracked", value: staff.length, color: "#374151" },
            { label: "Alerts", value: alerts.length, color: alerts.length > 0 ? "#dc2626" : "#16a34a" },
            {
              label: "Underperforming",
              value: staff.filter((s) => s.overallScore < 60).length,
              color: "#dc2626",
            },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <p className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-slate-500 text-sm mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <h3 className="text-red-800 font-semibold mb-2">⚠️ Consecutive Drop Alerts</h3>
            <div className="flex flex-wrap gap-2">
              {alerts.map((a) => (
                <span key={a.staffId} className="bg-red-100 text-red-800 text-sm px-3 py-1 rounded-full">
                  {a.name} — {a.overallScore}/100
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Score Distribution */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Score Distribution</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={filtered.slice(0, 15)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => v.split(" ")[0]}
                />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="overallScore" radius={[4, 4, 0, 0]}>
                  {filtered.slice(0, 15).map((s, i) => (
                    <Cell key={i} fill={getScoreColor(s.overallScore)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* KPI Category Completion */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">KPI Completion by Category</h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kpiChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={90} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Bar dataKey="avgCompletion" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                  {kpiChartData.map((d, i) => (
                    <Cell key={i} fill={getScoreColor(d.avgCompletion)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Staff Table */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Staff Rankings</h2>
            <span className="text-sm text-slate-500">{filtered.length} staff members</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">#</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">Dept</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">Score</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">Hours</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-xs font-medium text-slate-500 uppercase"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((s, i) => (
                    <tr key={s.staffId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-slate-400 font-medium">#{i + 1}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{s.name}</span>
                          {s.twoWeekDropAlert && (
                            <span title="Consecutive drop alert" className="text-red-500">⚠️</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500 text-sm">{s.department}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-slate-100 rounded-full h-2">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${s.overallScore}%`,
                                backgroundColor: getScoreColor(s.overallScore),
                              }}
                            />
                          </div>
                          <span
                            className="text-sm font-semibold"
                            style={{ color: getScoreColor(s.overallScore) }}
                          >
                            {s.overallScore}/100
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 text-sm">{s.totalHoursWorked}h</td>
                      <td className="px-6 py-4">{getStatusBadge(s.status)}</td>
                      <td className="px-6 py-4">
                        <a
                          href={`/admin/staff/${s.staffId}`}
                          className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                        >
                          Details →
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
