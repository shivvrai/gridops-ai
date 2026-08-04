# AI Workflow & Leverage

This document details two critical aspects of AI utilization in this submission:
1. **How AI was leveraged to build the system** (engineering workflow, delegation boundaries, failures, and code authorship).
2. **Where AI belongs inside the product** (architectural placement, prompt design, token budget, and fallback mechanics).

---

## Part 1: Using AI to Build the System (Engineering Workflow)

### AI Tools Utilized
- **Interactive Coding Assistant (Claude / Gemini / Cursor)**: Employed heavily as an intelligent co-pilot for fast prototyping, refactoring, boilerplate generation, and syntax discovery across FastAPI and React / Leaflet.

### Delegation Boundaries: What I Delegated vs. Wrote Personally
Drawing clear boundaries between human domain cognition and mechanical generation was vital for delivering a dependable system within the time budget:

- **What I Delegated to AI (Wholesale / Prompted):**
  - **Scaffolding & Boilerplate:** Initial project directory setup, FastAPI boilerplate endpoints, Pydantic/SQLAlchemy schema synchronization, and CORS middleware configurations.
  - **UI Visual Design & CSS Tokens:** Generating clean, modern glassmorphic styling tokens, responsive layouts, flex grid arrangements, and interactive button micro-animations in `index.css`.
  - **Synthetic Data Generation:** Drafting the mathematical distribution logic in `generator.py` to populate ~3,800 poles across feeders and distribution transformers with realistic metadata (wards, pin codes, RSSI jitter).
  - **Test Assertions:** Structuring repetitive unit test boilerplates in `test_localization.py` for edge-case validation.

- **What I Personally Authored, Architected & Supervised:**
  - **The 4-Stage Localization Engine (`localization.py`):** The core algorithmic invariants, live/dark tree boundary traversal, sequence-based deduplication, and corroboration short-circuit rules.
  - **Missing Topology Inference Logic (`topology.py`):** Designing the adaptive nearest-neighbor threshold (mean + 3σ) rooted at distribution transformers, avoiding naive global distance heuristics.
  - **Ticket State Machine Invariants (`ticket_manager.py`):** Enforcing strict physical reality checks (e.g., rejecting premature human "resolved" claims if telemetry indicates child poles remain dark).
  - **Architectural Trade-offs & Concurrency:** Decoupling per-message timer threads in favor of a clean, lock-free 10-second epoch background sweep over dirty DT trees.

### Where the AI Failed, Was Misleading, or Had to be Thrown Away
During development, AI assistants confidently generated several deficient or bug-prone solutions that required direct human intervention and rewrites:

1. **Hallucinated Leaflet View Remounting & Size Rendering:**
   - *The Error:* When implementing view switching between the interactive Canvas graph and the geographical Leaflet Map, the AI suggested simple CSS display toggles and reactivity via props on `<MapContainer>`. 
   - *The Fix:* This caused Leaflet tile rendering glitches (grey unrendered boxes) because Leaflet calculates container layout on mount and misses resize transitions when hidden. I discarded the AI's naive approach and implemented an explicit `MapReadyHandler` hook utilizing delayed `map.invalidateSize()` calls alongside forcing clean React component remounts via a specific `key` prop in `App.jsx`.

2. **Naive O(N²) Quadratic Tree Inference for Missing Topology:**
   - *The Error:* When prompted to build a tree structure for the 60% of DTs missing line ordering, an initial LLM generation produced an all-pairs greedy Euclidean distance loop across all thousands of poles in the division without constraining boundaries by DT assigned IDs.
   - *The Fix:* This caused severe startup computation lag during initial seeding and accidentally formed cross-feeder spurious bridges. I replaced the algorithm with a localized, DT-rooted greedy Spanning Tree growth restricted to nodes sharing the same `dt_id`, incorporating angular penalty guards to prevent unnatural line doubling-back.

3. **Over-Eager Alerting ("Crying Wolf"):**
   - *The Error:* When generating event routing logic in `telemetry.py`, the AI defaulted to creating a database fault ticket instantly upon receiving any single `power_lost` event.
   - *The Fix:* This violated the primary real-world requirement: during a severe monsoon storm, a single snapped wire creates dozens of synchronous dark telemetry reports. I scrapped real-time per-message ticket generation and decoupled the ingest pipeline from ticket creation, channeling updates into an authoritative in-memory status cache processed in structured 10-second sweeps.

