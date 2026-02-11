# avatar/backend/app/main.py
# Main FastAPI application for Theorem Health Avatar Backend

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import routes
from app.routes import heygen, stream

# ============================================================================
# FASTAPI APP INITIALIZATION
# ============================================================================

app = FastAPI(
    title="Theorem Health Avatar API",
    description="Interactive avatar backend for clinic and rehab support",
    version="1.0.0"
)

# ============================================================================
# CORS MIDDLEWARE
# ============================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", "*")
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# INCLUDE ROUTERS
# ============================================================================

app.include_router(heygen.router, prefix="/api/heygen", tags=["HeyGen"])
app.include_router(stream.router, prefix="/api/stream", tags=["Streaming"])

# ============================================================================
# ROOT ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    return {
        "service": "theorem-avatar-backend",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health():
    required_vars = ["HEYGEN_API_KEY", "BRAIN_API_URL"]
    missing = [var for var in required_vars if not os.getenv(var)]
    
    if missing:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "missing_env_vars": missing
            }
        )
    
    return {
        "status": "healthy",
        "brain_url": os.getenv("BRAIN_API_URL"),
        "heygen_configured": bool(os.getenv("HEYGEN_API_KEY")),
        "streaming_enabled": os.getenv("ENABLE_STREAMING", "false") == "true"
    }

# ============================================================================
# STARTUP/SHUTDOWN
# ============================================================================

@app.on_event("startup")
async def startup():
    print("🚀 Theorem Avatar Backend started")
    print(f"   Brain API: {os.getenv('BRAIN_API_URL', 'NOT SET')}")
    print(f"   Streaming: {os.getenv('ENABLE_STREAMING', 'false')}")

@app.on_event("shutdown")
async def shutdown():
    print("👋 Theorem Avatar Backend stopped")
