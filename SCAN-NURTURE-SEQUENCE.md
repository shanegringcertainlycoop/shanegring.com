# Scan → Read nurture sequence

**Trigger:** ran the free Site Readiness Scan (email + URL captured in the "Leads from AI scan" Sheet).
**Email 0** is the scan report itself (sent instantly by the Apps Script) — it already ends with the Read pitch.
**Goal:** Read purchase at https://shanegring.com/read.
**Exit:** buys a Read, books a Map, or replies (any reply = human takes over). Honor any "stop" reply immediately.
**Personalization available from the Sheet:** {{site}} (domain), {{score}} (overall /100).
**Voice rules:** plain text, short declarative sentences, Anglo words, em dashes, no hype, no price in email (price lives on the page).

---

## Email 1 — Day 1 · "The check the machine can't run"

**Subject:** The one thing your scan couldn't check
**Preview:** The machine read your structure. It can't read your story.

Yesterday a machine read {{site}} and gave it a {{score}}.

Here's what that number covers: structure. Whether AI can crawl you, whether your pages carry real markup, whether your content lives where machines can find it.

Here's what it can't cover: whether any of it is still true.

A scan can verify your schema. It can't know that your best offer changed last spring, that your prices moved, that the client you built the homepage around is one you'd never take today.

Try this — it takes two minutes. Open your homepage and read it as a stranger. Not as the person who wrote it. As someone deciding whether to spend money with you this week.

If the words are two years old, the score is the smaller problem.

That deeper check is what the Read is — my eyes on your site, not a machine's. It's here when you want it: https://shanegring.com/read

Shane
https://shanegring.com

---

## Email 2 — Day 3 · The drift

**Subject:** Your website describes a company that no longer exists
**Preview:** It didn't break. The business just kept moving.

The day your site launched, it was true.

Then you sharpened an offer. Raised a price. Landed a flagship client. Killed a service line that wasn't working. The business moved. The site didn't.

That's not neglect — it's the ordinary motion of a business nobody assigned to keep the surface in sync. Every founder-led company I've been inside has some version of it.

It used to cost you slowly: prospects land, bounce off stale language, move on. Now it costs you twice — because more and more of them never land at all. They ask an AI about you, and the AI answers from whatever your old pages say. Or it guesses.

One fix worth making this week: find the single page on {{site}} that's most wrong about who you are now, and rewrite its first paragraph. Just that.

If you'd rather see the whole gap at once — ranked, with the three fixes that matter most — that's the Read: https://shanegring.com/read

Shane

---

## Email 3 — Day 6 · The exercise

**Subject:** Ask an AI about your business. I'll wait.
**Preview:** Five questions your prospects are already asking.

Here's an exercise I run for clients. You can run it yourself right now.

Open whichever AI you use and ask it, one at a time:

1. What does {{site}} do?
2. Who are their typical clients?
3. What do they cost?
4. How do they compare to [your closest competitor]?
5. Best [your category] for [your ideal buyer] — and see if you appear at all.

Read the answers slowly. Every wrong answer is a prospect conversation that ends before it starts — or starts with you correcting the record. Every empty answer is a question your competitor may be answering instead.

This is the part of the Read people forward to their partners: I ask the engines the questions your prospects ask, on camera, and you watch what comes back. Then the memo shows why — which pages, which gaps, which fixes.

If the exercise above stung, the full version is here: https://shanegring.com/read

Shane

---

## Email 4 — Day 9 · The offer, plainly

**Subject:** What I'd find on {{site}} in five days
**Preview:** A video, a memo, three fixes you can ship without me.

No exercise today. Just what the Read is, plainly, in case it's useful:

— A 30 to 40 minute video of me going through {{site}} page by page. Not a template. Not a score. Me, reading your business the way an operator does and your site the way a machine does, showing you where the two don't match.

— A memo you can act on the same day. Every issue ranked by effort against impact. Three fixes marked that you can ship this week with whoever runs your site — no help from me needed.

— What the AI engines say about you, on screen, with the reasons why.

Five business days. No meetings — you answer five questions, I do the rest. The price is on the page, so you don't need a call to learn it.

Two things I hold myself to. If the Read doesn't show you something material you didn't already know, reply to the delivery email and I refund you in full. And if I look at your situation and conclude it isn't worth the fee, I refund you before I start and tell you why. Findings are only worth something if I'm not paid to manufacture them.

https://shanegring.com/read

Shane

---

## Email 5 — Day 13 · The honest close

**Subject:** Last one from me on this
**Preview:** Who the Read isn't for — and what happens if you wait.

This is the last email I'll send you about the Read, so let me be straight about who it's not for.

If you're pre-revenue, mid-rebuild, or you win all your work through relationships and the site genuinely doesn't matter — skip it. Keep the scan, fix what it flagged, and good luck out there. I mean that.

But if the business has outgrown the site — if the real story lives in your head and the pages tell an older one — know that this gap doesn't hold still. The business keeps moving. The site keeps standing still. And the engines keep answering questions about you from whatever they can find.

One more thing worth knowing: the Read's fee applies in full toward the Operating Map for 30 days after delivery. If this goes further, the diagnostic was free. If it doesn't, you own a memo built to work without me.

Either way — run the scan again in six months and see which way {{site}} moved.

https://shanegring.com/read

Shane
https://shanegring.com

---

## Implementation notes

- **Sender:** same as the scan report — Apps Script `MailApp` from the coop account, plain text, replyTo shane.gring@certainly.coop. Any reply exits the sequence.
- **Scheduling:** add a daily time-driven trigger to the same bound Apps Script. The Sheet already has `at` (timestamp) and `email`; add a `stage` column (0–5). Each day: for each row, compute days-since-scan, send the next unsent email that's due, bump `stage`. Exit check: a `stopped` flag set when someone replies "stop" or buys (match Stripe receipt email, manual for now).
- **Compliance:** every email needs an out. Add to the footer of each: "If you'd rather not hear about this, reply 'no more' and that's the end of it." Honor it by setting `stopped`.
- **The price never appears in email** — pricing lives only on the offer page (site-wide rule, 2026-07-09).
- **Instrumentation:** UTM the links (e.g. `?utm_source=scan-nurture&utm_campaign=read&utm_content=e3`) so GA4/GTM shows which email converts. Watch scan→Read rate; the doc's working assumption is 3–5%.
- **Ads stay off until this sequence is live** (per the launch sequence). Once the trigger is running, that gate is cleared.
