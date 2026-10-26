// localStorage 기반 저장소. 주소에 ?today=YYYY-MM-DD 를 붙이면 날짜를 바꿔 테스트할 수 있습니다.
(function () {
  const KEY = "factfolio.v1";
  const DAILY_GOAL = 5;     // 하루 출석 완료에 필요한 이슈 수
  const XP_PER_READ = 10;   // 이슈 1개를 읽고 퀴즈를 맞힐 때
  const XP_BONUS = 20;      // 하루 목표 달성 보너스
  const XP_PER_DAY = DAILY_GOAL * XP_PER_READ + XP_BONUS;
  // min: 성장에 필요한 목표 경험치 = min × 70 XP (min은 감점이 없을 때의 출석일 수)
  const STAGES = [
    { min: 0, emoji: "👶", name: "아기" },
    { min: 1, emoji: "🧒", name: "어린이" },
    { min: 3, emoji: "🎒", name: "초등학생" },
    { min: 5, emoji: "📖", name: "중학생" },
    { min: 7, emoji: "🧑‍🎓", name: "고등학생" },
    { min: 10, emoji: "✏️", name: "수험생" },
    { min: 14, emoji: "📝", name: "수능 보는 학생" },
    { min: 18, emoji: "🎉", name: "대학 합격생" },
    { min: 22, emoji: "🏫", name: "대학생" },
    { min: 26, emoji: "💼", name: "취준생" },
    { min: 30, emoji: "🧑‍💼", name: "회사원" },
    { min: 45, emoji: "🧑‍🏫", name: "전문가(학자)" },
    { min: 60, emoji: "🧙", name: "마법사" }
  ];

  function pad(n) { return String(n).padStart(2, "0"); }
  function fmt(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function today() {
    const p = new URLSearchParams(location.search).get("today");
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : fmt(new Date());
  }
  function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }

  function fresh() { return { nickname: "", completed: [], views: [], reads: [], penalties: [] }; }
  function load() {
    try { return Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY)) || {}); }
    catch (e) { return fresh(); }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }

  // 오늘 필요한 이슈 수 (이슈가 5개보다 적은 날을 대비)
  function goal(issueCount) { return Math.max(1, Math.min(DAILY_GOAL, issueCount)); }
  function todayReads(state) { return state.reads.filter(r => r.date === today()).map(r => r.issueId); }
  function isRead(state, issueId) { return todayReads(state).includes(issueId); }

  // 오늘(없으면 어제)부터 거꾸로 이어지는 연속 출석일 수
  function streak(state) {
    const set = new Set(state.completed);
    let t = today();
    if (!set.has(t)) t = addDays(t, -1);
    let n = 0;
    while (set.has(t)) { n++; t = addDays(t, -1); }
    return n;
  }
  function stageIndex(state) {
    if (typeof state.stage !== "number") { state.stage = 0; syncStage(state); }
    return state.stage;
  }
  // 경험치가 다음 호칭의 목표(최소 출석일 × 70 XP)에 도달해야만 성장한다. 한 번 오른 호칭은 내려가지 않는다.
  function syncStage(state) {
    if (typeof state.stage !== "number") state.stage = 0;
    while (STAGES[state.stage + 1] && xp(state) >= STAGES[state.stage + 1].min * XP_PER_DAY) state.stage++;
    return state.stage;
  }
  // 경험치 = 완료한 날 × 70 + 오늘 진행 중인 읽기 × 10 − 오답 벌점(오답 1회당 10)
  function xp(state) {
    const doneToday = state.completed.includes(today());
    const gained = state.completed.length * XP_PER_DAY + (doneToday ? 0 : todayReads(state).length * XP_PER_READ);
    return Math.max(0, gained - state.penalties.length * XP_PER_READ);
  }
  // 현재 호칭 구간의 경험치 바 정보 (호칭은 출석일 기준이라 XP가 줄어도 강등되지 않고 바만 0까지 내려간다)
  function xpInfo(state) {
    const idx = stageIndex(state), cur = STAGES[idx], next = STAGES[idx + 1];
    const total = xp(state);
    if (!next) return { total, cur, next: null, pct: 100, have: total, need: 0, left: 0 };
    const base = cur.min * XP_PER_DAY, need = (next.min - cur.min) * XP_PER_DAY;
    const have = Math.max(0, Math.min(need, total - base));
    return { total, cur, next, have, need, left: need - have, pct: Math.round((have / need) * 100) };
  }

  // 오답: 같은 날 같은 이슈의 같은 보기는 한 번만 감점
  function penalize(state, issueId, option) {
    const date = today();
    if (state.penalties.some(p => p.date === date && p.issueId === issueId && p.option === option)) return { applied: false };
    const before = xpInfo(state);
    state.penalties.push({ date, issueId, option });
    save(state);
    return { applied: true, amount: XP_PER_READ, xpBefore: before, xpAfter: xpInfo(state) };
  }

  // 이슈의 성향 탭을 그날 처음 열면 읽기 기록으로 남긴다.
  function recordView(state, issueId, side) {
    const date = today();
    if (state.views.some(v => v.date === date && v.issueId === issueId && v.side === side)) return false;
    state.views.push({ date, issueId, side });
    save(state);
    return true;
  }
  // 최근 7일(오늘 포함) 성향별 열람 수
  function weekStats(state) {
    const from = addDays(today(), -6), to = today();
    const c = { conservative: 0, progressive: 0 };
    state.views.forEach(v => { if (v.date >= from && v.date <= to) c[v.side]++; });
    const total = c.conservative + c.progressive;
    return { counts: c, total, ratio: total ? { conservative: c.conservative / total, progressive: c.progressive / total } : null };
  }

  // 퀴즈를 맞힌 이슈를 읽음으로 기록. 오늘 목표를 채우면 출석 완료 처리.
  function markRead(state, issueId, issueCount) {
    const g = goal(issueCount);
    if (isRead(state, issueId)) return { alreadyRead: true, count: todayReads(state).length, goal: g };
    const before = stageIndex(state), xpBefore = xpInfo(state);
    state.reads.push({ date: today(), issueId });
    const count = todayReads(state).length;
    let dayComplete = false;
    if (count >= g && !state.completed.includes(today())) {
      state.completed.push(today());
      dayComplete = true;
    }
    save(state);
    syncStage(state);
    save(state);
    return { alreadyRead: false, count, goal: g, dayComplete, leveledUp: stageIndex(state) > before, xpBefore, xpAfter: xpInfo(state) };
  }

  window.Store = { STAGES, DAILY_GOAL, XP_PER_READ, XP_BONUS, today, addDays, parse, fmt, load, save, goal, todayReads, isRead,
    streak, stageIndex, xp, xpInfo, penalize, recordView, weekStats, markRead };
})();


