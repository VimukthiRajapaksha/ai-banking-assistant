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


export interface Message {
    id: string
    content: string
    sender: "user" | "agent"
    timestamp: Date
}

// Function to save messages to localStorage
export const saveMessagesToStorage = (messages: Message[]) => {
    try {
        localStorage.setItem('chat-messages', JSON.stringify(messages))
    } catch (error) {
        console.error('Failed to save messages to localStorage:', error)
    }
}

// Function to load messages from localStorage
export const loadMessagesFromStorage = (): Message[] => {
    try {
        const saved = localStorage.getItem('chat-messages')
        if (saved) {
            const parsed = JSON.parse(saved)
            // Convert timestamp strings back to Date objects
            return parsed.map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
            }))
        }
    } catch (error) {
        console.error('Failed to load messages from localStorage:', error)
    }
    return []
}

// Function to clear messages from storage
export const clearMessagesFromStorage = () => {
    try {
        localStorage.removeItem('chat-messages')
    } catch (error) {
        console.error('Failed to clear messages from localStorage:', error)
    }
}

// Function to generate greeting message based on session state
export const getGreetingMessageContent = (): string => {
    // Always show the welcome message for first-time visitors
    return `# Welcome to Nexora Bank! 👋
<br>
Hi! I'm your personal banking assistant. To help you with your questions about accounts, check balances, and track spending, please sign in securely with your bank.

<div style="text-align: center; margin: 24px 0;">
  <button class="whatsapp-signin-button" onclick="handleSignIn()">
    🏦 Sign in with Bank
  </button>
</div>

> Your data is secure & encrypted 🔐`
}

export const getErrorMessageFromCode = (code: string): string => {
    let errorDescription = "An authentication error occurred."
    switch (code) {
        case "invalid_state":
            errorDescription = "Authentication state validation failed. This usually happens when cookies are blocked or the login process took too long. Please try again."
            break
        case "no_code":
            errorDescription = "No authorization code received from the authentication server."
            break
        case "missing_auth_data":
            errorDescription = "Required authentication data is missing. Please try logging in again."
            break
        case "auth_failed":
            errorDescription = "Authentication failed. Please try again."
            break
        case "auth_init_failed":
            errorDescription = "Failed to initialize authentication. Please try again."
            break
        default:
            errorDescription = `Authentication error: ${code}`
    }
    return errorDescription;
}

export const postChatRequest = async (message: string, sessionId: string) => {

    return fetch("/api/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: message,
            sessionId: sessionId,
        }),
    })
        .then(response => {
            if (!response.ok) throw new Error(`Status ${response.status}`);
            return response.json();
        })
        .then(data => {
            const agentMessage: Message = {
                id: (Date.now() + 1).toString(),
                content: data.response || "I apologize, but I encountered an error processing your request.",
                sender: "agent",
                timestamp: new Date(),
            }
            return agentMessage;
        });
}
