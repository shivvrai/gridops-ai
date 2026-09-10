# 🎙️ GridOps Presentation Script (With Embedded Cursor & Visual Cues)

> **Speaker:** Yashmit  
> **Total Duration:** 5 Minutes 20 Seconds  
> **Live App:** `http://localhost:3000`  
> 
> **How to read this script:**  
> • **`🗣️ SPEAK:`** Your exact word-for-word spoken script.  
> • **`📍 CURSOR:`** Exactly where to move or hover your mouse at that exact sentence.  
> • **`👀 WHAT TO EXPLAIN / SHOW:`** What the audience should be looking at on screen.  
> • **`🖱️ CLICK:`** When you need to click a button or tab.  

---

## ⚡ 10-Second Pre-Recording Setup
1. Open browser in full screen at **`http://localhost:3000`**.
2. Click **Simulator** tab on left $\rightarrow$ click **"Repair All Poles"** (network is 100% green).
3. Keep left sidebar open on **Tickets** or **Dashboard**.

---

### [0:00 – 0:50] Problem

🗣️ **SPEAK:**  
“Hi, I’m Yashmit, and this is **GridOps**.  

📍 **CURSOR:** Place cursor in the center of the dark canvas.  
👀 **WHAT TO EXPLAIN / SHOW:** The clean, full-screen radial network canvas with green power particles flowing.  

🗣️ **SPEAK:**  
When a fault occurs in a power distribution network, detecting that something is wrong is only the first problem. The harder problem is figuring out **where the fault actually occurred, what part of the network is affected, and how an operator should respond**.  

📍 **CURSOR:** Slowly pan cursor across the branches (from the top substation down through feeders).  
👀 **WHAT TO EXPLAIN / SHOW:** The large scale and complexity of the distribution network (~100+ poles spread across multiple feeders).  

🗣️ **SPEAK:**  
Traditional monitoring can tell you that several downstream devices have lost power, but that doesn't necessarily tell you where the actual fault is.  

📍 **CURSOR:** Circle a cluster of leaf poles at the very bottom of the canvas.  
👀 **WHAT TO EXPLAIN / SHOW:** Point out that knowing endpoints are dark does NOT reveal *where* upstream the wire snapped.  

🗣️ **SPEAK:**  
GridOps is my attempt to solve that problem through **real-time telemetry, topology-aware fault localization, and automated incident management**.  

📍 **CURSOR:** Move cursor to the left sidebar (Tickets / Stats panel).  
👀 **WHAT TO EXPLAIN / SHOW:** Show the real-time operational status (106 tracked poles, SSE stream connected, 0 active faults).  

🗣️ **SPEAK:**  
The goal is simple: turn raw grid telemetry into a localized, actionable fault incident.”

---

### [0:50 – 1:30] Core Insight

🗣️ **SPEAK:**  
“The key insight behind the system is that a radial power distribution network can be represented as a **tree graph**.  

📍 **CURSOR:** Hover directly over the purple **Substation (SS-01)** circle at the top of the canvas.  
👀 **WHAT TO EXPLAIN / SHOW:** Point out the single root node where all power originates.  

🗣️ **SPEAK:**  
The substation acts as the root. Feeders and transformers form intermediate nodes, and the downstream poles and devices form the branches.  

📍 **CURSOR:** Trace the cursor down in order:  
`Substation` $\rightarrow$ `Feeder lines` $\rightarrow$ `Distribution Transformers (DTs)` $\rightarrow$ `Poles (Leaves)`.  
👀 **WHAT TO EXPLAIN / SHOW:** The clear 3-tier hierarchy: Root $\rightarrow$ Intermediate Branches $\rightarrow$ Leaf Nodes.  

🗣️ **SPEAK:**  
Power flows outward through this topology, so when part of the network becomes de-energized, the topology gives us a very useful structure for reasoning about what happened.  

📍 **CURSOR:** Follow the moving green energy dots flowing along an edge.  
👀 **WHAT TO EXPLAIN / SHOW:** Emphasize that power flows strictly in one outward direction.  

🗣️ **SPEAK:**  
Instead of treating every sensor independently, GridOps looks at the **relationship between devices and their position in the network**.  

📍 **CURSOR:** Hover over a parent pole and its connected child pole.  
👀 **WHAT TO EXPLAIN / SHOW:** Show the connecting edge linking devices together in a parent-child relationship.  

