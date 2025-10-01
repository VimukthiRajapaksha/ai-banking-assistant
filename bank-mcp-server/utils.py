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

from typing import Dict
from mcp.server.fastmcp import Context
from config import ServerConfigs


def build_request_headers(ctx: Context, configs: ServerConfigs) -> Dict[str, str]:
    """
    Build HTTP request headers with authorization and API key if available.
    
    Args:
        ctx: The MCP context containing request information
        configs: Server configuration containing API key
        
    Returns:
        Dictionary of headers to include in the HTTP request
    """
    headers: Dict[str, str] = {}
    
    # Only add Authorization header if x-forwarded-authorization is present
    auth_token = ctx.request_context.request.headers.get('x-forwarded-authorization')
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    
    # Add API key if configured
    if configs.server_api_key:
        headers["api-key"] = configs.server_api_key
    
    return headers