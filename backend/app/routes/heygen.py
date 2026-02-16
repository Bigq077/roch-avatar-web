# avatar/backend/app/routes/heygen.py
# LiveAvatar CUSTOM Mode Integration

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import httpx
import os
import re

router = APIRouter()

# LiveAvatar API base
LIVEAVATAR_API_URL = "https://api.liveavatar.com/v1"

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

class SessionStartRequest(BaseModel):
    mode: str  # "clinic" or "rehab"
    avatar_id: str

class SessionStartResponse(BaseModel):
    session_id: str
    session_token: str
    room_url: str
    room_token: str

# ============================================================================
# CACHED RESPONSES (instant 0ms latency)
# ============================================================================

CACHED_RESPONSES = {
    "pricing": "Our physiotherapy sessions are £75 for both assessments and follow-ups. Each session is 50 minutes. If we use specialist equipment like shockwave therapy or Class IV laser, there's an additional £45 surcharge. Remedial rehabilitation sessions are £65, and prescribing is £12.50.",
    "hours": "We're open Monday to Friday, 8:30am to 9:00pm. We're closed on weekends and all UK bank holidays.",
    "locations": "We have two locations. Our Alcester clinic is at Kinwarton Road, Alcester, B49 6AD. Our Redditch clinic is at 51 Bromsgrove Road, Redditch, B97 4RH.",
    "cancellation": "We have a 24-hour cancellation policy. If you cancel with less than 24 hours notice, the full fee will be charged.",
    "insurance": "We operate on a self-pay model. You pay upfront and you're welcome to claim back from your insurance. We don't work directly with Bupa, but many patients successfully claim from other insurers."
}

def check_cached_response(message: str) -> Optional[str]:
    """Check for instant cached answers"""
    msg_lower = message.lower()
    
    if any(word in msg_lower for word in ["price", "cost", "how much", "fee"]):
        return CACHED_RESPONSES["pricing"]
    if any(word in msg_lower for word in ["hours", "open", "when are you", "opening"]):
        return CACHED_RESPONSES["hours"]
    if any(word in msg_lower for word in ["location", "address", "where"]):
        return CACHED_RESPONSES["locations"]
    if any(word in msg_lower for word in ["cancel", "reschedule"]):
        return CACHED_RESPONSES["cancellation"]
    if any(word in msg_lower for word in ["insurance", "bupa", "claim"]):
        return CACHED_RESPONSES["insurance"]
    
    return None

# ============================================================================
# BRAIN API CLIENT
# ============================================================================

async def call_brain_api(
    mode: str,
    message: str,
    history: List[Message] = [],
    session_id: Optional[str] = None
) -> Dict[str, Any]:
    """Call your brain API on Render"""
    
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
# OPENAI FALLBACK
# ============================================================================

async def fallback_openai(mode: str, message: str, history: List[Message] = []) -> str:
    """Fallback to OpenAI when brain unavailable"""
    import openai
    
    try:
        with open(f"app/prompts/{mode}_avatar.txt", 'r') as f:
            system_prompt = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"Prompt not found: {mode}_avatar.txt")
    
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": message})
    
    try:
        client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=messages,
            temperature=0.7,
            max_tokens=300
        )
        return response.choices[0].message.content
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {str(e)}")

# ============================================================================
# TEXT CHUNKING
# ============================================================================

def chunk_into_sentences(text: str) -> List[str]:
    """Split text into sentence chunks"""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        if len(current_chunk) + len(sentence) < 120:
            current_chunk += sentence + " "
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = sentence + " "
    
    if current_chunk:
        chunks.append(current_chunk.strip())
    
    return chunks

# ============================================================================
# CHAT ENDPOINT (for brain responses)
# ============================================================================

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Get response from brain for user message.
    Frontend will send this text to LiveAvatar to speak.
    """
    
    try:
        # Check cache first
        cached = check_cached_response(request.message)
        if cached:
            return ChatResponse(
                response=cached,
                chunks=chunk_into_sentences(cached),
                safety={"is_emergency": False, "refuse_diagnosis": False},
                meta={"source": "cache", "latency_ms": 0}
            )
        
        # Call brain or fallback
        brain_url = os.getenv("BRAIN_API_URL")
        use_fallback = os.getenv("USE_OPENAI_FALLBACK", "false").lower() == "true"
        
        if brain_url and not use_fallback:
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
            response_text = await fallback_openai(
                mode=request.mode,
                message=request.message,
                history=request.history
            )
            safety = {"is_emergency": False, "refuse_diagnosis": False}
            meta = {"source": "openai_fallback"}
        
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
# LIVEAVATAR SESSION MANAGEMENT
# ============================================================================

@router.post("/session/start", response_model=SessionStartResponse)
async def start_liveavatar_session(request: SessionStartRequest):
    """
    Start LiveAvatar CUSTOM mode session.
    Returns session token and LiveKit room details.
    """
    
    api_key = os.getenv("LIVEAVATAR_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="LIVEAVATAR_API_KEY not set")
    
    # Step 1: Create session token
    headers = {
        "X-API-KEY": api_key,
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    # Get voice ID based on mode
    voice_id = os.getenv(
        "ELEVENLABS_VOICE_ID_CLINIC" if request.mode == "clinic" 
        else "ELEVENLABS_VOICE_ID_REHAB"
    )
    
    token_payload = {
        "mode": "CUSTOM",  # Important!
        "avatar_id": request.avatar_id,
        "avatar_persona": {
            "voice_id": voice_id,
            "language": "en"
        }
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Create token
            token_response = await client.post(
                f"{LIVEAVATAR_API_URL}/sessions/token",
                headers=headers,
                json=token_payload
            )
            token_response.raise_for_status()
            token_data = token_response.json()
            
            session_id = token_data["session_id"]
            session_token = token_data["session_token"]
            
            # Step 2: Start session
            start_headers = {
                "Authorization": f"Bearer {session_token}",
                "Accept": "application/json"
            }
            
            start_response = await client.post(
                f"{LIVEAVATAR_API_URL}/sessions/start",
                headers=start_headers
            )
            start_response.raise_for_status()
            start_data = start_response.json()
            
            return SessionStartResponse(
                session_id=session_id,
                session_token=session_token,
                room_url=start_data.get("url", ""),
                room_token=start_data.get("token", "")
            )
            
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"LiveAvatar error: {str(e)}")

@router.post("/session/stop")
async def stop_liveavatar_session(session_id: str):
    """Stop LiveAvatar session"""
    
    api_key = os.getenv("LIVEAVATAR_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="LIVEAVATAR_API_KEY not set")
    
    headers = {
        "X-API-KEY": api_key,
        "Accept": "application/json"
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{LIVEAVATAR_API_URL}/sessions/{session_id}/stop",
                headers=headers
            )
            response.raise_for_status()
            return {"status": "stopped", "session_id": session_id}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"LiveAvatar error: {str(e)}")

# ============================================================================
# HEALTH CHECK
# ============================================================================

@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "liveavatar_configured": bool(os.getenv("LIVEAVATAR_API_KEY")),
        "brain_configured": bool(os.getenv("BRAIN_API_URL")),
        "cache_enabled": True,
        "mode": "CUSTOM"
    }
