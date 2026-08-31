import {
  SCOPES,
  STAGES,
  WAITING_NOTE,
  decryptStatus,
  formatCentralTime,
  formatPrice,
  notificationDelivery,
  pageNote,
  parseCapabilityFragment,
  stageDefinition,
  workflowSummary,
} from "./status-core.mjs";

const byId = (id) => document.getElementById(id);

function setText(id, value) {
  byId(id).textContent = value;
}

function showError() {
  byId("loading").hidden = true;
  byId("status-panel").hidden = true;
  byId("error-panel").hidden = false;
}

function renderRail(payload) {
  const rail = byId("status-rail");
  rail.replaceChildren();
  const definition = stageDefinition(payload.stage);
  const activeIndex = definition.index;

  setText("stage-name", definition.label);
  setText("stage-count", `Checkpoint ${activeIndex + 1} of ${STAGES.length}`);
  const progress = byId("progress-track");
  progress.setAttribute("aria-valuenow", String(activeIndex + 1));
  byId("progress-fill").style.width = `${((activeIndex + 1) / STAGES.length) * 100}%`;

  for (const [index, stage] of STAGES.entries()) {
    const item = document.createElement("li");
    item.className = index < activeIndex ? "complete" : index === activeIndex ? "active" : "upcoming";
    if (index === activeIndex) item.setAttribute("aria-current", "step");

    const marker = document.createElement("span");
    marker.className = "rail-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = index < activeIndex ? "✓" : String(index + 1);

    const label = document.createElement("span");
    label.className = "rail-label";
    label.textContent = stage.label;
    item.append(marker, label);
    rail.append(item);
  }
}

const MILESTONES = [
  { label: "Submitted", codes: ["submitted", "intake"] },
  { label: "Accepted", codes: ["accepted"] },
  { label: "In production", codes: ["research", "comparables", "drafting", "validation", "review"] },
  { label: "Ready for you", codes: ["ready"] },
  { label: "Delivered", codes: ["complete"] },
];

function renderTracker(payload) {
  const tracker = byId("status-tracker");
  if (!tracker) return;
  tracker.replaceChildren();
  const active = MILESTONES.findIndex((m) => m.codes.includes(payload.stage));

  for (const [index, milestone] of MILESTONES.entries()) {
    const item = document.createElement("li");
    item.className = index < active ? "done" : index === active ? "now" : "";
    if (index === active) item.setAttribute("aria-current", "step");

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");

    const step = document.createElement("span");
    step.className = "step";
    step.textContent = milestone.label;

    item.append(dot, step);
    tracker.append(item);
  }
}

function renderNotifications(payload) {
  const delivery = notificationDelivery(payload.notifications);
  setText("notification-mode", delivery.label);
  setText("email-setting", delivery.email ? "On" : "Off");
  setText("text-setting", delivery.text ? "Active" : "Not selected");
  setText(
    "milestone-copy",
    delivery.email || delivery.text
      ? `Standard alerts: accepted · waiting on you · ready for review${payload.long_window ? " · research complete on this longer turn" : ""}.`
      : "No email or text alerts are selected. Every checkpoint stays visible on this page.",
  );

}

function render(payload) {
  setText("order-number", `AP-${payload.order}`);
  setText("direction-order", `AP-${payload.order}`);
  // A permanently-published demonstration must not read as neglected; its return
  // time is already computed for the same reason. Real orders show their real stamp.
  setText(
    "last-updated",
    payload.demo
      ? formatCentralTime(new Date(Date.now() - 41 * 60 * 1000).toISOString())
      : formatCentralTime(payload.updated_at),
  );
  renderTracker(payload);
  renderRail(payload);
  renderNotifications(payload);

  const summary = workflowSummary(payload);
  setText("what-happened", summary.happened);
  setText("what-next", summary.next);
  setText("who-acts", summary.actor);

  const accepted = payload.scope !== null;
  const isTrial = payload.scope === "prior-assignment-trial";
  setText("scope", accepted ? SCOPES[payload.scope] : "Pending acceptance");
  setText("price", accepted ? formatPrice(payload.price_cents, payload.scope) : "Pending acceptance");
  setText(
    "return-time",
    !accepted
      ? "Pending acceptance"
      : payload.demo
        ? "Next business day, 3:30 PM CT"
        : formatCentralTime(payload.committed_return),
  );
  setText("return-label", isTrial ? "Illustrative trial return" : accepted ? "Committed return" : "Return time");

  byId("waiting-banner").hidden = !payload.waiting_on_you;
  if (payload.waiting_on_you) byId("waiting-banner").textContent = WAITING_NOTE;
  byId("demo-banner").hidden = !isTrial;
  byId("demo-exit").hidden = !payload.demo;

  byId("loading").hidden = true;
  byId("error-panel").hidden = true;
  byId("status-panel").hidden = false;
}

async function loadStatus() {
  try {
    const { recordId, keyBytes } = parseCapabilityFragment(window.location.hash);
    const response = await fetch(`status-data/${recordId}.json?refresh=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Status record unavailable.");
    const raw = await response.text();
    if (raw.length > 20000) throw new Error("Status record is too large.");
    const payload = await decryptStatus(JSON.parse(raw), recordId, keyBytes);
    render(payload);
    if (payload.demo) setUpReplay(payload);
  } catch {
    showError();
  }
}

// ---- Demonstration replay -------------------------------------------------
// Renders the real page through every stage using the real render path. The
// only value that changes between frames is the stage and the fields a stage
// legitimately governs. No live order is touched and nothing is fetched again.

function replayFrame(base, index) {
  const stage = STAGES[index];
  const acceptedIndex = STAGES.findIndex((s) => s.code === "accepted");
  const beforeAcceptance = index < acceptedIndex;
  return {
    ...base,
    stage: stage.code,
    scope: beforeAcceptance ? null : base.scope,
    price_cents: beforeAcceptance ? null : base.price_cents,
    committed_return: beforeAcceptance ? null : base.committed_return,
    waiting_on_you: stage.code === "comparables",
  };
}

function setUpReplay(base) {
  // A visitor should see this behave exactly like a real tracker that happens to be
  // moving. No controls, no demo chrome: the notice at the foot of the page is what
  // says it is a demonstration.
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reduceMotion) return;

  const STEP_MS = 2100;
  const HOLD_COMPLETE_MS = 3600;
  let cursor = 0;

  const show = (index) => {
    cursor = index;
    render(replayFrame(base, index));
  };

  const loop = () => {
    const atEnd = cursor >= STAGES.length - 1;
    window.setTimeout(() => {
      show(atEnd ? 0 : cursor + 1);
      loop();
    }, atEnd ? HOLD_COMPLETE_MS : STEP_MS);
  };

  show(0);
  loop();
}

loadStatus();

// The capability lives in the fragment, so a new link in the same tab must re-read it.
window.addEventListener("hashchange", () => {
  window.location.reload();
});
