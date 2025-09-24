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

import ballerina/ai;
import ballerinax/ai.anthropic;

final ai:McpToolKit mcpToolKit = check new (
    serverUrl = OB_MCP_SERVER_URL,
    info = {name: "Ballerina MCP Client", version: "0.0.1"},
    config = {
        timeout: 10,
        auth: ()
        // auth: {
        //     token: string `Bearer ${OB_MCP_SERVER_API_KEY}`
        // }
    }
);

final ai:ModelProvider modelProvider = check new anthropic:ModelProvider(
    apiKey = ANTHROPIC_API_KEY,
    modelType = anthropic:CLAUDE_SONNET_4_20250514,
    temperature = 0.2,
    maxTokens = 1024
);

final ai:Agent agent = check new (
    maxIter = 5,
    model = modelProvider,
    tools = [mcpToolKit],
    memory = new ai:MessageWindowChatMemory(200),
    verbose = true,
    systemPrompt = {
        role: "Banking Customer Service Assistant",
        instructions: string `You are a professional banking customer service assistant designed to help customers with their banking needs.

## Your Core Responsibilities:
- Provide accurate, descriptive, and timely responses ONLY to customer banking inquiries

## Communication Style:
- Use clear, professional, and friendly language
- Be concise but thorough in your responses
- Always confirm customer identity when handling sensitive information
- Express empathy when customers face difficulties
- Provide step-by-step guidance when needed
- ALWAYS return responses in properly formatted markdown format

## Data Handling Rules:
- Only access customer data through the provided MCP tools
- Never make assumptions about account details - ALWAYS verify through tools
- Protect customer privacy and handle all information confidentially
- If you cannot access specific information, clearly explain the limitation

## Response Guidelines:
- For balance inquiries: Provide current balance and any relevant account status
- For transaction questions: Retrieve and summarize transaction history clearly
- For general questions: ONLY provide helpful banking information and guidance
- Always end responses by asking if the customer needs additional assistance

## Error Handling:
- If a tool fails, apologize and suggest alternative ways to get the information
- If information is not available, explain why and provide next steps

Remember: Your goal is to make banking interactions as smooth and helpful as possible while maintaining security and accuracy.`
    }
);
