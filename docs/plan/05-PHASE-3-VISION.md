# Section 5 — Phase 3: Automatic Scoring from a Phone Camera

**Status: exploratory.** This section maps the option space and de-risks the idea; it is not
an implementation plan. Each sub-phase gates the next, and **3a is explicitly designed to kill
the idea cheaply if it's not going to work.**

---

## 5.0 Bottom line

Your instinct is right: crokinole is unusually well-suited to this. The board is rigid,
planar, and high-contrast, with **built-in fiducial markers** — the 26″ outer circle, the
20-hole at exact centre, and 8 pegs evenly spaced on a known 8″ circle. That's a
better-instrumented target than most industrial CV problems. The pieces are identical flat
discs in two colours.

**Overall difficulty: Medium**, with one Hard sub-problem and one stretch goal I'd advise
against. Realistically **~6–9 days of agent-assisted work** to useful live scoring.

Two findings reshape the idea from how you described it:

1. **The hard part isn't detection — it's precision, and specifically disc-thickness
   parallax.** Discs are ~10 mm thick. A camera 36″ above centre sees a disc at the board edge
   displaced radially outward by ~0.11″. The line-touching rule needs ~±0.03″. So the naive
   version is **systematically wrong exactly at the 15-ring and the outer edge**, where calls
   matter most. The error is deterministic and correctable given camera height, but if you
   skip it, borderline calls are worse than a coin flip.
2. **A single photo of a finished round cannot score it.** Twenties fall in the hole and are
   physically removed. The information isn't in the final frame. This forces **stateful,
   shot-by-shot video** rather than one-photo-per-round — which turns out to be a blessing,
   because diffing consecutive settled states is far easier than solving each board from
   scratch.

---

## 5.1 Phase 3a — Kill-or-confirm (0.5–1 day, P(success) ≈ 90%)

**No app. No video. A notebook.**

Take 40–60 phone photos of real settled boards. Hand-label the true score of each. Then:
detect the outer circle → refine the transform using the 8 pegs and the centre hole → warp to
a canonical top-down view → detect discs (Hough circles + colour thresholding, or template
matching) → assign rings by radius.

**Measure:** per-disc detection rate, per-board correct-score rate, and — tabulated
separately — accuracy on boards containing a disc within ~1/16″ of a line.

**Expected:** ~95–98% correct round scores on non-borderline boards; 60–80% on borderline ones
before parallax correction.

**Kill criterion:** if non-borderline board accuracy is below ~90% here, stop. The rest of the
plan doesn't recover from a weak foundation.

*Calibration point: DeepDarts — a harder problem, thin occluding objects, face-on camera — hit
94.7% total-score accuracy with 15k labelled images. You have an easier target and better
fiducials.*

---

## 5.2 Phase 3b — Precision + state (2–3 days, P ≈ 75%)

**This is where the project actually succeeds or fails.**

- **Correct for disc-thickness parallax.** Offset is purely radial given camera height *H* and
  disc thickness *t* (≈ `t·r/H`). Add a one-time calibration step that measures *H*.
- **Shoot 4K stills, not 1080p video frames**, for the scoring read. At 1080p a disc is ~50px
  and centre localisation error is ±0.025–0.05″ — marginal against a 0.03″ requirement. At 4K
  you have the headroom.
- **Settle detection.** Cheap frame-differencing at 15–30fps on a downscaled grayscale frame.
  State machine: `MOTION → QUIET(≥0.75s) → capture 4K still → score`. Reject quiet periods
  where an arm still overlaps the board.
- **Shot-by-shot diffing.** Score after *every* shot, not per round. This is what recovers
  twenties (disc count drops, no ditch entry, disappearance near centre → +20) and it means
  you only have to explain what *changed*, which is dramatically more robust.

Validate against ~20 hand-scored recorded rounds.

**On occlusion:** hands and arms block the board almost totally during a shot, and this is
**completely irrelevant** as long as you only read at settled moments. Don't over-engineer it.

---

## 5.3 Phase 3c — Live app + streaming (3–5 days, P ≈ 70%)

**Architecture: run inference on-device.** This isn't close.

| Option | Cost | Latency | Verdict |
|---|---|---|---|
| **On-device** | $0 | 20–80ms | ✅ **Recommended** |
| Stream frames to a GPU server | ~$0.40/hr + egress | 150–500ms | ❌ Not justified |
| Multimodal LLM scores each frame | ~$0.03/board read | 2–8s | ❌ Not for scoring |
| Hybrid: CV + LLM for ambiguous cases | ~$0.01/ambiguity | — | ⚠️ Low value |

Your pipeline is *classical CV* — Hough, thresholding, template matching — which runs in
single-digit milliseconds via OpenCV natively or `opencv.js` (WASM/SIMD) in a PWA. No model,
no GPU, no cold starts, and the video never leaves the room.

