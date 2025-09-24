# Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at

# http://www.apache.org/licenses/LICENSE-2.0

# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied. See the License for the
# specific language governing permissions and limitations
# under the License.

import logging
from typing import Any, Dict, Literal

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field
from typing_extensions import Annotated

from client import HTTPClient
from config import ServerConfigs

logger = logging.getLogger(__name__)

configs: ServerConfigs = ServerConfigs()

# Create an MCP server
mcp = FastMCP(name = "Open Banking MCP Server", host=configs.mcp_host, port=configs.mcp_port)

http_client: HTTPClient = HTTPClient(configs=configs)


@mcp.tool(
    description=(
        "Retrieves account information for a user from their bank via the Open Banking API. "
        "Call this tool to retrieve details for a specific account by its logical ID, or all accounts if no ID is provided. "
        "Use this tool when you need account balances, account numbers, or other account metadata for a user. "
        "Pass the 'account_id' parameter to fetch a specific account, or leave it blank to fetch all accounts."
    )
)
async def get_accounts(
    ctx: Context,
    account_id: Annotated[
        str,
        Field(
            description="The logical ID of the account to fetch. If blank, all accounts will be returned."
        ),
    ] = "",
    sub_resource: Annotated[
        Literal[
            "transactions"
        ],
        Field(
            description="Specifies the type of account sub-resource to retrieve for the given account."
        ),
    ] = "",
) -> Annotated[
    Dict[str, Any],
    Field(
        description=(
            "A dictionary containing account information as returned by the Open Banking API. "
            "Includes account balances, account numbers, and other metadata. "
            "If 'account_id' is provided, returns details for that account; otherwise, returns all accounts."
        )
    ),
]:
    """Fetch accounts from the Open Banking API."""
    accounts_url: str = configs.server_url.rstrip("/") + "/accounts"
    if account_id:
        accounts_url += f"/{account_id}"

    if sub_resource:
        accounts_url += f"/{sub_resource}"

    headers: dict[str, str] = {
        "Authorization": f"Bearer {ctx.request_context.request.headers.get('x-forwarded-authorization')}"
    }

    logger.info(f"Fetching accounts from URL: {accounts_url} with headers: {headers}")
    return http_client.get(url=accounts_url, headers=headers)


# @mcp.tool(
#     description=(
#         "Retrieves transaction information for a user from their bank via the Open Banking API. "
#         "Call this tool to obtain details for a specific transaction by its logical ID, or all transactions if no ID is provided. "
#         "Use this tool when you need transaction history, transaction amounts, dates, descriptions, or other transaction metadata for a user. "
#         "Pass the 'transaction_id' parameter to fetch a specific transaction, or leave it blank to fetch all transactions."
#     )
# )
def get_transactions(
    ctx: Context,
    transaction_id: Annotated[
        str,
        Field(
            description="The logical ID of the transaction to fetch. If blank, all transactions will be returned."
        ),
    ] = "",
) -> Annotated[
    Dict[str, Any],
    Field(
        description=(
            "A dictionary containing transaction information as returned by the Open Banking API. "
            "Includes transaction amounts, dates, descriptions, and other metadata. "
            "If 'transaction_id' is provided, returns details for that transaction; otherwise, returns all transactions."
        )
    ),
]:
    """Fetch transactions from the Open Banking API."""
    transactions_url: str = configs.server_url.rstrip("/") + "/transactions"
    if transaction_id:
        transactions_url += f"/{transaction_id}"

    headers: dict[str, str] = {
        "Authorization": f"Bearer {ctx.request_context.request.headers.get('x-forwarded-authorization')}"
    }

    logger.info(
        f"Fetching transactions from URL: {transactions_url} with headers: {headers}"
    )
    return http_client.get(url=transactions_url, headers=headers)
