// app/api/kanban/ai/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side AI card assistant using OpenAI GPT-4o.
// Called by KanbanTab's AIAssistant component when user clicks "🤖 AI".
//
// POST body: { title: string }
// Response:  { story, subtasks, effortScore, valueScore }
//
// Requires an admin x-admin-token header. Uses OPENAI_API_KEY env var.
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { title } = await req.json() as { title: string };
  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });

  const prompt = `You are a senior product manager at a SaaS company.
Fill out this Kanban card based on its title.

Card title: "${title.trim()}"

Respond with ONLY valid JSON — no markdown, no backticks, no explanation:
{
  "story": "As a [specific user type], I want [clear goal] so that [concrete business reason].",
  "subtasks": [
    { "done": false, "label": "First concrete subtask" },
    { "done": false, "label": "Second concrete subtask" },
    { "done": false, "label": "Third concrete subtask" }
  ],
  "effortScore": <integer 1-10, where 1=1-2 hours, 5=1 week, 10=1 month+>,
  "valueScore": <integer 1-10, where 1=nice-to-have, 10=revenue-critical>,
  "reasoning": "One sentence explaining the scores."
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.4,
        max_tokens: 600,
        response_format: { type: "json_object" }, // forces valid JSON output
        messages: [
          { role: "system", content: "You are a senior PM. Always respond with valid JSON only." },
          { role: "user",   content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("OpenAI error:", err);
      return NextResponse.json({ error: "OpenAI API error" }, { status: res.status });
    }

    const data = await res.json() as {
      choices: { message: { content: string } }[];
    };

    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as {
      story: string;
      subtasks: { done: boolean; label: string }[];
      effortScore: number;
      valueScore: number;
      reasoning: string;
    };

    // Validate and clamp scores
    return NextResponse.json({
      story:       parsed.story       ?? "",
      subtasks:    parsed.subtasks    ?? [],
      effortScore: Math.min(10, Math.max(1, Math.round(parsed.effortScore ?? 3))),
      valueScore:  Math.min(10, Math.max(1, Math.round(parsed.valueScore  ?? 5))),
      reasoning:   parsed.reasoning   ?? "",
    });

  } catch (e) {
    console.error("AI route error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}