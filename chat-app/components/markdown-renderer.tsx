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
    <div className={`chat-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          // Customize headers
          h1: ({ children, ...props }) => (
            <h1 className="text-xl font-bold mb-3 mt-4 text-white" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-lg font-bold mb-2 mt-3 text-white" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-md font-semibold mb-2 mt-3 text-white" {...props}>
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 className="text-sm font-semibold mb-1 mt-2 text-white" {...props}>
              {children}
            </h4>
          ),
          h5: ({ children, ...props }) => (
            <h5 className="text-sm font-medium mb-1 mt-2 text-gray-200" {...props}>
              {children}
            </h5>
          ),
          h6: ({ children, ...props }) => (
            <h6 className="text-xs font-medium mb-1 mt-2 text-gray-200" {...props}>
              {children}
            </h6>
          ),
          
          // Customize paragraphs
          p: ({ children, ...props }) => (
            <p className="mb-2 text-white leading-relaxed" {...props}>
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
            <li className="text-white leading-relaxed" {...props}>
              {children}
            </li>
          ),
          
          // Customize tables
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full border border-gray-400 rounded-lg text-sm" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-gray-600" {...props}>
              {children}
            </thead>
          ),
          tbody: ({ children, ...props }) => (
            <tbody className="bg-gray-700 divide-y divide-gray-500" {...props}>
              {children}
            </tbody>
          ),
          tr: ({ children, ...props }) => (
            <tr {...props}>
              {children}
            </tr>
          ),
          th: ({ children, ...props }) => (
            <th className="px-3 py-2 text-left font-medium text-white border-b border-gray-400" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="px-3 py-2 text-gray-200 border-b border-gray-500" {...props}>
              {children}
            </td>
          ),
          
          // Customize blockquotes
          blockquote: ({ children, ...props }) => (
            <blockquote className="border-l-4 border-blue-300 pl-4 py-2 mb-3 italic text-gray-800" {...props}>
              {children}
            </blockquote>
          ),
          
          // Customize inline code
          code: ({ className, children, inline, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '')
            return !inline ? (
              <code className={`${className} block bg-gray-800 text-gray-200 p-3 rounded-md text-sm overflow-x-auto`} {...props}>
                {children}
              </code>
            ) : (
              <code className="bg-gray-700 text-gray-200 px-1 py-0.5 rounded text-sm font-mono" {...props}>
                {children}
              </code>
            )
          },
          
          // Customize pre blocks (code blocks container)
          pre: ({ children, ...props }: any) => (
            <pre className="bg-gray-800 text-gray-200 p-3 rounded-md overflow-x-auto mb-3 text-sm" {...props}>
              {children}
            </pre>
          ),
          
          // Customize links
          a: ({ children, href, ...props }) => (
            <a 
              href={href} 
              className="text-blue-300 hover:text-blue-200 underline" 
              target="_blank" 
              rel="noopener noreferrer" 
              {...props}
            >
              {children}
            </a>
          ),
          
          // Customize horizontal rules
          hr: ({ ...props }) => (
            <hr className="border-gray-400 my-4" {...props} />
          ),
          
          // Customize emphasis
          em: ({ children, ...props }) => (
            <em className="italic text-gray-200" {...props}>
              {children}
            </em>
          ),
          
          // Customize strong text
          strong: ({ children, ...props }) => (
            <strong className="font-semibold text-white" {...props}>
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
