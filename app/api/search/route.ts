import { searchArchive } from "@/lib/retrieval";

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query?.trim()) {
      return Response.json({ error: "A non-empty search query is required." }, { status: 400 });
    }

    const records = searchArchive(query);
    return Response.json({ query, count: records.length, records });
  } catch {
    return Response.json({ error: "The archive search could not be completed." }, { status: 500 });
  }
}
