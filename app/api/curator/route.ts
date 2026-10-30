import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { question } = await request.json();

    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "A question is required." },
        { status: 400 }
      );
    }

    const response = await fetch(
      "http://localhost:11434/api/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen2.5-coder:3b",
          messages: [
            {
              role: "system",
              content:
                "You are The Curator, an archivist investigating a mysterious fictional website. Be concise and never invent evidence.",
            },
            {
              role: "user",
              content: question,
            },
          ],
          stream: false,
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Ollama could not process the request." },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      answer: data.message.content,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not connect to Ollama. Check if it is running." },
      { status: 503 }
    );
  }
}
