// combined_server.js
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import http from 'http';
import nodeTikzjax from 'node-tikzjax';

// Extract the tex2svg function from node-tikzjax
const tex2svg = nodeTikzjax.default;

// Get current directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Unified CORS configuration: allow requests from your React app's origin
app.use(cors({
  origin: 'http://localhost:5174',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Increase payload size if necessary
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories:
// For image uploads (used in /api/save-image)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  console.log(`Creating uploads directory at: ${uploadsDir}`);
  fs.mkdirSync(uploadsDir, { recursive: true });
} else {
  console.log(`Uploads directory exists at: ${uploadsDir}`);
}

// For temporary files (used in /api/generate-pdf and TikZ rendering)
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to clean up files
function cleanupFiles(files) {
  files.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.error(`Failed to delete ${file}:`, err);
      }
    }
  });
}

// Global error handlers so the server keeps running
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled rejection at:', promise, 'reason:', reason);
});

// --- TikZ Rendering Endpoint ---
app.post('/api/render-tikz', (req, res) => {
  try {
    console.log('[SERVER] Received /api/render-tikz request');

    const { tikzCode, darkMode } = req.body;
    if (!tikzCode) {
      return res.status(400).json({ error: 'No TikZ code provided' });
    }

    // Normalize whitespace
    const normalizedTikzCode = tikzCode.replace(/\s+/g, ' ').trim();

    // Create a unique job ID
    const jobId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
    console.log(`[SERVER] Processing TikZ job ${jobId}`);

    // Wrap TikZ code in a minimal document
    const source = `
\\begin{document}
${normalizedTikzCode}
\\end{document}`;

    const renderPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('TikZ rendering timed out after 15 seconds'));
      }, 15000);

      tex2svg(source)
        .then(svg => {
          clearTimeout(timeout);
          resolve(svg);
        })
        .catch(err => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    renderPromise
      .then(svg => {
        console.log(`[SERVER] Successfully rendered TikZ job ${jobId}`);
        let svgContent = svg;
        if (darkMode) {
          svgContent = svgContent
            .replace(/fill="white"/g, 'fill="#f1f1f1"')
            .replace(/stroke="black"/g, 'stroke="#333"')
            .replace(/fill="black"/g, 'fill="#333"');
        }
        res.json({ svg: svgContent });
      })
      .catch(error => {
        console.error(`[SERVER] TikZ rendering error in job ${jobId}:`, error);
        const errorMessage = error.message || 'Unknown error';
        const errorSvg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#f1f1f1"/>
          <text x="50%" y="50%" text-anchor="middle" fill="#c62828" font-family="sans-serif" font-size="14">TikZ rendering failed</text>
          <text x="50%" y="70%" text-anchor="middle" fill="#333" font-family="sans-serif" font-size="12">Error: ${errorMessage}</text>
        </svg>`;
        res.json({ svg: errorSvg, error: errorMessage });
      });
  } catch (error) {
    console.error('[SERVER] Unexpected error in render-tikz endpoint:', error);
    const errorSvg = `<svg width="200" height="120" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f1f1f1"/>
      <text x="50%" y="50%" text-anchor="middle" fill="#c62828" font-family="sans-serif" font-size="14">Server error</text>
      <text x="50%" y="70%" text-anchor="middle" fill="#333" font-family="sans-serif" font-size="12">${error.message || 'Unexpected error'}</text>
    </svg>`;
    res.json({ svg: errorSvg, error: error.message || 'Server error' });
  }
});

// --- PDF Generation Endpoint ---
app.post('/api/generate-pdf', (req, res) => {
  try {
    const { latexCode } = req.body;
    if (!latexCode) {
      return res.status(400).json({ error: 'No LaTeX code provided' });
    }
    console.log('[SERVER] Received PDF generation request');

    const timestamp = Date.now();
    const jobId = timestamp.toString() + Math.random().toString(36).substring(2, 8);
    const texFilePath = path.join(tempDir, `document-${jobId}.tex`);
    const pdfFilePath = path.join(tempDir, `document-${jobId}.pdf`);
    const logFilePath = path.join(tempDir, `document-${jobId}.log`);
    const auxFilePath = path.join(tempDir, `document-${jobId}.aux`);

    cleanupFiles([texFilePath, pdfFilePath, logFilePath, auxFilePath]);

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    try {
      fs.writeFileSync(texFilePath, latexCode);
      console.log(`[SERVER] LaTeX file created: ${texFilePath}`);
    } catch (writeError) {
      console.error('[SERVER] Error writing LaTeX file:', writeError);
      return res.status(500).json({
        error: 'Failed to write LaTeX file',
        details: writeError.message
      });
    }

    const pdflatexTimeout = 25000; // 25 seconds
    console.log(`[SERVER] Running pdflatex (first pass) for job ${jobId}...`);

    exec(
      `pdflatex -interaction=nonstopmode -output-directory=${tempDir} ${texFilePath}`,
      { timeout: pdflatexTimeout },
      (error1, stdout1, stderr1) => {
        if (error1) {
          console.error(`[SERVER] pdflatex error (first pass) for job ${jobId}:`, error1);
          cleanupFiles([texFilePath, pdfFilePath, logFilePath, auxFilePath]);
          return res.status(500).json({
            error: 'LaTeX compilation failed (first pass)',
            details: stdout1 || stderr1 || error1.message
          });
        }

        console.log(`[SERVER] Running pdflatex (second pass) for job ${jobId}...`);
        exec(
          `pdflatex -interaction=nonstopmode -output-directory=${tempDir} ${texFilePath}`,
          { timeout: pdflatexTimeout },
          (error2, stdout2, stderr2) => {
            if (error2) {
              console.error(`[SERVER] pdflatex error (second pass) for job ${jobId}:`, error2);
              cleanupFiles([texFilePath, pdfFilePath, logFilePath, auxFilePath]);
              return res.status(500).json({
                error: 'LaTeX compilation failed (second pass)',
                details: stdout2 || stderr2 || error2.message
              });
            }

            if (!fs.existsSync(pdfFilePath)) {
              console.error(`[SERVER] PDF file not created for job ${jobId}`);
              cleanupFiles([texFilePath, logFilePath, auxFilePath]);
              return res.status(500).json({
                error: 'PDF file was not created',
                details: 'Check LaTeX code for errors'
              });
            }

            console.log(`[SERVER] PDF generated successfully for job ${jobId}`);
            try {
              const pdfContent = fs.readFileSync(pdfFilePath);
              res.setHeader('Content-Type', 'application/pdf');
              res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
              res.send(pdfContent);
              setTimeout(() => {
                console.log(`[SERVER] Cleaning up temporary files for job ${jobId}`);
                cleanupFiles([texFilePath, pdfFilePath, logFilePath, auxFilePath]);
              }, 1000);
            } catch (readError) {
              console.error(`[SERVER] Error reading PDF file for job ${jobId}:`, readError);
              cleanupFiles([texFilePath, pdfFilePath, logFilePath, auxFilePath]);
              return res.status(500).json({
                error: 'Failed to read generated PDF',
                details: readError.message
              });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error('[SERVER] Unexpected error in generate-pdf endpoint:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message || 'An unexpected error occurred'
    });
  }
});

// --- Image Save Endpoint ---
app.post('/api/save-image', (req, res) => {
  const { imageData } = req.body;
  if (!imageData) {
    return res.status(400).json({ message: 'No image data provided' });
  }
  const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
  const fileName = `pdf-snippet-${Date.now()}.png`;
  const filePath = path.join(uploadsDir, fileName);

  fs.writeFile(filePath, base64Data, 'base64', (err) => {
    if (err) {
      console.error('Error saving image:', err);
      return res.status(500).json({ message: 'Failed to save image' });
    }
    console.log(`Image saved to ${filePath}`);
    res.status(200).json({
      message: 'Image saved successfully',
      filePath,
      fileName,
      url: `/uploads/${fileName}`
    });
  });
});

// Serve static files from the uploads directory
app.use('/uploads', express.static(uploadsDir));

// Health check endpoint (combined)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'combined-server',
    timestamp: new Date().toISOString()
  });
});

// --- Server Startup with Port Fallback ---
const desiredPort = parseInt(process.argv[2]) || process.env.PORT || 4444;
let currentPort = desiredPort;
const maxPortAttempts = 10;

function startServer(port, attempt = 1) {
  const server = http.createServer(app);
  server.listen(port, () => {
    console.log(`[SERVER] Running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < maxPortAttempts) {
      console.log(`[SERVER] Port ${port} is busy, trying port ${port + 1}...`);
      currentPort = port + 1;
      startServer(currentPort, attempt + 1);
    } else {
      console.error('[SERVER] Failed to start server:', err);
      process.exit(1);
    }
  });
}

startServer(currentPort);
