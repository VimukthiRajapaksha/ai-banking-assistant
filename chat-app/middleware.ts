import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  // Check if user is accessing chat page
  if (request.nextUrl.pathname.startsWith("/chat")) {
    if (!request.cookies.get("session_id")) {
      // Redirect to login if no session id
      return NextResponse.redirect(new URL("/", request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/chat/:path*"],
}
