# Phantasia

**Winner of Best Overall**  
Devpost: [https://devpost.com/software/phantasia](https://devpost.com/software/phantasia)

## Inspiration

Many of our team members have taken STEM classes that rely on multimedia textbooks—like the Mechanics course at PUI—which integrate videos, interactive examples, and equation tools. We wanted to take that a step further and empower students to create custom AI-powered multimedia tools tailored to their classes and learning styles.

## What It Does

Phantasia is an AI-driven learning companion for STEM students. It provides a suite of interactive tools designed to visualize and explain complex concepts:

- PDF Viewer – Upload class notes or textbooks directly.
- AI Chatbot – Ask questions and receive detailed answers powered by LLMs.
- Screenshot Utility – Send selected textbook sections to the chatbot.
- Graphing Integration – Auto-generates visualizations using Desmos.
- LaTeX Editor – Render real-time math, including TikZ diagrams.
- Whiteboard Pane – Draw, brainstorm, and annotate freely.
- AI-Powered Animation Generator – Converts topics into voice-narrated animations.

## How We Built It

Phantasia uses a modular full-stack architecture designed for high interactivity and smooth AI integration.

### Core Components

| Component        | Description                                                   |
|------------------|---------------------------------------------------------------|
| Chatbot          | AI assistant using multi-step reasoning with DeepSeek and ChatGPT |
| PDF Viewer       | Extracts, annotates, and screenshots textbook content         |
| Whiteboard       | Free-draw interface for sketching or brainstorming            |
| LaTeX Editor     | Renders LaTeX and TikZ in-browser                             |
| Video Creator    | Generates voice-narrated animations from topic prompts        |
| Desmos Graphing  | Converts math expressions into graphs                         |

## AI and LLM Integration

Phantasia is built on a Python backend using FastAPI. It routes requests to different AI components for intelligent, multimodal responses.

### 1. Chatbot and Reasoning Pipeline
- Uses DeepSeek and ChatGPT
- Detects math expressions and routes them to visual tools

### 2. Automated Video Generation
- Gemini API generates structured topic explanations
- DeepSeek converts descriptions to Manim animation scripts
- A debugging loop auto-corrects syntax errors
- Gemini generates voiceover scripts
- Eleven Labs produces voiceovers

### 3. Desmos Graphing
- Parses chatbot responses for equations
- Injects them into an embedded Desmos calculator

### 4. LaTeX Rendering
- Uses KaTeX, MathJax, and a Node.js API to render LaTeX and TikZ diagrams

### 5. PDF Screenshot Utility
- Uses DOM manipulation and the Canvas API to capture and send PDF sections to the chatbot

## APIs and Architecture

| API Name               | Purpose                                                     |
|------------------------|-------------------------------------------------------------|
| Main Server API        | Handles LLM interactions and query routing (Python)         |
| Desmos API             | Sends expressions to graphing tool (Python)                 |
| Video Creator API      | Handles animation generation pipeline (Python)              |
| LaTeX Handler API      | Renders and returns LaTeX and TikZ outputs (Node.js)        |
| Screenshot Handler API | Captures and sends textbook images (Node.js)                |

### Infrastructure Overview

- Microservices-based backend
- Frontend built with React, TypeScript, and TailwindCSS
- State management using Context API and Redux
- Queue-based API processing to reduce latency and manage costs

## Challenges We Faced

- Integrating multiple AI tools with different request and response formats
- Debugging syntax errors in AI-generated Manim code
- DOM manipulation for high-resolution screenshot extraction
- Live LaTeX rendering and support for complex TikZ diagrams
- Synchronization and communication across six frontend components

## Accomplishments

- Fully automated video generation from topic input to voice-narrated animation
- Desmos graph integration triggered by AI understanding
- Real-time LaTeX and TikZ rendering with live editing support
- Seamless screenshot integration between textbook viewer and chatbot
- Debugging loop for correcting AI-generated code

## What We Learned

- Techniques for making LLMs generate reliable, structured code
- Prompt engineering strategies for generative outputs
- Multimedia rendering pipelines for mathematical content
- Handling multiple asynchronous APIs across frontend and backend
- Building interactive educational tools powered by AI

## What’s Next

- Support for more file formats beyond PDF
- New tools for chemistry, biology, and advanced physics
- Real-time collaboration and sharing of visualizations
- Animation template improvements for consistency and quality
- Offline mode for local use
- Integration with LMS platforms like Canvas or Blackboard
- Improved accessibility and multilingual features

## Devpost

Learn more about Phantasia and view our submission here:  
[https://devpost.com/software/phantasia](https://devpost.com/software/phantasia)
