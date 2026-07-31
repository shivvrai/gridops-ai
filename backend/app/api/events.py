"""Server-Sent Events (SSE) endpoint for real-time push to the operator console."""
import asyncio
import json
import logging
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])

# Global event queue — subscribers get events pushed to them
_subscribers: list[asyncio.Queue] = []


async def broadcast_event(event_type: str, data: dict):
    """Broadcast an event to all SSE subscribers."""
    message = json.dumps({"type": event_type, "data": data}, default=str)
    dead = []
    for i, queue in enumerate(_subscribers):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            dead.append(i)
    # Remove dead subscribers
    for i in reversed(dead):
        _subscribers.pop(i)


@router.get("/stream")
async def event_stream():
    """SSE endpoint for real-time updates. Used by the operator console."""
    queue = asyncio.Queue(maxsize=100)
    _subscribers.append(queue)

    async def generate():
        try:
            # Send initial connection event
            yield {
                "event": "connected",
                "data": json.dumps({"message": "Connected to fault localization system"}),
            }
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=30)
                    yield {
                        "event": "update",
                        "data": message,
                    }
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield {
                        "event": "ping",
                        "data": json.dumps({"type": "keepalive"}),
                    }
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _subscribers:
                _subscribers.remove(queue)

    return EventSourceResponse(generate())
