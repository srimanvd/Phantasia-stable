import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './Chatbot.css';
import Screenshot from "./Screenshot.tsx"

const API_BASE_URL = 'http://localhost:8000';
const DESMOS_API_URL = 'http://localhost:8001';

// Store scroll positions globally to preserve during streaming updates
const tableScrollPositions = new Map();

// Debounce helper function
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Convert LaTeX notation \(equation\) and \[equation\] to $equation$ and $$equation$$
const processLatexNotation = (content) => {
  if (!content) return '';

  // Handle potential escaping in code blocks
  const codeBlocks = [];
  const placeholder = '___CODE_BLOCK___';

  // Temporarily replace code blocks to avoid processing LaTeX inside them
  let processedContent = content.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return placeholder;
  });

  // Also preserve inline code
  const inlineCodeBlocks = [];
  const inlineCodePlaceholder = '___INLINE_CODE___';
  processedContent = processedContent.replace(/`[^`]+`/g, (match) => {
    inlineCodeBlocks.push(match);
    return inlineCodePlaceholder;
  });

  // Handle escaped backslashes (markdown sometimes escapes them as \\)
  // This converts \\ followed by [ or ( to \[ or \(
  processedContent = processedContent.replace(/\\\\(\[|\()/g, '\\$1');

  // Replace \[...\] with $$...$$
  processedContent = processedContent.replace(/\\\[([\s\S]*?)\\\]/g, (_, p1) => {
    return `$$${p1}$$`;
  });

  // Replace \(...\) with $...$
  processedContent = processedContent.replace(/\\\(([\s\S]*?)\\\)/g, (_, p1) => {
    return `$${p1}$`;
  });

  // Restore code blocks
  let codeBlockIndex = 0;
  processedContent = processedContent.replace(new RegExp(placeholder, 'g'), () => {
    return codeBlocks[codeBlockIndex++] || '';
  });

  // Restore inline code blocks
  let inlineCodeBlockIndex = 0;
  processedContent = processedContent.replace(new RegExp(inlineCodePlaceholder, 'g'), () => {
    return inlineCodeBlocks[inlineCodeBlockIndex++] || '';
  });

  return processedContent;
};

// Utility to wrap a <table> with proper container markup
function wrapTable(html) {
  let processed = html.replace(/<table/gi, '<table class="table-component"');

  // If there's no outer container, add it
  if (!processed.includes('table-outer-container')) {
    processed = `<table-container>${processed}</table-container>`;
  }

  return processed;
}

// Process partial or incomplete table content
function processStreamedTables(content) {
  if (!content) return '';

  // Regex to detect direct tables
  const directTablePattern = /(<table[\s\S]*?<\/table>)/gi;
  // Replace direct tables with a custom container
  let processedContent = content.replace(directTablePattern, (match) => {
    return wrapTable(match);
  });

  // Now handle incomplete tables (missing </table>)
  const tableStartIndex = processedContent.toLowerCase().lastIndexOf('<table');
  if (
    tableStartIndex !== -1 &&
    processedContent.toLowerCase().indexOf('</table>', tableStartIndex) === -1
  ) {
    // We have a partial table
    const beforeTable = processedContent.substring(0, tableStartIndex);
    let incompleteTable = processedContent.substring(tableStartIndex);

    // Add "table-component" if missing
    if (
      !incompleteTable.includes('class="table-component"') &&
      !incompleteTable.includes("class='table-component'")
    ) {
      incompleteTable = incompleteTable.replace(
        /<table/i,
        '<table class="table-component"'
      );
    }

    // Add a "loading row" if we see a <tbody> but no closing
    if (
      incompleteTable.toLowerCase().includes('<tbody') &&
      !incompleteTable.toLowerCase().includes('class="loading-row"')
    ) {
      const lastTrIndex = incompleteTable.toLowerCase().lastIndexOf('<tr');
      if (lastTrIndex !== -1) {
        // Count columns from first row
        const firstRowMatch = /<tr[\s\S]*?<\/tr>/i.exec(incompleteTable);
        let colCount = 1;
        if (firstRowMatch) {
          const tdMatches = firstRowMatch[0].match(/<t[dh]/gi);
          colCount = tdMatches ? tdMatches.length : 1;
        }
        const loadingRow = `
          <tr class="loading-row">
            <td colspan="${colCount}" class="loading-cell">
              <div class="table-loading-indicator">Loading table data</div>
            </td>
          </tr>
        `;
        if (incompleteTable.toLowerCase().includes('</tbody>')) {
          incompleteTable = incompleteTable.replace(
            '</tbody>',
            loadingRow + '</tbody>'
          );
        } else {
          incompleteTable += loadingRow;
        }
      }
    }

    // Wrap the partial table
    incompleteTable = `<table-container>${incompleteTable}</table-container>`;
    processedContent = beforeTable + incompleteTable;
  }

  // Add a unique id attribute to each table container for scroll position tracking
  let tableContainerCount = 0;
  processedContent = processedContent.replace(
    /<table-container>/g,
    () => `<table-container data-table-id="${tableContainerCount++}">`
  );

  // Replace <table-container> with the final HTML wrapper
  processedContent = processedContent.replace(
    /<table-container data-table-id="(\d+)">/g,
    '<div class="table-outer-container" data-table-id="$1"><div class="table-scroll-container">'
  );
  processedContent = processedContent.replace(
    /<\/table-container>/g,
    '</div><div class="table-scroll-indicator"></div></div>'
  );

  return processedContent;
}

// Function to split content into distinct blocks (markdown vs. tables)
function splitMixedContent(content) {
  if (!content) return [];

  // If we see our final container structure
  if (content.includes('<div class="table-outer-container"')) {
    // Regex to capture entire table container blocks
    const containerRegex = /(<div class="table-outer-container"[\s\S]*?<\/div><\/div>)/gi;
    const parts = content.split(containerRegex);
    return parts
      .map((part, i) => {
        if (part.trim().startsWith('<div class="table-outer-container"')) {
          // Check if it contains a loading row - if so, flag it as incomplete
          const isComplete = !part.includes('loading-row') &&
            !part.includes('table-loading-indicator') &&
            part.includes('</table>');

          return {
            type: 'html-table-container',
            content: part,
            id: `html-table-${i}`,
            isComplete
          };
        } else if (part.trim()) {
          return {
            type: 'markdown',
            content: part,
            id: `markdown-${i}`,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  // Otherwise handle <table> tags directly
  const tableRegex = /(<table[\s\S]*?<\/table>)/gi;
  const parts = content.split(tableRegex);
  return parts
    .map((part, i) => {
      const lower = part.trim().toLowerCase();
      if (lower.startsWith('<table') && lower.endsWith('</table>')) {
        // If it's a complete table (has closing tag and no loading indicators)
        const isComplete = !part.includes('loading-row') &&
          !part.includes('table-loading-indicator');

        return {
          type: 'html-table',
          content: part,
          id: `html-table-${i}`,
          isComplete
        };
      } else if (part.trim()) {
        return {
          type: 'markdown',
          content: part,
          id: `markdown-${i}`,
        };
      }
      return null;
    })
    .filter(Boolean);
}

// React component for HTML tables
const HtmlTableComponent = ({ html }) => {
  const tableContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [hasScroll, setHasScroll] = useState(false);
  const scrollPositionRef = useRef(0);
  const tableId = useRef(null);

  // Check if the table contains complete data (no loading indicators)
  const isCompleteTable = useMemo(() => {
    // If contains loading indicators, it's not complete
    const hasLoadingIndicators = html.includes('loading-row') ||
      html.includes('table-loading-indicator');

    // If it has a closing table tag and no loading indicators, it's complete
    return html.includes('</table>') && !hasLoadingIndicators;
  }, [html]);

  useEffect(() => {
    if (tableContainerRef.current) {
      const match = html.match(/data-table-id="(\d+)"/);
      if (match) {
        tableId.current = match[1];
      }
    }
  }, [html]);

  useEffect(() => {
    if (tableRef.current && tableContainerRef.current) {
      // Check if table is wider than container
      const needsScroll =
        tableRef.current.offsetWidth > tableContainerRef.current.offsetWidth;
      setHasScroll(needsScroll);

      // Immediately restore scroll position if available
      if (tableId.current && tableScrollPositions.has(tableId.current)) {
        tableContainerRef.current.style.scrollBehavior = 'auto';
        tableContainerRef.current.scrollLeft = tableScrollPositions.get(tableId.current);
        scrollPositionRef.current = tableScrollPositions.get(tableId.current);

        setTimeout(() => {
          if (tableContainerRef.current) {
            tableContainerRef.current.style.scrollBehavior = '';
          }
        }, 100);
      }
    }
  }, [isCompleteTable]);

  // Save scroll position when scrolling
  const handleScroll = useCallback(() => {
    if (tableContainerRef.current && tableId.current) {
      // Only update if position has changed significantly
      const currentPos = tableContainerRef.current.scrollLeft;
      if (Math.abs(currentPos - scrollPositionRef.current) > 5) {
        scrollPositionRef.current = currentPos;
        tableScrollPositions.set(tableId.current, currentPos);

        // Add a class to indicate this table is actively being scrolled by user
        tableContainerRef.current.classList.add('user-scrolling');

        // Remove the class after scrolling stops
        clearTimeout(tableContainerRef.current.scrollTimer);
        tableContainerRef.current.scrollTimer = setTimeout(() => {
          tableContainerRef.current?.classList.remove('user-scrolling');
        }, 150);
      }
    }
  }, []);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Process HTML to maintain table IDs while fixing internal structure
  const processedHtml = html.replace(
    /data-table-id="(\d+)"/,
    (match) => match
  );

  return (
    <div className="table-outer-container" data-table-id={tableId.current} ref={tableRef}>
      <div
        className="table-scroll-container"
        ref={tableContainerRef}
        style={{ willChange: 'transform' }}
      >
        <div
          dangerouslySetInnerHTML={{ __html: processedHtml.replace(/data-table-id="\d+"/, '') }}
        />
      </div>
      {hasScroll && <div className="table-scroll-indicator"></div>}
    </div>
  );
};

// Custom components for ReactMarkdown
const customMarkdownComponents = {
  table: ({ node, ...props }) => <table className="table-component" {...props} />,
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
  code: ({ node, inline, className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    return !inline ? (
      <pre className={className}>
        <code className={match ? `language-${match[1]}` : ''} {...props}>
          {children}
        </code>
      </pre>
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // Enhanced math components for KaTeX
  math: ({ value }) => {
    try {
      return <div className="katex-block">{value}</div>;
    } catch (error) {
      console.error("Failed to render display math:", error);
      return <div className="katex-error">Failed to render math: {value}</div>;
    }
  },
  inlineMath: ({ value }) => {
    try {
      return <span className="katex-inline">{value}</span>;
    } catch (error) {
      console.error("Failed to render inline math:", error);
      return <span className="katex-error">Failed to render math: {value}</span>;
    }
  }
};

// Renderer for mixed content (markdown and HTML tables)
const MixedContentRenderer = ({ content }) => {
  // Save all table scroll positions before re-rendering
  useEffect(() => {
    // Find all table containers in the DOM and save their scroll positions
    const tableContainers = document.querySelectorAll('.table-scroll-container');
    tableContainers.forEach(container => {
      const tableId = container.parentElement.getAttribute('data-table-id');
      if (tableId && container.scrollLeft > 0) {
        tableScrollPositions.set(tableId, container.scrollLeft);
      }
    });
  }, [content]); // Run before content changes

  // Process the content parts
  const processedContent = processLatexNotation(content);
  const parts = splitMixedContent(processedContent);

  return (
    <>
      {parts.map((part) => {
        if (part.type === 'html-table') {
          // Wrap in final container
          const finalTable = processStreamedTables(part.content);
          return <HtmlTableComponent key={part.id} html={finalTable} />;
        } else if (part.type === 'html-table-container') {
          // For existing table containers, let the React component handle it
          // We need to extract the HTML from the container and pass it to our component
          let tableContent = part.content;

          // If the content has outer wrapper, extract just the table HTML
          if (tableContent.includes('table-outer-container')) {
            const match = tableContent.match(/<div class="table-scroll-container"[^>]*>([\s\S]*?)<\/div><div class="table-scroll-indicator"><\/div>/);
            if (match && match[1]) {
              tableContent = match[1];
            }
          }

          return <HtmlTableComponent key={part.id} html={tableContent} />;
        } else {
          // Plain markdown
          return (
            <ReactMarkdown
              key={part.id}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={customMarkdownComponents}
            >
              {part.content}
            </ReactMarkdown>
          );
        }
      })}
    </>
  );
};

// Function to extract graph data from message content
const extractGraphs = (content) => {
  try {
    const graphPattern = /```graph\n([\s\S]*?)\n```/g;
    const matches = [...content.matchAll(graphPattern)];

    if (!matches || matches.length === 0) return null;

    // Collect all graphs from all matched blocks
    const allGraphs = [];
    for (const match of matches) {
      const graphsJson = match[1];
      try {
        const graphs = JSON.parse(graphsJson);
        if (Array.isArray(graphs)) {
          // If it's an array, add all entries
          allGraphs.push(...graphs);
        } else {
          // If it's a single object, add it as one entry
          allGraphs.push(graphs);
        }
      } catch (jsonError) {
        console.error("Error parsing graph JSON block:", jsonError);
        // Continue with other blocks even if one fails
      }
    }

    return allGraphs.length > 0 ? allGraphs : null;
  } catch (error) {
    console.error("Error extracting graphs:", error);
    return null;
  }
};

// Function to send graphs to the Desmos API
const sendGraphsToDesmos = async (content) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/extract-graphs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error("Error sending graphs to API:", error);
    return false;
  }
};

// Function to open the Desmos viewer in a new tab/window
const openDesmosViewer = () => {
  window.open(`${DESMOS_API_URL}/viewer`, '_blank');
};

// Safe markdown component with special case handling
const SafeMarkdown = ({ content, messageId, wasInterrupted, isComplete, hasGraphs }) => {
  const [messageElement, setMessageElement] = useState(null);

  useEffect(() => {
    // Get reference to the current message element for copy/download functionality
    setTimeout(() => {
      const element = document.querySelector(`.message[data-message-id="${messageId}"] .message-content`);
      if (element) {
        setMessageElement(element);
      }
    }, 100);
  }, [messageId, content, isComplete]);

  if (!content) return null;

  // Special gradient effect for "Thinking..."
  if (content === "Thinking..." ||
    (content.includes("Thinking") || content.includes("Searching") &&
      !content.includes("```") &&
      !content.includes("<table"))) {
    return <div className="searching-message">{content}</div>;
  }

  try {
    // Process LaTeX notations first
    let processedContent = processLatexNotation(content);

    // Process the content to ensure tables are properly embedded in place
    processedContent = processStreamedTables(processedContent);

    // See if it has HTML tables
    const hasHtmlTable =
      processedContent.toLowerCase().includes('<table') &&
      (processedContent.toLowerCase().includes('</table>') ||
        processedContent.toLowerCase().includes('<th') ||
        processedContent.toLowerCase().includes('<td'));

    return (
      <div className="markdown-content">
        {hasHtmlTable ? (
          <MixedContentRenderer content={processedContent} />
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={customMarkdownComponents}
          >
            {processedContent}
          </ReactMarkdown>
        )}

        {/* Only show action buttons when response is complete */}
        {isComplete && (
          <div className="response-actions">
            {wasInterrupted && (
              <div className="interrupted-indicator">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="interrupted-icon">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>Response was interrupted</span>
              </div>
            )}

            <button
              className="action-icon"
              onClick={() => {
                if (messageElement) {
                  const tempElement = messageElement.cloneNode(true);
                  const actionButtons = tempElement.querySelector('.response-actions');
                  if (actionButtons) actionButtons.remove();
                  navigator.clipboard.writeText(tempElement.textContent);
                } else {
                  navigator.clipboard.writeText(content);
                }
              }}
              aria-label="Copy response"
              title="Copy response"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>

            {hasGraphs && (
              <button
                className="action-icon graph-button"
                onClick={openDesmosViewer}
                aria-label="View graph in Desmos"
                title="View graph in Desmos"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </button>
            )}

            <div style={{ flex: 1 }}></div>

            <button
              className="action-icon"
              onClick={() => console.log('Liked response')}
              aria-label="Thumbs up"
              title="This was helpful"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
              </svg>
            </button>

            <button
              className="action-icon dislike"
              onClick={() => console.log('Disliked response')}
              aria-label="Thumbs down"
              title="This was not helpful"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
              </svg>
            </button>
          </div>
        )}
      </div>
    );
  } catch (e) {
    console.error("Markdown render error:", e);
    return (
      <>
        <div className="plain-text">{content}</div>
        {isComplete && (
          <div className="response-actions">
            {/* Same action buttons as above */}
          </div>
        )}
      </>
    );
  }
};

