# Linear → Grok Build 에이전트

Linear 이슈를 **Grok**에게 넘기면, 이 맥에서 Grok Build가 `repo_path` 레포를 고치고 그 레포의 git 원격으로 PR/브랜치를 올립니다.

이 저장소(`linear-grok-agent`)는 **수신기**입니다. 사이트키퍼 같은 제품 코드가 여기로 커밋되지 않습니다.

현재 운영 주소는 고정입니다.

```
https://grokbot.win/webhook
https://grokbot.win/oauth/callback
```

## 사용자 입장에서 하는 일

1. Linear 이슈를 Grok에 **위임**(delegate)하거나 `@Grok`을 멘션한다.
2. Linear 세션에서 진행을 본다. 질문이 뜨면 그 세션에 답한다.
3. 끝나면 일하는 레포(지금은 SeedSiteKeeper Azure)에 브랜치/PR이 생긴다.

이슈 assignee는 사람 그대로입니다. Grok은 delegate입니다.

맥이 꺼져 있거나 아래 `start.sh`가 안 떠 있으면 Linear가 웹훅을 보내도 아무 일도 안 일어납니다. DNS 주소는 살아 있어도 수신기가 없는 상태입니다.

---

## 처음 설치 (한 대, 한 번)

### 0. 준비물

| 항목 | 설명 |
|------|------|
| 맥 | 에이전트가 실제로 도는 머신 |
| Node 22+ | `node -v` |
| Grok CLI | `grok` 로그인된 상태 |
| GitHub CLI | `gh auth login` (GitHub 원격 레포용. Azure 레포면 `az`/`git` 자격도 필요) |
| cloudflared | `brew install cloudflared` |
| Cloudflare 계정 + 도메인 | 고정 URL용. 이 운영 환경은 `grokbot.win` |
| Linear 워크스페이스 admin | Grok 앱 설치 권한 |

집 와이파이는 고정 IP가 아니어도 됩니다. DNS는 집 IP가 아니라 Cloudflare를 가리킵니다.

### 1. 이 저장소 클론

```bash
git clone git@github.com:ses9892/linear-grok-agent.git ~/.grok/linear-agent
cd ~/.grok/linear-agent
npm install
cp config.toml.example config.toml
```

### 2. Cloudflare named tunnel (고정 주소)

도메인이 Cloudflare Registrar로 사졌거나, 네임서버가 Cloudflare이면 됩니다.

```bash
cloudflared tunnel login
```

브라우저에서 **해당 도메인**(예: `grokbot.win`)을 고르고 Authorize 합니다. `cert.pem`이 다운로드되면 Finder로 옮깁니다.

```
다운로드/cert.pem  →  ~/.cloudflared/cert.pem
```

터미널이 Downloads를 못 읽는 경우가 많습니다. `Shift+Command+G` 로 `~/.cloudflared` 를 연 뒤 드래그하세요.

```bash
ls -l ~/.cloudflared/cert.pem
cloudflared tunnel list
```

터널이 없으면 만듭니다.

```bash
cloudflared tunnel create linear-grok
```

나온 UUID로 `~/.cloudflared/config.yml`:

```yaml
tunnel: <터널-UUID>
credentials-file: /Users/<당신>/.cloudflared/<터널-UUID>.json

ingress:
  - hostname: grokbot.win
    service: http://127.0.0.1:8787
  - service: http_status:404
```

DNS:

```bash
cloudflared tunnel route dns linear-grok grokbot.win
```

확인:

```bash
curl -sS https://grokbot.win/health
```

수신기가 꺼져 있으면 여기서는 실패해도 됩니다. DNS만 먼저 붙은 상태입니다.

`cert.pem`과 `*.json`은 **절대 git에 넣지 마세요.**

### 3. Linear OAuth 앱

