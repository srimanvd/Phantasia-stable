import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { MathJaxContext, MathJax } from 'better-react-mathjax';
import crypto from 'crypto-js';
import axios from 'axios';
import { FaDownload, FaFilePdf, FaExclamationTriangle, FaTimes } from 'react-icons/fa';

/**
 * LaTeX Editor with TikZ support
 */
export default function LatexEditor() {
  // State for the LaTeX code
  const [latexCode, setLatexCode] = useState(`\\documentclass{article}
\\usepackage{tikz}
\\usepackage{amsmath}
\\begin{document}
\\section{LaTeX Editor with TikZ Support}
This editor supports various LaTeX elements:
\\begin{enumerate}
  \\item Math formulas: $E = mc^2$
  \\item Tables and figures
  \\item TikZ diagrams
  \\item Lists and sections
\\end{enumerate}
\\subsection{Math Example}
Display math:
$$\\int_{0}^{1} x^2 dx = \\frac{1}{3}$$
\\begin{align}
a &= b + c \\\\
  &= d + e
\\end{align}
\\subsection{Table Example}
\\begin{table}[h]
  \\begin{center}
  \\begin{tabular}{|c|c|c|}
      \\hline
      \\textbf{x} & \\textbf{f(x)} & \\textbf{Notes} \\\\
      \\hline
      0 & 1 & Base case \\\\
      1 & 1 & Base case \\\\
      2 & 2 & $f(1) + f(0)$ \\\\
      3 & 3 & $f(2) + f(1)$ \\\\
      4 & 5 & $f(3) + f(2)$ \\\\
      \\hline
  \\end{tabular}
  \\caption{Fibonacci Sequence}
  \\end{center}
\\end{table}
\\subsection{TikZ Example}
Basic circle:
\\begin{tikzpicture}
\\draw[thick, fill=blue!20] (0,0) circle (1cm);
\\draw[->] (0,0) -- (1,0) node[right] {$x$};
\\draw[->] (0,0) -- (0,1) node[above] {$y$};
\\fill (0,0) circle (2pt);
\\end{tikzpicture}
Function plot:
\\begin{tikzpicture}
\\draw[->] (-0.5,0) -- (4,0) node[right] {$x$};
\\draw[->] (0,-0.5) -- (0,4) node[above] {$y$};
\\draw[domain=0:3, smooth, variable=\\x, blue, thick] plot ({\\x}, {\\x*\\x});
\\node at (2,3) {$y = x^2$};
\\end{tikzpicture}
\\end{document}`);

  // References and state
  const resizeRef = useRef(null);
  const [editorWidth, setEditorWidth] = useState(45);
  const [isResizing, setIsResizing] = useState(false);
  const [processedHtml, setProcessedHtml] = useState('');
  const [tikzCache, setTikzCache] = useState({});
  const [tikzBlocks, setTikzBlocks] = useState([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showError, setShowError] = useState(false);
  const [serverBaseUrl, setServerBaseUrl] = useState('http://localhost:4444');
  const [renderCounter, setRenderCounter] = useState(0);
  const outputRef = useRef(null);
  const editorRef = useRef(null);
  const lastChangeRef = useRef(Date.now());
  const tikzRenderTimerRef = useRef(null);
  const pendingRendersRef = useRef(new Set());

  // Monaco editor configuration for LaTeX syntax highlighting
  const configureMonacoLatex = (monaco) => {
    monaco.languages.register({ id: 'latex' });
    monaco.languages.setMonarchTokensProvider('latex', {
      defaultToken: '',
      tokenPostfix: '.tex',

      // Regular expressions
      control: /\\[a-zA-Z]+/,

      // Tokenizer
      tokenizer: {
        root: [
          // Commands
          [/\\[a-zA-Z]+/, 'keyword'],

          // Environment blocks
          [/(\\begin)({)([a-zA-Z]+)(})/, ['keyword', 'delimiter.curly', 'type', 'delimiter.curly']],
          [/(\\end)({)([a-zA-Z]+)(})/, ['keyword', 'delimiter.curly', 'type', 'delimiter.curly']],

          // Math modes
          [/\$\$/, 'string', '@displaymath'],
          [/\$/, 'string', '@inlinemath'],

          // Comments
          [/%.*$/, 'comment'],

          // Braces
          [/{/, 'delimiter.curly', '@arguments'],
          [/}/, 'delimiter.curly'],

          // Brackets
          [/\[/, 'delimiter.square', '@squarebrackets'],
          [/\]/, 'delimiter.square'],
        ],

        arguments: [
          [/[^{}]/, 'variable.parameter'],
          [/{/, 'delimiter.curly', '@arguments'],
          [/}/, 'delimiter.curly', '@pop'],
        ],

        squarebrackets: [
          [/[^\[\]]/, 'attribute.value'],
          [/\[/, 'delimiter.square', '@squarebrackets'],
          [/\]/, 'delimiter.square', '@pop'],
        ],

        displaymath: [
          [/\$\$/, 'string', '@pop'],
          [/./, 'string.math'],
        ],

        inlinemath: [
          [/\$/, 'string', '@pop'],
          [/./, 'string.math'],
        ],
      }
    });

    // Define custom theme
    monaco.editor.defineTheme('latex-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.math', foreground: 'CE9178' },
        { token: 'delimiter.curly', foreground: 'DCDCAA' },
        { token: 'delimiter.square', foreground: 'DCDCAA' },
        { token: 'comment', foreground: '6A9955' },
        { token: 'variable.parameter', foreground: '9CDCFE' },
        { token: 'attribute.value', foreground: 'CE9178' },
      ],
      colors: {
        'editor.background': '#1a1a1a',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#6e7681',
        'editorLineNumber.activeForeground': '#d4d4d4',
        'editor.lineHighlightBackground': '#2a2a2a',
        'editorCursor.foreground': '#d4d4d4',
        'scrollbarSlider.background': '#33333333',
        'scrollbarSlider.hoverBackground': '#44444466',
        'scrollbarSlider.activeBackground': '#55555599',
      }
    });
  };

  // MathJax configuration
  const mathJaxConfig = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']],
      processEscapes: true,
      packages: ['base', 'ams', 'noerrors', 'noundefined']
    },
    svg: { fontCache: 'global' }
  };

  // Editor initialization
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    configureMonacoLatex(monaco);
    editor.setModel(monaco.editor.createModel(latexCode, 'latex'));
    editor.updateOptions({
      theme: 'latex-dark',
      fontFamily: "'Fira Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 14,
    });
  };

  // Resizing functionality
  useEffect(() => {
    const handleMouseDown = () => {
      setIsResizing(true);
    };

    const handleMouseMove = (e) => {
      if (!isResizing) return;

      const containerRect = document.querySelector('.latex-editor-container').getBoundingClientRect();
      const newWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

      if (newWidth >= 20 && newWidth <= 80) {
        setEditorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    const resizer = resizeRef.current;
    if (resizer) {
      resizer.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (resizer) {
        resizer.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
    };
  }, [isResizing]);

  // Function to normalize whitespace and newlines in TikZ code for consistent hashing
  const normalizeTikzCode = (code) => {
    return code
      .replace(/\s+/g, ' ')  // Replace sequences of whitespace with a single space
      .trim();  // Remove leading/trailing whitespace
  };

  // Extract TikZ blocks from LaTeX code
  const extractTikzBlocks = (code) => {
    // Extract content inside \begin{document}...\end{document}
    const docMatch = code.match(/\\begin\s*\{\s*document\s*\}([\s\S]*?)\\end\s*\{\s*document\s*\}/);
    const content = docMatch ? docMatch[1] : code;

    // Match TikZ blocks including whitespace
    const tikzPattern = /\\begin\{tikzpicture\}([\s\S]*?)\\end\{tikzpicture\}/g;
    const blocks = [];
    let match;
    let index = 0;

    // Find all TikZ blocks
    while ((match = tikzPattern.exec(content)) !== null) {
      // Create a unique ID for this block based on its content
      const fullCode = match[0];
      const innerCode = match[1];
      const normalizedCode = normalizeTikzCode(fullCode);
      const hash = crypto.SHA256(normalizedCode).toString();

      blocks.push({
        id: `tikz-${index}-${hash.substring(0, 8)}`,
        fullCode: fullCode,
        innerCode: innerCode,
        index: index,
        hash: hash
      });

      index++;
    }

    return blocks;
  };

  // Create HTML with placeholders for TikZ diagrams
  const createHtmlWithPlaceholders = (code, tikzBlocks) => {
    // Extract document content
    const docMatch = code.match(/\\begin\s*\{\s*document\s*\}([\s\S]*?)\\end\s*\{\s*document\s*\}/);
    let content = docMatch ? docMatch[1] : code;

    // Replace each TikZ block with a placeholder
    tikzBlocks.forEach(block => {
      const placeholder = `<div class="tikz-placeholder" data-tikz-id="${block.id}"></div>`;
      content = content.replace(block.fullCode, placeholder);
    });

    // Process other LaTeX environments
    return processLatexEnvironments(content);
  };

  // Process LaTeX environments into HTML
  function processLatexEnvironments(content) {
    return content
      // Sections and subsections
      .replace(/\\section\{([^}]*)\}/g, '<h2 class="latex-section">$1</h2>')
      .replace(/\\subsection\{([^}]*)\}/g, '<h3 class="latex-subsection">$1</h3>')

      // Lists
      .replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g, (match, group) => {
        const items = group.split('\\item').slice(1);
        return '<ol class="latex-enumerate">' +
          items.map(item => `<li>${item.trim()}</li>`).join('') +
          '</ol>';
      })
      .replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (match, group) => {
        const items = group.split('\\item').slice(1);
        return '<ul class="latex-itemize">' +
          items.map(item => `<li>${item.trim()}</li>`).join('') +
          '</ul>';
      })

      // Tables
      .replace(/\\begin\{table\}(\[.*?\])?([\s\S]*?)\\end\{table\}/g,
        '<div class="latex-table-container">$2</div>')
      .replace(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g, (match, colSpec, tableContent) => {
        // Process column specs
        const hasVerticalLines = colSpec.includes('|');
        const colClasses = [];

        for (let i = 0; i < colSpec.length; i++) {
          if (colSpec[i] === 'l') colClasses.push('text-left');
          else if (colSpec[i] === 'c') colClasses.push('text-center');
          else if (colSpec[i] === 'r') colClasses.push('text-right');
        }

        // Process rows
        const rowsWithHlines = tableContent.trim().split('\\\\').map(row => row.trim());

        let tableHTML = '<table class="latex-table">';
        let pendingHline = false;
        let tbody = '';

        for (let i = 0; i < rowsWithHlines.length; i++) {
          let row = rowsWithHlines[i];

          // Handle \hline
          if (row.includes('\\hline')) {
            const parts = row.split('\\hline');
            row = parts.join('').trim();

            if (row === '') {
              pendingHline = true;
              continue;
            }
          }

          if (row === '') continue;

          // Apply border style
          let rowClass = pendingHline ? 'border-top' : '';
          pendingHline = false;

          tbody += `<tr class="${rowClass}">`;

          // Process cells
          const cells = row.split('&').map(cell => cell.trim());
          cells.forEach((cell, j) => {
            const alignClass = j < colClasses.length ? colClasses[j] : '';
            tbody += `<td class="${alignClass}">${cell}</td>`;
          });

          tbody += '</tr>';
        }

        // Apply bottom border if pending
        if (pendingHline) {
          const colCount = Math.max(1, colClasses.length);
          tbody += `<tr class="border-bottom"><td colspan="${colCount}"></td></tr>`;
        }

        tableHTML += tbody + '</table>';
        return tableHTML;
      })

      // Text formatting
      .replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>')

      // Other environments
      .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div class="latex-center">$1</div>')
      .replace(/\\caption\{([^}]*)\}/g, '<div class="latex-caption">$1</div>')

      // Math environments
      .replace(/\\begin\{align\}([\s\S]*?)\\end\{align\}/g, '$$\\begin{align}$1\\end{align}$$')

      // Paragraph breaks
      .replace(/\n\n+/g, '<p></p>');
  }

  // Render a TikZ block
  const renderTikzBlock = async (block) => {
    if (pendingRendersRef.current.has(block.id)) {
      return; // Already rendering this block
    }

    pendingRendersRef.current.add(block.id);
    console.log(`Rendering TikZ block: ${block.id}`);

    try {
      // Check cache first
      if (tikzCache[block.hash]) {
        setTikzBlocks(current => {
          return current.map(b => {
            if (b.id === block.id) {
              return { ...b, isLoading: false, svg: tikzCache[block.hash] };
            }
            return b;
          });
        });
        pendingRendersRef.current.delete(block.id);
        return;
      }

      // Call server API
      const response = await axios.post(`${serverBaseUrl}/api/render-tikz`, {
        tikzCode: block.fullCode,
        darkMode: true
      }, { timeout: 10000 });

      if (response.data && response.data.svg) {
        // Update cache
        setTikzCache(prev => ({
          ...prev,
          [block.hash]: response.data.svg
        }));

        // Update block
        setTikzBlocks(current => {
          return current.map(b => {
            if (b.id === block.id) {
              return { ...b, isLoading: false, svg: response.data.svg };
            }
            return b;
          });
        });
      }
    } catch (error) {
      console.error(`Error rendering TikZ block ${block.id}:`, error);

      // Create error SVG
      const errorSvg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#2a2a2a"/>
        <text x="50%" y="50%" text-anchor="middle" fill="#e74c3c" font-family="sans-serif" font-size="14">TikZ rendering failed</text>
        <text x="50%" y="70%" text-anchor="middle" fill="#e0e0e0" font-family="sans-serif" font-size="12">${error.message || 'Server error'}</text>
      </svg>`;

      // Update block with error
      setTikzBlocks(current => {
        return current.map(b => {
          if (b.id === block.id) {
            return { ...b, isLoading: false, svg: errorSvg };
          }
          return b;
        });
      });
    } finally {
      pendingRendersRef.current.delete(block.id);
    }
  };

  // Render TikZ blocks in parallel
  const renderAllTikzBlocks = async (blocks) => {
    const renderPromises = blocks
      .filter(block => block.isLoading)
      .map(block => renderTikzBlock(block));

    await Promise.all(renderPromises);
  };

  // Update processed content when LaTeX code changes
  useEffect(() => {
    // Extract TikZ blocks
    const extractedBlocks = extractTikzBlocks(latexCode);

    // Map current state to new state, preserving SVGs where possible
    const newTikzBlocks = extractedBlocks.map(newBlock => {
      const existingBlock = tikzBlocks.find(oldBlock => oldBlock.hash === newBlock.hash);

      if (existingBlock && existingBlock.svg) {
        // Block exists and has SVG, preserve it
        return {
          ...newBlock,
          isLoading: false,
          svg: existingBlock.svg
        };
      } else {
        // New block or no SVG yet, mark for loading
        return {
          ...newBlock,
          isLoading: true,
          svg: null
        };
      }
    });

    // Create HTML with placeholders
    const html = createHtmlWithPlaceholders(latexCode, newTikzBlocks);

    // Update state
    setTikzBlocks(newTikzBlocks);
    setProcessedHtml(html);
    lastChangeRef.current = Date.now();

    // Trigger re-render counter
    setRenderCounter(prev => prev + 1);

    // Clear any existing render timer
    if (tikzRenderTimerRef.current) {
      clearTimeout(tikzRenderTimerRef.current);
    }

    // Start a new render timer (slight delay to batch changes)
    tikzRenderTimerRef.current = setTimeout(() => {
      renderAllTikzBlocks(newTikzBlocks);
    }, 300);

    return () => {
      if (tikzRenderTimerRef.current) {
        clearTimeout(tikzRenderTimerRef.current);
      }
    };
  }, [latexCode]);

  // Poll for unrendered TikZ blocks every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTikzBlocks(currentBlocks => {
        const unrenderedBlocks = currentBlocks.filter(block => block.isLoading);
        if (unrenderedBlocks.length > 0) {
          console.log(`Poll: Found ${unrenderedBlocks.length} unrendered TikZ blocks`);
          renderAllTikzBlocks(unrenderedBlocks);
        }
        return currentBlocks;
      });

      // Force a re-render by updating the counter
      setRenderCounter(prev => prev + 1);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Render final HTML with TikZ SVGs
  const renderFinalContent = () => {
    if (!processedHtml) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(processedHtml, 'text/html');
    const placeholders = doc.querySelectorAll('.tikz-placeholder');

    placeholders.forEach(ph => {
      const tikzId = ph.getAttribute('data-tikz-id');
      const block = tikzBlocks.find(block => block.id === tikzId);

      if (!block) return;

      if (block.isLoading) {
        ph.innerHTML = '<div class="tikz-loading"><div class="spinner"></div></div>';
      } else if (block.svg) {
        ph.innerHTML = `<div class="tikzsvg">${block.svg}</div>`;
      }
    });

    return doc.body.innerHTML;
  };

  // Handle code changes
  const handleCodeChange = (value) => {
    setLatexCode(value || '');
  };

  // Download handlers
  const handleDownloadLatex = useCallback(() => {
    const blob = new Blob([latexCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Create link element to trigger download dialog
    const link = document.createElement('a');
    link.href = url;
    link.download = 'document.tex';
    document.body.appendChild(link);
    link.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }, [latexCode]);

  const handleDownloadPdf = useCallback(async () => {
    setIsGeneratingPdf(true);
    setErrorMessage('');
    setShowError(false);

    try {
      console.log('Sending PDF generation request...');

      // Call the server API to generate PDF
      const response = await axios.post(
        `${serverBaseUrl}/api/generate-pdf`,
        { latexCode },
        { responseType: 'blob', timeout: 30000 } // 30 second timeout
      );

      console.log('PDF received from server');

      // Create a download link
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'document.pdf';
      document.body.appendChild(link);
      link.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error('PDF generation failed:', error);

      let errorMsg = 'Failed to generate PDF';
      if (error.response) {
        // Try to extract error message from blob
        try {
          const errorBlob = error.response.data;
          const errorText = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsText(errorBlob);
          });

          try {
            // Try to parse as JSON
            const errorJson = JSON.parse(errorText);
            errorMsg = errorJson.error || errorText;
          } catch {
            // If not JSON, use as plain text
            errorMsg = errorText;
          }
        } catch (e) {
          // Fallback error message
          errorMsg = 'Error compiling LaTeX document. Check for syntax errors.';
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMsg = 'Request timed out. The server took too long to respond.';
      } else if (error.message) {
        errorMsg = error.message;
      }

      setErrorMessage(errorMsg);
      setShowError(true);
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [latexCode, serverBaseUrl]);

  // Check server connection on mount
  useEffect(() => {
    const checkServer = async () => {
      try {
        await axios.get(`${serverBaseUrl}/health`, { timeout: 5000 });
        console.log('Server connection established');
      } catch (error) {
        console.error('Failed to connect to server:', error);
        setErrorMessage('Failed to connect to the LaTeX server. Make sure the server is running on port 4444.');
        setShowError(true);
      }
    };

    checkServer();
  }, [serverBaseUrl]);

  // Get final HTML content
  const finalHtml = renderFinalContent();

  return (
    <MathJaxContext config={mathJaxConfig}>
      <div className="latex-editor-container">
        <div className="latex-editor-main">
          {/* Editor panel */}
          <div className="editor-panel" style={{ width: `${editorWidth}%` }}>
            <div className="editor-header">
              <div className="header-title">LaTeX Editor</div>
              <div className="header-actions">
                <button className="download-button tex-button" onClick={handleDownloadLatex}>
                  <FaDownload className="button-icon" /> .tex
                </button>
              </div>
            </div>
            <div className="editor-container">
              <Editor
                height="100%"
                defaultLanguage="latex"
                theme="latex-dark"
                value={latexCode}
                onChange={handleCodeChange}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  lineNumbersMinChars: 3,
                  folding: true,
                  renderLineHighlight: 'line',
                  automaticLayout: true,
                  scrollbar: {
                    useShadows: false,
                    verticalHasArrows: false,
                    horizontalHasArrows: false,
                    vertical: 'visible',
                    horizontal: 'visible',
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                    arrowSize: 0
                  }
                }}
              />
            </div>
          </div>

          {/* Resizer */}
          <div
            ref={resizeRef}
            className="resizer"
            style={{ cursor: isResizing ? 'col-resize' : 'ew-resize' }}
          />

          {/* Preview panel */}
          <div className="preview-panel" style={{ width: `${100 - editorWidth}%` }}>
            <div className="preview-header">
              <div className="header-title">Preview</div>
              <div className="header-actions">
                <button
                  className="download-button pdf-button"
                  onClick={handleDownloadPdf}
                  disabled={isGeneratingPdf}
                >
                  {isGeneratingPdf ? (
                    <>
                      <div className="spinner-small"></div> Generating...
                    </>
                  ) : (
                    <>
                      <FaFilePdf className="button-icon" /> Download PDF
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="preview-container">
              <MathJax key={renderCounter}>
                <div
                  ref={outputRef}
                  className="preview-content"
                  dangerouslySetInnerHTML={{ __html: finalHtml }}
                />
              </MathJax>
            </div>
          </div>
        </div>

        {/* Error popup */}
        {showError && (
          <div className="error-overlay">
            <div className="error-popup">
              <div className="error-header">
                <FaExclamationTriangle className="error-icon" />
                <h3>LaTeX Compilation Error</h3>
                <button className="close-button" onClick={() => setShowError(false)}>
                  <FaTimes />
                </button>
              </div>
              <div className="error-content">
                <pre>{errorMessage}</pre>
              </div>
            </div>
          </div>
        )}

        <style jsx>{`
          @import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600&display=swap');

          .latex-editor-container {
            display: flex;
            flex-direction: column;
            height: 90vh; /* Changed from 100vh to 90vh for bottom padding */
            width: 100%;
            background-color: #121212;
            color: #e0e0e0;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin-bottom: 2rem;
          }
          
          .latex-editor-main {
            display: flex;
            flex: 1;
            overflow: hidden;
          }
          
          .editor-panel, .preview-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
          }
          
          .editor-header, .preview-header {
            padding: 0;
            background-color: #0a0a0a;
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 36px;
            border-bottom: 1px solid #222;
          }
          
          .header-title {
            font-size: 13px;
            font-weight: 500;
            color: #888;
            padding: 0 12px;
          }
          
          .header-actions {
            display: flex;
            align-items: center;
            padding-right: 8px;
          }
          
          .editor-container, .preview-container {
            flex: 1;
            overflow: hidden;
            position: relative;
          }
          
          .preview-container {
            overflow-y: auto;
            padding: 20px;
            background-color: #1e1e1e;
            
            /* Custom scrollbar */
            scrollbar-width: thin;
            scrollbar-color: rgba(100, 100, 100, 0.3) transparent;
          }
          
          .preview-container::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          
          .preview-container::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 3px;
          }
          
          .preview-container::-webkit-scrollbar-thumb {
            background-color: rgba(100, 100, 100, 0.3);
            border-radius: 3px;
          }
          
          .preview-container::-webkit-scrollbar-thumb:hover {
            background-color: rgba(100, 100, 100, 0.5);
          }
          
          .preview-container::-webkit-scrollbar-corner {
            background: transparent;
          }
          
          /* Override Monaco editor scrollbars */
          .monaco-scrollable-element > .scrollbar > .slider {
            background: rgba(100, 100, 100, 0.3) !important;
            border-radius: 3px !important;
          }
          
          .monaco-scrollable-element > .scrollbar > .slider:hover {
            background: rgba(100, 100, 100, 0.5) !important;
          }
          
          .monaco-scrollable-element > .scrollbar {
            background: transparent !important;
          }
          
          .resizer {
            width: 4px;
            height: 100%;
            background-color: #0a0a0a;
            cursor: ew-resize;
            transition: background-color 0.2s;
          }
          
          .resizer:hover, .resizer:active {
            background-color: #3a3a3a;
          }
          
          .download-button {
            padding: 4px 10px;
            font-size: 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            outline: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s ease;
            margin-left: 8px;
            font-weight: 500;
            height: 24px;
          }
          
          .button-icon {
            font-size: 12px;
          }
          
          .tex-button {
            background-color: #000;
            color: #e0e0e0;
          }
          
          .tex-button:hover {
            background-color: #252525;
            transform: translateY(-1px);
          }
          
          .pdf-button {
            background-color: #000;
            color: #e0e0e0;
          }
          
          .pdf-button:hover {
            background-color: #252525;
            transform: translateY(-1px);
          }
          
          .pdf-button:disabled {
            background-color: #222;
            color: #666;
            cursor: not-allowed;
            transform: none;
          }
          
          /* LaTeX styles */
          .preview-content {
            font-family: 'Computer Modern Serif', 'Latin Modern Roman', Georgia, serif;
            line-height: 1.6;
            padding-bottom: 40px;
            color: #e0e0e0;
          }
          
          .latex-section {
            font-size: 1.5rem;
            border-bottom: 1px solid #444;
            padding-bottom: 5px;
            margin-top: 25px;
            margin-bottom: 15px;
            color: #64b5f6;
            font-weight: 500;
          }
          
          .latex-subsection {
            font-size: 1.25rem;
            margin-top: 20px;
            margin-bottom: 10px;
            color: #4dd0e1;
            font-weight: 500;
          }
          
          .latex-enumerate, .latex-itemize {
            margin-left: 20px;
            margin-bottom: 15px;
          }
          
          .latex-enumerate li, .latex-itemize li {
            margin-bottom: 5px;
          }
          
          .latex-table-container {
            margin: 20px 0;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          
          .latex-table {
            border-collapse: collapse;
            margin: 10px 0;
            background-color: #2d2d2d;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            border-radius: 3px;
            overflow: hidden;
          }
          
          .latex-table td {
            padding: 8px 16px;
            border: 1px solid #444;
          }
          
          .latex-table .border-top td {
            border-top: 2px solid #5c6bc0;
          }
          
          .latex-table tr.border-bottom td {
            border-bottom: 2px solid #5c6bc0;
          }
          
          .text-center { text-align: center; }
          .text-left { text-align: left; }
          .text-right { text-align: right; }
          
          .latex-center {
            text-align: center;
            margin: 10px 0;
          }
          
          .latex-caption {
            text-align: center;
            font-style: italic;
            margin-top: 5px;
            color: #bdbdbd;
          }
          
          /* TikZ styling */
          .tikz-placeholder {
            display: flex;
            justify-content: center;
            min-height: 100px;
            margin: 20px 0;
          }
          
          .tikzsvg {
            background-color: #f1f1f1; /* Lighter color for TikZ diagrams */
            padding: 15px;
            border-radius: 6px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            display: flex;
            justify-content: center;
            margin: 0 auto;
            transition: all 0.2s ease;
          }
          
          .tikzsvg:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          }
          
          .tikzsvg svg {
            max-width: 100%;
            border-radius: 4px;
          }
          
          .tikz-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100px;
          }
          
          .spinner {
            width: 30px;
            height: 30px;
            border: 3px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            border-top-color: #5c6bc0;
            animation: spin 1s linear infinite;
          }
          
          .spinner-small {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            border-top-color: #ffffff;
            animation: spin 1s linear infinite;
            margin-right: 4px;
          }
          
          /* Error popup */
          .error-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
            animation: fadeIn 0.2s ease;
          }
          
          .error-popup {
            background-color: #1e1e1e;
            border-radius: 8px;
            width: 80%;
            max-width: 600px;
            max-height: 80vh;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            animation: slideIn 0.2s ease;
          }
          
          .error-header {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            background-color: #c62828;
            color: white;
          }
          
          .error-icon {
            margin-right: 10px;
            font-size: 18px;
          }
          
          .error-header h3 {
            margin: 0;
            flex: 1;
            font-size: 16px;
            font-weight: 600;
          }
          
          .close-button {
            background: none;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 4px;
            border-radius: 4px;
            transition: background-color 0.2s;
          }
          
          .close-button:hover {
            background-color: rgba(255, 255, 255, 0.1);
          }
          
          .error-content {
            padding: 16px;
            overflow-y: auto;
            max-height: 60vh;
            scrollbar-width: thin;
            scrollbar-color: rgba(100, 100, 100, 0.3) transparent;
          }
          
          .error-content::-webkit-scrollbar {
            width: 6px;
          }
          
          .error-content::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 3px;
          }
          
          .error-content::-webkit-scrollbar-thumb {
            background-color: rgba(100, 100, 100, 0.3);
            border-radius: 3px;
          }
          
          .error-content pre {
            margin: 0;
            white-space: pre-wrap;
            font-family: 'Fira Code', monospace;
            font-size: 13px;
            color: #e0e0e0;
            background-color: #2a2a2a;
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          
          @keyframes slideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      </div>
    </MathJaxContext>
  );
}
