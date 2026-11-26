# ThreadLock G2 — 3-Minute Hackathon Demo Script 🎬
> **Hackathon**: Heads Up: Even Realities Hackathon 2026 (Deadline: Nov 30, 2026)  
> **App**: ThreadLock G2 (Monorepo: `backend/`, `companion-web/`, `g2-app/`)  
> **Target Hardware**: Even Realities G2 Smart Glasses (`576×288` Monochrome OLED) + Even R1 Ring  
> **Target Video Duration**: 3:00 Minutes

---

## ⏱️ Video Timeline Overview

| Timestamp | Phase | What Judge Sees on Screen |
|---|---|---|
| **0:00 – 0:35** | **The Hook & Problem** | Freelance/sales contract chat on phone; terms sneaky drift; introducing ThreadLock G2 |
| **0:35 – 1:10** | **Pairing & Baseline Lock** | Companion Web (`http://localhost:4000/companion/`) locking $10,000 USD deal; Telegram link |
| **1:10 – 1:50** | **Live Drift Alert on G2** | Telegram offer arrives; G2 HUD (`576×288`) flashes `+$3,500 (+35%)` glance card |
| **1:50 – 2:30** | **Read & Write Action Execution** | Using Even R1 Ring / touch temple to trigger `COUNTER` and `LOCK`; 30s Undo window |
| **2:30 – 3:00** | **Audit Trail & Wrap Up** | Cryptographic SHA-256 chain verification; why G2 is the ultimate negotiation HUD |

---

## 🎬 Detailed Step-by-Step Script

---

### [0:00 – 0:35] The Hook & The Problem
**Visual:**
- Camera on speaker wearing smart glasses, or split screen: Left side shows a real Telegram chat proposal slipping in a 35% price hike; Right side shows user trying to look down at a laptop spreadsheet.

**Voiceover:**
> *"Have you ever negotiated a deal on Telegram, Slack, or over coffee, and the other party casually slips in a price hike, pushes the deadline by three weeks, or sneaks in 'Net 90 retainage'?*  
> *Looking down at a laptop or opening spreadsheets during a face-to-face conversation breaks eye contact and kills your negotiation leverage.*  
> *Meet **ThreadLock G2**—the world’s first heads-up deal commitment and terms drift engine, engineered specifically for the Even Realities G2 smart glasses."*

---

### [0:35 – 1:10] Pairing & Locking Baseline Terms
**Visual:**
- Screen recording of **Companion Web Console** (`http://localhost:4000/companion/`) side-by-side with **G2 Glasses Viewport** (`http://localhost:4000/g2/`).
- Show pairing code `G2-S9EY` connected via Server-Sent Events (SSE).
- Fill in the baseline agreement:
  - **Title**: `Acme Mobile App Build`
  - **Counterparty**: `@alice_lead`
  - **Agreed Price**: `$10,000 USD`
  - **Agreed Deadline**: `2026-11-30`
  - **Deliverables**: `iOS MVP, Android build, Auth backend`
- Click **"🔒 Lock Agreed Terms"**.
- Click Telegram pill and show bot `@threadlock_g2_bot` linked.

**Voiceover:**
> *"Here on the Companion Web, we lock our agreed baseline terms: $10,000 USD due November 30. We click 'Lock Agreed Terms'.*  
> *Notice our pairing session code `G2-S9EY` is instantly synced with our G2 glasses HUD over real-time Server-Sent Events—with zero client-side API secrets.*  
> *Our Telegram Bot, `@threadlock_g2_bot`, is already linked to this session, actively listening for any contract proposals or client chat messages."*

---

### [1:10 – 1:50] Real-Time Drift Detection on 576×288 HUD
**Visual:**
- Switch focus to the **G2 Glasses Viewport (576×288 Monochrome OLED)**.
- Trigger a real incoming offer (either send from Telegram on phone or click judge preset `⚡ +15% Price Drift` / send draft):
  - Message: *"We reviewed the quote: total fee is now $13,500 USD and delivery pushed to Dec 25."*
