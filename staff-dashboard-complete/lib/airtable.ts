/**
 * lib/airtable.ts
 * Central Airtable client. ALL database operations go through this file.
 * To migrate to PostgreSQL later: swap out these functions, keep all signatures.
 */

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const BASE_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AirtableUser {
  id: string;
  fields: {
    Name: string;
    Email: string;
    Role: "staff" | "admin" | "ceo";
    Department: string;
    ClickUpUserId?: string;
    IsActive: boolean;
  };
}

export interface AirtableTask {
  id: string;
  fields: {
    RawText: string;          // "9:00–10:00 Attendance review"
    SubmittedAt: string;      // ISO date
    ClickUpTaskId?: string;
    StaffId: string[];        // Linked record to Users
    Status: "pending" | "parsed" | "error";
    WeekNumber: number;       // ISO week number
    Year: number;
  };
}

export interface AirtableParsedTask {
  id?: string;
  fields: {
    TaskId: string[];         // Linked record to Tasks
    StaffId: string[];        // Linked record to Users
    StartTime: string;        // "09:00"
    EndTime: string;          // "10:00"
    DurationMinutes: number;
    Category: string;         // "Attendance" | "Support" | "Dev" | "Admin" | etc.
    Description: string;
    TaskDate: string;         // ISO date
    WeekNumber: number;
    Year: number;
  };
}

export interface AirtableKPI {
  id: string;
  fields: {
    Name: string;             // "Weekly Attendance Reviews"
    Category: string;         // Must match ParsedTask.Category
    Department: string;
    TargetHoursPerWeek: number;
    TargetCountPerWeek?: number;
    Weight: number;           // 0-100, used in composite score
    Description: string;
  };
}

export interface AirtableKPIResult {
  id?: string;
  fields: {
    StaffId: string[];        // Linked record to Users
    KPIId: string[];          // Linked record to KPIs
    WeekNumber: number;
    Year: number;
    ActualHours: number;
    ActualCount: number;
    CompletionPercent: number;
    PerformanceScore: number; // 0-100
    PrevWeekScore?: number;
    Status: "met" | "at_risk" | "missed";
    Notes?: string;
  };
}

// ─── Core fetch helper ────────────────────────────────────────────────────────

async function airtableFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(
      `Airtable API error: ${res.status} - ${JSON.stringify(error)}`
    );
  }

  return res.json();
}

// ─── Generic table operations ─────────────────────────────────────────────────

