import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import 'highlight.js/styles/github.css'

interface MarkdownRendererProps {
  content: string
  className?: string
  onSignIn?: () => void
  onSignOut?: () => void
  isSignedIn?: boolean
}

export function MarkdownRenderer({ content, className = '', onSignIn, onSignOut, isSignedIn }: MarkdownRendererProps) {
  // Check if the entire content is wrapped in a single code block
  const codeBlockRegex = /^```(?:\w+)?\n?([\s\S]*?)\n?```$/
  const match = content.trim().match(codeBlockRegex)

  // If the entire content is a code block, extract and render the inner content as markdown
  const actualContent = match ? match[1] : content

  // Extract URLs from content - must have a proper domain structure
  const urlRegex = /https?:\/\/[^\s)]+|(?:\/[\w-./?%&=]+\.[\w]+)/g
  const urls = actualContent.match(urlRegex) || []
  const uniqueUrls = Array.from(new Set(urls))
  
  // Log URLs to console if found
  if (uniqueUrls.length > 0) {
    console.log('URLs found in content:', uniqueUrls)
  }

  const getFileNameFromUrl = (url: string): string => {
    try {
      const pathname = url.includes('http') 
        ? new URL(url).pathname 
        : url
      
      // Split path into segments and filter out empty ones
      const segments = pathname.split('/').filter(Boolean)
      
      if (segments.length === 0) return 'download'
      
      // Get the last segment (potential filename)
      const lastSegment = segments[segments.length - 1]
      const idSegment = segments[segments.length - 2]
      
      // If it has an extension, use it as-is
      if (lastSegment.includes('.')) {
        return lastSegment
      }
      
      // If no extension, try to create a meaningful filename
      // For API endpoints like '/receipt' or '/document', use that as filename
      if (lastSegment && lastSegment.length > 0) {
        return `${idSegment}-${lastSegment}.pdf` // Default to PDF for API endpoints
      }
      
      return 'download'
    } catch {
      return 'download'
    }
  }

  const getFileTypeIcon = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    console.log(`Determining icon for file extension: ${ext}`)
    switch (ext) {
      case 'pdf':
        return '📄'
      case 'doc':
      case 'docx':
        return '📝'
      case 'xls':
      case 'xlsx':
        return '📊'
      case 'zip':
      case 'rar':
        return '📦'
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return '🖼️'
      case 'mp4':
      case 'avi':
      case 'mov':
        return '🎬'
      case 'mp3':
      case 'wav':
        return '🎵'
      case 'txt':
      case 'csv':
      case 'json':
      case 'xml':
        return '📋'
      default:
        return '📎'
    }
  }

  const downloadFile = async (url: string, fileName: string) => {
    try {
      const fullUrl = url.startsWith('http') ? url : `http://${url}`
      const response = await fetch(fullUrl)
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      console.error('Download failed:', error)
      window.open(url.startsWith('http') ? url : `http://${url}`, '_blank')
    }
  }

  return (
    <div className={`whatsapp-markdown ${className}`}>
      {/* Render attachments if URLs are found */}
      {uniqueUrls.length > 0 && (
        <div className="mb-3 space-y-2 w-full">
          {uniqueUrls.map((url, index) => {
            const fileName = getFileNameFromUrl(url)
            const fileIcon = getFileTypeIcon(fileName)
            const ext = fileName.split('.').pop()?.toLowerCase()
            console.log(`File ${index + 1}: name="${fileName}", extension="${ext}"`)
            return (
              <div
                key={index}
                className="block cursor-pointer transition-opacity hover:opacity-80"
                onClick={() => downloadFile(url, fileName)}
              >
                <div
                  className="rounded-lg p-3 w-full"
                  style={{
                    backgroundColor: 'var(--whatsapp-bg-light)',
                    border: '1px solid var(--whatsapp-border)'
                  }}
                >
                  <div className="flex flex-row items-center gap-3">
                    <span className="text-3xl flex-shrink-0">{fileIcon}</span>
                    <p className="text-sm font-medium truncate flex-1" style={{ color: 'var(--whatsapp-text-primary)' }}>
                      {fileName}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          // Customize headers
          h1: ({ children, ...props }) => (
            <h1 className="text-xl font-bold mb-3 mt-4" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-lg font-bold mb-2 mt-3" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-md font-semibold mb-2 mt-3" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-sm font-semibold mb-1 mt-2" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </h4>
          ),
          h5: ({ children, ...props }) => (
            <h5 className="text-sm font-medium mb-1 mt-2" style={{ color: 'var(--whatsapp-text-secondary)' }} {...props}>
              {children}
            </h5>
          ),
          h6: ({ children, ...props }) => (
            <h6 className="text-xs font-medium mb-1 mt-2" style={{ color: 'var(--whatsapp-text-secondary)' }} {...props}>
              {children}
            </h6>
          ),
          
          // Customize paragraphs
          p: ({ children, ...props }) => (
            <p className="mb-2 leading-relaxed" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </p>
          ),
          
          // Customize lists
          ul: ({ children, ...props }) => (
            <ul className="list-disc list-inside mb-3 ml-2 space-y-1" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal list-inside mb-3 ml-2 space-y-1" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </li>
          ),
          
          // Customize tables
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full rounded-lg text-sm" style={{ border: '1px solid var(--whatsapp-border)' }} {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead style={{ backgroundColor: 'var(--whatsapp-bg-light)' }} {...props}>
              {children}
            </thead>
          ),
          tbody: ({ children, ...props }) => (
            <tbody style={{ backgroundColor: 'var(--whatsapp-bg-white)' }} {...props}>
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => (
            <tr {...props}>
              {children}
            </tr>
          ),
          th: ({ children, ...props }) => (
            <th className="px-3 py-2 text-left font-medium" style={{ 
              color: 'var(--whatsapp-text-primary)', 
              borderBottom: '1px solid var(--whatsapp-border)' 
            }} {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-3 py-2" style={{ 
              color: 'var(--whatsapp-text-secondary)', 
              borderBottom: '1px solid var(--whatsapp-border)' 
            }} {...props}>
              {children}
            </td>
          ),
          
          // Customize blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote className="pl-4 py-2 mb-3 italic" style={{ 
              borderLeft: '4px solid var(--whatsapp-primary)', 
              color: 'var(--whatsapp-text-secondary)' 
            }} {...props}>
              {children}
            </blockquote>
          ),
          
          // Customize inline code
          code: ({ className, children, inline, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '')
            return !inline ? (
              <code className={`${className} block p-3 rounded-md text-sm overflow-x-auto`} style={{
                backgroundColor: 'var(--whatsapp-code-bg)',
                color: 'var(--whatsapp-text-primary)'
              }} {...props}>
                {children}
              </code>
            ) : (
              <code className="px-1 py-0.5 rounded text-sm font-mono" style={{
                backgroundColor: 'var(--whatsapp-code-bg)',
                color: 'var(--whatsapp-text-primary)'
              }} {...props}>
                {children}
              </code>
            )
          },
          
          // Customize pre blocks (code blocks container)
          pre: ({ children, ...props }: any) => (
            <pre className="p-3 rounded-md overflow-x-auto mb-3 text-sm" style={{
              backgroundColor: 'var(--whatsapp-code-bg)',
              color: 'var(--whatsapp-text-primary)'
            }} {...props}>
              {children}
            </pre>
          ),
          
          // Customize links
          a: ({ children, href, ...props }) => (
            <a 
              href={href} 
              className="underline hover:no-underline" 
              style={{ color: 'var(--whatsapp-primary)' }}
              target="_blank" 
              rel="noopener noreferrer" 
              {...props}
            >
              {children}
            </a>
          ),
          
          // Customize horizontal rules
          hr: ({ ...props }) => (
            <hr className="my-4" style={{ borderColor: 'var(--whatsapp-border)' }} {...props} />
          ),
          
          // Customize emphasis
          em: ({ children, ...props }) => (
            <em className="italic" style={{ color: 'var(--whatsapp-text-secondary)' }} {...props}>
              {children}
            </em>
          ),
          
          // Customize strong text
          strong: ({ children, ...props }) => (
            <strong className="font-semibold" style={{ color: 'var(--whatsapp-text-primary)' }} {...props}>
              {children}
            </strong>
          ),
          
          // Customize line breaks
          br: ({ ...props }) => (
            <br className="leading-relaxed" {...props} />
          ),
          // Customize buttons to handle onClick properly
          button({ className, children, onClick, ...props }: any) {
            const isBankSignInButton = className?.includes('whatsapp-signin-button')
            
            return (
              <button 
                className={className} 
                onClick={(e) => {
                  e.preventDefault()
                  
                  // If it's the bank sign-in button, use appropriate callback based on sign-in state
                  if (isBankSignInButton) {
                    if (isSignedIn && onSignOut) {
                      onSignOut()
                    } else if (!isSignedIn && onSignIn) {
                      onSignIn()
                    }
                    return
                  }
                  
                  // Fallback to the onclick attribute handling
                  if (props.onclick) {
                    try {
                      // Check if the function exists on window object
                      const funcName = props.onclick.replace(/[()]/g, '')
                      if (typeof (window as any)[funcName] === 'function') {
                        (window as any)[funcName]()
                      } else {
                        // Fallback: try to execute as code
                        eval(props.onclick)
                      }
                    } catch (error) {
                      console.error('Error executing button click:', error)
                    }
                  }
                  
                  if (onClick) {
                    onClick(e)
                  }
                }}
                {...props}
              >
                {/* Override button text based on sign-in state for sign-in buttons */}
                {isBankSignInButton ? (
                  isSignedIn ? (
                    <>🚪 Sign Out</>
                  ) : (
                    <>🏦 Sign in with Bank</>
                  )
                ) : (
                  children
                )}
              </button>
            )
          },
          // Let CSS handle the rest of the styling
        }}
      >
        {actualContent}
      </ReactMarkdown>
    </div>
  )
}
