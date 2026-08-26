# 장애 기록 (다음에 바로 읽을 것)

Linear에서 “훅이 안 된다 / Working에 남는다 / Grok이 말이 없다”고 하면 **터널이 죽은 게 아닐 수 있다.**  
먼저 `agent.log`와 `token.json`을 본다. 증상 문장 → 이 파일의 케이스를 매칭한다.

운영 경로: Linear Agent Session 웹훅 → `https://grokbot.win/webhook` → 맥 `:8787` → GraphQL(Grok 앱 토큰) → `grok -p`.

```bash
curl -fsS http://127.0.0.1:8787/health
curl -fsS https://grokbot.win/health
tail -80 ~/.grok/linear-agent/agent.log
python3 -c 'import json;from pathlib import Path;d=json.loads(Path.home().joinpath(".grok/linear-agent/token.json").read_text());print(sorted(d.keys()), "expires_at", d.get("expires_at"))'
```

---

## 2026-08-26 — 웹훅은 오는데 Linear 세션이 안 움직임 (GraphQL 401)

**사용자가 한 말:** “리니어에서 훅으로 통신이 안 되는 듯”, “지금 안 된다”.

**겉보기:** `@Grok` / 위임해도 thought가 안 뜨거나 세션이 멈춘 것처럼 보임. health는 `ok`.

**로그 지문 (`agent.log`):**

```
POST /webhook
webhook handler failed Error: Linear GraphQL HTTP 401
    at graphql (.../src/linear.ts)
    at async Object.thought (.../src/linear.ts)
    at async handleWebhook (.../src/orchestrator.ts)
```

**실제:** 웹훅은 Cloudflare까지 정상. 수신기가 첫 thought를 올리려 GraphQL `agentActivityCreate`를 치다 **Grok 앱 OAuth access_token 만료(24h)** 로 401.

**원인:** 최초 OAuth 교환이 `token.json`에 `access_token`만 저장하고 `refresh_token`을 버림. 토큰 나이 ≈ 33시간. refresh 불가.

**조치:**

1. 코드 `284693f` — `token.json`에 `refresh_token` + `expires_at` 저장, 만료 1분 전 갱신.
2. **한 번** workspace admin으로 Authorize. 끝나면 콜백 페이지 `ok`.
3. `token.json` 키에 `refresh_token`이 있어야 한다. 없으면 예전 교환 코드다.
4. 재인증 후 수신기 재시작은 필요 없음(웹훅마다 `token.json`을 다시 읽음). 코드 배포 직후라면 `start.sh` 재시작.

**Authorize URL:** 수신기 기동 로그 `OAuth:` 줄, 또는 README 설치 절.

**헷갈리지 말 것:** `grokbot.win/health` = ok 이어도 세션은 안 움직인다. health는 터널+HTTP만 본다. GraphQL 앱 토큰은 별개다.

---

## 2026-08-25 — 일감은 끝났는데 Linear 세션이 Working + Stop requested

**사용자가 한 말 / 화면:** Working… `Grok이 JHJ-53 작업을 이어서 진행합니다` 다음 줄 `지금 JHJ-56 작업 중`. 우측 **Stop requested**. 본인 일감은 이미 끝난 상태.

**로그/DB 지문:**

- sqlite `JHJ-53|complete` 인데 `queued_prompt`가 큼.
- `JHJ-56|complete`, 실제 grok는 다른 이슈(당시 `JHJ-55`) running.
- `agent.log`에 해당 세션의 `response`/`error`가 없음. thought만.

**실제:** 전역 슬롯이 **1개**라 JHJ-53 후속 멘션이 JHJ-56 뒤에 FIFO. 대기 중엔 thought만 보내서 Linear 세션이 Working에 고정. 사용자가 Stop을 눌러도 `prompted` + `agentActivity.signal: "stop"`을 무시해서 세션이 안 닫힘.

**조치:** 코드 `ca47df6`

- 전역 running 최대 5 (`config.toml` `max_running = 5`). 6번째부터 FIFO.
- 대기 thought: `대기열 N번. 지금 실행 중: … (최대 5)`.
- Stop이면 grok abort + `response`로 세션 종료.
- 당시 JHJ-53 세션은 GraphQL `agentActivityCreate` response로 수동 종료.

**헷갈리지 말 것:** “지금 JHJ-56 작업 중”은 **그 세션의 grok가 JHJ-56을 하는 게 아님.** 슬롯 홀더 안내일 뿐. 홀더가 바뀌어도 예전 thought는 그대로 남는다.

---

## 2026-08-25 — live `grok -p`가 이슈 본문을 모름

**증상:** Linear에는 제목/본문/스크린샷이 있는데 grok 프롬프트가 거의 비어 있음. worktree 이름만으로 추측 구현.

**원인:** 웹훅 `agentSession.promptContext`가 빈 문자열인 경우가 많음. 파서가 그 필드만 읽음.

**조치:** `1974a98` — GraphQL로 제목/본문/상태/댓글 스냅샷. `uploads.linear.app`은 `issue-images/<이슈>/`에 받아 절대 경로를 프롬프트에 넣음. Linear MCP 쓰기는 금지(사람 계정). 쓰기는 `bin/linear-as-grok` + 앱 토큰.

---

## 진단 순서 (훅이 안 된다고 할 때)

1. `curl` local + public `/health`. 공개만 실패 → 터널. 둘 다 실패 → `start.sh`.
2. `agent.log`에서 최근 `POST /webhook`.
   - 웹훅이 없음 → Linear 앱 Webhook URL / Agent session events / 맥 슬립.
   - `POST` 다음 `GraphQL HTTP 401` → **이 파일 첫 케이스.** Authorize.
   - `POST`만 있고 thought 없음 → 핸들러 예외. 스택 읽기.
3. Linear 세션이 Working만 반복 → sqlite `status`/`queued_prompt`, 슬롯 5 코드인지, Stop 처리 코드인지.
4. 댓글 작성자가 사람 + `via MCP` → `--deny MCPTool(linear__*)` 없는 예전 프로세스. `start.sh` 재시작.

수신기 재시작: 포트 8787의 `start.sh` PID만 kill (`pkill -f start.sh` 금지 — 래퍼까지 죽음). 그다음 `nohup ~/.grok/linear-agent/start.sh >> agent.log 2>&1 &`.
