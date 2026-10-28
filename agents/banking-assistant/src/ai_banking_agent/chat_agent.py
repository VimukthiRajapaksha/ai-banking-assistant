"""The conversational LLM loop -- the only place an LLM call happens in this
service. Everything upstream of a tool call actually running (agent self-auth,
delegation, session/token caching) is deterministic Python, per the project's
design.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any

from anthropic import AsyncAnthropic
from mcp.types import Tool as McpTool
from pydantic_ai import Agent, FunctionToolset, RunContext, Tool
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.anthropic import AnthropicModel
from pydantic_ai.providers.anthropic import AnthropicProvider

from ai_banking_agent.mcp_client import call_tool
from ai_banking_agent.sessions import SessionRuntime

logger = logging.getLogger(__name__)

# Wire-level MCP tool names, which must match the MCP server's registrations.
# Used by the PLAN line; the tools themselves are built from the server's
# listing (see build_chat_agent).
GET_ACCOUNTS_TOOL = "get_accounts"
GET_TRANSACTIONS_TOOL = "get_transactions"
GET_PAYEES_TOOL = "get_payees"
MAKE_PAYMENT_TOOL = "make_payment"

#: Every tool a plan may name. Anything else the model writes on its PLAN line
#: is dropped rather than forwarded -- the MCP server would ignore it anyway,
#: but there is no reason to send it a name it has no catalog entry for.
KNOWN_TOOLS = (GET_ACCOUNTS_TOOL, GET_TRANSACTIONS_TOOL, GET_PAYEES_TOOL, MAKE_PAYMENT_TOOL)

PLAN_PREFIX = "PLAN:"

SYSTEM_PROMPT = f"""\
You are the banking assistant for a retail bank, talking with a signed-in \
customer about their own money. Your tools look up the customer's accounts, \
balances, transactions and saved payees, and make payments to saved payees. \
Everything you know about the customer's money comes from those tools.

<plan_line>
Start every reply with one line naming the tools this turn will use, for example

    {PLAN_PREFIX} {GET_ACCOUNTS_TOOL}, {GET_TRANSACTIONS_TOOL}

or "{PLAN_PREFIX} none" when the turn needs no tool. Write it before any other \
text and before your first tool call, and name every tool the whole request \
needs, not only the first: recent activity on an account the customer names \
needs {GET_ACCOUNTS_TOOL} and {GET_TRANSACTIONS_TOOL}; paying someone needs \
{GET_PAYEES_TOOL} and {MAKE_PAYMENT_TOOL}. The customer approves data access \
once for the tools this line declares, so a line that leaves one out makes \
them approve twice for one request. The line is removed before the customer \
sees your reply. The tool names are {GET_ACCOUNTS_TOOL}, {GET_TRANSACTIONS_TOOL}, \
{GET_PAYEES_TOOL} and {MAKE_PAYMENT_TOOL}.
</plan_line>

<using_tools>
Work out what the customer is referring to from tool results rather than \
asking them for identifiers: accounts they describe in words are matched \
against {GET_ACCOUNTS_TOOL}, and people or companies they want to pay against \
{GET_PAYEES_TOOL}. Ask the customer only when the results leave a real choice, \
such as two accounts or payees that both fit, or when nothing fits.

When one call needs another's output, make them in order and pass the real \
value; never guess an argument.

Some tools need the customer's approval first. They give it outside this \
conversation, and only the customer can give it, so you never answer for them. \
When a tool result says something was declined or failed, tell the customer \
plainly and follow the next step the result gives rather than retrying on your \
own.
</using_tools>

<payments>
A payment moves real money and cannot be undone, so it only happens when the \
customer has asked for it and you know both the payee and the amount; if \
either is missing or unclear, ask. Do not ask which account to pay from: the \
customer chooses it while approving the payment. When the customer says what \
a payment is for, even in passing, pass it as `reason`, because it appears on \
the approval they sign and on their statement. Each payment needs its own \
approval, so an earlier approval never covers a new one, and a payment is only \
done when {MAKE_PAYMENT_TOOL} returns a payment record.
</payments>

