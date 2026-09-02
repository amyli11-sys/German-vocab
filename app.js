/* ---------- Config ---------- */
const LEARNING_STEPS_MIN = [1, 10];       // minutes: new-card learning steps (like Anki default)
const RELEARN_STEPS_MIN = [10];           // minutes: steps after a lapse
const GRADUATE_INTERVAL_DAYS = 1;         // interval after finishing learning steps
const EASY_GRADUATE_INTERVAL_DAYS = 4;    // interval if "Easy" pressed while learning
const STARTING_EASE = 2.5;
const MIN_EASE = 1.3;
const STORAGE_KEY = "de1000_cards_v1";
const META_KEY = "de1000_meta_v1";

/* ---------- State ---------- */
let WORDS = [];          // static word data from data.json
let cards = {};          // rank -> card state, persisted
let meta = {};           // { lastDate, newIntroducedToday, newPerDay }
let queue = [];          // array of ranks to review this session
let currentIdx = 0;
let currentGrade = null;
let flipStage = 0;       // 0 = front (word), 1 = context sentence, 2 = full back
let resetArmed = false;

/* ---------- Persistence ---------- */
function loadCards() {
  try { cards = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch (e) { cards = {}; }
}
function saveCards() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}
function loadMeta() {
  try { meta = JSON.parse(localStorage.getItem(META_KEY)) || {}; }
  catch (e) { meta = {}; }
  const today = new Date().toDateString();
  if (meta.lastDate !== today) {
    meta.lastDate = today;
    meta.newIntroducedToday = 0;
  }
  if (!meta.newPerDay) meta.newPerDay = 20;
  saveMeta();
}
function saveMeta() {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

/* ---------- Card init ---------- */
function ensureCard(rank) {
  if (!cards[rank]) {
    cards[rank] = {
      status: "new",     // new | learning | review | relearning
      step: 0,
      interval: 0,       // days
      ease: STARTING_EASE,
      due: 0,             // epoch ms
      reps: 0,
      lapses: 0
    };
  }
  return cards[rank];
}

/* ---------- Scheduling: preview intervals for the 4 buttons ---------- */
function formatInterval(mins) {
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months * 10) / 10}mo`;
  return `${Math.round((months / 12) * 10) / 10}y`;
}

function previewIntervals(card) {
  const out = {};
  if (card.status === "new" || card.status === "learning" || card.status === "relearning") {
    const steps = card.status === "relearning" ? RELEARN_STEPS_MIN : LEARNING_STEPS_MIN;
    out.again = formatInterval(steps[0]);
    out.hard = formatInterval(steps[Math.min(card.step, steps.length - 1)] * 1.5);
    const isLastStep = card.step >= steps.length - 1;
    out.good = isLastStep
      ? formatInterval(GRADUATE_INTERVAL_DAYS * 1440)
      : formatInterval(steps[card.step + 1]);
    out.easy = formatInterval(EASY_GRADUATE_INTERVAL_DAYS * 1440);
  } else {
    // review card
    out.again = formatInterval(1440); // goes to relearning, next due ~1 day after graduating
    out.hard = formatInterval(Math.max(card.interval * 1.2, card.interval + 1) * 1440);
    out.good = formatInterval(Math.max(card.interval * card.ease, card.interval + 1) * 1440);
    out.easy = formatInterval(Math.max(card.interval * card.ease * 1.3, card.interval + 1) * 1440);
  }
  return out;
}

/* ---------- Scheduling: apply a grade ---------- */
function gradeCard(rank, grade) {
  const card = ensureCard(rank);
  const now = Date.now();

  if (card.status === "new" || card.status === "learning" || card.status === "relearning") {
    const steps = card.status === "relearning" ? RELEARN_STEPS_MIN : LEARNING_STEPS_MIN;

    if (grade === "again") {
      card.step = 0;
      card.due = now + steps[0] * 60000;
      card.status = card.status === "relearning" ? "relearning" : "learning";
      if (card.status !== "relearning") card.lapses += 0; // still learning, not a real lapse
    } else if (grade === "hard") {
      const stepMin = steps[Math.min(card.step, steps.length - 1)] * 1.5;
      card.due = now + stepMin * 60000;
    } else if (grade === "good") {
      if (card.step >= steps.length - 1) {
        // graduate
        card.status = "review";
        card.interval = GRADUATE_INTERVAL_DAYS;
        card.due = now + card.interval * 86400000;
      } else {
        card.step += 1;
        card.due = now + steps[card.step] * 60000;
      }
    } else if (grade === "easy") {
      card.status = "review";
      card.interval = EASY_GRADUATE_INTERVAL_DAYS;
      card.ease = STARTING_EASE;
      card.due = now + card.interval * 86400000;
    }
  } else {
    // status === "review"
    if (grade === "again") {
      card.lapses += 1;
      card.ease = Math.max(MIN_EASE, card.ease - 0.2);
      card.interval = Math.max(1, Math.round(card.interval * 0.5));
      card.status = "relearning";
      card.step = 0;
      card.due = now + RELEARN_STEPS_MIN[0] * 60000;
    } else if (grade === "hard") {
      card.ease = Math.max(MIN_EASE, card.ease - 0.15);
      card.interval = Math.max(card.interval * 1.2, card.interval + 1);
      card.due = now + card.interval * 86400000;
    } else if (grade === "good") {
      card.interval = Math.max(card.interval * card.ease, card.interval + 1);
      card.due = now + card.interval * 86400000;
    } else if (grade === "easy") {
      card.ease = card.ease + 0.15;
      card.interval = Math.max(card.interval * card.ease * 1.3, card.interval + 1);
      card.due = now + card.interval * 86400000;
    }
  }
  card.reps += 1;
  saveCards();
}

/* ---------- Queue building ---------- */
function buildQueue() {
  const now = Date.now();
  const due = [];
  const learningDue = [];
  const fresh = [];

  WORDS.forEach(w => {
    const c = cards[w.rank];
    if (!c || c.status === "new") {
      fresh.push(w.rank);
    } else if ((c.status === "learning" || c.status === "relearning") && c.due <= now) {
      learningDue.push(w.rank);
    } else if (c.status === "review" && c.due <= now) {
      due.push(w.rank);
    }
  });

  const remainingNewSlots = Math.max(0, meta.newPerDay - meta.newIntroducedToday);
  const newBatch = fresh.slice(0, remainingNewSlots);

  let q = [...learningDue, ...due, ...newBatch];
  // light shuffle so it's not perfectly grouped
  for (let i = q.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [q[i], q[j]] = [q[j], q[i]];
  }
  return q;
}

/* ---------- UI: dashboard ---------- */
function refreshDashboard() {
  const now = Date.now();
  let due = 0, fresh = 0, learned = 0;
  WORDS.forEach(w => {
    const c = cards[w.rank];
    if (!c || c.status === "new") fresh++;
    else {
      learned++;
      if ((c.status === "review" && c.due <= now) || ((c.status === "learning" || c.status === "relearning") && c.due <= now)) due++;
    }
  });
  document.getElementById("dueCount").textContent = due;
  document.getElementById("newCount").textContent = Math.min(fresh, Math.max(0, meta.newPerDay - meta.newIntroducedToday));
  document.getElementById("learnedCount").textContent = learned;
  document.getElementById("newPerDaySetting").value = meta.newPerDay;

  const hint = document.getElementById("emptyHint");
  if (due === 0 && fresh === 0) {
    hint.textContent = "You've cleared every word in this deck. 🎉";
  } else if (due === 0 && meta.newIntroducedToday >= meta.newPerDay) {
    hint.textContent = "No reviews due right now — you've also hit today's new-card limit.";
  } else {
    hint.textContent = "";
  }
}

/* ---------- UI: views ---------- */
function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

/* ---------- Review flow ---------- */
function startReview() {
  queue = buildQueue();
  currentIdx = 0;
  if (queue.length === 0) {
    refreshDashboard();
    showView("view-home");
    return;
  }
  showView("view-review");
  renderCurrentCard();
}

function highlightSentence(sentence, highlight) {
  if (!highlight) return sentence;
  const idx = sentence.indexOf(highlight);
  if (idx === -1) return sentence;
  const before = sentence.slice(0, idx);
  const after = sentence.slice(idx + highlight.length);
  const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${esc(before)}<span class="hl">${esc(highlight)}</span>${esc(after)}`;
}