### AI-Generated Code Estimation
- **Overall Estimated % AI-Authored / Assisted Code:** ~65% by volume. 
- *Breakdown:* UI components, CSS styling, synthetic seeding generators, and schema configurations are heavily (~80-90%) AI-accelerated. In contrast, the domain-critical modules (`localization.py`, `topology.py`, `ticket_manager.py`, and asynchronous synchronization) represent tightly supervised human architecture with iterative refinement (~30% AI assistance primarily for syntax formatting and logging expressions).

### Example of Effective Constraint-First Prompting
Instead of open-ended code generation requests, my most effective AI interactions utilized rigid constraint architectures:
```text
"We are designing the ticket state machine for power fault localization.
Write an async class TicketManager in ticket_manager.py with these strict invariants:
1. Valid lifecycle transitions MUST follow exactly: detected -> acknowledged -> crew_assigned -> resolved -> verified -> closed.
2. If an operator attempts to transition a ticket to 'resolved', you MUST query the LocalizationEngine to check if ANY affected pole in the boundary is still marked 'confirmed_dark'. If so, raise a ValueError rejecting the transition.
3. Transitioning to 'verified' is SYSTEM-ONLY; no manual human endpoint can invoke this state directly. It is triggered solely when our background sweep observes that all affected poles under the ticket span are energized."
```

---

## Part 2: AI Inside the Product (Feature & Architectural Placement)

### Feature: "Explain This Ticket"

#### Why This Placement (And Why Nowhere Else)
An LLM earns its keep at the human-computer UI interface: bridging raw technical data (coordinate bounds, firmware version quirks, confidence heuristics, sequence numbers) into intuitive, plain-language actionable context for a non-engineer control room operator working at 2:00 AM.

Conversely, **an LLM does NOT belong in the fault localization pipeline itself.** Graph traversal over low-tension electrical lines is deterministic, O(V+E) instant, mathematically rigorous, free of recurring API costs, and completely testable. Replacing a clean graph BFS with an LLM prompt would be an architectural anti-pattern with unquantifiable hallucinations and unacceptable operational latency.

#### How It Works
1. Operator clicks **"🤖 Explain This Ticket"** on the ticket detail pane.
2. Backend API retrieves the ticket's structured snapshot (boundary endpoints, confidence factors, affected households, topology provenance).
3. Constructs a concise prompt directed to OpenAI's `GPT-4o-mini`.
4. Returns a short, plain-language 3-sentence operational brief directly to the console.

#### Prompt Design & Output Formatting
- **Tone:** Direct, authoritative, zero conversational fluff.
- **Constraints:** Explicitly prohibited from using bullet points or markdown tables—operators scanning a screen during a storm crisis read dense paragraphs faster without scrolling overhead.
- **Content Focus:** Explains *why* confidence might be marked LOW (e.g., highlighting that topology was mathematically inferred via GPS rather than field-surveyed, or noting latency delays due to legacy fw1.2 silent sensors).

#### Fallback & High-Availability Degradation
If the LLM is unavailable (missing API key, rate limits, network timeouts, or upstream vendor outage):
- The API transparently degrades to a **Structured Template Fallback**, constructing a deterministic summary directly from ticket string interpolation.
- The UI displays `"📋 Structured Summary"` rather than `"🤖 AI Explanation"`.
- Zero degradation to core network operations—ingestion, localization sweeps, and dispatch workflows execute entirely independent of third-party AI service reachability.

#### Economics & Token Budget
- **Model:** `gpt-4o-mini` (optimally sized for rapid text synthesis at exceptional cost efficiency: ~$0.15/1M input tokens, ~$0.60/1M output tokens).
- **Average Per-Request Usage:**
  - System Prompt & Schema Context: ~250 tokens
  - Dynamic Ticket Payload: ~150 tokens
  - Generated Explanation: ~150 tokens
  - **Total:** ~550 tokens per interaction.
- **Cost Analysis:** At approximately **$0.00015 per call**, generating 1,000 on-demand ticket explanations during a month of monsoon storms costs less than $0.20 total—an insignificant operational expenditure for tremendous operator time savings.
