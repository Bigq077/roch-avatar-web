# avatar/backend/app/routes/stream.py
# Streaming routes (for future streaming implementation)

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import json
import os

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class Message(BaseModel):
    role: str
    content: str

class StreamRequest(BaseModel):
    mode: str
    message: str
    history: Optional[List[Message]] = []
    session_id: Optional[str] = None

# ============================================================================
# STREAMING CHAT (SSE)
# ============================================================================

@router.post("/chat")
async def stream_chat(request: StreamRequest):
    """
    Streaming chat endpoint using Server-Sent Events (SSE).
    
    This will be used when ENABLE_STREAMING=true.
    Streams sentences as they're generated for lower latency.
    """
    
    async def generate():
        """Generator that yields SSE events"""
        
        # Check if brain streaming is enabled
        brain_url = os.getenv("BRAIN_API_URL")
        streaming_enabled = os.getenv("ENABLE_STREAMING", "false").lower() == "true"
        
        if not streaming_enabled or not brain_url:
            # Fallback: send error
            yield f"data: {json.dumps({'error': 'Streaming not enabled'})}\n\n"
            return
        
        try:
            # Import streaming function from heygen routes
            from app.routes.heygen import call_brain_api_stream
            
            # Stream sentences from brain API
            async for sentence in call_brain_api_stream(
                mode=request.mode,
                message=request.message,
                history=request.history
            ):
                # Send each sentence as SSE event
                event_data = {
                    "type": "sentence",
                    "text": sentence
                }
                yield f"data: {json.dumps(event_data)}\n\n"
            
            # Send completion event
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

# ============================================================================
# HEALTH CHECK
# ============================================================================

@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "streaming_enabled": os.getenv("ENABLE_STREAMING", "false") == "true"
    }
