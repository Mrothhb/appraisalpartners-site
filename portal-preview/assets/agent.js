/* A&AP portal preview: practice data only. Nothing leaves the page. */
(function () {
  const DATA = {
    person: "Pat", office: "Practice Appraisal Group", plan: !/plan=off/.test(location.search),
    usage: { pct: 42, started: 5, of: 12, resets: "Sun, Nov 15, 2026 at 2 PM Central", resetShort: "Sun 2 PM", weeks: [["Oct 19", 60], ["Oct 26", 85], ["Nov 2", 100], ["Nov 9", 42]] },
    orders: [
      { code: "AP-9891", street: "3 ZZ Review Ct", city: "Frisco, TX 75034", stage: 3, status: "Ready for your review", tone: "you", due: "Today, Nov 13, 2026", clientDue: "Mon, Nov 16, 2026", used: 8,
        need: "Review the report and approve it.", next: "Delivery to your TOTAL folder on the day you approve.", lane: "Partial, your comps", price: "$89",
        have: [["TOTAL file", "Nov 10, 9:05 AM"], ["Engagement letter", "Nov 10, 9:05 AM"], ["Comps and MLS sheets (4)", "Nov 10, 9:40 AM"], ["Photos", "Nov 10, 9:40 AM"]], still: [],
        changes: [{ what: "Garage label corrected in sketch and grid", state: "Completed", note: "'Carport' changed to '2-car attached' on page 2 and in the comp grid." }],
        log: [["Nov 13, 9:00 AM", "Change completed: garage label"], ["Nov 12, 3:15 PM", "Draft ready for your review"], ["Nov 10, 9:40 AM", "Order started"], ["Nov 10, 9:05 AM", "Order received"]] },
      { code: "AP-9893", street: "2 ZZ Files Ln", city: "Plano, TX 75024", stage: 0, status: "Files missing", tone: "you", due: "Date not yet confirmed", clientDue: "Fri, Nov 20, 2026", used: 0,
        need: "3 files: engagement letter, subject photos, comp MLS sheets.", next: "The order starts when all files are received. Ready for your review 2 working days after the start.", lane: "Full, 2 to 4 units", price: "$199",
        have: [["TOTAL file", "Nov 13, 7:30 AM"], ["Sketch", "Nov 13, 7:31 AM"]], still: ["Engagement letter", "Subject photos", "Comp MLS sheets"],
        changes: [], log: [["Nov 13, 7:31 AM", "2 of 5 files received"]] },
      { code: "AP-9897", street: "1 ZZ Test Way", city: "Dallas, TX 75201", stage: 2, status: "In progress", tone: "", due: "Mon, Nov 16, 2026, before noon", clientDue: "Tue, Nov 17, 2026", used: 8,
        need: "Nothing. All files received.", next: "Ready for your review Mon, Nov 16, 2026, before noon.", lane: "Partial, your comps", price: "$89",
        have: [["TOTAL file", "Nov 12, 4:12 PM"], ["Sketch", "Nov 12, 4:12 PM"], ["Engagement letter", "Nov 12, 4:30 PM"], ["Comps and MLS sheets (5)", "Nov 13, 8:20 AM"], ["Plat", "Nov 13, 1:10 PM"]], still: [],
        changes: [], log: [["Nov 13, 1:10 PM", "Plat added at your request"], ["Nov 13, 9:00 AM", "Order started"], ["Nov 12, 4:12 PM", "Order received"]] },
      { code: "AP-9888", street: "6 ZZ Revision Rd", city: "McKinney, TX 75070", stage: 2, status: "Revision round 1 in progress", tone: "", due: "Sat, Nov 14, 2026", clientDue: "Mon, Nov 16, 2026", used: 12,
        need: "Nothing right now.", next: "Corrected report back to you Sat, Nov 14, 2026, to re-sign.", lane: "Full", price: "$199",
        have: [["Delivered report, version 1", "Nov 10, 11:00 AM"], ["Lender conditions letter (3 items)", "Nov 12, 2:05 PM"]], still: [],
        changes: [{ what: "Lender: signature block date", state: "Completed" }, { what: "Lender: comp 2 sale date outside lookback, explain or swap", state: "In progress" }, { what: "Lender: site adjustment support", state: "In progress" }],
        log: [["Nov 13, 10:10 AM", "Revision round 1: 1 of 3 completed"], ["Nov 12, 2:05 PM", "Revision round 1 received"], ["Nov 10, 11:00 AM", "Delivered, version 1"]] }
    ],
    delivered: [
      { code: "AP-9894", street: "4 ZZ Done Dr", city: "Tyler, TX 75707", when: "Nov 13, 2026", versions: [["Version 1", "Nov 13, 2026"]], balance: null },
      { code: "AP-9890", street: "5 ZZ Pay St", city: "Garland, TX 75040", when: "Nov 12, 2026", versions: [["Version 1", "Nov 12, 2026"]], balance: { amount: "$89", due: "Nov 13, 2026", inv: "INV-2041" } },
      { code: "AP-9885", street: "7 ZZ Past Pl", city: "Allen, TX 75002", when: "Nov 5, 2026", versions: [["Version 2", "Nov 5, 2026"], ["Version 1", "Nov 3, 2026"]], balance: null }
    ],
    invoices: [
      { id: "INV-2041", order: "5 ZZ Pay St", amount: "$89", amountNum: 89, due: "Nov 13, 2026", paid: null },
      { id: "INV-2037", order: "7 ZZ Past Pl", amount: "$199", amountNum: 199, due: "Nov 7, 2026", paid: "Nov 11, 2026" },
      { id: "INV-2030", order: "4 ZZ Done Dr", amount: "$89", amountNum: 89, due: "Nov 13, 2026", paid: "Nov 13, 2026" }
    ],
    prices: [["Partial — your comps", "$89"], ["Full", "$199"], ["Rent schedule", "+$35"], ["Next-day rush", "+$60"]],
    callTimes: ["Today 3:30 PM", "Today 4:15 PM", "Mon, Nov 16, 9:00 AM"]
  };
  const NOW = "Nov 13, 2026, 2:21 PM Central";
  const full = o => `${o.street}, ${o.city}`;
  const find = (q) => DATA.orders.find(o => q.includes(o.street.toLowerCase()) || q.includes(o.code.toLowerCase()));
  const ICON_OK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".14"/><path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Answers: property, status, date, next action. No banter. If no property is established, ask which.
  // Each action: label, and the receipt line shown after "Sending…" becomes "Request received".
  function answer(raw, scopeCode) {
    const q = (raw || "").toLowerCase().trim();
    const o = find(q) || (scopeCode ? DATA.orders.find(x => x.code === scopeCode) : null);
    const has = (...w) => w.some(x => q.includes(x));
    const which = (lines) => ({ pick: true, lines: lines.concat(["Which property?"]), acts: DATA.orders.map(t => ({ label: t.street, ask: `${raw} ${t.street}` })) });
    if (has("usage", "left", "how much", "week", "plan", "refill")) {
      return DATA.plan
        ? { lines: [`This week: <b>${DATA.usage.pct}% used</b>, ${DATA.usage.started} of ${DATA.usage.of} orders. Resets ${DATA.usage.resets}.`], acts: [{ label: "Refill now — $100", did: "Refill of $100 requested. It applies as soon as the payment confirms." }, { label: "Open Plan & billing", go: "#billing" }] }
        : { lines: ["Your office is not on the weekly plan. Each order is billed on delivery."], acts: [{ label: "Open Billing", go: "#billing" }] };
    }
    if (has("invoice", "pay", "bill", "owe", "balance", "check")) {
      return { lines: ["Amount due: <b>$89</b>. INV-2041 for 5 ZZ Pay St, due Nov 13, 2026.", "INV-2037 ($199) paid Nov 11, 2026. INV-2030 ($89) paid Nov 13, 2026."],
        acts: [{ label: "Pay $89", go: "#billing" }, { label: "Download invoice", did: "INV-2041 (PDF) is downloading." }, { label: "Report a check payment", did: "Check reported for INV-2041 · Awaiting confirmation. Matt confirms when it clears." }] };
    }
    if (has("call", "matt", "phone", "talk")) {
      return { pick: true, lines: ["Open times for a call with Matt:"], acts: DATA.callTimes.map(t => ({ label: t, did: `Call requested for ${t} Central. Matt will confirm the time.` })) };
    }
    if (has("unsign", "signing error", "uad error", "error when i sign", "re-sign", "total")) {
      return { lines: ["Fix a signing error: 1. Open the report in TOTAL. 2. Remove the signature. 3. Make the fix. 4. Run the error check. 5. Sign again.", "Numbered steps with pictures are under Help."], acts: [{ label: "Open Help: Fix a signing error", go: "#help" }, { label: "Request a call with Matt", ask: "Request a call with Matt" }] };
    }
    if (has("version", "upload", "which file", "re-send", "resend", "download")) {
      return { lines: ["7 ZZ Past Pl, Allen, TX 75002: <b>Version 2 · Latest · Nov 5, 2026</b>. Upload Version 2.", "Earlier version: Version 1, Nov 3, 2026, available under Earlier versions."], acts: [{ label: "Open Delivered", go: "#delivered" }, { label: "Re-send Version 2 links by email", did: "Version 2 links for 7 ZZ Past Pl sent to your email." }] };
    }
    if (has("new order", "start an order", "quote", "price")) {
      return { lines: ["Prices: Partial — your comps: $89. Full: $199. Rent schedule: +$35. Next-day rush: +$60.", "New order shows the charges, total, payment due date and ready date before you start."], acts: [{ label: "New order", go: "#new" }, { label: "My prices", go: "#prices" }] };
    }
    // everything below needs a property
    if (!o) return which([]);
    const head = `<b>${full(o)}</b>. Status: ${o.status}.`;
    if (has("ready", "when", "eta", "status", "where", "how long", "track")) {
      return { lines: [head, `Ready for your review: ${o.due}. Client due date: ${o.clientDue}.`, o.tone === "you" ? `Next: ${o.next}` : ""].filter(Boolean),
        acts: [o.tone === "you" ? { label: o.stage === 3 ? "Review report" : "Add files", go: o.stage === 3 ? `#orders/${o.code}/review` : `#orders/${o.code}#files` } : null, { label: "Change client due date", did: `Client due date change for ${o.street} recorded. Current date: ${o.clientDue}. Next: the desk confirms the new date.` }].filter(Boolean) };
    }
    if (has("revision", "lender", "underwriter", "conditions")) {
      return { lines: [head, `${o.changes.filter(c => c.state === "Completed").length} of ${o.changes.length || 0} conditions completed. Corrected report: ${o.due}.`],
        acts: [{ label: "Send a revision", go: `#revision/${o.code}` }, { label: "Open the change list", go: `#orders/${o.code}#changes` }] };
    }
    if (has("change", "fix", "correct", "wrong", "edit")) {
      return { lines: [head, "Describe the change. It is added to the order's change list as Received, then In progress, then Completed."],
        acts: [{ label: "Fix the garage label", did: `Change request for ${o.street}: fix the garage label. Status: Received. Next: In progress.`, fx: "change" }, { label: "Keep comps in my order", did: `Change request for ${o.street}: keep comps in the order sent. Status: Received.`, fx: "change" }, { label: "Type the change", focus: true }] };
    }
    if (has("comp", "mls", "bracket", "swap")) {
      return { lines: [head, "Give the MLS number and one line on why. Weighting and value stay with the appraiser."],
        acts: [{ label: "Add MLS# 20412345 as comp 5", did: `Comp request for ${o.street}: MLS# 20412345 as comp 5. Status: Received.`, fx: "change" }, { label: "Type the MLS number", focus: true }] };
    }
    if (has("file", "missing", "need from me", "did you get", "receive", "photos", "letter", "email")) {
      if (!o.still.length) return { lines: [head, `All ${o.have.length} files received. Nothing needed from you.`], acts: [{ label: "Open the file list", go: `#orders/${o.code}#files` }] };
      return { lines: [head, `Still needed (${o.still.length}): ${o.still.join(", ")}.`, `Received (${o.have.length}): ${o.have.map(h => h[0]).join(", ")}.`],
        acts: [{ label: "Add files", go: `#orders/${o.code}#files`, fx: "files" }, { label: "I sent them by email", did: `Checking email for ${o.street} · Receipt not yet confirmed. The list updates when each file is matched.`, fx: "emailed" }] };
    }
    if (has("approve", "review", "sign", "accept")) {
      return { lines: [head, o.stage === 3 ? "1 change since your last review: garage label corrected in sketch and grid. Approval is inside the report review." : "This order is not at review yet."],
        acts: o.stage === 3 ? [{ label: "Review report", go: `#orders/${o.code}/review` }, { label: "Request a change", ask: `Request a change on ${o.street}` }] : [{ label: "When will it be ready?", ask: `When will ${o.street} be ready?` }] };
    }
    return { lines: [head, `Ready for your review: ${o.due}.`], acts: [{ label: "Open this order", go: `#orders/${o.code}` }, { label: "Request a change", ask: `Request a change on ${o.street}` }] };
  }

  window.AGENT = { DATA, answer, ICON_OK, find, NOW, full };
})();
