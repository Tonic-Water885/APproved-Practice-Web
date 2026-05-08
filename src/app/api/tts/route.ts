export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { error: "Server-side TTS is disabled. The web app uses the browser device TTS engine." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
