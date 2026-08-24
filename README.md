# Linear → Grok Build 에이전트

Linear 이슈를 Grok에 할당하거나 `@Grok`을 멘션하면, 이 맥에서 `grok-4.6` / `--effort high`가 SeedSiteKeeper worktree에서 구현하고 GitHub PR을 엽니다.

맥이 꺼져 있으면 동작하지 않습니다. 질문이면 Linear 세션에서 멈추고, 같은 이슈 답장/`@Grok`으로 재개합니다.

## 설치

1. `brew install cloudflared` (없으면)
2. Linear → Settings → API → New application. 이름 `Grok`.  
   Callback `https://<tunnel>/oauth/callback`.  
   Webhooks에서 **Agent session events**를 켜고 URL은 `https://<tunnel>/webhook`.
3. `cp config.toml.example config.toml` 후 client id / secret / webhook secret을 넣습니다.
4. 터미널 A에서 터널을 띄워 hostname을 받습니다.

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

`config.toml`의 `public_base_url`과 Linear 앱의 callback/webhook URL을 그 hostname으로 맞춥니다.

5. 터미널 B:

```bash
cd ~/.grok/linear-agent
npm start
```

6. 브라우저에서 설치(워크스페이스 admin):

```
https://linear.app/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=<public_base_url>/oauth/callback&scope=read,write,app:assignable,app:mentionable&actor=app&state=install
```

Callback이 `token.json`을 씁니다.

7. `query { viewer { id } }` 결과를 `config.toml`의 `app_user_id`에 넣습니다.

## 사용

테스트 이슈를 Grok에 위임(delegate)하거나 `@Grok`을 멘션합니다. 10초 안에 thought가 보여야 합니다. 질문이면 세션에 답하고 같은 브랜치로 이어집니다. 완료 시 PR 링크가 붙습니다.

## launchd

quick tunnel hostname은 재시작마다 바뀝니다. 상시 기동은 **named tunnel**과 고정 `public_base_url`을 쓰십시오. 그 전에는 수동으로 `cloudflared` + `npm start`를 쓰는 것이 안전합니다.

named tunnel을 이미 쓰는 경우:

```bash
cp ~/.grok/linear-agent/launchd/ai.xai.linear-grok-agent.plist ~/Library/LaunchAgents/
cp ~/.grok/linear-agent/launchd/ai.xai.linear-grok-tunnel.plist ~/Library/LaunchAgents/
# tunnel plist의 cloudflared 경로와 인자를 named tunnel에 맞게 수정
launchctl load ~/Library/LaunchAgents/ai.xai.linear-grok-agent.plist
launchctl load ~/Library/LaunchAgents/ai.xai.linear-grok-tunnel.plist
```

## 수동 체크리스트

- 서명 없는 POST → 401
- 같은 `Linear-Delivery` 두 번 → 러너 1회
- 새 할당 → 10초 안 thought, worktree, grok 시작
- elicitation 후 세션 답장 → 같은 grokSessionId resume
- elicitation 후 이슈 `@Grok` → 같은 resume
- 완료 후 같은 이슈 `@Grok` → 같은 브랜치
- 두 이슈가 동시에 running이 되려 하면 FIFO
- 마커 없는 exit 0 → error
- 재기동 시 죽은 running pid → error + 재개 안내
- PR 성공 → response + externalUrls

## 테스트

```bash
cd ~/.grok/linear-agent
npm test
```
