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

"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Send, LogOut, Search, MoreVertical, Phone, Video } from "lucide-react"
import { useRouter } from "next/navigation"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import Cookies from 'js-cookie';
import { getErrorMessageFromCode, getGreetingMessageContent, Message, postChatRequest, saveMessagesToStorage, loadMessagesFromStorage, clearMessagesFromStorage } from "./utils"

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [hasWelcomeBackMessage, setHasWelcomeBackMessage] = useState(false)
  const [sessionId,] = useState(() => Cookies.get('session_id') || "")
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()


  // Add global function for bank sign-in
  const handleSignIn = () => {
    const redirectionMessage: Message = {
      id: "3",
      content: "I'm taking you to bank's secure login page now 🔐. You'll be back here in just a moment!",
      sender: "agent",
      timestamp: new Date(),
    };
    setMessages(prevMessages => {
      const updatedMessages = [...prevMessages, redirectionMessage]
      saveMessagesToStorage(updatedMessages)
      return updatedMessages
    })
    // Redirect to the OAuth initiation endpoint
    window.location.href = "/api/auth/login"
  }

  // Add function for bank sign-out
  const handleSignOut = () => {
    // Clear session data and messages
    Cookies.remove('session_id')
    clearMessagesFromStorage()
    router.push("/")
    window.location.href = "/"
  }

  useEffect(() => {
    // Check for error parameters in URL
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get("error")

    if (errorParam) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `I'm sorry, I'm having trouble connecting right now. ${getErrorMessageFromCode(errorParam)}`,
        sender: "agent",
        timestamp: new Date(),
      }
      setMessages(prevMessages => {
        const updatedMessages = [...prevMessages, errorMessage]
        saveMessagesToStorage(updatedMessages)
        return updatedMessages
      })
    }
  }, []);

  // Function to generate welcome back message for authenticated users
  const generateWelcomeBackMessage = (): void => {
    const inputMessage: string = "Generate a short WhatsApp‑style 'welcome back' message for me with three sections. " +
      "Fetch my accounts and recent transactions through your tools first. " +
      "1. Greet me by first name. 2. Give a quick snapshot section (balances + upcoming recurring payments), " +
      "3. Then based on the retrieved data suggest 3-4 personalized read-only follow-up questions section I could ask next. " +
      "Keep it friendly, concise, and only use real data you retrieved. Always end by asking if I need anything else.";

    getAgentReplyForMessage(inputMessage, sessionId);
  };

  // Initialize banking agent and then show greeting
  useEffect(() => {
    // First, try to load messages from localStorage
    const savedMessages = loadMessagesFromStorage()

    if (savedMessages.length > 0) {
      // If we have saved messages, use them
      setMessages(savedMessages)
      
      // If user is logged in and we don't have a welcome back message, add it
      if (sessionId && !hasWelcomeBackMessage) {
          generateWelcomeBackMessage();
          setHasWelcomeBackMessage(true);
      }
    } else {
      // If no saved messages, create the initial greeting (always show welcome message first)
      const hiMessage: Message = {
        id: "1",
        content: "Hi!",
        sender: "user",
        timestamp: new Date(),
      };

      const greetingMessage: Message = {
        id: "2",
        content: getGreetingMessageContent(),
        sender: "agent",
        timestamp: new Date(),
      };

      const initialMessages = [hiMessage, greetingMessage]
      setMessages(initialMessages)
      saveMessagesToStorage(initialMessages)

      // If user is already logged in on first visit, add welcome back message
      if (sessionId && !hasWelcomeBackMessage) {
        generateWelcomeBackMessage();
        setHasWelcomeBackMessage(true);
      }
    }
  }, [])

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    const scrollToBottom = () => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
      }
    }

    const timeoutId = setTimeout(scrollToBottom, 100)
    return () => clearTimeout(timeoutId)
  }, [messages])

  const sendMessage = (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      content,
      sender: "user",
      timestamp: new Date(),
    }

    setMessages(prevMessages => {
      const updatedMessages = [...prevMessages, userMessage]
      saveMessagesToStorage(updatedMessages)
      return updatedMessages
    })
    
    // Get agent reply
    getAgentReplyForMessage(content, sessionId)
  }

  const getAgentReplyForMessage = async (inputMessage: string, sessionId: string) => {
    setIsLoading(true);
    postChatRequest(inputMessage, sessionId)
      .then(agentMessage => {
        console.log("Agent message received:", agentMessage);
        setMessages(prevMessages => {
          const updatedMessages = [...prevMessages, agentMessage]
          saveMessagesToStorage(updatedMessages)
          return updatedMessages
        })
      })
      .catch(error => {
        console.error("Error sending message:", error)
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          content: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
          sender: "agent",
          timestamp: new Date(),
        };
        setMessages(prevMessages => {
          const updatedMessages = [...prevMessages, errorMessage]
          saveMessagesToStorage(updatedMessages)
          return updatedMessages
        })
      }).finally(() => {
        setIsLoading(false)
      });
  }

  const handleSendMessage = () => {
    if (inputMessage.trim() && !isLoading) {
      sendMessage(inputMessage.trim())
      setInputMessage("")
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="whatsapp-container">
      <div className="whatsapp-main">
        {/* Left Sidebar */}
        <div className="whatsapp-sidebar">
          {/* User Profile Header */}
          <div className="whatsapp-sidebar-header">
            <div className="whatsapp-user-profile">
              <div className="whatsapp-user-avatar">
                KW
              </div>
              <div className="whatsapp-user-name">
                Kevin William
              </div>
            </div>
            <div className="whatsapp-header-actions">
              <div className="whatsapp-icon-button" onClick={handleSignOut}>
                <LogOut size={20} />
              </div>
              <div className="whatsapp-icon-button">
                <MoreVertical size={20} />
              </div>
            </div>
          </div>

          {/* Search Box */}
          <div className="whatsapp-search-container">
            <div className="whatsapp-search-box">
              <Search className="whatsapp-search-icon" />
              <input
                className="whatsapp-search-input"
                placeholder="Search or start new chat"
                type="text"
              />
            </div>
          </div>

          {/* Chat List */}
          <div className="whatsapp-chat-list">
            <div className="whatsapp-chat-item active">
              <div className="whatsapp-chat-avatar">
                NB
              </div>
              <div className="whatsapp-chat-info">
                <div className="whatsapp-chat-header">
                  <div className="whatsapp-chat-name">Nexora Bank Assistant</div>
                  <div className="whatsapp-chat-time">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="whatsapp-chat-preview">
                  Welcome to Nexora Bank! Hi! I'm your personal...
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Chat Area */}
        <div className="whatsapp-chat-area">
          {/* Chat Header */}
          <div className="whatsapp-chat-header-main">
            <div className="whatsapp-contact-avatar">
              NB
              <div className="whatsapp-online-dot"></div>
            </div>
            <div className="whatsapp-contact-info">
              <div className="whatsapp-contact-name">Nexora Bank Assistant</div>
              <div className="whatsapp-contact-status">Online</div>
            </div>
            <div className="whatsapp-chat-actions">
              <div className="whatsapp-icon-button">
                <Video size={20} />
              </div>
              <div className="whatsapp-icon-button">
                <Phone size={20} />
              </div>
              <div className="whatsapp-icon-button">
                <MoreVertical size={20} />
              </div>
            </div>
          </div>

          {/* Messages Area */}
          <div className="whatsapp-messages-area" ref={scrollAreaRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`whatsapp-message ${message.sender === "user" ? "sent" : "received"}`}
              >
                <div className="whatsapp-message-bubble">
                  <div className="whatsapp-message-content">
                    {message.sender === "user" ? (
                      <span>{message.content}</span>
                    ) : (
                      <div className="whatsapp-markdown">
                        <MarkdownRenderer
                          content={message.content}
                          onSignIn={handleSignIn}
                          onSignOut={handleSignOut}
                          isSignedIn={!!sessionId}
                        />
                      </div>
                    )}
                  </div>
                  <div className="whatsapp-message-time">
                    {message.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="whatsapp-message received">
                <div className="whatsapp-message-bubble">
                  <div className="whatsapp-typing-indicator">
                    <span>Banking Assistant is typing</span>
                    <div className="whatsapp-typing-dots">
                      <div className="whatsapp-typing-dot"></div>
                      <div className="whatsapp-typing-dot"></div>
                      <div className="whatsapp-typing-dot"></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="whatsapp-input-area">
            <div className="whatsapp-input-container">
              <textarea
                className="whatsapp-input"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Type a banking question..."
                disabled={isLoading}
                rows={1}
              />
            </div>
            <button
              className="whatsapp-send-button"
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || isLoading}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