🗣️ **SPEAK:**  
That allows the system to distinguish between an isolated sensor problem and a potentially real infrastructure fault.”

---

### [1:30 – 3:20] Live Demo

🗣️ **SPEAK:**  
“Let me show you how this works.  

I’ll start with a healthy network.  

We begin at the substation and establish the energized portion of the topology.  

**Step one is root discovery.**  

The substation is our root node, and from there we traverse the network.  

📍 **CURSOR:** Hover over **SS-01 Substation** (purple node).  
👀 **WHAT TO EXPLAIN / SHOW:** Highlight the root node as energized.  

🗣️ **SPEAK:**  
**Step two is the BFS traversal.**  

I use breadth-first traversal to propagate through the topology and determine which portions of the network remain reachable from the energized source.  

📍 **CURSOR:** Trace the green wave moving outward along the branches.  
👀 **WHAT TO EXPLAIN / SHOW:** All reachable branches are pulsating green, proving BFS reachability.  
🖱️ **CLICK:** Click the **Simulator** tab on the left sidebar.  

🗣️ **SPEAK:**  
Now I'll inject a simulated fault.  

🖱️ **CLICK:** In the Simulator tab, select **"Span Fault"** $\rightarrow$ Click **`⚡ Inject Fault`** (or click any line between two poles on canvas).  
📍 **CURSOR:** Place cursor right over the snapped line.  

🗣️ **SPEAK:**  
You can see that a downstream portion of the network is no longer receiving power.  

📍 **CURSOR:** Circle the downstream red poles.  
👀 **WHAT TO EXPLAIN / SHOW:** The snapped line turns red; child poles immediately turn red (dark), while upstream feeder poles stay green!  

🗣️ **SPEAK:**  
But this is where things get interesting.  

**Step three is outage corroboration.**  

Telemetry in a real system isn't perfect. A sensor could fail, a message could be missed, or telemetry could arrive late.  

So a single device reporting zero voltage shouldn't automatically create a grid incident.  

📍 **CURSOR:** Point to the group of contiguous dark poles.  
👀 **WHAT TO EXPLAIN / SHOW:** The cluster of connected dark poles.  

🗣️ **SPEAK:**  
GridOps uses corroboration and confirmation logic to determine whether the observed outage represents a meaningful pattern rather than an isolated telemetry failure.  

Once the outage is confirmed, we move to **fault localization**.  

The system examines the topology and identifies the boundary between the energized and de-energized portions of the network.  

In other words, we're looking for the point where a healthy upstream section connects to an affected downstream section.  

📍 **CURSOR:** Rest cursor directly on the **boundary span** (the line between the last live green pole and the first dark red pole).  
👀 **WHAT TO EXPLAIN / SHOW:** The glowing red boundary line between the energized upstream pole and the de-energized downstream pole.  

🗣️ **SPEAK:**  
That gives us the likely fault location rather than simply telling us that an outage exists.  

The system then converts that diagnosis into an **incident ticket**, including the affected area and a confidence level.  

📍 **CURSOR:** Move cursor to the left sidebar $\rightarrow$ click the new ticket card (e.g. `FLT-0001`).  
👀 **WHAT TO EXPLAIN / SHOW:** Show the ticket summary: Fault Type (`span`), Boundary (`P-031 → P-032`), Confidence (`HIGH`), Affected Poles & Households.  

🗣️ **SPEAK:**  
And that ticket isn't just a static alert.  

It can move through the operational lifecycle from **Detected, to Acknowledged, Crew Assigned, Resolved, Verified, and Closed**.  

🖱️ **CLICK:**  
1. Click **`Acknowledge`** button $\rightarrow$ status badge updates to amber (*Acknowledged*).  
2. Click **`Assign Crew`** $\rightarrow$ pick *North Line Maintenance Alpha* $\rightarrow$ status updates to *Crew Assigned*.  
📍 **CURSOR:** Hover over the lifecycle status bar at the top of the ticket.  
👀 **WHAT TO EXPLAIN / SHOW:** The live transition through the operational state machine.  

🗣️ **SPEAK:**  
So the workflow goes from raw telemetry, to detection, to localization, and finally to an actionable operational incident.”

---

### [3:20 – 4:15] Engineering Challenges

🗣️ **SPEAK:**  
“One of the biggest challenges was making this reliable under **imperfect telemetry**.  

🖱️ **CLICK:** Click the **Simulator** tab on the left sidebar.  
📍 **CURSOR:** Scroll down through the noise controls.  