**Why not just ask a vision model?** Because the numbers don't work. Current VLM spatial
grounding error is roughly 1–3% of image dimension — **±0.3–0.8″ on a 26″ board**, or about
**10–25× worse** than the line rule requires. A VLM will reliably tell you *"4 dark discs,
3 light, one near the hole"* and will **not** reliably tell you whether a disc touches the
15-line. Cost isn't the blocker (~$0.03/board read); precision is. Where a VLM *is* useful is
a different job — sanity-checking disc counts and colours against your tracked state.

**Better fallback for ambiguity than any model: a human tap.** Render the canonical top-down
view with the ring overlay, highlight the disputed disc, one tap to confirm. Faster than any
inference and always correct.

> **This composes with §9's tables model — noted 2026-08-12.** A table is a physical board and a
> camera watches one board, so a table maps **1:1 onto a capture device** and the `gameId`
> scoping below becomes table-scoped for free. The "viewer" role here and the "spectator" role
> in §9 are the same concept arrived at from two directions. See §9.8.

**Live streaming to other devices — trivial, and Convex is well suited**, provided you never
push video through it:

- Capture device runs inference locally, calls `recordShot({ gameId, roundIndex, shotIndex, discs, scoreDelta })`.
- Viewers `useQuery(api.games.liveState, { gameId })`. Convex re-runs the query and pushes over
  its managed WebSocket — sub-100ms, no subscription plumbing.
- Store the settled-board still in Convex file storage per shot: disputes become auditable
  **and you get a free labelled-data pipeline**.
- A `correctShot` mutation fans corrections out to everyone instantly. Because totals are
  derived (§3.2.1), fixing shot 3 fixes every downstream number for free.

---

## 5.4 Phase 3d — Trajectory & speed (3–6 days, P ≈ 40%)

**I'd advise treating this as a stretch experiment, not a feature.** The arithmetic is
unkind. Competitive flick speeds are roughly 2–5 m/s:

| Frame rate | Displacement/frame at 5 m/s | Verdict |
|---|---|---|
| 30fps | 167mm = 5.2 disc diameters | association impossible |
| 60fps | 83mm = 2.6 diameters | still bad |
| 120fps | 42mm = 1.3 diameters | workable floor |
| 240fps | 21mm = 0.65 diameters | good |

Motion blur is the tighter constraint: at 1/250s and 5 m/s a disc smears 20mm — most of its
own diameter. You need ≤1/1000s exposure, which means **a lot of light**. And collisions, the
physically interesting part, happen in under 10ms and will be under-sampled regardless.

Platform reality: iOS AVFoundation exposes 120/240fps fairly consistently; Android CameraX
high-speed capture is device- and HAL-dependent, and Samsung restricts third-party apps to
30fps for thermal reasons.

**Verdict: 120fps is the floor, 240fps is the real answer.** Try it on one known-good device.
Be willing to drop it.

---

## 5.5 If you ever need a trained model

You probably don't — classical CV should carry this. If you do:

- Fixed rig, one board: **300–500 labelled frames** → >99% mAP.
- Generalising across boards/lighting/phones: 2,000–5,000 frames.
- **Don't hand-label.** Bootstrap with the classical detector, human-correct in a review UI:
  ~10–20s/frame, so 500 frames ≈ 2–3 hours.
- **Synthetic data works unusually well here** and is the single biggest shortcut available.
  The board is concentric circles, 8 pegs, and wood texture — a procedural renderer with
  domain randomisation (grain, lighting, shadow direction, camera pose, disc wear, blur) can
  produce 50k perfectly-labelled images in an afternoon, including exact ground-truth
  *footprint* positions you physically cannot hand-label. Pretrain synthetic, fine-tune on
  200–400 real frames.

---

## 5.6 The cheapest thing you can do today

**Change your discs and your lighting.**

Light "natural" maple discs on a light maple board is the single most avoidable source of
detection error in the entire system. High-contrast discs (dark + red rather than dark +
natural) plus a cheap diffuse LED panel improves every number in this section — and the LED
panel is also mandatory for §5.4's short exposures.

Also: **start saving one photo of the final board per game now** (§4.5 item 6). By the time
you're ready for 3a you'll have a real labelled dataset for free.

---

## 5.7 Prior art

- [`samssi/crokinole-score-keeper`](https://github.com/samssi/crokinole-score-keeper) — the only
  CV crokinole scorer found. Python + OpenCV, very early stage. Worth reading before starting 3a.
- [`hanneshoettinger/opencv-steel-darts`](https://github.com/hanneshoettinger/opencv-steel-darts)
  and [DeepDarts](https://arxiv.org/pdf/2105.09880) — the closest well-developed analogue.
- [croke.app](https://croke.app/) — existing league/tournament platform. Worth 10 minutes to
  see what they got right before you build Phase 2's leaderboard.