- **Watch the G2 Glasses HUD flash instantly**:
  - Top Bar: `[● G2-S9EY] ACME MOBILE APP BUILD [DRIFT: PRICE + DUE]` (pulsing red alert)
  - Center Card:
    - Line 1: `+$3,500 (+35.0%)`
    - Line 2: `OLD: $10,000 | NEW: $13,500`
    - Line 3: `DUE: Nov 30 -> Dec 25 (+25d)`
    - Line 4: `@alice_lead • Proposal deviates from baseline`
    - Line 5: `REC ACTION: COUNTER`
  - Bottom Bar highlights: `LOCK | ▶ FLAG ◀ | COUNTER`

**Voiceover:**
> *"Now, watch what happens when our client sends an updated proposal. Boom!*  
> *In under 200 milliseconds, without touching our phone or looking away, our G2 glasses heads-up display flashes an alert.*  
> *Our deterministic diff engine analyzed the numbers: a 35% price jump from $10,000 to $13,500, a 25-day deadline slip to December 25, and high severity.*  
> *The glance layout is strictly designed for the G2's 576×288 monochrome display—zero clutter, maximum optical contrast, readable in one second."*

---

### [1:50 – 2:30] Hardware Read & Write Actions + 30-Second Undo Guard
**Visual:**
- On the G2 Simulator or physical glasses:
  - Rotate the **Even R1 Ring** or swipe the right temple touchpad: watch the highlight shift fluidly from `FLAG` to `COUNTER`.
  - Press **Enter** / click the R1 Ring to execute `COUNTER`.
  - Show the **Countdown Undo Overlay** appear on the HUD:
    `CONFIRMED [COUNTER] (28s TO UNDO • [TAP TO REVERT])`
  - Show the Telegram chat receiving the crisp counter-offer:
    > *"💬 ThreadLock G2 — Counter-Offer: Re: Acme Mobile App Build: Proposing compromise at $11,750 USD with deadline maintained at 2026-11-30. Sent via Even Realities G2."*
  - Press `U` or Tap to demonstrate **instant undo rollback**.
  - Now select `LOCK` and confirm: terms update to the new baseline.

**Voiceover:**
> *"Even Realities G2 isn't just a passive notification display—ThreadLock G2 is a complete read and write action engine.*  
> *Using the Even R1 Ring or glasses temple swipe, we highlight 'COUNTER' and click.*  
> *Instantly, a structured counter-offer is dispatched back to the client via Telegram.*  
> *To protect against accidental triggers during natural gestures, our state machine enters a 30-second safe Undo Window with a live countdown on our HUD. If we tap, it reverts immediately.*  
> *Once agreed, we hit 'LOCK', committing the new agreed terms directly from our glasses."*

---

### [2:30 – 3:00] SHA-256 Audit Trail & Conclusion
**Visual:**
- Switch back to Companion Web.
- Point to the **Tamper-Evident SHA-256 Audit Trail**.
- Click **"🛡 Verify Hashes"**:
  - Green banner appears: `[OK] Chain Verified: 100% untampered SHA-256 integrity (8 events validated)`.
- Show the 1:1 Raw Mode toggle (`http://localhost:4000/g2/?mode=raw`).
- Concluding slide with repository links and Even Realities Hackathon badge.

**Voiceover:**
> *"Every single diff evaluation, gesture action, and baseline change is permanently sealed in an append-only, SHA-256 hash-chained audit ledger.*  
> *One click on 'Verify Hashes' cryptographically proves that the negotiation record has never been tampered with.*  
> *ThreadLock G2 holds zero user funds, exposes zero API keys in the WebView, and transforms Even Realities G2 into the ultimate negotiation superpower.*  
> *Thank you for watching—try the live simulator at localhost:4000 today!"*

---

## 📋 Pre-Recording Checklist

1. **Backend Server Running**:
   ```bash
   npm start
   ```
   Verify console output:
   `Telegram Bot Verified: @threadlock_g2_bot (ID: 9227084863)`
   `Telegram Bot Long-Polling Worker Started`

2. **Open Browser Tabs**:
   - Tab 1: [http://localhost:4000/companion/](http://localhost:4000/companion/)
   - Tab 2: [http://localhost:4000/g2/](http://localhost:4000/g2/)
   - Tab 3 (Optional Phone Mirror): Telegram app chat with `@threadlock_g2_bot`

3. **Verify Pairing Code**:
   - Both screens should display `G2-S9EY`.
