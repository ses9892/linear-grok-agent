# Linear → Grok Build 에이전트

Linear 이슈를 **Grok**에 위임하거나 `@Grok`을 멘션하면, 이 맥에서 Grok Build가 코드를 고치고 GitHub PR을 엽니다.

- 모델: `grok-4.6`
- effort: `high`
- 질문이 필요하면 추측하지 않고 Linear에서 멈춘 뒤, 같은 이슈 답장/`@Grok`으로 재개합니다.
- 맥이 꺼져 있거나 이 프로세스가 없으면 웹훅을 받지 못합니다.

시크릿(`config.toml`, `token.json`)은 git에 넣지 않습니다.

## 필요 조건

- Node 22+
- [Grok CLI](https://docs.x.ai/docs) (`grok`)
- `gh` (GitHub CLI, `gh auth login` 완료)
- `cloudflared` (`brew install cloudflared`)
- Linear 워크스페이스 admin (앱 설치용)

## 클론 후 설치

```bash
git clone git@github.com:ses9892/linear-grok-agent.git ~/.grok/linear-agent
cd ~/.grok/linear-agent
npm install
cp config.toml.example config.toml
```

`config.toml`에 Linear Client ID / Client secret / Webhook signing secret / `app_user_id` / `repo_path`를 넣습니다.

## 실행

```bash
~/.grok/linear-agent/start.sh
```

SeedSiteKeeper 안에서는:

```bash
./scripts/start-linear-grok-agent.sh
```

스크립트가 Cloudflare quick tunnel을 띄우고 `public_base_url`을 맞춘 뒤 수신기(`127.0.0.1:8787`)를 켭니다.

**quick tunnel은 실행마다 공개 URL이 바뀝니다.** 출력된 주소로 Linear Grok 앱의 Webhook URL을 매번 맞추십시오.

```
https://<호스트>.trycloudflare.com/webhook
```

Redirect URI:

```
https://<호스트>.trycloudflare.com/oauth/callback
```

이미 수신기와 터널이 살아 있으면 스크립트는 재시작하지 않고 현재 주소만 보여 줍니다. Ctrl+C로 종료합니다.

## Linear 앱 (최초 1회)

1. [New application](https://linear.app/settings/api/applications/new) 이름 `Grok`
2. Redirect URI: 터널 callback URL
3. Webhooks 켜기, URL은 터널 `/webhook`, 이벤트는 **Agent session events**
4. Public / Client credentials는 끄기
5. 워크스페이스 admin으로 설치:

```
https://linear.app/oauth/authorize?response_type=code&client_id=<id>&redirect_uri=<public_base_url>/oauth/callback&scope=read,write,app:assignable,app:mentionable&actor=app&state=install
```

Callback이 `token.json`을 씁니다. `query { viewer { id } }` 결과를 `app_user_id`에 넣습니다.

## 동작

1. 이슈를 Grok에 위임하거나 `@Grok` 멘션
2. 10초 안에 Linear thought
3. `~/.grok/linear-agent/worktrees/<ISSUE>` worktree에서 `grok -p` (`--yolo`, `--effort high`)
4. 질문이면 elicitation 후 대기, 답이면 `--resume`
5. 변경이 있으면 `feat/<issue-id>` 브랜치에서 PR, Linear에 링크

동시 실행은 `running` 1개입니다. 나머지는 FIFO 큐입니다.

## 테스트

```bash
cd ~/.grok/linear-agent
npm test
```

## 상시 기동

quick tunnel hostname은 재시작마다 바뀝니다. 고정 URL이 필요하면 Cloudflare named tunnel을 쓰고 `launchd/` plist를 맞추십시오.
