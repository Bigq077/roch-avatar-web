# avatar/backend/app/routes/heygen.py
# HeyGen Interactive Avatar Routes

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import os
import re
import json

router = APIRouter()

# ============================================================================
# MODELS
# ============================================================================

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    mode: str  # "clinic" or "rehab"
    message: str
    history: Optional[List[Message]] = []
    session_id: Optional[str] = None

class ChatResponse(BaseModel):
    response: str
    chunks: List[str]
    safety: Dict[str, bool]
    meta: Dict[str, Any]

class HeyGenSessionRequest(BaseModel):
    avatar_id: str
    mode: str

class HeyGenSessionResponse(BaseModel):
    session_id: str
    ice_servers: Optional[List[Dict[str, Any]]] = []
    sdp: Optional[str] = ""

# ============================================================================
# RESPONSE CACHING (for instant common answers)
# ============================================================================

CACHED_RESPONSES = {
    "pricing_physio": "Our physiotherapy sessions are £75 for both assessments and follow-ups. Each session is 50 minutes long. If we use specialist equipment like shockwave therapy or Class IV laser, there's an additional £45 surcharge. Remedial rehabilitation sessions are £65, and prescribing is £12.50.",
    
    "hours": "We're open Monday to Friday, 8:30am to 9:00pm. We're closed on weekends and all UK bank holidays.",
    
    "locations": "We have two locations. Our Alcester clinic is at Kinwarton Road, Alcester, B49 6AD. Our Redditch clinic is at 51 Bromsgrove Road, Redditch, B97 4RH.",
    
    "cancellation": "We have a 24-hour cancellation policy. If you cancel with less than 24 hours notice, the full fee will be charged.",
    
    "insurance": "We operate on a self-pay model. You pay for your session upfront, and you're welcome to claim it back through your insurance provider yourself. We don't work directly with Bupa, but many of our patients successfully claim back from other insurers."
}

def check_for_cached_response(message: str) -> Optional[str]:
    """Check if this is a common question with cached answer"""
    msg_lower = message.lower()
    
    if any(word in msg_lower for word in ["price", "cost", "how much", "fee"]):
        return CACHED_RESPONSES["pricing_physio"]
    
    if any(word in msg_lower for word in ["hours", "open", "when are you", "opening times"]):
        return CACHED_RESPONSES["hours"]
    
    if any(word in msg_lower for word in ["location", "address", "where are you", "where is"]):
        return CACHED_RESPONSES["locations"]
    
    if any(word in msg_lower for word in ["cancel", "cancellation", "reschedule"]):
        return CACHED_RESPONSES["cancellation"]
    
    if any(word in msg_lower for word in ["insurance", "bupa", "claim back"]):
        return CACHED_RESPONSES["insurance"]
    
    return None

# ============================================================================
# BRAIN API CLIENT (NON-STREAMING)
# ============================================================================

async def call_brain_api(
    mode: str,
    message: str,
    history: List[Message] = [],
    session_id: Optional[str] = None
) -> Dict[str, Any]:
    """Call brain API - non-streaming version"""
    
    brain_url = os.getenv("BRAIN_API_URL")
    
    if not brain_url:
        raise HTTPException(status_code=500, detail="BRAIN_API_URL not set")
    
    payload = {
        "mode": mode,
        "message": message,
        "history": [{"role": m.role, "content": m.content} for m in history],
        "session_id": session_id
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{brain_url}/api/brain/query",
                json=payload
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Brain API error: {str(e)}")

# ============================================================================
# BRAIN API CLIENT (STREAMING)
# ============================================================================

async def call_brain_api_stream(
    mode: str,
    message: str,
    history: List[Message] = []
):
    """Call brain API - streaming version (yields sentences as they arrive)"""
    
    brain_url = os.getenv("BRAIN_API_URL")
    
    if not brain_url:
        raise HTTPException(status_code=500, detail="BRAIN_API_URL not set")
    
    payload = {
        "mode": mode,
        "message": message,
        "history": [{"role": m.role, "content": m.content} for m in history]
    }
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{brain_url}/api/brain/stream",
                json=payload
            ) as response:
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = json.loads(line[6:])
                        if "text" in data:
                            yield data["text"]
                        elif data.get("done"):
                            break
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Brain stream error: {str(e)}")

# ============================================================================
# OPENAI FALLBACK
# ============================================================================

async def fallback_openai(mode: str, message: str, history: List[Message] = []) -> str:
    """Fallback to OpenAI when brain unavailable"""
    import openai
    
    try:
        with open(f"app/prompts/{mode}_avatar.txt", 'r') as f:
            system_prompt = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"Prompt file not found: {mode}_avatar.txt")
    
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": message})
    
    try:
        client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),  # Fast model
            messages=messages,
            temperature=0.7,
            max_tokens=300  # Shorter = faster
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")

# ============================================================================
# TEXT CHUNKING
# ============================================================================

def chunk_into_sentences(text: str) -> List[str]:
    """Split text into sentence chunks for smooth delivery"""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk) + len(sentence) < 120:  # Reduced for faster delivery
            current_chunk += sentence + " "
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + " "
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks

# ============================================================================
# MAIN CHAT ENDPOINT
# ============================================================================

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Main chat endpoint - handles both cached and dynamic responses"""
    
    try:
        # Check cache first (instant response)
        cached = check_for_cached_response(request.message)
        if cached:
            return ChatResponse(
                response=cached,
                chunks=chunk_into_sentences(cached),
                safety={"is_emergency": False, "refuse_diagnosis": False},
                meta={"source": "cache", "latency_ms": 0}
            )
        
        # Determine if we use brain or fallback
        brain_url = os.getenv("BRAIN_API_URL")
        use_fallback = os.getenv("USE_OPENAI_FALLBACK", "false").lower() == "true"
        
        if brain_url and not use_fallback:
            # Call brain API
            brain_response = await call_brain_api(
                mode=request.mode,
                message=request.message,
                history=request.history,
                session_id=request.session_id
            )
            
            response_text = brain_response["response"]
            safety = brain_response.get("safety", {
                "is_emergency": False,
                "refuse_diagnosis": False
            })
            meta = brain_response.get("meta", {})
        else:
            # OpenAI fallback
            response_text = await fallback_openai(
                mode=request.mode,
                message=request.message,
                history=request.history
            )
            safety = {"is_emergency": False, "refuse_diagnosis": False}
            meta = {"source": "openai_fallback"}
        
        # Chunk for smooth delivery
        chunks = chunk_into_sentences(response_text)
        
        return ChatResponse(
            response=response_text,
            chunks=chunks,
            safety=safety,
            meta=meta
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {str(e)}")

# ============================================================================
# HEYGEN SESSION MANAGEMENT
# ============================================================================

@router.post("/session/start")
async def start_session(request: HeyGenSessionRequest):
    """Return a HeyGen session token for the browser SDK."""

    api_key = os.getenv("HEYGEN_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="HEYGEN_API_KEY not set")

    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.heygen.com/v1/streaming.create_token",
                headers=headers,
                json={},
            )
            response.raise_for_status()
            data = response.json()

        token = (data.get("data") or {}).get("token")
        if not token:
            raise HTTPException(status_code=502, detail=f"HeyGen token missing: {data}")

        return {"token": token}

    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"HeyGen error: {str(e)}")

    

# ============================================================================
# HEALTH CHECK
# ============================================================================

@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "heygen_configured": bool(os.getenv("HEYGEN_API_KEY")),
        "brain_configured": bool(os.getenv("BRAIN_API_URL")),
        "cache_enabled": True,
        "streaming_available": os.getenv("ENABLE_STREAMING", "false") == "true"
    }
