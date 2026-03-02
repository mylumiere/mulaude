import { useState } from 'react'

interface ThinkingBlockProps {
  content: string
}

export default function ThinkingBlock({ content }: ThinkingBlockProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="thinking-block">
      <button className="thinking-block-header" onClick={() => setExpanded(!expanded)}>
        <span className="thinking-block-icon">💭</span>
        <span className="thinking-block-label">Thinking</span>
        <span className={`tool-block-chevron ${expanded ? 'expanded' : ''}`}>▶</span>
      </button>
      {expanded && (
        <div className="thinking-block-body">
          {content}
        </div>
      )}
    </div>
  )
}
