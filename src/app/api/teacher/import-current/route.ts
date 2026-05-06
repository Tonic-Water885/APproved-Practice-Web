import { createClient } from "@supabase/supabase-js";

import { ensureFlatCurriculumIsEditable } from "@/lib/server/teacher-curriculum-sync";
import type { CurriculumTopicRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://jomlceougvxmnlztppms.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvbWxjZW91Z3Z4bW5senRwcG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTIzMjAsImV4cCI6MjA5MzU2ODMyMH0.nvflZjGbg4gCSHVaE1H3ATxUc561YDtetXvcpWViGd8";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const providedRows = Array.isArray(body?.rows) ? body.rows as CurriculumTopicRow[] : undefined;
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return Response.json({ error: "Missing authorization" }, { status: 401 });
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return Response.json({ error: "Missing access token" }, { status: 401 });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: userError?.message ?? "Not signed in" }, { status: 401 });
  }

  const userID = userData.user.id;
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", userID)
    .single();

  if (profileError || !["teacher", "admin"].includes(String(profile?.role))) {
    return Response.json({ error: "Teacher access required" }, { status: 403 });
  }

  const curriculumClient = supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
        },
      })
    : userClient;

  try {
    const imported = await ensureFlatCurriculumIsEditable(curriculumClient, userID, providedRows);
    return Response.json({ imported });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Import failed" }, { status: 400 });
  }
}
