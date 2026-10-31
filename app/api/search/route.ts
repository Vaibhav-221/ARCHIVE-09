import { searchArchive } from "@/lib/retrieval";

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    if (!query?.trim()) {
      return Response.json({ error: "A non-empty search query is required." }, { status: 400 });
    }
    if (query.length > 200) {
      return Response.json({ error: "Search queries must be 200 characters or fewer." }, { status: 413 });
    }

    const rawLimit = url.searchParams.get("limit");
    let limit: number | undefined;
    if (rawLimit !== null) {
      limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return Response.json({ error: "Search limits must be a whole number from 1 to 100." }, { status: 400 });
      }
    }

    const records = searchArchive(query, limit);
    return Response.json({ query, count: records.length, records });
  } catch {
    return Response.json({ error: "The archive search could not be completed." }, { status: 500 });
  }
}