function renderCurrentCard() {
  if (currentIdx >= queue.length) {
    endSession();
    return;
  }
  const rank = queue[currentIdx];
  const w = WORDS.find(x => x.rank === rank);
  const c = ensureCard(rank);
  const wasNew = c.status === "new";
  if (wasNew) {
    c.status = "learning";
    c.step = 0;
    meta.newIntroducedToday += 1;
    saveMeta();
  }

  flipStage = 0;
  document.getElementById("posTag").textContent = w.pos.split("/")[0];
  document.getElementById("germanWord").textContent = w.german;
  document.getElementById("contextSentenceDE").innerHTML = highlightSentence(w.sentenceDE, w.highlight);
  document.getElementById("backEnglish").textContent = w.english;
  document.getElementById("backSentenceDE").innerHTML = highlightSentence(w.sentenceDE, w.highlight);
  document.getElementById("backSentenceEN").textContent = w.sentenceEN;

  document.querySelector(".card-front").classList.remove("hidden");
  document.querySelector(".card-context").classList.add("hidden");
  document.querySelector(".card-back").classList.add("hidden");
  document.getElementById("gradeButtons").classList.add("hidden");
  document.getElementById("flipBtn").classList.remove("hidden");
  document.getElementById("flipBtn").textContent = "Show Sentence";

  const preview = previewIntervals(c);
  document.getElementById("ivAgain").textContent = preview.again;
  document.getElementById("ivHard").textContent = preview.hard;
  document.getElementById("ivGood").textContent = preview.good;
  document.getElementById("ivEasy").textContent = preview.easy;

  const pct = Math.round((currentIdx / queue.length) * 100);
  document.getElementById("progressFill").style.width = pct + "%";
}