<accuracy>
The customer may act on what you tell them, so report balances, account \
details, transactions and payment outcomes exactly as the tools returned them. \
If the tools did not return something, say you do not have it rather than \
estimating or filling it in.
</accuracy>

<style>
Be friendly and professional, and keep replies short and in plain language. \
Always give amounts with their currency. Use a short list or table only when \
showing several accounts, transactions or payees.
</style>
"""


def _forward(mcp_server_url: str, name: str):
    """The model-facing body of MCP tool `name`: a straight forward to the server.

    The arguments go through untouched -- the server validates them against
    the same schema the model was shown.
    """

    async def forward(ctx: RunContext[SessionRuntime], **arguments: Any) -> str:
        logger.debug("Tool call: %s", name)
        return await call_tool(mcp_server_url, name, ctx.deps, arguments=arguments)

    return forward


def build_chat_agent(
    model: str,
    api_key: str,
    mcp_server_url: str,
    base_url: str | None = None,
    api_key_header: str | None = None,
) -> Agent[SessionRuntime, str]:
    # base_url=None is the provider's own default (api.anthropic.com), so this
    # stays a single code path whether or not a gateway is configured.
    # api_key_header is for a gateway that reads its key from a header other
    # than Anthropic's x-api-key -- AMP's per-agent LLM proxy uses "API-Key".
    default_headers = {api_key_header: api_key} if api_key_header else None
    client = AsyncAnthropic(api_key=api_key, base_url=base_url, default_headers=default_headers)
    llm_model = AnthropicModel(model, provider=AnthropicProvider(anthropic_client=client))
    agent: Agent[SessionRuntime, str] = Agent(
        llm_model,
        deps_type=SessionRuntime,
        system_prompt=SYSTEM_PROMPT,
    )

    # The last listing seen, for a turn whose own connection failed: the model
    # keeps the same tools (and the call then reports the outage where it
    # belongs) instead of answering a banking question with none.
    last_listing: list[McpTool] = []

    @agent.toolset(per_run_step=False)
    def mcp_tools(ctx: RunContext[SessionRuntime]) -> FunctionToolset[SessionRuntime]:
        """The MCP server's tools, exactly as it describes them.

        Name, description and input schema all come from its `tools/list`, so
        the server is the single place a tool is defined. Evaluated once per
        run: the listing is fixed for the turn, and changing tool definitions
        mid-run would invalidate the model's earlier reasoning.
        """
        nonlocal last_listing
        if ctx.deps.mcp_tools:
            last_listing = ctx.deps.mcp_tools
        return FunctionToolset([
            Tool.from_schema(
                _forward(mcp_server_url, tool.name),
                name=tool.name,
                # Docstrings arrive with their source indentation.
                description=inspect.cleandoc(tool.description or ""),
                json_schema=tool.input_schema,
                takes_ctx=True,
            )
            for tool in last_listing
        ])

    return agent


def parse_plan(response: ModelResponse) -> list[str]:
    """The tools the model declared on its PLAN line, if it wrote one.

    Read off the same model response that carries the turn's first tool call,
    so the plan is known before that call is made -- which is the whole point:
    the first call is what triggers the consent prompt.

    Advisory, exactly as the separate planner model's answer was. The MCP
    server clamps a plan to the caller's token scopes and refuses to
    pre-authorise anything restricted from a plan alone, so a wrong or hostile
    line costs an extra prompt, never unearned access.
    """
    for part in response.parts:
        if not isinstance(part, TextPart):
            continue
        for line in part.content.splitlines():
            stripped = line.strip()
            if not stripped.upper().startswith(PLAN_PREFIX):
                continue
            named = {t.strip().lower() for t in stripped[len(PLAN_PREFIX):].split(",")}
            return [t for t in KNOWN_TOOLS if t in named]
    return []


def strip_plan(reply: str) -> str:
    """Drop the PLAN line before the reply reaches the customer.

    It is protocol between this service and the MCP server, not something the
    customer asked for. Left in the stored message history on purpose: seeing
    its own earlier lines keeps the model writing them.
    """
    lines = reply.splitlines()
    kept = [line for line in lines if not line.strip().upper().startswith(PLAN_PREFIX)]
    return "\n".join(kept).lstrip("\n")
