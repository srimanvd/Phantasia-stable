import os
from dotenv import load_dotenv
from openai import OpenAI
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import traceback
import httpx
import re
import json
from pathlib import Path
import base64
from typing import List

load_dotenv()
DEEPSEEKAPIKEY = os.getenv("DEEPSEEKAPIKEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not DEEPSEEKAPIKEY:
    print("Warning: DEEPSEEKAPIKEY environment variable not set, using hardcoded key.")

app = FastAPI(
    title="Streaming Chat API",
    description="API for handling chat requests with OpenAI streaming responses"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OPENAI_BASE_URL = "https://api.deepseek.com/v1"

# Initialize OpenAI client
try:
    client = OpenAI(api_key=OPENAI_API_KEY)

except Exception as e:
    print(f"Error initializing OpenAI client: {e}")

active_generations = {}


class ChatRequest(BaseModel):
    message: str


class GraphRequest(BaseModel):
    content: str


# Update the get_image_files_from_uploads function to add more debugging and handle the path correctly

def get_image_files_from_uploads() -> List[str]:
    """Scan the uploads directory for image files with enhanced debugging"""
    image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
    upload_dir = Path("hackathon-indy-project/uploads")  # Path relative to where the server is running

    # Debug message
    print(f"Looking for images in: {upload_dir.absolute()}")

    # Check if directory exists
    if not upload_dir.exists():
        print(f"Warning: Uploads directory does not exist at {upload_dir.absolute()}")
        os.makedirs(upload_dir, exist_ok=True)
        return []

    # Get all files with image extensions
    image_files = []
    for ext in image_extensions:
        found_files = list(upload_dir.glob(f"*{ext}"))
        if found_files:
            print(f"Found {len(found_files)} files with extension {ext}")
        image_files.extend(found_files)

    # Return full paths as strings
    file_paths = [str(img_path) for img_path in image_files]

    # Debug output
    if file_paths:
        print(f"Found {len(file_paths)} image files in uploads directory:")
        for path in file_paths:
            print(f"  - {path}")
    else:
        print("No image files found in uploads directory")

    return file_paths


def encode_image_to_base64(image_path: str) -> str:
    """Encode an image file to base64 string with error handling"""
    # Get file extension and map to MIME type
    file_ext = Path(image_path).suffix.lower()
    mime_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    }
    mime_type = mime_types.get(file_ext, 'image/jpeg')  # Default to JPEG if unknown

    print(f"Encoding image: {image_path} as {mime_type}")

    try:
        # Encode file to base64
        with open(image_path, "rb") as image_file:
            file_data = image_file.read()
            print(f"Successfully read {len(file_data)} bytes from {image_path}")
            base64_data = base64.b64encode(file_data).decode('utf-8')
            return f"data:{mime_type};base64,{base64_data}"
    except Exception as e:
        print(f"Error encoding image {image_path}: {e}")
        raise


def encode_image_to_base64(image_path: str) -> str:
    """Encode an image file to base64 string with appropriate MIME type"""
    # Get file extension and map to MIME type
    file_ext = Path(image_path).suffix.lower()
    mime_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    }
    mime_type = mime_types.get(file_ext, 'image/jpeg')  # Default to JPEG if unknown

    # Encode file to base64
    with open(image_path, "rb") as image_file:
        base64_data = base64.b64encode(image_file.read()).decode('utf-8')

    return f"data:{mime_type};base64,{base64_data}"


def cleanup_uploads_directory():
    """Delete all files in the uploads directory"""
    upload_dir = Path("uploads")
    if upload_dir.exists():
        for file_path in upload_dir.iterdir():
            if file_path.is_file():
                try:
                    file_path.unlink()
                    print(f"Deleted file: {file_path}")
                except Exception as e:
                    print(f"Error deleting file {file_path}: {e}")