function advanceFlip() {
  if (flipStage === 0) {
    flipStage = 1;
    document.querySelector(".card-front").classList.add("hidden");
    document.querySelector(".card-context").classList.remove("hidden");
    document.getElementById("flipBtn").textContent = "Show Answer";
  } else if (flipStage === 1) {
    flipStage = 2;
    document.querySelector(".card-context").classList.add("hidden");
    document.querySelector(".card-back").classList.remove("hidden");
    document.getElementById("gradeButtons").classList.remove("hidden");
    document.getElementById("flipBtn").classList.add("hidden");
  }
}

function submitGrade(grade) {
  const rank = queue[currentIdx];
  gradeCard(rank, grade);
  currentIdx += 1;
  renderCurrentCard();
}

function endSession() {
  document.getElementById("progressFill").style.width = "100%";
  const remaining = buildQueue().length;
  document.getElementById("doneMsg").textContent = remaining > 0
    ? `${remaining} more card(s) are due shortly — come back soon.`
    : "Nothing else is due. Great work today.";
  showView("view-done");
  refreshDashboard();
}

/* ---------- Stats view ---------- */
function renderStats() {
  const total = WORDS.length;
  let learned = 0, mature = 0, lapses = 0;
  Object.values(cards).forEach(c => {
    if (c.status !== "new") learned++;
    if (c.status === "review" && c.interval >= 21) mature++;
    lapses += c.lapses || 0;
  });
  const body = document.getElementById("statsBody");
  body.innerHTML = `
    <div class="stats-line"><span>Total words in deck</span><span>${total}</span></div>
    <div class="stats-line"><span>Cards started</span><span>${learned}</span></div>
    <div class="stats-line"><span>Mature (21d+ interval)</span><span>${mature}</span></div>
    <div class="stats-line"><span>Total lapses</span><span>${lapses}</span></div>
    <div class="stats-line"><span>New cards left</span><span>${total - learned}</span></div>
  `;
}

/* ---------- Learned words view ---------- */
function renderLearnedList() {
  const list = document.getElementById("learnedList");
  const learnedWords = WORDS.filter(w => {
    const c = cards[w.rank];
    return c && c.status !== "new";
  }).sort((a, b) => a.rank - b.rank);

  if (learnedWords.length === 0) {
    list.innerHTML = `<div class="learned-empty">No words learned yet — start a review to begin.</div>`;
    return;
  }

  list.innerHTML = learnedWords.map(w => `
    <div class="learned-row">
      <span class="learned-german">${w.german}</span>
      <span class="learned-english">${w.english}</span>
    </div>
  `).join("");
}

/* ---------- Init ---------- */
async function init() {
  const res = await fetch("data.json");
  WORDS = await res.json();
  loadCards();
  loadMeta();
  refreshDashboard();

  document.getElementById("startBtn").addEventListener("click", startReview);
  document.getElementById("flipBtn").addEventListener("click", advanceFlip);
  document.getElementById("flashcard").addEventListener("click", () => { if (flipStage < 2) advanceFlip(); });

  document.querySelectorAll(".grade-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      submitGrade(btn.dataset.grade);
    });
  });

  document.getElementById("exitReviewBtn").addEventListener("click", () => {
    refreshDashboard();
    showView("view-home");
  });
  document.getElementById("doneBackBtn").addEventListener("click", () => {
    refreshDashboard();
    showView("view-home");
  });

  document.getElementById("statsBtn").addEventListener("click", () => {
    renderStats();
    showView("view-stats");
  });
  document.getElementById("statsBackBtn").addEventListener("click", () => {
    refreshDashboard();
    showView("view-home");
  });

  document.getElementById("learnedCard").addEventListener("click", () => {
    renderLearnedList();
    showView("view-learned");
  });
  document.getElementById("learnedBackBtn").addEventListener("click", () => {
    refreshDashboard();
    showView("view-home");
  });

  document.getElementById("newPerDaySetting").addEventListener("change", (e) => {
    meta.newPerDay = Math.max(0, parseInt(e.target.value) || 0);
    saveMeta();
    refreshDashboard();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!resetArmed) {
      resetArmed = true;
      const btn = document.getElementById("resetBtn");
      btn.textContent = "Tap again to confirm — this can't be undone";
      setTimeout(() => {
        resetArmed = false;
        btn.textContent = "Reset all progress";
      }, 4000);
      return;
    }
    resetArmed = false;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
    document.getElementById("resetBtn").textContent = "Reset all progress";
    loadCards();
    loadMeta();
    refreshDashboard();
    showView("view-home");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
