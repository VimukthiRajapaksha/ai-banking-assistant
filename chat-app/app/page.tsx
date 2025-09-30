"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Send, LogOut, Search, MoreVertical, Phone, Video } from "lucide-react"
import { useRouter } from "next/navigation"
import { MarkdownRenderer } from "@/components/markdown-renderer"
import Cookies from 'js-cookie';

interface Message {
  id: string
  content: string
  sender: "user" | "agent"
  timestamp: Date
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId,] = useState(() => Cookies.get('session_id') || "")
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Function to save messages to localStorage
  const saveMessagesToStorage = (messages: Message[]) => {
    try {
      localStorage.setItem('chat-messages', JSON.stringify(messages))
    } catch (error) {
      console.error('Failed to save messages to localStorage:', error)
    }
  }

  // Function to load messages from localStorage
  const loadMessagesFromStorage = (): Message[] => {
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
  const clearMessagesFromStorage = () => {
    try {
      localStorage.removeItem('chat-messages')
    } catch (error) {
      console.error('Failed to clear messages from localStorage:', error)
    }
  }

  // Add global function for bank sign-in
  const handleSignIn = () => {
    const redirectionMessage: Message = {
      id: "3",
      content: "🔐 I'm taking you to bank's secure login page now. You'll be back here in just a moment!",
      sender: "agent",
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, redirectionMessage]
    setMessages(updatedMessages)
    saveMessagesToStorage(updatedMessages)
    // Redirect to the OAuth initiation endpoint
    window.location.href = "/api/auth/login"
  }

  // Add function for bank sign-out
  const handleSignOut = () => {
    // Clear session data and messages
    Cookies.remove('session_id')
    // clearMessagesFromStorage()
    router.push("/")
    window.location.href = "/"
  }

  // useEffect(() => {
  //   // Also add to window for backward compatibility
  //   (window as any).handleSignIn = handleSignIn

  //   // Cleanup function
  //   return () => {
  //     delete (window as any).handleSignIn
  //   }
  // }, [router])

  useEffect(() => {
    // Check for error parameters in URL
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get("error")

    if (errorParam) {
      let errorDescription = "An authentication error occurred."

      switch (errorParam) {
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
          errorDescription = `Authentication error: ${errorParam}`
      }

      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `I'm sorry, I'm having trouble connecting right now. ${errorDescription}`,
        sender: "agent",
        timestamp: new Date(),
      }
      const updatedMessages = [...messages, errorMessage]
      setMessages(updatedMessages)
      saveMessagesToStorage(updatedMessages)
    }
  }, [])


  // Function to generate greeting message based on session state
  const generateGreetingMessage = (isSignedIn: boolean): string => {

    const buttonSection = isSignedIn ?
      `<div style="text-align: center; margin: 24px 0;">
      <button class="whatsapp-signin-button" onclick="handleBankSignIn()">
        🚪 Sign Out
      </button>
    </div>` :
      `<div style="text-align: center; margin: 24px 0;">
      <button class="whatsapp-signin-button" onclick="handleBankSignIn()">
        🏦 Sign in with Bank
      </button>
    </div>`;

    return `# Welcome to Family Bank! 👋
<br>
Hi! I'm your Banking Assistant. I can help you with account balances, spending insights, and transaction details.
<br><br>

**Try asking:**
- "What's my current balance?" 💰
- "How much did I spend on eating out last month?" 🍽️
- "I have a recurring payment of $15.99. What is it?" 🔄
- "Show me my largest expenses this week" 📊
<br>

${buttonSection}

> Note: Your banking information is protected with industry-standard security measures.`
  }

  // Initialize banking agent and then show greeting
  useEffect(() => {
    // First, try to load messages from localStorage
    const savedMessages = loadMessagesFromStorage()

    if (savedMessages.length > 0) {
      // If we have saved messages, use them
      setMessages(savedMessages)
    } else {
      // If no saved messages, create the initial greeting
      const hiMessage: Message = {
        id: "1",
        content: "Hi!",
        sender: "user",
        timestamp: new Date(),
      };

      const greetingMessage: Message = {
        id: "2",
        content: generateGreetingMessage(!!sessionId),
        sender: "agent",
        timestamp: new Date(),
      };

      const initialMessages = [hiMessage, greetingMessage]
      setMessages(initialMessages)
      saveMessagesToStorage(initialMessages)
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

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage,
      sender: "user",
      timestamp: new Date(),
    }

    const updatedMessagesWithUser = [...messages, userMessage]
    setMessages(updatedMessagesWithUser)
    saveMessagesToStorage(updatedMessagesWithUser)
    setInputMessage("")
    setIsLoading(true)

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: inputMessage,
          sessionId: sessionId,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to send message")
      }

      const data = await response.json()

      const agentMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.response || "I apologize, but I encountered an error processing your request.",
        sender: "agent",
        timestamp: new Date(),
      }

      const finalMessages = [...updatedMessagesWithUser, agentMessage]
      setMessages(finalMessages)
      saveMessagesToStorage(finalMessages)
    } catch (error) {
      console.error("Error sending message:", error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
        sender: "agent",
        timestamp: new Date(),
      }
      const finalMessages = [...updatedMessagesWithUser, errorMessage]
      setMessages(finalMessages)
      saveMessagesToStorage(finalMessages)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
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
                JA
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
                FB
              </div>
              <div className="whatsapp-chat-info">
                <div className="whatsapp-chat-header">
                  <div className="whatsapp-chat-name">Family Bank Assistant</div>
                  <div className="whatsapp-chat-time">
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className="whatsapp-chat-preview">
                  Welcome to Family Bank! How can I help...
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
              FB
              <div className="whatsapp-online-dot"></div>
            </div>
            <div className="whatsapp-contact-info">
              <div className="whatsapp-contact-name">Family Bank Assistant</div>
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
              onClick={sendMessage}
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
