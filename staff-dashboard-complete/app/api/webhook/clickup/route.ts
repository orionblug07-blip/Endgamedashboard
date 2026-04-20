/**
 * app/api/webhook/clickup/route.ts
 * Receives incoming ClickUp webhooks, stores raw tasks, triggers parsing.
 * 
 * ClickUp webhook setup: https://clickup.com/api → Webhooks → Create webhook
 * Point it to: https://your-domain.vercel.app/api/webhook/clickup
 * Events to subscribe to: taskCreated, taskUpdated, taskCommentPosted
 */

import { NextRequest, NextResponse } from "next/server";
import { db, getISOWeek } from "@/lib/airtable";
import { parseTask } from "@/lib/taskParser";
import crypto from "crypto";

// ─── Security ─────────────────────────────────────────────────────────────────

function verifyClickUpSignature(body: string, signature: string): boolean {
  if (!process.env.CLICKUP_WEBHOOK_SECRET) return true; // skip in dev
  
  const hmac = crypto
    .createHmac("sha256", process.env.CLICKUP_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(hmac)
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-signature") ?? "";

  // Verify the request is genuinely from ClickUp
  if (!verifyClickUpSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, task_id, history_items } = payload;

  // We care about task updates that contain custom field submissions
  // Adjust this based on your ClickUp form structure
  if (!["taskCreated", "taskUpdated"].includes(event)) {
    return NextResponse.json({ received: true, skipped: true });
  }

  try {
    // Extract the text field from ClickUp task
    // ClickUp custom fields come in via history_items or task.custom_fields
    const rawText = extractTaskText(payload);
    const clickUpUserId = payload.task?.creator?.id ?? payload.history_items?.[0]?.user?.id;

    if (!rawText || !clickUpUserId) {
      return NextResponse.json({ received: true, skipped: "no_text_or_user" });
    }

    // Look up staff member by ClickUp user ID
    const staffUser = await db.users.getByClickUpId(String(clickUpUserId));
    if (!staffUser) {
      console.warn(`No staff found for ClickUp user ${clickUpUserId}`);
      return NextResponse.json({ received: true, skipped: "user_not_found" });
    }

    const now = new Date();
    const week = getISOWeek(now);
    const year = now.getFullYear();

    // Store raw task in Airtable
    const rawTask = await db.tasks.create({
      RawText: rawText,
      SubmittedAt: now.toISOString(),
      ClickUpTaskId: task_id,
      StaffId: [staffUser.id],
      Status: "pending",
      WeekNumber: week,
      Year: year,
    });

    // Parse the task text (async, but we'll await for now — move to queue for scale)
    const parsedResults = await parseTask(rawText);

    if (parsedResults.length === 0) {
      await db.tasks.updateStatus(rawTask.id, "error");
      return NextResponse.json({
        received: true,
        taskId: rawTask.id,
        parsed: 0,
        warning: "Could not parse task text",
      });
    }

    // Store parsed tasks in Airtable
    await db.parsedTasks.bulkCreate(
      parsedResults.map((parsed) => ({
        fields: {
          TaskId: [rawTask.id],
          StaffId: [staffUser.id],
          StartTime: parsed.startTime,
          EndTime: parsed.endTime,
          DurationMinutes: parsed.durationMinutes,
          Category: parsed.category,
          Description: parsed.description,
          TaskDate: now.toISOString().split("T")[0],
          WeekNumber: week,
          Year: year,
        },
      }))
    );

    await db.tasks.updateStatus(rawTask.id, "parsed");

    return NextResponse.json({
      received: true,
      taskId: rawTask.id,
      parsed: parsedResults.length,
      entries: parsedResults.map((p) => ({
        category: p.category,
        durationMinutes: p.durationMinutes,
        parsedBy: p.parsedBy,
      })),
    });
  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return NextResponse.json(
      { error: "Internal processing error", detail: err.message },
      { status: 500 }
    );
  }
}

// ─── ClickUp payload extraction ───────────────────────────────────────────────

function extractTaskText(payload: any): string | null {
  // Option 1: Task description contains the daily log
  if (payload.task?.description) return payload.task.description;

  // Option 2: Custom field named "Daily Tasks" or "Task Log"
  const customFields = payload.task?.custom_fields ?? [];
  for (const field of customFields) {
    const name = (field.name ?? "").toLowerCase();
    if (name.includes("daily") || name.includes("task log") || name.includes("activity")) {
      return field.value ?? null;
    }
  }

  // Option 3: Comment text (if using task comments as submissions)
  const comment = payload.history_items?.find(
    (item: any) => item.field === "comment"
  );
  if (comment?.comment?.text) return comment.comment.text;

  return null;
}

// ─── Alternative: Manual task submission endpoint ──────────────────────────────
// Staff can also submit via a form on the dashboard (no ClickUp required)

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { staffId, rawText, taskDate } = body;

  if (!staffId || !rawText) {
    return NextResponse.json(
      { error: "staffId and rawText are required" },
      { status: 400 }
    );
  }

  const date = taskDate ? new Date(taskDate) : new Date();
  const week = getISOWeek(date);
  const year = date.getFullYear();

  const rawTask = await db.tasks.create({
    RawText: rawText,
    SubmittedAt: date.toISOString(),
    StaffId: [staffId],
    Status: "pending",
    WeekNumber: week,
    Year: year,
  });

  const parsedResults = await parseTask(rawText);

  if (parsedResults.length > 0) {
    await db.parsedTasks.bulkCreate(
      parsedResults.map((parsed) => ({
        fields: {
          TaskId: [rawTask.id],
          StaffId: [staffId],
          StartTime: parsed.startTime,
          EndTime: parsed.endTime,
          DurationMinutes: parsed.durationMinutes,
          Category: parsed.category,
          Description: parsed.description,
          TaskDate: date.toISOString().split("T")[0],
          WeekNumber: week,
          Year: year,
        },
      }))
    );
    await db.tasks.updateStatus(rawTask.id, "parsed");
  }

  return NextResponse.json({ success: true, parsed: parsedResults.length });
}
