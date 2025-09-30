import { OpenBankingClientBuilder } from "@/lib/auth/client";
import { AuthorizationCodeGrant } from "@/lib/auth/grants/authorization-code";
import { post } from "@/lib/auth/http"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const headers: Record<string, string> = {};
    const { message, sessionId } = await request.json()

    const { access_token } = await new OpenBankingClientBuilder()
      .with(new AuthorizationCodeGrant())
      .buildSingleton()
      .getTokenFromCacheOrRetrieve(sessionId);

    if (!access_token) {
      return NextResponse.json({ error: "Unauthorized - No access token" }, { status: 401 })
    } else {
      headers["Authorization"] = "Bearer " + access_token
    }

    if (!process.env.OB_AGENT_URL) {
      return NextResponse.json({ error: "Healthcare agent endpoint not configured" }, { status: 500 })
    }


    if (process.env.OB_AGENT_API_KEY) {
      headers["api-key"] = process.env.OB_AGENT_API_KEY
    }

    const response = await post(process.env.OB_AGENT_URL,
      {
        sessionId: sessionId,
        message: message,
      },
      {
        headers: headers,
        useMtls: false
      },
    )

    return NextResponse.json({
      response: response.data.response || response.data.message || "I received your message but couldn't generate a proper response.",
      sessionId: sessionId,
    })
  } catch (error: any) {
    console.error("Chat API error:", error?.response?.data || error.message)
    return NextResponse.json(
      {
        error: "Failed to process chat message",
        response: "I'm sorry, I'm experiencing technical difficulties. Please try again later.",
      },
      { status: 500 },
    )
  }
}