async function listRecords<T>(
  table: string,
  params: {
    filterByFormula?: string;
    sort?: { field: string; direction: "asc" | "desc" }[];
    maxRecords?: number;
    fields?: string[];
    pageSize?: number;
  } = {}
): Promise<T[]> {
  const searchParams = new URLSearchParams();

  if (params.filterByFormula)
    searchParams.set("filterByFormula", params.filterByFormula);
  if (params.maxRecords)
    searchParams.set("maxRecords", String(params.maxRecords));
  if (params.pageSize)
    searchParams.set("pageSize", String(params.pageSize));
  if (params.fields)
    params.fields.forEach((f) => searchParams.append("fields[]", f));
  if (params.sort)
    params.sort.forEach((s, i) => {
      searchParams.set(`sort[${i}][field]`, s.field);
      searchParams.set(`sort[${i}][direction]`, s.direction);
    });

  const records: T[] = [];
  let offset: string | undefined;

  // Airtable paginates at 100 records. Loop through all pages.
  do {
    if (offset) searchParams.set("offset", offset);

    const data = await airtableFetch(
      `/${encodeURIComponent(table)}?${searchParams.toString()}`
    );

    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

async function getRecord<T>(table: string, id: string): Promise<T> {
  return airtableFetch(`/${encodeURIComponent(table)}/${id}`);
}

async function createRecord<T>(table: string, fields: object): Promise<T> {
  return airtableFetch(`/${encodeURIComponent(table)}`, {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
}

async function updateRecord<T>(
  table: string,
  id: string,
  fields: object
): Promise<T> {
  return airtableFetch(`/${encodeURIComponent(table)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
}

async function bulkCreate<T>(
  table: string,
  records: { fields: object }[]
): Promise<T[]> {
  // Airtable bulk create limit: 10 records per call
  const chunks: { fields: object }[][] = [];
  for (let i = 0; i < records.length; i += 10) {
    chunks.push(records.slice(i, i + 10));
  }

  const results: T[] = [];
  for (const chunk of chunks) {
    const data = await airtableFetch(`/${encodeURIComponent(table)}`, {
      method: "POST",
      body: JSON.stringify({ records: chunk }),
    });
    results.push(...data.records);
  }

  return results;
}

async function bulkUpdate<T>(
  table: string,
  records: { id: string; fields: object }[]
): Promise<T[]> {
  const chunks = [];
  for (let i = 0; i < records.length; i += 10) {
    chunks.push(records.slice(i, i + 10));
  }

  const results: T[] = [];
  for (const chunk of chunks) {
    const data = await airtableFetch(`/${encodeURIComponent(table)}`, {
      method: "PATCH",
      body: JSON.stringify({ records: chunk }),
    });
    results.push(...data.records);
  }

  return results;
}

// ─── Domain-specific queries ───────────────────────────────────────────────────

export const db = {
  users: {
    list: (filters?: { isActive?: boolean; department?: string }) => {
      let formula = "";
      if (filters?.isActive !== undefined)
        formula = `{IsActive} = ${filters.isActive ? 1 : 0}`;
      if (filters?.department)
        formula = formula
          ? `AND(${formula}, {Department} = "${filters.department}")`
          : `{Department} = "${filters.department}"`;

      return listRecords<AirtableUser>("Users", {
        filterByFormula: formula || undefined,
      });
    },

    getByEmail: (email: string) =>
      listRecords<AirtableUser>("Users", {
        filterByFormula: `{Email} = "${email}"`,
        maxRecords: 1,
      }).then((r) => r[0] ?? null),

    getByClickUpId: (clickUpId: string) =>
      listRecords<AirtableUser>("Users", {
        filterByFormula: `{ClickUpUserId} = "${clickUpId}"`,
        maxRecords: 1,
      }).then((r) => r[0] ?? null),
  },

  tasks: {
    create: (fields: AirtableTask["fields"]) =>
      createRecord<AirtableTask>("Tasks", fields),

    updateStatus: (id: string, status: AirtableTask["fields"]["Status"]) =>
      updateRecord<AirtableTask>("Tasks", id, { Status: status }),

    listPending: () =>
      listRecords<AirtableTask>("Tasks", {
        filterByFormula: `{Status} = "pending"`,
      }),

    listByWeek: (staffId: string, week: number, year: number) =>
      listRecords<AirtableTask>("Tasks", {
        filterByFormula: `AND(FIND("${staffId}", ARRAYJOIN({StaffId})), {WeekNumber} = ${week}, {Year} = ${year})`,
      }),
  },

  parsedTasks: {
    create: (fields: AirtableParsedTask["fields"]) =>
      createRecord<AirtableParsedTask>("ParsedTasks", fields),

    bulkCreate: (records: { fields: AirtableParsedTask["fields"] }[]) =>
      bulkCreate<AirtableParsedTask>("ParsedTasks", records),

    listByStaffWeek: (staffId: string, week: number, year: number) =>
      listRecords<AirtableParsedTask>("ParsedTasks", {
        filterByFormula: `AND(FIND("${staffId}", ARRAYJOIN({StaffId})), {WeekNumber} = ${week}, {Year} = ${year})`,
      }),

    listByWeek: (week: number, year: number) =>
      listRecords<AirtableParsedTask>("ParsedTasks", {
        filterByFormula: `AND({WeekNumber} = ${week}, {Year} = ${year})`,
      }),
  },

  kpis: {
    list: (department?: string) =>
      listRecords<AirtableKPI>("KPIs", {
        filterByFormula: department
          ? `{Department} = "${department}"`
          : undefined,
      }),
  },

  kpiResults: {
    upsert: async (
      staffId: string,
      kpiId: string,
      week: number,
      year: number,
      data: Partial<AirtableKPIResult["fields"]>
    ) => {
      // Check if a result already exists for this staff+KPI+week
      const existing = await listRecords<AirtableKPIResult>("KPIResults", {
        filterByFormula: `AND(FIND("${staffId}", ARRAYJOIN({StaffId})), FIND("${kpiId}", ARRAYJOIN({KPIId})), {WeekNumber} = ${week}, {Year} = ${year})`,
        maxRecords: 1,
      });

      if (existing.length > 0) {
        return updateRecord<AirtableKPIResult>("KPIResults", existing[0].id!, data);
      } else {
        return createRecord<AirtableKPIResult>("KPIResults", {
          StaffId: [staffId],
          KPIId: [kpiId],
          WeekNumber: week,
          Year: year,
          ...data,
        });
      }
    },

    listByStaffWeek: (staffId: string, week: number, year: number) =>
      listRecords<AirtableKPIResult>("KPIResults", {
        filterByFormula: `AND(FIND("${staffId}", ARRAYJOIN({StaffId})), {WeekNumber} = ${week}, {Year} = ${year})`,
      }),

    listByWeek: (week: number, year: number) =>
      listRecords<AirtableKPIResult>("KPIResults", {
        filterByFormula: `AND({WeekNumber} = ${week}, {Year} = ${year})`,
      }),

    getRecentByStaff: (staffId: string, weeksBack: number = 8) => {
      const now = new Date();
      const currentWeek = getISOWeek(now);
      const currentYear = now.getFullYear();
      // Simplified: just filter by staff and limit
      return listRecords<AirtableKPIResult>("KPIResults", {
        filterByFormula: `FIND("${staffId}", ARRAYJOIN({StaffId}))`,
        sort: [{ field: "Year", direction: "desc" }],
        maxRecords: weeksBack * 10, // rough upper bound
      });
    },
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}