const Chatbot = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [messageStates, setMessageStates] = useState({});
  const [messagesWithGraphs, setMessagesWithGraphs] = useState(new Set());
  const [isWelcomePage, setIsWelcomePage] = useState(true);

  // Refs
  const chatWrapperRef = useRef(null);
  const inputRef = useRef(null);
  const textareaWrapperRef = useRef(null);
  const abortControllerRef = useRef(null);
  const streamControllerRef = useRef({ active: false, currentMessageId: null });
  const resizeObserverRef = useRef(null);

  // For testing LaTeX processing (remove in production)
  const testLatexProcessing = () => {
    const tests = [
      // Test inline math
      "This is a test with \\(x^2 + y^2 = z^2\\) inline math.",
      // Test display math
      "This is a test with display math: \\[E = mc^2\\]",
      // Test with mixed formats
      "Mixed formats: \\(a^2\\) and \\[\\sum_{i=0}^{n} i^2\\] in the same message.",
      // Test with code blocks containing similar syntax
      "Here's inline math \\(x = 5\\) and a code block: ```python\nprint('\\[not math\\]')\n```",
      // Test with inline code
      "Inline code `\\(not math\\)` with \\(real math\\) nearby.",
      // Test with escaped backslashes (as might come from markdown processors)
      "With escaped backslashes: \\\\(x^2\\\\) and \\\\[E = mc^2\\\\]",
      // Test with real LaTeX from models
      "The formula for the area of a circle is \\(A = \\pi r^2\\) where \\(r\\) is the radius.",
      // Complex equation
      "The Schrödinger equation: \\[i\\hbar\\frac{\\partial}{\\partial t}\\Psi(\\mathbf{r},t) = \\hat H\\Psi(\\mathbf{r},t)\\]"
    ];

    const results = tests.map(test => ({
      original: test,
      processed: processLatexNotation(test)
    }));

    console.log("LaTeX Processing Tests:", results);
    return results;
  };

  // Uncomment to run tests on component mount
  useEffect(() => {
    testLatexProcessing();
  }, []);

  // Mark a message as complete
  const markMessageComplete = (messageId, wasInterrupted = false) => {
    setMessageStates(prev => ({
      ...prev,
      [messageId]: { isComplete: true, wasInterrupted }
    }));
  };

  // Add message ID attribute for easier DOM references
  const addMessageIdAttribute = () => {
    setTimeout(() => {
      document.querySelectorAll('.message').forEach(messageEl => {
        const message = messages.find(msg => msg.id.toString() === messageEl.getAttribute('data-message-id'));
        if (!message && messageEl.classList.contains('bot')) {
          const messageId = messages.find(msg => msg.sender === 'bot')?.id;
          if (messageId) {
            messageEl.setAttribute('data-message-id', messageId.toString());
          }
        }
      });
    }, 0);
  };

  // Dynamic textarea resizing
  const resizeTextarea = useCallback(() => {
    if (!inputRef.current || !textareaWrapperRef.current) return;

    const selectionStart = inputRef.current.selectionStart;
    const selectionEnd = inputRef.current.selectionEnd;

    inputRef.current.style.height = '22px'; // reset
    const newHeight = Math.min(inputRef.current.scrollHeight, 80);
    inputRef.current.style.height = `${newHeight}px`;
    inputRef.current.style.overflowY = newHeight >= 80 ? 'auto' : 'hidden';

    if (newHeight > 26) {
      textareaWrapperRef.current.style.height = `${Math.max(
        52,
        52 + (newHeight - 22)
      )}px`;
    } else {
      textareaWrapperRef.current.style.height = '52px';
    }

    // Restore cursor
    inputRef.current.setSelectionRange(selectionStart, selectionEnd);
  }, []);

  const debouncedResize = useCallback(debounce(resizeTextarea, 10), [resizeTextarea]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    debouncedResize();
  };

  // Handle streaming response data
  const readStreamData = async (reader, decoder, botMessageId) => {
    let accumulated = '';
    let receivedFirstChunk = false;

    // Indicate streaming is active
    streamControllerRef.current.active = true;
    streamControllerRef.current.currentMessageId = botMessageId;

    // We store the last time we updated the UI
    let lastUpdateTime = Date.now();

    // Store a map of table containers and their scroll positions
    const activeScrollContainers = new Map();

    // This function flushes the accumulated text into the message state
    const flushContent = () => {
      // First, find and store all current table containers and their scroll positions
      document.querySelectorAll('.table-scroll-container').forEach(container => {
        const tableId = container.parentElement.getAttribute('data-table-id');
        if (tableId && container.scrollLeft > 0) {
          // Store both the scroll position and a reference to the actual DOM element
          activeScrollContainers.set(tableId, {
            element: container,
            scrollLeft: container.scrollLeft
          });
          tableScrollPositions.set(tableId, container.scrollLeft);
        }
      });

      const preserveTableStructures = () => {
        const botMessageElement = document.querySelector(`.message.bot[data-message-id="${botMessageId}"]`);
        if (!botMessageElement) return null;

        // Store any relevant state we need to preserve
        return {
          scrollTop: chatWrapperRef.current ? chatWrapperRef.current.scrollTop : 0,
          scrollHeight: chatWrapperRef.current ? chatWrapperRef.current.scrollHeight : 0
        };
      };

      const preservedState = preserveTableStructures();

      // Update the React state with processed content
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === botMessageId) {
            return { ...msg, content: accumulated };
          }
          return msg;
        })
      );

      // Use requestAnimationFrame to preserve scroll positions after update
      requestAnimationFrame(() => {
        // Restore all table scroll positions
        activeScrollContainers.forEach((info, tableId) => {
          const containers = document.querySelectorAll('.table-scroll-container');
          containers.forEach(container => {
            const id = container.parentElement.getAttribute('data-table-id');
            if (id === tableId) {
              container.classList.add('updating');
              container.scrollLeft = info.scrollLeft;
            }
          });
        });

        // Restore chat scroll position
        if (chatWrapperRef.current && preservedState) {
          const newScrollHeight = chatWrapperRef.current.scrollHeight;
          const oldScrollHeight = preservedState.scrollHeight;
          chatWrapperRef.current.scrollTop = preservedState.scrollTop + (newScrollHeight - oldScrollHeight);
        }

        // Remove updating class
        setTimeout(() => {
          document.querySelectorAll('.table-scroll-container.updating').forEach(el => {
            el.classList.remove('updating');
          });
        }, 50);
      });

      lastUpdateTime = Date.now();
    };

    try {
      while (streamControllerRef.current.active) {
        const { done, value } = await reader.read();
        if (done) {
          // Check for graphs in the accumulated content before completing
          const hasGraphs = extractGraphs(accumulated) !== null;

          if (hasGraphs) {
            const success = await sendGraphsToDesmos(accumulated);
            if (success) {
              setMessagesWithGraphs(prev => new Set([...prev, botMessageId]));
            }
          }

          // Normal completion
          markMessageComplete(botMessageId, false);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        if (chunk && chunk.length > 0) {
          receivedFirstChunk = true;

          // Direct handling of raw content from API
          accumulated += chunk;

          // Throttle how often we flush
          const now = Date.now();
          if (now - lastUpdateTime > 200) { // Update every 200ms
            flushContent();
          }
        }
      }

      // If we left the loop, flush any remaining content
      flushContent();

      // If we're here because streaming was stopped manually, mark as interrupted
      if (!streamControllerRef.current.active && streamControllerRef.current.currentMessageId === botMessageId) {
        markMessageComplete(botMessageId, true);
      }

      return {
        success: true,
        text: accumulated,
        receivedAnyChunks: receivedFirstChunk,
        interrupted: !streamControllerRef.current.active && streamControllerRef.current.currentMessageId === botMessageId
      };
    } catch (error) {
      console.error("Error reading stream:", error);
      // Don't treat aborted requests as errors when manually stopped
      const wasManuallyAborted = error.name === 'AbortError' && !streamControllerRef.current.active;

      if (!wasManuallyAborted) {
        markMessageComplete(botMessageId, true);
        return { success: false, error, text: accumulated };
      } else {
        // For manual interruptions, still mark as complete but with interrupted flag
        markMessageComplete(botMessageId, true);
        return {
          success: true,
          text: accumulated,
          receivedAnyChunks: receivedFirstChunk,
          interrupted: true
        };
      }
    } finally {
      streamControllerRef.current.active = false;
      streamControllerRef.current.currentMessageId = null;
      setIsStreaming(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;

    // Switch from welcome page to chat mode
    if (isWelcomePage) {
      setIsWelcomePage(false);
    }

    setStreamError(null);

    // Add user message
    const userMessage = { id: Date.now(), sender: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    markMessageComplete(userMessage.id, false);

    // Clear input
    setInput('');
    if (inputRef.current) {
      inputRef.current.style.height = '22px';
      inputRef.current.style.overflowY = 'hidden';
    }
    if (textareaWrapperRef.current) {
      textareaWrapperRef.current.style.height = '52px';
    }

    // Scroll to bottom
    setTimeout(() => {
      if (chatWrapperRef.current) {
        chatWrapperRef.current.scrollTop = chatWrapperRef.current.scrollHeight;
      }
    }, 100);

    try {
      setIsStreaming(true);

      // Create bot message
      const botMessageId = Date.now() + 1;
      setMessages((prev) => [
        ...prev,
        { id: botMessageId, sender: 'bot', content: 'Thinking...' }
      ]);

      // Bot message starts as incomplete
      setMessageStates(prev => ({
        ...prev,
        [botMessageId]: { isComplete: false, wasInterrupted: false }
      }));

      // Add message IDs to DOM elements
      addMessageIdAttribute();

      // Create an AbortController for cancellation
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // Send request to API
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage.content }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      const streamResult = await readStreamData(reader, decoder, botMessageId);

      if (!streamResult.success) {
        console.error("Stream reading failed:", streamResult.error);

        // Only set streamError if it's not an AbortError (manual interruption)
        if (!(streamResult.error && streamResult.error.name === 'AbortError')) {
          setStreamError(streamResult.error);

          if (streamResult.text) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMessageId ? { ...msg, content: streamResult.text } : msg
              )
            );
          } else {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMessageId
                  ? { ...msg, content: "Error processing response" }
                  : msg
              )
            );
          }

          // Mark as complete with error
          markMessageComplete(botMessageId, true);
        }
      } else if (!streamResult.receivedAnyChunks) {
        // No chunks at all
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? { ...msg, content: "No response received from server" }
              : msg
          )
        );

        // Mark as complete with error
        markMessageComplete(botMessageId, true);
      } else if (streamResult.interrupted) {
        // Mark as interrupted but complete - no error message needed
        markMessageComplete(botMessageId, true);
      } else {
        // Normal completion
        markMessageComplete(botMessageId, false);
      }
    } catch (err) {
      console.error('Error:', err);

      // Only show error to user if it's not an AbortError (manual interruption)
      if (err.name !== 'AbortError') {
        setStreamError(err);

        const errorMessageId = Date.now() + 2;
        setMessages((prev) => [
          ...prev,
          {
            id: errorMessageId,
            sender: 'bot',
            content: `Error: ${err.message}`,
          },
        ]);

        // Mark error message as complete
        markMessageComplete(errorMessageId, false);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  // Handle stopping the stream
  const handleStopStream = async () => {
    // Mark the current message as interrupted
    if (streamControllerRef.current.currentMessageId) {
      markMessageComplete(streamControllerRef.current.currentMessageId, true);
    }

    streamControllerRef.current.active = false;
    setIsStreaming(false);

    // Abort the fetch request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    try {
      await fetch(`${API_BASE_URL}/stop`, { method: 'POST' });
    } catch (error) {
      console.error('Error stopping stream:', error);
      // Don't display this error to the user
    }
  };

  // Pressing Enter to send message
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Scroll to bottom on new messages with improved behavior
  useEffect(() => {
    if (chatWrapperRef.current) {
      // Use smoother scrolling for a better experience
      const scrollToBottom = () => {
        const scrollHeight = chatWrapperRef.current.scrollHeight;
        const currentScroll = chatWrapperRef.current.scrollTop + chatWrapperRef.current.clientHeight;
        const isCloseToBottom = scrollHeight - currentScroll < 200; // Within 200px of bottom

        if (isCloseToBottom || messages[messages.length - 1]?.sender === 'user') {
          // Scroll smoothly if we're already close to bottom or if the latest message is from user
          chatWrapperRef.current.scrollTo({
            top: chatWrapperRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      };

      // Small delay to ensure content has rendered
      setTimeout(scrollToBottom, 100);
    }

    // Add message IDs for DOM references
    addMessageIdAttribute();
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = '22px';
      inputRef.current.style.overflowY = 'hidden';
      setTimeout(() => inputRef.current.focus(), 100);
    }
    if (textareaWrapperRef.current) {
      textareaWrapperRef.current.style.height = '52px';
    }
  }, []);

  // Cleanup ResizeObserver
  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, []);

  // Setup custom loading animation
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }
      .loading-dot {
        animation: pulse 1.4s infinite;
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #9ca3af;
        margin: 0 2px;
      }
      .loading-dot:nth-child(2) {
        animation-delay: 0.2s;
      }
      .loading-dot:nth-child(3) {
        animation-delay: 0.4s;
      }
      
      .graph-button {
        color: #0066cc;
      }
      
      .graph-button:hover {
        color: #004c99;
      }
      
      /* Welcome page styles */
      .welcome-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
        padding: 0 2rem;
      }
      
      .welcome-title {
        font-size: 2rem;
        font-weight: 600;
        margin-bottom: 1rem;
        text-align: center;
      }
      
      .welcome-subtitle {
        font-size: 1.25rem;
        color: var(--text-secondary);
        margin-bottom: 2rem;
        text-align: center;
      }
      
      .welcome-input-container {
        width: 100%;
        max-width: 800px;
        margin-top: 2rem;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Render welcome page or regular chat
  if (isWelcomePage) {
    return (
      <div className="app-container">
        <main className="chat-screen">
          <div className="welcome-container">
            <h1 className="welcome-title">Welcome to Phantasia.</h1>
            <h2 className="welcome-subtitle">How can I help you today?</h2>

            <div className="welcome-input-container">
              <div className="input-container">
                <div className="textarea-wrapper" ref={textareaWrapperRef}>
                  <textarea
                    ref={inputRef}
                    className="message-input"
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="What do you want to know?"
                    disabled={isStreaming}
                  />
                </div>
                <div className="input-buttons">
                  <div className="left-buttons">
                    {/* Left side buttons - empty for now */}
                  </div>

                  <div className="flex flex-col justify-items-center">
                    <button
                      className="action-button send-button"
                      onClick={handleSendMessage}
                      disabled={!input.trim()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                      </svg>
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Regular chat UI
  return (
    <div className="app-container">
      <main className="chat-screen">
        <div className="chat-wrapper" ref={chatWrapperRef}>
          <div className="chat-container">
            {messages.map((message) => {
              const messageState = messageStates[message.id] || { isComplete: false, wasInterrupted: false };
              return (
                <div
                  key={message.id}
                  className={`message ${message.sender}`}
                  data-message-id={message.id}
                >
                  {message.sender === 'user' ? (
                    <div className="message-content">{message.content}</div>
                  ) : (
                    <div className="message-content">
                      <SafeMarkdown
                        content={message.content}
                        messageId={message.id}
                        wasInterrupted={messageState.wasInterrupted}
                        isComplete={messageState.isComplete}
                        hasGraphs={messagesWithGraphs.has(message.id)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {streamError && (
              <div className="stream-error">
                Error streaming response. Please try again or refresh the page.
              </div>
            )}
          </div>
        </div>

        {/* Content mask positioned relative to chat-screen */}
        <div className="content-mask"></div>

        {/* Input container - positioned absolutely within the chat-screen container */}
        <div className="input-container fixed-input">
          <div className="textarea-wrapper" ref={textareaWrapperRef}>
            <textarea
              ref={inputRef}
              className="message-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isStreaming}
            />
          </div>
          <div className="input-buttons">
            <div className="left-buttons">
              {/* Left side buttons area - empty for now */}
            </div>

            <div className="flex flex-col justify-items-center">
              {isStreaming ? (
                <button
                  className="action-button send-button stop-button"
                  onClick={handleStopStream}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  </svg>
                  Stop
                </button>
              ) : (
                <button
                  className="action-button send-button"
                  onClick={handleSendMessage}
                  disabled={!input.trim()}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Chatbot;