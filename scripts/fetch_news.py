#!/usr/bin/env python3
"""매일 언론사 RSS에서 헤드라인을 모아 공통 팩트 이슈로 정리하고 data/issues.js를 갱신한다.

- 표준 라이브러리만 사용 (pip 설치 불필요)
- 기사 본문은 저장하지 않고, 제목·링크·AI가 새로 쓴 요약만 저장한다.
- GitHub Models(GITHUB_TOKEN)를 사용한다. 실패하면 기존 data/issues.js를 그대로 둔다.
"""
import datetime
import html
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "issues.js")
MODEL = os.environ.get("MODEL", "openai/gpt-4o-mini")
API = "https://models.github.ai/inference/chat/completions"
MIN_ISSUES = 5
MAX_ISSUES = 8
PER_FEED = 25

FEEDS = [
    {"outlet": "조선일보", "side": "conservative", "url": "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml"},
    {"outlet": "동아일보", "side": "conservative", "url": "https://rss.donga.com/total.xml"},
    {"outlet": "한겨레", "side": "progressive", "url": "https://www.hani.co.kr/rss"},
    {"outlet": "경향신문", "side": "progressive", "url": "https://www.khan.co.kr/rss/rssdata/total_news.xml"},
    {"outlet": "프레시안", "side": "progressive", "url": "https://www.pressian.com/api/v3/site/rss/news"},
]
SIDES = ("conservative", "progressive")


def http(url, data=None, headers=None, timeout=40):
    h = {"User-Agent": "Mozilla/5.0 (Factfolio news bot)"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clean(text, limit):
    text = re.sub(r"<[^>]+>", " ", html.unescape(text or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def fetch_feed(feed):
    try:
        root = ET.fromstring(http(feed["url"]))
    except Exception as e:  # 한 언론사가 실패해도 계속 진행
        print("피드 실패:", feed["outlet"], e, file=sys.stderr)
        return []
    items = []
    for it in root.iter("item"):
        title = clean(it.findtext("title"), 120)
        link = (it.findtext("link") or "").strip()
        if title and link.startswith(("http://", "https://")):
            items.append({"outlet": feed["outlet"], "side": feed["side"], "title": title,
                          "url": link, "desc": clean(it.findtext("description"), 160)})
        if len(items) >= PER_FEED:
            break
    return items


def build_prompt(articles):
    lines = [f'[{k}] ({a["outlet"]}) {a["title"]} — {a["desc"]}' for k, a in articles.items()]
    schema = {
        "issues": [{
            "title": "이슈 제목(중립적 표현)", "category": "정치|경제|사회|국제|노동|교육|복지|산업|에너지|문화",
            "emoji": "이모지 1개", "conservative_ids": ["C1"], "progressive_ids": ["P1"],
            "facts": ["양측 기사에 공통으로 나온 객관적 사실 3~4개"],
            "frames": {s: {"keywords": ["핵심 키워드 3개"], "summary": ["해당 진영 해석 요약 3줄"]} for s in SIDES},
            "quiz": {"q": "공통 팩트를 묻는 질문", "options": ["보기 3개"], "answer": 0, "explain": "공통 팩트: ..."},
        }]
    }
    return (
        "아래는 보수 성향(C)과 진보 성향(P) 언론사의 오늘 기사 제목과 요약이다.\n"
        f"같은 사건을 다룬 기사끼리 묶어, 양쪽 성향 기사가 모두 있는 이슈를 {MIN_ISSUES}~{MAX_ISSUES}개 골라라.\n"
        "규칙: (1) facts에는 주어진 제목·요약에서 확인되는 객관적 사실만 쓰고 추측·평가·감정 표현은 금지. "
        "(2) frames는 각 진영 기사에서 드러난 강조점·해석만 중립적 어조로 요약. "
        "(3) 퀴즈는 facts에서만 출제하고 정답은 보기 중 하나. 수치·날짜가 불확실하면 출제하지 말 것. "
        "(4) 기사 본문을 그대로 베끼지 말고 새로 써라. (5) 한국어, JSON만 출력.\n"
        f"출력 형식 예시: {json.dumps(schema, ensure_ascii=False)}\n\n기사 목록:\n" + "\n".join(lines)
    )


def call_model(prompt):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN 이 없습니다.")
    body = json.dumps({
        "model": MODEL, "temperature": 0.2, "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": "너는 정치적으로 중립적인 뉴스 에디터다. JSON만 출력한다."},
                     {"role": "user", "content": prompt}],
    }).encode("utf-8")
    raw = http(API, data=body, timeout=180, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json",
        "Accept": "application/vnd.github+json"})
    try:
        return json.loads(json.loads(raw)["choices"][0]["message"]["content"])
    except ValueError:
        print("모델 응답 이상:", raw[:300])
        raise


