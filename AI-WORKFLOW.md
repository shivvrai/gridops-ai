# AI Workflow

This document describes how AI/LLM features are used in the fault localization system.

## Feature: "Explain This Ticket"

### What it does
Generates a natural-language explanation of a detected fault ticket, aimed at control room operators who are NOT engineers. Explains what was detected, where, how confident the system is, and what caveats exist.

### How it works
1. Operator clicks "🤖 Explain This Ticket" on any ticket in the detail panel
2. Backend retrieves the ticket's full data (fault type, boundary poles, confidence factors, topology source, etc.)
3. Constructs a structured prompt with all relevant ticket data
4. Calls OpenAI GPT-4o-mini with `temperature=0.3` and `max_tokens=300`
5. Returns the natural-language explanation to the UI

### Prompt design
The prompt is deterministic (same ticket data → same prompt). It instructs the model to:
- Use plain language (no jargon)
- Be concise (3-4 sentences)
- Cover: what, where, confidence, caveats
- NOT use bullet points (operators scan text, not lists at 2AM)

### Fallback behavior
When the LLM is unavailable (no API key, timeout, rate limit, error):
- The endpoint returns a **structured fallback** — a template-generated summary using the same ticket data
- The UI shows "📋 Structured Summary" instead of "🤖 AI Explanation"
- No degradation to the core system — localization continues unaffected

### Design constraints
- **Strictly read-only**: The AI never influences fault detection, localization, confidence scoring, or ticket state
- **Non-blocking**: AI calls are on-demand (user-triggered), not in the detection loop
- **Graceful degradation**: System is fully functional without an API key
- **Low cost**: GPT-4o-mini at ~$0.15/1M input tokens, ~$0.60/1M output tokens; each explanation uses ~400 input + ~150 output tokens ≈ $0.00015/call

### Token budget
| Component | Tokens |
|-----------|--------|
| System prompt | ~150 |
| Ticket data | ~250 |
| Response | ~150 |
| **Total** | **~550** |

At ~$0.00015 per call, 1,000 explanations cost ~$0.15.

### When to use AI vs. structured data
- **AI explanation**: When the operator wants to understand the ticket in context — why the confidence is LOW, what "inferred topology" means practically, whether fw1.2 latency is a factor
- **Structured data**: When the operator needs specific values — pole IDs, GPS coordinates, timestamps, affected pole count

The AI supplements the structured data display; it doesn't replace it. Both are always available on the ticket detail panel.
