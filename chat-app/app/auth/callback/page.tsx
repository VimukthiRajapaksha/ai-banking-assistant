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

import { useEffect } from "react"
import { Loader2 } from "lucide-react"

export default function AuthCallbackPage() {
  useEffect(() => {
    const handleCallback = () => {
      // Check if there's a URL fragment (hash)
      const hash = window.location.hash

      if (hash) {
        console.log('Found URL fragment:', hash)

        // Convert fragment (#) to query parameters (?)
        const fragmentWithoutHash = hash.substring(1) // Remove the #
        const newUrl = `${window.location.origin}/api/auth/callback?${fragmentWithoutHash}`

        console.log('Redirecting to:', newUrl)

        // Redirect to the API endpoint with converted parameters
        window.location.href = newUrl
        return
      }

      // If no fragment, check if we already have query parameters
      const searchParams = new URLSearchParams(window.location.search)
      const code = searchParams.get('code')
      const error = searchParams.get('error')

      if (code || error) {
        // Already have query parameters, redirect to API endpoint
        const newUrl = `${window.location.origin}/api/auth/callback${window.location.search}`
        console.log('Redirecting query params to API:', newUrl)
        window.location.href = newUrl
        return
      }

      // No authentication data found
      console.log('No authentication data found, redirecting to home')
      window.location.href = '/?error=no_auth_data'
    }

    // Small delay to ensure page is loaded
    const timer = setTimeout(handleCallback, 100)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="whatsapp-container">
      <div className="whatsapp-auth-container">
        <div className="whatsapp-auth-content">
          {/* Processing Icon */}
          <div className="whatsapp-auth-icon">
            <Loader2 className="whatsapp-auth-spinner" />
          </div>

          {/* Processing Message */}
          <div className="whatsapp-auth-message">
            <h3 className="whatsapp-auth-title">
              Processing Authentication
            </h3>
            <p className="whatsapp-auth-subtitle">
              Please wait while we process your authentication...
            </p>
            <div className="whatsapp-auth-dots">
              <div className="whatsapp-auth-dot"></div>
              <div className="whatsapp-auth-dot" style={{ animationDelay: "0.1s" }}></div>
              <div className="whatsapp-auth-dot" style={{ animationDelay: "0.2s" }}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
