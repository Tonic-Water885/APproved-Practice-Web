export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "Legacy flat curriculum import is disabled in production. Use the normalized teacher tools instead." },
    { status: 410 },
  );
}
