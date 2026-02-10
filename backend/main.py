import os
import json
import asyncio
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

app = FastAPI()

HEYGEN_API_KEY = os.getenv("HEYGEN_API_KEY", "")

# 1) Your clinic avatar prompt (keep short first sentence for speed)
SYSTEM_CLINIC = """You are the website-based clinic avatar for Theorem Health & Wellness.
Rules:
- informational only, no diagnosis, no treatment changes
- if emergency symptoms: "I can’t help with emergencies. Please call 999 or go to A&E immediately."
- Start with ONE short sentence (max 12 words). Then explain.
Tone: calm, professional.
Only use clinic knowledge. If unknown, say you don't have that information."""

# --------------------------
# Endpoint A: create session
# --------------------------
@app.post("/api/heygen/session")
async def create_heygen_session():
    if not HEYGEN_API_KEY:
        return JSONResponse({"error": "Missing HEYGEN_API_KEY"}, status_code=500)

    # NOTE: The exact endpoint/payload depends on the HeyGen SDK/API version you use.
    # The SDK handles this nicely client-side, but the key must remain server-side.
    #
    # Recommended approach:
    # - Create a token/session on server
    # - Return session params to client
    #
    # For your build: implement per HeyGen Streaming API docs for session creation.
    # (Keep this endpoint as the place where HEYGEN_API_KEY is used.)
    #
    # If you're using the @heygen/streaming-avatar SDK only on the frontend,
    # then instead you return a short-lived "access token" (generated server-side).

    async with httpx.AsyncClient(timeout=30) as client:
        # Example placeholder; replace with HeyGen’s actual session endpoint
        # from their Streaming API / LiveAvatar docs.
        # docs: Streaming Avatar SDK + Streaming API :contentReference[oaicite:3]{index=3}
        res = await client.post(
            "https://api.heygen.com/v1/streaming.new",  # example name seen in changelog
            headers={"X-Api-Key": HEYGEN_API_KEY, "Content-Type": "application/json"},
            json={
                "quality": "low",  # lower quality reduces latency
                # choose your avatar_id / voice settings per your HeyGen config
            },
        )

    if res.status_code >= 300:
        return JSONResponse({"error": res.text}, status_code=500)

    return JSONResponse(res.json())

# ------------------------------------
# Endpoint B: stream LLM output (SSE)
# ------------------------------------
@app.get("/api/avatar/stream")
async def avatar_stream(
    mode: str = Query("clinic"),
    message: str = Query(..., min_length=1)
):
    async def event_gen():
        # Replace this with YOUR existing LLM streaming logic.
        # The only requirement: yield small chunks quickly.
        #
        # PSEUDO: here we simulate streaming tokens.
        answer = (
            "Thanks — I can help with that. "
            "At Theorem Health & Wellness we offer 50-minute physiotherapy sessions, "
            "and we typically start with an assessment so we understand your situation before anything else. "
            "If you'd like, booking an appointment is the best next step."
        )

        # Stream as "data: <text>\n\n"
        for token in answer.split(" "):
            yield f"data: {token} \n\n"
            await asyncio.sleep(0.03)

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")