def s_list(v, n_min, n_max, limit=140):
    if not isinstance(v, list):
        return None
    out = [clean(str(x), limit) for x in v if str(x).strip()]
    return out[:n_max] if len(out) >= n_min else None


def validate(issue, articles, date_key, n):
    try:
        sources = []
        for side in SIDES:
            ids = [i for i in issue.get(side + "_ids", []) if i in articles and articles[i]["side"] == side]
            if not ids:
                return None
            for i in ids[:3]:
                a = articles[i]
                sources.append({"outlet": a["outlet"], "side": side, "title": a["title"], "url": a["url"]})
        frames = {}
        for side in SIDES:
            kw = s_list(issue["frames"][side]["keywords"], 2, 3, 20)
            sm = s_list(issue["frames"][side]["summary"], 3, 3)
            if not kw or not sm:
                return None
            frames[side] = {"keywords": kw, "summary": sm}
        facts = s_list(issue["facts"], 2, 5)
        q = issue["quiz"]
        opts = s_list(q["options"], 3, 3, 60)
        ans = int(q["answer"])
        if not facts or not opts or not 0 <= ans < len(opts):
            return None
        return {
            "id": f"{date_key}-{n}", "emoji": clean(issue.get("emoji") or "📰", 4) or "📰",
            "category": clean(issue.get("category") or "뉴스", 10), "title": clean(issue["title"], 60),
            "facts": facts, "frames": frames,
            "quiz": {"q": clean(q["q"], 100), "options": opts, "answer": ans, "explain": clean(q["explain"], 120)},
            "sources": sources,
        }
    except (KeyError, TypeError, ValueError):
        return None


def main():
    articles, c, p = {}, 0, 0
    for feed in FEEDS:
        for a in fetch_feed(feed):
            if a["side"] == "conservative":
                c += 1
                articles[f"C{c}"] = a
            else:
                p += 1
                articles[f"P{p}"] = a
    print(f"수집: 보수 {c}건, 진보 {p}건")
    if c < 5 or p < 5:
        sys.exit("기사 수가 부족해 기존 데이터를 유지합니다.")

    result = call_model(build_prompt(articles))
    kst = datetime.timezone(datetime.timedelta(hours=9))
    now = datetime.datetime.now(kst)
    date_key = now.strftime("%Y%m%d")
    issues = []
    for raw in result.get("issues", []):
        v = validate(raw, articles, date_key, len(issues) + 1)
        if v:
            issues.append(v)
        if len(issues) >= MAX_ISSUES:
            break
    if len(issues) < MIN_ISSUES:
        sys.exit(f"유효한 이슈가 {len(issues)}개뿐이라 기존 데이터를 유지합니다.")

    meta = {"mode": "auto", "generatedAt": now.strftime("%Y-%m-%d %H:%M"), "model": MODEL}
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일 (scripts/fetch_news.py). 직접 수정하지 마세요.\n")
        f.write("window.ISSUES_META = " + json.dumps(meta, ensure_ascii=False) + ";\n")
        f.write("window.ISSUES = " + json.dumps(issues, ensure_ascii=False, indent=2) + ";\n")
    print(f"완료: 이슈 {len(issues)}개 저장")


if __name__ == "__main__":
    main()
