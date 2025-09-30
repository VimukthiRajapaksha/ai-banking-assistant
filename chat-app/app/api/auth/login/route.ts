import { type NextRequest, NextResponse } from "next/server"
import { OpenBankingClient, OpenBankingClientBuilder } from "@/lib/auth/client"
import { AuthorizationCodeGrant } from "@/lib/auth/grants/authorization-code"

export async function GET(request: NextRequest) {

  const openBankingClient: OpenBankingClient = new OpenBankingClientBuilder()
    .with(new AuthorizationCodeGrant()).buildSingleton();

  return openBankingClient.authorize()
    .then((authorizationUrl) => {
      return NextResponse.redirect(authorizationUrl);
    }).catch((error) => {
      console.error("OAuth initiation error. Caused by, ", error)
      return NextResponse.redirect(new URL("/?error=auth_init_failed", request.url))
    });
}
