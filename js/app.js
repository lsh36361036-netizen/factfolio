(function () {
  const S = Store;
  const app = document.getElementById("app");
  const SIDE = { conservative: "보수", progressive: "진보" };
  const OPP = { conservative: "progressive", progressive: "conservative" };
  let state = S.load();

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 자동 수집 데이터가 HTML로 해석되지 않도록 문자열을 미리 이스케이프 (URL은 safeUrl에서 처리)
  (function sanitize(o, key) {
    if (Array.isArray(o)) o.forEach((v, n) => { if (typeof v === "string") o[n] = esc(v); else sanitize(v); });
    else if (o && typeof o === "object") Object.keys(o).forEach(k => {
      if (typeof o[k] === "string") { if (k !== "url") o[k] = esc(o[k]); } else sanitize(o[k]);
    });
  })(window.ISSUES);
  const issueById = id => ISSUES.find(i => i.id === id);

  function updateChip() {
    document.getElementById("streakChip").textContent = "🔥 " + S.streak(state) + "일 연속";
    document.getElementById("xpChip").textContent = "⭐ " + S.xp(state) + " XP";
  }

  // ---------- 공통 조각 ----------
  function safeUrl(u) { return /^https?:\/\//i.test(u) ? esc(u) : "#"; }

  function xpBar(x, pctOverride) {
    const pct = pctOverride == null ? x.pct : pctOverride;
    return `<div class="bar xp" role="progressbar" aria-label="경험치" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <p class="muted xp-text">${x.next ? `⭐ ${x.have} / ${x.need} XP · 다음 단계 <b>${x.next.emoji} ${x.next.name}</b>까지 ${x.left} XP` : `⭐ ${x.total} XP · 최고 단계 도달! 🎉`}</p>`;
  }

  function dailyProgress() {
    const goal = S.goal(ISSUES.length), n = Math.min(goal, S.todayReads(state).length);
    const done = state.completed.includes(S.today());
    return `<p class="daily ${done ? "done" : ""}" id="dailyProgress">${done ? "✅ 오늘 출석 완료!" : `📖 오늘 ${n} / ${goal}개 읽었어요`}
      <span class="dots">${Array.from({ length: goal }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span></p>`;
  }

  function characterCard(grow) {
    const idx = S.stageIndex(state), st = S.STAGES[idx], x = S.xpInfo(state);
    const nick = state.nickname ? esc(state.nickname) + "님의 " : "";
    return `<section class="card garden" aria-label="성장 현황">
      <div class="avatar ${grow ? "grow" : ""}" id="avatar" aria-hidden="true">${st.emoji}</div>
      <div class="garden-info">
        <h2>${nick}성장 단계: ${st.name}</h2>
        ${xpBar(x)}
        <p class="streak-line">🔥 연속 <b id="streakNum">${S.streak(state)}</b>일 · 누적 출석 ${state.completed.length}일</p>
        ${dailyProgress()}
        <p class="muted">하루에 이슈 ${S.goal(ISSUES.length)}개를 읽고 각 퀴즈를 맞히면 출석이 완료돼요.</p>
      </div>
    </section>`;
  }

  function sourcesHtml(sources, side) {
    return (sources || []).filter(s => !side || s.side === side).map(s =>
      `<li><a href="${safeUrl(s.url)}" rel="noopener noreferrer"><b>${s.outlet}</b> ${s.title} <span aria-hidden="true">↗</span></a></li>`).join("");
  }

  function calendarCard() {
    const t = S.parse(S.today());
    const y = t.getFullYear(), m = t.getMonth();
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const done = new Set(state.completed);
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<div class="day empty"></div>`;
    for (let d = 1; d <= days; d++) {
      const key = S.fmt(new Date(y, m, d));
      const cls = (done.has(key) ? " stamped" : "") + (key === S.today() ? " today" : "");
      cells += `<div class="day${cls}" data-date="${key}">${d}${done.has(key) ? `<span class="stamp" title="완료">✔</span>` : ""}</div>`;
    }
    return `<section class="card" aria-label="출석 달력"><h2>📅 ${y}년 ${m + 1}월 출석 달력</h2>
      <div class="cal">${["일", "월", "화", "수", "목", "금", "토"].map(w => `<div class="dow">${w}</div>`).join("")}${cells}</div></section>`;
  }

  function issueCard(i, extra) {
    const read = S.isRead(state, i.id);
    return `<a class="issue${read ? " read" : ""}" href="#/issue/${i.id}"><span class="emoji">${i.emoji}</span>
      <span><small class="tag">${i.category}</small><strong>${i.title}</strong>${extra || ""}</span>${read ? `<span class="read-mark" title="오늘 읽음">✔ 읽음</span>` : ""}</a>`;
  }

  // 편중 여부와 부족한 관점 판단
  function biasInfo() {
    const w = S.weekStats(state);
    if (!w.total) return { w, biased: false };
    const side = w.ratio.conservative >= 0.7 ? "conservative" : w.ratio.progressive >= 0.7 ? "progressive" : null;
    return { w, biased: !!side, heavy: side, lacking: side ? OPP[side] : null };
  }
  function complementIssues(lacking) {
    const seen = new Set(state.views.filter(v => v.side === lacking).map(v => v.issueId));
    return ISSUES.slice().sort((a, b) => seen.has(a.id) - seen.has(b.id)).slice(0, 3);
  }

  // ---------- 화면 ----------
  function renderHome() {
    const grow = sessionStorage.getItem("factfolio.grow") === "1";
    sessionStorage.removeItem("factfolio.grow");
    const b = biasInfo();
    let rec;
    if (b.biased) {
      rec = `<section class="card rec-top" id="recommend"><h2>🧭 관점 보완형 팩트 이슈</h2>
        <p class="muted">최근 ${SIDE[b.heavy]} 관점을 많이 읽었어요. 반대인 <b>${SIDE[b.lacking]}</b> 관점의 해석을 함께 살펴볼까요?</p>
        <div class="issues">${complementIssues(b.lacking).map(i =>
          issueCard(i, `<em class="kw">${SIDE[b.lacking]} 프레임: ${i.frames[b.lacking].keywords.join(" · ")}</em>`)).join("")}</div></section>`;
    } else {
      rec = `<section class="card" id="recommend"><h2>⭐ 오늘의 추천 이슈</h2>
        <div class="issues">${ISSUES.slice(0, 3).map(i => issueCard(i)).join("")}</div></section>`;
    }
    const rest = ISSUES.map(i => issueCard(i)).join("");
    const nameForm = state.nickname ? "" : `<form class="card nick" id="nickForm"><label>닉네임을 정해 주세요 <input name="nick" maxlength="12" required placeholder="예: 새싹독자"></label><button class="btn">시작하기</button></form>`;
    const meta = window.ISSUES_META || {};
    const note = meta.mode === "auto"
      ? `<p class="muted notice">🤖 ${esc(meta.generatedAt)} 기준 자동 수집 · AI가 요약한 내용이에요. 자세한 내용은 각 이슈의 원문 기사를 확인하세요.</p>`
      : `<p class="muted notice">예시 이슈예요. 자동 수집이 켜지면 매일 실제 기사로 바뀌어요.</p>`;
    app.innerHTML = `<h1>오늘의 이슈</h1>${nameForm}${characterCard(grow)}${note}${rec}
      <section class="card"><h2>📚 전체 이슈</h2><div class="issues">${rest}</div></section>${calendarCard()}`;
    const f = document.getElementById("nickForm");
    if (f) f.addEventListener("submit", e => { e.preventDefault(); state.nickname = f.nick.value.trim(); S.save(state); renderHome(); });
  }

  function renderIssue(id) {
    const i = issueById(id);
    if (!i) { app.innerHTML = `<p>이슈를 찾을 수 없어요. <a href="#/">홈으로</a></p>`; return; }
    const sides = ["conservative", "progressive"];
    app.innerHTML = `<a class="back" href="#/">← 목록</a>
      <h1>${i.emoji} ${i.title}</h1>
      <section class="card brief" id="factBrief"><h2>📌 공통 팩트 브리핑</h2>
        <p class="muted">양측이 공통으로 인정하는 객관적 사실만 모았어요.</p>
        <ul>${i.facts.map(f => `<li>${f}</li>`).join("")}</ul></section>
      <section class="card" id="frameCards"><h2>🔍 핵심 프레임 비교 카드</h2>
        <div class="frames">${sides.map(s => `<div class="frame ${s}"><h3>${SIDE[s]}</h3>
          <div class="chips">${i.frames[s].keywords.map(k => `<span class="chip">${k}</span>`).join("")}</div></div>`).join("")}</div>
        <div class="tabs" role="tablist">${sides.map(s => `<button role="tab" class="tab ${s}" data-side="${s}" aria-selected="false">${SIDE[s]} 관점 보기</button>`).join("")}</div>
        <div class="layer" id="layer" role="tabpanel" hidden></div></section>
      <section class="card sources" id="sources"><h2>📰 참고한 기사 (원문 보기)</h2>
        <p class="muted">${(i.sources || []).some(s => s.search) ? "예시 이슈라 언론사별 관련 기사 검색 링크를 연결했어요." : "이 요약은 아래 기사를 참고했어요. 더 자세한 내용은 원문에서 확인하세요."}</p>
        <div class="frames">${sides.map(s => `<div class="frame ${s}"><h3>${SIDE[s]} 언론</h3><ul class="src">${sourcesHtml(i.sources, s) || "<li class='muted'>링크 없음</li>"}</ul></div>`).join("")}</div></section>
      <section class="card quiz" id="quiz"><h2>📝 오늘의 팩트 체크 퀴즈</h2>
        <p class="muted">💡 위에서 보수/진보 관점 탭을 열어 읽으면 '내 균형 리포트'의 관점 비율에 반영돼요.</p>
        <p><b>${i.quiz.q}</b></p>
        <div class="opts">${i.quiz.options.map((o, n) => `<button class="opt" data-n="${n}">${o}</button>`).join("")}</div>
        <p class="feedback" id="feedback" aria-live="polite"></p>
        <button class="btn" id="doneBtn" disabled>이 이슈 완료 (+${S.XP_PER_READ} XP)</button></section>`;

    const layer = document.getElementById("layer");
    app.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
      const s = t.dataset.side;
      app.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === t ? "true" : "false"));
      layer.hidden = false;
      layer.className = "layer " + s;
      const links = sourcesHtml(i.sources, s);
      layer.innerHTML = `<h3>${SIDE[s]} 진영의 3줄 핵심 해석</h3><ol>${i.frames[s].summary.map(l => `<li>${l}</li>`).join("")}</ol>
        ${links ? `<p class="muted">더 자세히 보기</p><ul class="src">${links}</ul>` : ""}`;
      S.recordView(state, i.id, s);
    }));

    const doneBtn = document.getElementById("doneBtn"), fb = document.getElementById("feedback");
    let correct = false;
    if (S.isRead(state, i.id)) {
      correct = true;
      doneBtn.disabled = true;
      app.querySelectorAll(".opt").forEach(o => { o.disabled = true; if (+o.dataset.n === i.quiz.answer) o.classList.add("right"); });
      fb.innerHTML = "오늘 이미 읽은 이슈예요. " + i.quiz.explain; fb.className = "feedback ok";
    }
    app.querySelectorAll(".opt").forEach(o => o.addEventListener("click", () => {
      if (correct) return;
      if (+o.dataset.n === i.quiz.answer) {
        correct = true; o.classList.add("right");
        fb.innerHTML = "정답! " + i.quiz.explain; fb.className = "feedback ok";
        doneBtn.disabled = false;
      } else {
        o.classList.add("wrong"); o.disabled = true;
        const pn = S.penalize(state, i.id, +o.dataset.n);
        updateChip();
        fb.textContent = (pn.applied ? `틀렸어요 😢 -${pn.amount} XP. ` : "틀렸어요. ") + "공통 팩트 브리핑을 다시 확인해 보세요."; fb.className = "feedback bad";
      }
    }));
    doneBtn.addEventListener("click", () => {
      if (!correct || S.isRead(state, i.id)) return;
      const r = S.markRead(state, i.id, ISSUES.length);
      updateChip();
      doneBtn.disabled = true;
      if (r.dayComplete) sessionStorage.setItem("factfolio.grow", "1");
      showReward(r, i.id);
    });
  }

  function showReward(r, currentId) {
    const x = r.xpAfter, idx = S.stageIndex(state), st = S.STAGES[idx];
    const prev = S.STAGES[Math.max(0, idx - (r.leveledUp ? 1 : 0))];
    const next = ISSUES.find(q => q.id !== currentId && !S.isRead(state, q.id));
    const startPct = r.leveledUp ? 0 : r.xpBefore.pct;
    const head = r.dayComplete
      ? `<div class="avatar big grow" id="rAvatar">${prev.emoji}</div><h2>🎉 오늘 출석 완료! 🔥 연속 ${S.streak(state)}일</h2>
         <p>${r.leveledUp ? `${prev.name} → <b>${st.name}</b>(으)로 성장했어요!` : `현재 단계: <b>${st.name}</b>`}</p>
         <p class="stamp-line">오늘 출석 도장 ✔ 찍힘</p>
<p class="bonus-msg">🎁 오늘 하루 ${S.goal(ISSUES.length)}개를 모두 읽었어요! 보너스 +${S.XP_BONUS} XP가 지급됐어요.</p>`
      : `<div class="avatar big" id="rAvatar">${st.emoji}</div><h2>+${S.XP_PER_READ} XP!</h2>
         <p>오늘 <b>${r.count} / ${r.goal}</b>개 읽었어요. ${r.goal - r.count}개만 더 읽으면 출석 완료!</p>`;
    const ov = document.createElement("div");
    ov.className = "overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-label", "보상");
    ov.innerHTML = `<div class="reward">${head}
      <div class="bar xp"><span id="rBar" style="width:${startPct}%"></span></div>
      <p class="muted xp-text">${x.next ? `⭐ ${x.have} / ${x.need} XP · ${x.next.name}까지 ${x.left} XP` : `⭐ ${x.total} XP · 최고 단계!`}</p>
      <div class="reward-actions">${!r.dayComplete && next ? `<a class="btn" href="#/issue/${next.id}">다음 이슈 읽기</a>` : ""}<a class="btn ${!r.dayComplete && next ? "sub" : ""}" href="#/">메인으로</a></div></div>`;
    document.body.appendChild(ov);
    setTimeout(() => { const b = document.getElementById("rBar"); if (b) b.style.width = x.pct + "%"; }, 80);
    if (r.leveledUp) setTimeout(() => { const a = document.getElementById("rAvatar"); if (a) { a.textContent = st.emoji; a.classList.remove("grow"); void a.offsetWidth; a.classList.add("grow"); } }, 700);
    ov.querySelectorAll("a").forEach(a => a.addEventListener("click", () => ov.remove()));
  }

  function renderReport() {
    const b = biasInfo(), w = b.w;
    const from = S.addDays(S.today(), -6);
    const weekRead = state.reads.filter(r => r.date >= from);
    const viewedKeys = new Set(state.views.filter(v => v.date >= from).map(v => v.date + "|" + v.issueId));
    const factOnly = weekRead.filter(r => !viewedKeys.has(r.date + "|" + r.issueId)).length;
    let body;
    if (!w.total) {
      body = weekRead.length
        ? `<p class="muted">공통 팩트 위주로 읽었어요. 보수/진보 관점 탭도 열어 보면 성향 비율 차트가 나타나요.</p>`
        : `<p class="muted">최근 1주일간 읽은 이슈가 없어요. 오늘의 이슈를 읽어 보세요.</p>`;
    } else {
      const c = Math.round(w.ratio.conservative * 100), p = 100 - c;
      body = `<h3>관점 탭 열람 비율</h3><div class="donut-wrap"><div class="donut" role="img" aria-label="보수 ${c}%, 진보 ${p}%" style="background:conic-gradient(var(--cons) 0 ${c}%, var(--prog) ${c}% 100%)"><span>${w.total}회</span></div>
        <ul class="legend"><li><i class="dot cons"></i>보수 관점 ${c}% (${w.counts.conservative}회)</li><li><i class="dot prog"></i>진보 관점 ${p}% (${w.counts.progressive}회)</li></ul></div>
        <div class="hbar"><span class="cons" style="width:${c}%">${c}%</span><span class="prog" style="width:${p}%">${p}%</span></div>`;
      body += b.biased
        ? `<p class="alert" id="biasMsg">⚠️ 최근 특정 관점의 해석을 많이 접했어요 <small>(${SIDE[b.heavy]} ${Math.round(w.ratio[b.heavy] * 100)}%)</small></p>`
        : `<p class="ok-msg">👍 균형 있게 읽고 있어요!</p>`;
    }
    let rec = "";
    if (b.biased) rec = `<h3>🧭 관점 보완형 팩트 이슈</h3><div class="issues">${complementIssues(b.lacking).map(i => issueCard(i, `<em class="kw">${SIDE[b.lacking]}: ${i.frames[b.lacking].keywords.join(" · ")}</em>`)).join("")}</div><p><a href="#/">메인 추천 섹션에서 보기 →</a></p>`;
    const summary = `<div class="stat-row" id="readSummary">
        <div class="stat"><b>${weekRead.length}</b><span>읽은 이슈</span></div>
        <div class="stat"><b>${factOnly}</b><span>공통 팩트만 읽음</span></div>
        <div class="stat"><b>${w.total}</b><span>관점 탭 열람</span></div></div>
      <p class="muted">읽은 이슈 수는 퀴즈를 맞힌 이슈 기준이에요. 관점 비율(편중 분석)은 관점 탭을 연 기록으로 계산돼요.</p>`;
    app.innerHTML = `<h1>내 균형 리포트</h1><section class="card"><h2>최근 7일 읽기 현황</h2>${summary}${body}${rec}</section>
      <section class="card demo"><h2>🧪 테스트 도구</h2><p class="muted">기능 확인용 버튼이에요.</p>
        <button class="btn sub" id="demoProg">진보 편중 예시 넣기</button>
        <button class="btn sub" id="demoCons">보수 편중 예시 넣기</button>
        <button class="btn sub danger" id="reset">내 기록 모두 지우기</button></section>`;
    const fill = major => {
      const minor = OPP[major];
      for (let n = 0; n < 10; n++) state.views.push({ date: S.addDays(S.today(), -(n % 5)), issueId: ISSUES[n % ISSUES.length].id, side: n < 8 ? major : minor });
      S.save(state); renderReport();
    };
    document.getElementById("demoProg").onclick = () => fill("progressive");
    document.getElementById("demoCons").onclick = () => fill("conservative");
    document.getElementById("reset").onclick = () => { if (confirm("모든 기록을 지울까요?")) { state = S.load(); localStorage.removeItem("factfolio.v1"); state = S.load(); updateChip(); renderReport(); } };
  }

  function route() {
    document.querySelectorAll(".overlay").forEach(o => o.remove());
    state = S.load();
    updateChip();
    const h = location.hash.replace(/^#/, "") || "/";
    document.querySelectorAll("nav a").forEach(a => a.classList.toggle("active", (h === "/" && a.dataset.nav === "home") || (h === "/report" && a.dataset.nav === "report")));
    if (h.startsWith("/issue/")) renderIssue(h.slice(7));
    else if (h === "/report") renderReport();
    else renderHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();
})();


