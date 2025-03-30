from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Set
import json
import uuid
import asyncio
from datetime import datetime
import logging
import subprocess
import os
import signal

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("desmos-api")

# Create the FastAPI app
app = FastAPI(title="Desmos Equations API")

# Add CORS middleware to allow cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Data model for equations
class EquationCreate(BaseModel):
    expression: str
    label: Optional[str] = None
    color: Optional[str] = None


class Equation(EquationCreate):
    id: str
    timestamp: str


# In-memory storage for equations
equations: Dict[str, Equation] = {}


# Store active WebSocket connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"New WebSocket connection. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket disconnected. Remaining connections: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        """Send a message to all connected clients"""
        logger.info(f"Broadcasting message type: {message.get('type')} to {len(self.active_connections)} clients")
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error sending message: {e}")


manager = ConnectionManager()


# Routes
@app.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {"message": "Desmos Equations API is running"}


@app.post("/equations/", response_model=Equation)
async def create_equation(equation: EquationCreate):
    """Add a new equation from the chatbot to be displayed in Desmos"""
    logger.info(f"Received equation: {equation.expression}")

    # Validate input
    if not equation.expression or len(equation.expression.strip()) == 0:
        logger.error("Empty equation received")
        raise HTTPException(status_code=400, detail="Expression cannot be empty")

    # Create equation record
    equation_id = str(uuid.uuid4())
    timestamp = datetime.now().isoformat()

    try:
        # Clean up the expression if needed
        cleaned_expression = equation.expression.strip()
        logger.info(f"Processed expression: {cleaned_expression}")

        new_equation = Equation(
            id=equation_id,
            timestamp=timestamp,
            expression=cleaned_expression,
            label=equation.label or f"Equation {len(equations) + 1}",
            color=equation.color or "#2d70b3"
        )

        equations[equation_id] = new_equation

        # Broadcast the new equation to all connected Desmos viewers
        await manager.broadcast({
            "type": "new_equation",
            "equation": new_equation.dict()
        })

        logger.info(f"Successfully added equation with ID: {equation_id}")
        return new_equation

    except Exception as e:
        logger.error(f"Error creating equation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing equation: {str(e)}")


@app.get("/equations/", response_model=List[Equation])
async def get_equations():
    """Get all equations to initialize the Desmos viewer"""
    logger.info(f"Returning {len(equations)} equations")
    return list(equations.values())


@app.get("/equations/{equation_id}", response_model=Equation)
async def get_equation(equation_id: str):
    """Get a specific equation by ID"""
    if equation_id not in equations:
        logger.warning(f"Equation not found: {equation_id}")
        raise HTTPException(status_code=404, detail="Equation not found")

    logger.info(f"Retrieved equation: {equation_id}")
    return equations[equation_id]


@app.delete("/equations/{equation_id}")
async def delete_equation(equation_id: str):
    """Delete a specific equation by ID"""
    if equation_id not in equations:
        logger.warning(f"Attempt to delete non-existent equation: {equation_id}")
        raise HTTPException(status_code=404, detail="Equation not found")

    deleted_equation = equations.pop(equation_id)

    # Broadcast the deletion to all connected Desmos viewers
    await manager.broadcast({
        "type": "delete_equation",
        "equation_id": equation_id
    })

    logger.info(f"Deleted equation: {equation_id}")
    return {"message": f"Equation {equation_id} deleted"}


@app.delete("/equations/")
async def delete_all_equations():
    """Delete all equations"""
    count = len(equations)
    equations.clear()

    # Broadcast the clear action to all connected Desmos viewers
    await manager.broadcast({
        "type": "clear_equations"
    })

    logger.info(f"Cleared {count} equations")
    return {"message": f"All {count} equations deleted"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates to the Desmos viewer"""
    await manager.connect(websocket)
    try:
        # Send all existing equations to the new connection
        await websocket.send_json({
            "type": "init",
            "equations": [eq.dict() for eq in equations.values()]
        })

        # Keep the connection alive and handle messages
        while True:
            # Wait for messages from the client (could be used for interactive features)
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                logger.info(f"Received WebSocket message: {message.get('type', 'unknown')}")
                # Handle any client messages here if needed
                # For now, we just echo back
                await websocket.send_json({"type": "echo", "data": message})
            except json.JSONDecodeError:
                logger.error("Received invalid JSON over WebSocket")
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
        manager.disconnect(websocket)


def kill_port(port):
    try:
        # Get the process ID(s) using the specified port
        proc = subprocess.Popen(["lsof", "-t", "-i", f":{port}"], stdout=subprocess.PIPE)
        out, _ = proc.communicate()
        pids = out.splitlines()
        for pid in pids:
            os.kill(int(pid), signal.SIGKILL)
            print(f"Killed process {pid.decode()} on port {port}")
    except Exception as e:
        print(f"Error killing process on port {port}: {e}")


if __name__ == "__main__":
    kill_port(8001)

    import uvicorn

    logger.info("Starting Desmos Equations API server")
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
