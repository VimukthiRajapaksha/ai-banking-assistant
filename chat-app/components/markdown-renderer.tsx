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

  return (
    <div className={`whatsapp-markdown ${className}`}>
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
