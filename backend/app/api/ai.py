"""AI feature: 'Explain This Ticket' — on-demand natural-language explanation."""
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.models.database import get_db
from app.models.schemas import Ticket, TicketAffectedPole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])

EXPLAIN_PROMPT = """You are a fault localization system explaining a detected power outage ticket to a control room operator who is NOT an engineer. Be concise, clear, and factual.

Given this ticket data:
- Ticket ID: {display_id}
- Fault Type: {fault_type}
- Status: {status}
- Location: Feeder {feeder_id}, DT {dt_id}
- Boundary: Live pole {boundary_live_pole} → Dark pole {boundary_dark_pole}
- Coordinates: {fault_lat}, {fault_lon}
- PIN Code: {pincode}
- Affected Poles: {affected_pole_count}
- Estimated Households: {estimated_households}
- Confidence: {confidence_label}
- Confidence Factors: {confidence_factors}
- Topology Source: {topology_source}
- Range: {is_range} ({range_description})
- Detected At: {detected_at}

Explain in 3-4 sentences:
1. What was detected and where
2. How confident the system is and why
3. How many people are affected
4. Any caveats the operator should know (inferred topology, uninstrumented gaps, etc.)

Use plain language. No technical jargon. No bullet points."""


@router.get("/explain/{display_id}")
async def explain_ticket(
    display_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a natural-language explanation of a ticket.
    Falls back to structured data if the LLM is unavailable.
    """
    # Fetch ticket
    result = await db.execute(
        select(Ticket).where(Ticket.display_id == display_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {display_id} not found")

    # Build prompt data
    prompt_data = {
        "display_id": ticket.display_id,
        "fault_type": ticket.fault_type,
        "status": ticket.status,
        "feeder_id": ticket.feeder_id,
        "dt_id": ticket.dt_id or "N/A",
        "boundary_live_pole": ticket.boundary_live_pole or "N/A (DT-level fault)",
        "boundary_dark_pole": ticket.boundary_dark_pole or "N/A (DT-level fault)",
        "fault_lat": f"{ticket.fault_lat:.6f}" if ticket.fault_lat else "N/A",
        "fault_lon": f"{ticket.fault_lon:.6f}" if ticket.fault_lon else "N/A",
        "pincode": ticket.pincode or "Unknown",
        "affected_pole_count": ticket.affected_pole_count,
        "estimated_households": ticket.estimated_households or "Unknown",
        "confidence_label": ticket.confidence_label,
        "confidence_factors": str(ticket.confidence_factors),
        "topology_source": ticket.topology_source,
        "is_range": ticket.is_range,
        "range_description": ticket.range_description or "N/A",
        "detected_at": ticket.detected_at.isoformat() if ticket.detected_at else "Unknown",
    }

    # Try LLM explanation
    if settings.openai_api_key:
        try:
            explanation = await _get_llm_explanation(prompt_data)
            return {
                "display_id": display_id,
                "explanation": explanation,
                "source": "ai",
            }
        except Exception as e:
            logger.warning(f"LLM explanation failed for {display_id}: {e}")

    # Fallback: structured explanation
    fallback = _generate_fallback_explanation(ticket)
    return {
        "display_id": display_id,
        "explanation": fallback,
        "source": "fallback",
        "note": "AI explanation unavailable. Showing structured summary.",
    }


async def _get_llm_explanation(prompt_data: dict) -> str:
    """Call OpenAI API for ticket explanation."""
    import httpx

    prompt = EXPLAIN_PROMPT.format(**prompt_data)

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.3,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


def _generate_fallback_explanation(ticket: Ticket) -> str:
    """Generate a structured fallback explanation without LLM."""
    parts = []

    if ticket.fault_type == "span":
        parts.append(
            f"A span fault was detected between pole {ticket.boundary_live_pole} (live) "
            f"and pole {ticket.boundary_dark_pole} (dark)."
        )
    elif ticket.fault_type == "dt":
        parts.append(
            f"A distribution transformer fault was detected at DT {ticket.dt_id}. "
            f"All poles under this transformer are dark."
        )
    elif ticket.fault_type == "feeder":
        parts.append(
            f"A feeder-level fault was detected on feeder {ticket.feeder_id}. "
            f"All transformers on this feeder are affected."
        )

    parts.append(
        f"{ticket.affected_pole_count} poles affected, "
        f"serving approximately {ticket.estimated_households or 'unknown'} households "
        f"in PIN {ticket.pincode or 'unknown'}."
    )

    parts.append(f"Confidence: {ticket.confidence_label}.")

    if ticket.topology_source == "inferred_gps":
        parts.append(
            "Note: The pole ordering here was inferred from GPS coordinates, "
            "not from surveyed records. The exact fault span may differ."
        )

    if ticket.is_range:
        parts.append(f"Location is a range: {ticket.range_description}")

    return " ".join(parts)