1. [New application](https://linear.app/settings/api/applications/new)
2. 값:

| 칸 | 값 |
|----|----|
| Application name | `Grok` |
| Developer name | 본인/팀 이름 |
| Developer URL | `https://linear.app/<workspace>` |
| Description | Linear 이슈를 로컬 Grok Build에 넘겨 구현합니다. |
| Redirect URIs | `https://grokbot.win/oauth/callback` |
| GitHub username | 비움 |
| Public | 끄기 |
| Client credentials | 끄기 |
| Webhooks | **켜기** |
| Webhook URL | `https://grokbot.win/webhook` |
| Events | **Agent session events** |

3. Create 후 Client ID, Client secret, Webhook signing secret을 복사합니다.

### 4. `config.toml` 채우기

`~/.grok/linear-agent/config.toml`:

```toml
linear_client_id = "..."
linear_client_secret = "..."
linear_webhook_secret = "lin_wh_..."
app_user_id = "pending"
repo_path = "/absolute/path/to/your/repo"
bind_host = "127.0.0.1"
bind_port = 8787
public_base_url = "https://grokbot.win"
```

`repo_path`가 **Grok이 고칠 git 레포 루트**입니다. PR은 그 레포의 `origin`으로 갑니다. (사이트키퍼는 Azure DevOps입니다. 이 에이전트 GitHub가 아닙니다.)

### 5. 수신기 기동 + 앱 설치

```bash
~/.grok/linear-agent/start.sh
```

브라우저에서 (workspace admin):

```
https://linear.app/oauth/authorize?response_type=code&client_id=<Client-ID>&redirect_uri=https://grokbot.win/oauth/callback&scope=read,write,app:assignable,app:mentionable&actor=app&state=install
```

Authorize 하면 `token.json`이 생깁니다.

앱 유저 id:

```bash
python3 - <<'PY'
import json, urllib.request
tok = json.load(open(__import__("pathlib").Path.home() / ".grok/linear-agent/token.json"))["access_token"]
body = json.dumps({"query": "query { viewer { id name } }"}).encode()
req = urllib.request.Request(
    "https://api.linear.app/graphql",
    data=body,
    headers={"content-type": "application/json", "authorization": f"Bearer {tok}"},
    method="POST",
)
print(urllib.request.urlopen(req).read().decode())
PY
```

나온 `viewer.id`를 `config.toml`의 `app_user_id`에 넣고 `start.sh`를 한 번 재시작합니다.

### 6. 동작 확인

테스트 이슈를 만들고 Grok에 위임하거나 `@Grok`을 멘션합니다. 10초 안에 Linear 세션에 thought가 보여야 합니다. 답변 작성자는 **Grok 앱**이어야 합니다. `via MCP` / 본인 계정이면 Linear MCP가 사람 계정으로 댓글을 단 것이니, 이 저장소의 `--deny MCPTool(linear__*)`가 적용된 `start.sh`인지 확인합니다.

---

## 매일 사용

컴퓨터를 켜면:

```bash
~/.grok/linear-agent/start.sh
```

이미 떠 있으면 현재 주소만 보여 주고 끝냅니다. Ctrl+C로 수신기+터널을 같이 끕니다.

Webhook URL은 `https://grokbot.win/webhook` 고정입니다. 재시작할 때마다 Linear에서 URL을 바꿀 필요가 없습니다.

SeedSiteKeeper 레포 안 래퍼:

```bash
./scripts/start-linear-grok-agent.sh
```

이 파일은 사이트키퍼에만 있고, `~/.grok/linear-agent/start.sh`를 실행합니다.

## 아키텍처

```
Linear 이슈 위임 / @Grok
        │  HTTPS POST
        ▼
https://grokbot.win/webhook     ← Cloudflare DNS + named tunnel
        │
        ▼
맥 127.0.0.1:8787  수신기 (이 저장소)
        │
        ▼
worktrees/<이슈번호>   git worktree of repo_path
        grok -p  -m grok-4.6 --effort high --yolo
        │
        ▼
repo_path 의 origin (사이트키퍼면 Azure DevOps)
```

Cloudflare Tunnel은 Linear(클라우드)가 맥(`localhost`)을 찾아오게 하는 다리입니다. 공유기 포트포워드와 고정 공인 IP는 필요 없습니다.

## 동작 규칙

- 모델 `grok-4.6`, effort `high`
- 동시에 `running` 이슈 1개. 나머지는 FIFO
- 질문이면 Linear elicitation 후 대기. 같은 이슈 답장/`@Grok`으로 `--resume`
- 완료 후 다시 `@Grok`이면 같은 브랜치에서 후속
- 시작 시 Linear GraphQL로 이슈 제목/본문/상태/댓글을 읽어 프롬프트에 넣음. 웹훅 `promptContext`가 비어도 본문으로 작업함
- `uploads.linear.app` 이미지는 에이전트 `issue-images/<이슈>/`에 받아 절대 경로로 프롬프트에 넣음 (worktree에 넣지 않음)
- Linear 쓰기는 Grok 앱 토큰 헬퍼 `bin/linear-as-grok` (댓글/설명/제목/상태). Grok CLI의 Linear MCP는 `--deny` — MCP는 사람 계정으로 쓰기 때문
- Linear 세션 action에 도구 경로/커맨드 파라미터를 같이 올림
- thought는 단어 단위가 아니라 문장/버퍼로 모아서 올림

## 테스트

```bash
cd ~/.grok/linear-agent
npm test
```

## 비밀값

git에 올리지 않는 것:

- `config.toml`
- `token.json`
- `state.sqlite`
- `worktrees/`
- `issue-images/`
- `~/.cloudflared/cert.pem`
- `~/.cloudflared/<터널-UUID>.json`

## 문제 해결

| 증상 | 볼 곳 |
|------|--------|
| 위임했는데 아무 반응이 없음 | `start.sh`가 떠 있는지, Linear Webhook URL이 `https://grokbot.win/webhook` 인지, Agent session events 가 켜져 있는지 |
| `grokbot.win/health` 실패 | 맥에서 `cloudflared tunnel run` + `npm start`가 살아 있는지 |
| 댓글이 내 계정 `via MCP` | 예전 바이너리. 최신 `start.sh`로 재시작. Grok은 `bin/linear-as-grok`로만 Linear를 써야 함 |
| 이슈 본문/스크린샷을 모름 | 최신 코드(이슈 스냅샷 + 이미지 다운로드)로 재시작 |
| thought가 단어마다 끊김 | 최신 코드(thought buffer)로 재시작 |
| PR이 GitHub 개인 저장소로 감 | 아님. `repo_path`의 `git remote`로 감 |
| 컴퓨터를 끄면 | 주소는 유지되지만 수신이 안 됨. 다시 `start.sh` |
