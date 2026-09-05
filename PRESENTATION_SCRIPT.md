# 🎙️ Yashmit's Presentation Script (Spoken / Teleprompter Style)

> **Pro Tip:** Talk like you're explaining something cool to a friend or fellow engineer. Don't read like a textbook. Keep your sentences short and breathe between points.

---

## ⏱️ Quick Cheat Sheet (If You Get Stuck)

- **The Problem:** When power cuts out in a storm, linemen drive jeeps in the dark with flashlights to find the broken wire. It takes 3 hours.
- **My Idea:** The grid is actually a tree graph. Substation is the root. Homes are leaves.
- **The Algorithm:** 
  1. **BFS** checks which parts still have power.
  2. **Corroboration** ignores dead sensor batteries (needs 3+ dark poles).
  3. **DFS** finds where live connects to dark — that's the break.
- **The Result:** We find the exact span in 15 milliseconds. Linemen get GPS directions directly to the pole. MTTR drops from 2.5 hours to 20 minutes.

---

## 🎬 5-Minute Word-for-Word Script

---

### [0:00 – 1:00] The Hook: The Real-World Problem

**[ACTION: Full screen on your Grid Canvas. Power dots are moving.]**

"Hi everyone, I’m Yashmit.

Let me ask you a question. When power goes out in a storm... why does it take 3 to 4 hours to come back?

Here’s the dirty secret of electrical grids:  
They have almost zero visibility on the last mile. 

When a wire snaps, nobody knows where it broke.  
Linemen literally get into a truck... drive down dark roads... and shine flashlights up at poles. 

Think about that. In 2026, we find broken 11,000-volt power lines by having humans squint at wires in the rain.

It’s slow. It wastes hours.  
And worse — live wires fall onto flooded roads, electrocuting people and animals.

I built **GridOps AI** to solve this."

---

### [1:00 – 1:45] The Idea: It's Just a Tree

**[ACTION: Slowly pan from the purple Substation at the top down to the poles.]**

"Last monsoon, a wire snapped near my house. It took the repair crew nearly 3 hours just to find the pole.

Watching them, I realized something simple:

Power doesn't flow randomly.  
It starts at a substation.  
It flows to transformers.  
Then to poles.  
And then into our homes.

Mathematically, that's not a mystery. **It's a tree graph.**

And if it’s a tree, we don’t need to patrol it with trucks. We can solve it with simple, fast graph algorithms. 

Instead of 3 hours in a jeep, we can find the exact broken span in **15 milliseconds**."

---

### [1:45 – 3:30] Live Demo: Scenario Lab (Try-On Zone)

**[ACTION: Click 'Scenario Lab (Try-On)' button at top. Select 'Broken Wire Span'. Click 'Inject Scenario'. Click 'Minimize'. Canvas auto-focuses.]**

"Let me show you live.

I’m in our **Try-On Zone**. I’m going to simulate a tree branch falling and snapping a high-voltage wire.

*(Inject & Minimize)*

Watch the bottom dock. The algorithm solves this in 5 clear steps.

---

**Step 1: Root Discovery**  
*(Point at the purple glowing circle at SS-01)*  
"We start at Substation SS-01. That’s our root. All power starts here."

---

**[ACTION: Click 'Next ➔']**

**Step 2: The BFS Wave**  
*(Point at green dots moving through lines)*  
"Step 2: We run a Breadth-First Search outward from the substation.  
Notice the green wave. It checks every line that's still healthy. Everything green is still receiving power."

---

**[ACTION: Click 'Next ➔']**

**Step 3: The Dark Cluster**  
*(Point at the red dashed box with '0V' badges)*  
"Step 3: Anything the green wave couldn't reach is dark. That's our outage island.

Now look at the top badge: it says **CORROBORATED**.  
Why does that matter?  
Because IoT sensor batteries die all the time. If a sensor battery dies, it reports zero volts. But that doesn't mean the wire broke!  
Our algorithm requires at least 3 nearby poles to report dark before it raises an alarm. That stops false alarms completely."

---

**[ACTION: Click 'Next ➔']**

**Step 4: The Golden Laser**  
*(Point directly at the pulsing gold beam between P-031 and P-032)*  
"Now look at Step 4. This is the breakthrough.

We run a Depth-First Search down the tree. The moment we find a node that is LIVE... connected to a child that is DARK... that's our break!

Look at the golden laser right here.  
Upstream pole P-031 is live at 11kV.  
Downstream pole P-032 is completely dark at 0V.  
The break is right between them.  

No patrolling. No guessing. Pinpointed in 12 milliseconds."

---

### [3:30 – 4:15] Step 5: Dispatch & Tech Stack

**[ACTION: Click 'Next ➔']**

"Step 5: Automated Dispatch.  
The system uses the Haversine formula to measure the span — 43 meters. It maps it back to the nearest transformer, generates a ticket, and dispatches the closest crew with a 14-minute ETA.

**What did I use to build this?**
- **Frontend:** React and a custom HTML5 Canvas engine. I didn't use Google Maps or Leaflet because they lag. Our canvas runs at a silky-smooth 60 FPS.
- **Backend:** Python and FastAPI with NetworkX for lightning-fast graph calculations."

---

### [4:15 – 5:00] Why This Matters & Closing

**[ACTION: Click 'Expand' on dock. Click green 'Repair All' button. Entire grid turns healthy green.]**

"To wrap up: why does this matter to an electricity board?

1. **Repairs drop from 3 hours to 20 minutes.** Linemen don't search; their phone gives them turn-by-turn GPS directly to the broken pole.
2. **It saves lives.** Snapped live wires on flooded streets are flagged instantly before someone walks into them.
3. **Zero new hardware needed.** Utilities can plug this software directly into the smart meters and SCADA systems they already have.

GridOps AI turns a blind grid into a self-diagnosing network.

Thank you! I'm Yashmit, and I'd love to take your questions."

---

## 🎯 How to Deliver This Naturally:

1. **Don't rush.** Speak at a calm, conversational speed.
2. **Look at the audience, not just the screen.** When you say "Think about that in 2026...", look straight at the judges.
3. **When you click `Next ➔`**, pause for 1 second so everyone sees the animation change before you speak.