@app.post("/api/chat")
async def chat_endpoint(chat_req: ChatRequest, request: Request):
    if not chat_req.message:
        raise HTTPException(status_code=400, detail="No message provided")

    request_id = id(request)
    active_generations[request_id] = {"active": True, "cancelled": False}
    print(f"Starting generation for request ID: {request_id}")

    # Check for images in the uploads directory
    image_files = get_image_files_from_uploads()
    has_images = len(image_files) > 0

    if has_images:
        print(f"Found {len(image_files)} images to include in request {request_id}")

    async def stream_generator():
        stream = None
        try:
            # Log the request
            print(f"Sending message to LLM for request {request_id}: {chat_req.message[:100]}...")  # Log snippet

            # Prepare system message
            system_message = {
                "role": "system",
                "content": """
                You are a helpful assistant that can answer questions and help with tasks.
                You are also able to use LaTeX to render mathematical expressions. However, avoid Tkiz diagrams. We can't compile them.

                When a user asks you to graph something or plot a function, you should provide the equations in a format that can be plotted.
                Use LaTeX syntax for the equations. For graphable content, include a special section at the end of your response like this:

                ```graph
                [
                  {
                    "expression": "x^2",
                    "label": "Parabola",
                    "color": "#FF0000"
                  },
                  {
                    "expression": "\\\\sin(x)",
                    "label": "Sine Wave",
                    "color": "#0000FF"
                  }
                ]
                ```

                The expression should use LaTeX syntax. Make sure to properly escape backslashes in LaTeX expressions.
                Always use these colors for different functions: #FF0000 (red), #0000FF (blue), #00FF00 (green), 
                #800080 (purple), #FFA500 (orange), #008080 (teal).

                We'll be rendering these graphs in Desmos, so make sure to use the correct syntax for Desmos. 
                Take special note of \\\\sin(x) and \\\\cos(x) as these are the correct ways to write the sine and cosine functions for Desmos.
                If an equation has no variables, then write y=equation.
                For example, if the equation is 2, then write y=2.

                If the user has sent images, analyze them and provide insights based on their visual content.
                """
            }

            # Prepare user message
            if has_images:
                # Create a message with text and images
                content = [{"type": "text", "text": chat_req.message}]

                # Add images to content
                for img_path in image_files:
                    try:
                        data_url = encode_image_to_base64(img_path)
                        content.append({
                            "type": "image_url",
                            "image_url": {
                                "url": data_url
                            }
                        })
                    except Exception as img_err:
                        print(f"Error processing image {img_path}: {img_err}")

                user_message = {
                    "role": "user",
                    "content": content
                }
            else:
                # Simple text-only message
                user_message = {
                    "role": "user",
                    "content": chat_req.message
                }

            # Create the stream with the prepared messages
            stream = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[system_message, user_message],
                stream=True
            )

            for chunk in stream:
                if active_generations.get(request_id, {}).get("cancelled", False):
                    print(f"Request {request_id} was cancelled by user.")
                    break

                content = chunk.choices[0].delta.content
                if content is not None:
                    yield str(content)
                    await asyncio.sleep(0)

            print(f"Finished streaming for request {request_id}.")

            # Cleanup images after successful completion
            if has_images:
                cleanup_uploads_directory()
                print(f"Cleaned up {len(image_files)} images from uploads directory for request {request_id}")

        except asyncio.CancelledError:
            print(f"Request {request_id} was cancelled (client disconnected).")
            active_generations[request_id]["cancelled"] = True
        except Exception as e:
            error_details = traceback.format_exc()
            print(f"Error during LLM stream for request {request_id}: {error_details}")

        finally:
            if request_id in active_generations:
                del active_generations[request_id]
                print(f"Cleaned up active generation state for request {request_id}")
            if stream is not None and hasattr(stream, 'close'):
                try:
                    stream.close()
                    print(f"Closed OpenAI stream for request {request_id}")
                except Exception as close_err:
                    print(f"Error closing stream for request {request_id}: {close_err}")
            # Ensure images are cleaned up even if there was an error
            if has_images:
                try:
                    cleanup_uploads_directory()
                    print(f"Cleaned up {len(image_files)} images from uploads directory after error/cancellation")
                except Exception as cleanup_err:
                    print(f"Error during image cleanup: {cleanup_err}")

    return StreamingResponse(
        stream_generator(),
        media_type="text/plain"
    )


@app.post("/api/extract-graphs")
async def extract_graphs(graph_req: GraphRequest):
    """
    Extract graphable equations from a message and send them to the Desmos API
    """
    try:
        # Extract graphs from the message using regex
        graph_pattern = r"```graph\n([\s\S]*?)\n```"
        matches = re.findall(graph_pattern, graph_req.content)

        if not matches:
            return {"success": False, "message": "No graphs found in the message", "graphs": []}

        # Process all matches and collect all graphs
        all_graphs = []

        for match in matches:
            try:
                # Parse the JSON data from this match
                parsed_data = json.loads(match)

                # Handle both array and single object formats
                if isinstance(parsed_data, list):
                    all_graphs.extend(parsed_data)
                else:
                    all_graphs.append(parsed_data)
            except json.JSONDecodeError as e:
                print(f"Error parsing graph block: {e}")
                # Continue with other blocks even if one fails

        if not all_graphs:
            return {"success": False, "message": "No valid graph data found in the message", "graphs": []}

        # Send graphs to the Desmos API
        graphs_sent = 0
        async with httpx.AsyncClient() as client:
            for graph in all_graphs:
                try:
                    response = await client.post(
                        "http://localhost:8001/equations/",
                        json=graph
                    )

                    if response.status_code == 200:
                        graphs_sent += 1
                    else:
                        print(f"Error sending graph to Desmos API: {response.status_code} - {response.text}")
                except Exception as e:
                    print(f"Error sending individual graph to Desmos API: {str(e)}")

        return {
            "success": True,
            "message": f"Successfully sent {graphs_sent} graphs to Desmos",
            "graphs": all_graphs
        }

    except json.JSONDecodeError as e:
        print(f"JSON parsing error: {e}")
        return {"success": False, "message": f"Invalid graph data format: {str(e)}", "graphs": []}
    except Exception as e:
        print(f"Error extracting graphs: {str(e)}")
        return {"success": False, "message": f"Error processing graphs: {str(e)}", "graphs": []}


@app.post("/stop")
async def stop_generation():
    """
    Signals all active streaming generations to stop.
    Note: This flags them; the generator checks the flag.
    """
    stopped_count = 0
    active_ids = list(active_generations.keys())
    print(f"Received stop request. Attempting to stop {len(active_ids)} generations.")
    for req_id in active_ids:
        if req_id in active_generations:
            active_generations[req_id]["cancelled"] = True
            stopped_count += 1
            print(f"Flagged request {req_id} for cancellation.")

    return {"message": f"Cancellation signal sent to {stopped_count} active generation(s)."}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "api": "online"}


if __name__ == "__main__":
    import uvicorn

    port = 8000
    print(f"Starting server on http://0.0.0.0:{port}")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=True, workers=1)