🗣️ **SPEAK:**  
I specifically designed and tested scenarios involving missed messages, duplicate messages, sensor failures, clock skew, repairs, and multiple simultaneous faults.  

📍 **CURSOR:** Hover over the specific simulator controls:  
• *30% Missed Dying Gasps*  
• *Firmware 1.2 Silent Sensors*  
• *Clock Skew / Timestamp Jitter*  
👀 **WHAT TO EXPLAIN / SHOW:** Show that real-world dirty data scenarios are baked directly into the simulator.  

🗣️ **SPEAK:**  
Instead of testing only against manually created ideal inputs, I built a **fault simulator** that can inject different types of failures into the network.  

This helped me test how the localization logic behaves when the input data isn't perfect.  

Another important consideration was keeping the architecture explainable.  

The core diagnosis is deterministic and topology-aware, so I can trace how the system arrived at a particular fault location instead of relying on an opaque prediction.  

📍 **CURSOR:** Point back to the clean graph canvas.  
👀 **WHAT TO EXPLAIN / SHOW:** Emphasize that the localization path is mathematically traceable (no black box).  

🗣️ **SPEAK:**  
From an engineering perspective, the frontend uses **React with a custom Canvas-based visualization**, while the backend uses **Python and FastAPI**, with graph-based processing for the network topology and localization logic.  

The system also includes automated test scenarios for different fault and telemetry conditions.”  

🖱️ **CLICK:** Click the **System Health** tab (`/api/system-health`) to show live subsystem latencies, or mention the **26 passing automated tests** in pytest.  

---

### [4:15 – 4:55] AI Layer

🗣️ **SPEAK:**  
“The AI architecture was also a deliberate decision.  

I didn't want an LLM deciding where a potentially safety-critical electrical fault occurred.  

That decision remains **deterministic and auditable**.  

🖱️ **CLICK:** Switch back to the open ticket in the **Ticket Detail** drawer.  
📍 **CURSOR:** Hover directly over the **`🤖 Explain This Ticket`** button.  

🗣️ **SPEAK:**  
Instead, I use **GPT-4o-mini** for the **Explain This Ticket** capability.  

🖱️ **CLICK:** Click the **`🤖 Explain This Ticket`** button.  
👀 **WHAT TO EXPLAIN / SHOW:** Watch the explanation text box generate on screen.  

🗣️ **SPEAK:**  
Once the system has verified and structured the incident, the LLM converts that technical information into a concise natural-language explanation for the operator.  

📍 **CURSOR:** Scroll through the generated 3-sentence summary.  
👀 **WHAT TO EXPLAIN / SHOW:** Point out that it explains *what broke, where it is, why confidence is high, and how many homes are dark* in plain human language.  

🗣️ **SPEAK:**  
So the AI isn't replacing the underlying engineering logic.  

It's acting as an interface layer that makes the system's diagnosis easier for a human operator to understand and act on.  

For me, that was an important lesson in building AI systems: **use AI where it adds value, but don't force an LLM into a problem where deterministic logic is more reliable.**”

---

### [4:55 – 5:20] Closing

🗣️ **SPEAK:**  
“So GridOps isn't just an outage dashboard.  

It's an end-to-end system that goes from **telemetry → topology analysis → fault localization → confidence-based diagnosis → incident management**, with an LLM used to make verified incidents easier to understand.  

🖱️ **CLICK:** Click the **Dashboard** tab on the left sidebar.  
📍 **CURSOR:** Hover over the MTTR card, active incidents count, and reliability metrics.  
👀 **WHAT TO EXPLAIN / SHOW:** The high-level operational impact on utility metrics.  

🗣️ **SPEAK:**  
The project started from a simple question:  

**Can software reason about the structure of a power grid and turn raw telemetry into an actionable diagnosis?**  

📍 **CURSOR:** Zoom out on the Canvas to frame the entire illuminated power grid.  
👀 **WHAT TO EXPLAIN / SHOW:** Wide, cinematic overview of the self-diagnosing network.  

🗣️ **SPEAK:**  
GridOps is my implementation of that idea.  

And the engineering principle I wanted to demonstrate is that good AI products aren't necessarily about putting an LLM everywhere.  

They're about combining **the right algorithms, the right system architecture, and AI in the places where it genuinely improves the product.**  

📍 **CURSOR:** Rest cursor steady in the center. Look directly at camera/judges.  

🗣️ **SPEAK:**  
Thank you.”
