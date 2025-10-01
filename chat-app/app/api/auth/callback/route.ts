// Copyright (c) 2025 WSO2 LLC (http://www.wso2.com).
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { OpenBankingClientBuilder } from "@/lib/auth/client"
import { AuthorizationCodeGrant } from "@/lib/auth/grants/authorization-code"
import { type NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get("code")
  const error = searchParams.get("error")

  // Get the actual base URL for redirects (works in Docker)
  const baseUrl = process.env.OB_CLIENT_BASE_URL || request.url

  // Handle authorization errors
  if (error) {
    return NextResponse.redirect(new URL(`/?error=${error}`, baseUrl))
  }

  if (!code) {
    console.error("Authorization code not found")
    return NextResponse.redirect(new URL("/?error=no_code", baseUrl))
  }

  try {
    const sessionId = crypto.randomUUID();
    const response = await new OpenBankingClientBuilder()
      .with(new AuthorizationCodeGrant())
      .buildSingleton()
      .getTokenFromCacheOrRetrieve(sessionId, { code: code });

    const nextResponse = NextResponse.redirect(new URL("/", baseUrl))

    // Set secure HTTP-only cookies for token storage
    nextResponse.cookies.set("session_id", sessionId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: response.expires_in || 3600,
      path: "/",
    })

    return nextResponse;

  } catch (error) {
    console.error("OAuth callback error:", error)
    return NextResponse.redirect(new URL("/?error=auth_failed", baseUrl))
  }
}
