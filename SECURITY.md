# 安全说明 · Security

本仓库只有一个静态 HTML 文件，没有后端、没有构建、没有依赖安装。下面把「它能做什么」「不能做什么」
「你可以怎么自己验证」写清楚，不用只信我一句话。

---

## 这个文件能做什么、不能做什么

`index.html` 是纯前端单文件工具，运行在浏览器沙箱里：

**能做的**
- 读你**主动选择**的文件（EPUB / TXT / 图片），在内存里解析
- 把结果画到 `<canvas>` 上，导出成 PNG 下载

**做不到的**
- 没有网络请求：文件里不存在 `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` / `EventSource`
- 没有动态执行：不存在 `eval` / `new Function` / `document.write`
- 不写任何持久化存储：不存在 `localStorage` / `sessionStorage` / `IndexedDB` / `document.cookie`
- 不读剪贴板、不请求摄像头/麦克风/定位、不注册 Service Worker、不开新窗口
- 不会在你不选文件的情况下碰任何本地文件

---

## 已经做的加固

### 1. 零外部依赖（本轮改动）

原先通过 CDN 加载 JSZip：

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
```

这是整个工具**唯一**的外部资源，也是唯一的供应链攻击面——CDN 一旦被投毒，页面就会执行任意代码。
现在已把 JSZip 3.10.1 内联进 HTML，并做过完整性校验：

```
sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==
```

该哈希与 cdnjs 官方发布的 SRI 值逐字符一致。**内联之后，这个文件不再发起任何网络请求。**

### 2. 内容安全策略（CSP）—— 用哈希白名单锁死脚本

`<head>` 里有一条严格的 CSP，**不含 `'unsafe-inline'`**：

| 指令 | 作用 |
| --- | --- |
| `default-src 'none'` | 默认拒绝一切 |
| `script-src 'sha256-…' 'sha256-…'` | **只允许本文件里那两段内联脚本执行**，其余一律拒绝 |
| `style-src 'sha256-…'` | 同上，只允许那一段内联样式表 |
| `connect-src 'none'` | **禁止 fetch / XHR / WebSocket / sendBeacon，堵死数据外传** |
| `object-src 'none'` | 禁止插件 |
| `frame-src 'none'` / `child-src 'none'` | 禁止内嵌框架 |
| `worker-src 'none'` / `manifest-src 'none'` | 禁止 Worker 与 PWA 清单 |
| `font-src 'none'` / `media-src 'none'` | 禁止外部字体与音视频 |
| `base-uri 'none'` | 禁止改写相对地址基准 |
| `form-action 'none'` | 禁止表单提交 |
| `img-src data: blob:` | 只允许本地图片 |

**为什么用哈希而不是 `'unsafe-inline'`：** 这个文件里没有任何内联事件处理器（`onclick=` 之类）
和 `javascript:` 链接，所以可以给每一段内联脚本算出 sha256 写进白名单。这样一来，
**任何后来被塞进文件的脚本都不会执行**——它的哈希不在名单里。
（实测：往文件里插入一段 `<script>window.__EVIL_RAN=true</script>`，CSP 直接拦下，变量始终为
`undefined`。）

> ⚠️ **维护提醒**：哈希是对脚本正文逐字节计算的，**改一个空格都会失配、页面会白屏**。
> 改完 `index.html` 后必须跑一次：
> ```bash
> node tools/csp-hash.mjs index.html
> ```
> 它会重新计算哈希并写回 CSP。仓库里已附带这个脚本。

### 3. 输出转义

工具里唯一一处 `innerHTML`（高频词筛选结果的按钮）已经过 `escHtml()` 转义，覆盖
`& < > " '`。也就是说，**即使你载入的小说里被人塞了 `<img onerror=...>` 这类内容，它也只会被当作
普通文字显示，不会变成可执行代码**。其余所有文本输出都走 `textContent`。

### 4. 输入大小上限（防 DoS / 解压炸弹）

工具要解析你给的文件，所以「文件本身」是一个攻击面——一个精心构造的文件可以让浏览器吃光内存。
现在所有入口都有硬上限：

| 入口 | 上限 |
| --- | --- |
| TXT / HTML / EPUB 文件大小 | 24 MB |
| 图片文件大小 | 32 MB |
| 清洗后的文本长度 | 1200 万字符 |
| 图片解码后的像素总量 | 4000 万像素 |
| EPUB 单条目解压后大小 | 8 MB |
| EPUB 全部条目解压累计 | 96 MB |
| EPUB 条目数 | 5000 |

其中 EPUB 的三条是**解压炸弹（zip bomb）防护**：一个 10 KB 的 EPUB 可以解压出 9 MB 正文，
再大一点就能把内存打满。现在会在解压**之前**先读 ZIP 头里声明的大小，超限直接跳过；
解压过程中再累计一次实际字节数。

### 5. `.gitattributes` 禁止行尾转换

CSP 用哈希锁脚本，意味着**文件字节必须完全一致**。而 Windows 上 git 默认
`core.autocrlf=true`，检出时会把 LF 换成 CRLF——哈希立刻失配、页面白屏。
所以仓库里加了 `.gitattributes`：

```
* -text
```

禁止一切行尾转换，保证任何人 clone 下来的字节和仓库里的字节相同。

---

## 你可以自己验证

### 方法一：看网络请求（最直观）

1. 用浏览器打开 `index.html`
2. 按 `F12` → 切到 **Network（网络）** 面板
3. 勾选 **Preserve log**，然后刷新页面
4. 载入一本小说、调参数、导出 PNG

**全程应该看不到任何一条请求**（除了 `index.html` 自身）。如果有，说明文件被改过。

### 方法二：核对文件指纹

```bash
# 下载后计算
sha256sum index.html
```

本仓库当前版本的 `index.html`：

```
大小   : 236895 字节
sha256 : 555df944dc0740dd80b48a4cd10b85fa493c8e2aa19b97d36bc75a347be89ec2
```

> 注意：指纹只能帮你发现「文件被改动过」。如果攻击者同时改了文件和这里记录的哈希，指纹就失去意义了
> ——真正的保障是下面的账号安全措施。

### 方法三：搜一遍关键字

```bash
grep -nE 'fetch\(|XMLHttpRequest|WebSocket|eval\(|new Function|localStorage|innerHTML' index.html
```

`innerHTML` 只应出现在高频词渲染那一处，且被 `escHtml()` 包着。

### 方法四：核对 CSP 哈希（最严格）

CSP 白名单里的哈希必须和文件里实际那段脚本对得上。自己算一遍：

```bash
node tools/csp-hash.mjs index.html
```

输出里的三个哈希应与文件第 5 行 CSP 里的值**完全一致**，并且末尾显示「CSP 内容无变化」。
如果不一致，说明脚本正文被改动过（或有人忘了重签）。

### 方法五：看 CSP 有没有真的生效

用浏览器打开页面 → `F12` → Console（控制台）。粘贴：

```js
fetch('https://example.com/probe').then(()=>console.log('ALLOWED!!')).catch(()=>console.log('BLOCKED'))
```

应该打印 **`BLOCKED`**——这是浏览器在替你强制「不联网」，不是靠代码自觉。

---

## 说清楚：CSP 挡得住什么、挡不住什么

**挡得住**
- 第三方依赖被投毒（现在已无第三方依赖）
- 你载入的小说 / EPUB / TXT / 图片里藏了恶意内容
- **文件被「部分」篡改**——比如有人往脚本块里插一段新代码。
  哈希白名单会让它无法执行（这是哈希型 CSP 相比 `'unsafe-inline'` 多出来的那层保护）
- 页面把任何数据发出去（`connect-src 'none'`）

**挡不住**
- **有人拿到仓库写权限、直接替换掉整个文件**——包括替换掉 CSP 本身。
  CSP 是文件自己声明的，能改文件的人自然也能删掉它。
- 有人下载了旧版本或被改过的版本**存到本地**再用。CSP 只管运行期，管不了文件来源。

所以真正防「账号被劫持」的，不是这份文件，而是下面的账号措施。

---

## 如果 GitHub 账号被盗，攻击者能做什么

先说结论：**这个仓库本身的价值很低**，因为里面只有一个静态页面。

| 攻击者能做的 | 后果 |
| --- | --- |
| 改仓库里的文件 | 谁下载或访问被改过的版本，谁就执行被改过的代码 |
| 删仓库 | 链接失效 |
| 用你的身份开 issue / PR / 评论 | 声誉影响 |

**风险取决于你怎么用这个文件**：

- 只是本地打开 → 攻击者改文件对你**没有任何影响**（你手上的副本是你自己的）
- 部署到 GitHub Pages 并分享链接 → **这是真正有风险的场景**，别人访问到的就是被改过的版本
- 有人 clone 或下载 → 同上

**本仓库目前没有开启 GitHub Pages，也没有任何自动化（Actions）**，所以攻击面比一般项目小得多。
建议**保持这样**——不要给这个仓库加 GitHub Actions，workflow 文件是比静态页面危险得多的东西。

---

## 账号加固清单

按收益从高到低排。

### 已完成

- ✅ **Passkey**（比短信 2FA 强得多，且抗钓鱼）
- ✅ **Vigilant mode**（`https://github.com/settings/security` → *Vigilant mode*）
  开启后，任何**未签名**的提交都会显示 `Unverified` 黄标。这样一旦有人用别的方式往仓库推东西，
  你一眼就能看出来。**副作用**：本仓库现有的两个提交是未签名的，会显示黄标——这是正常的，
  解决办法见下面第 7 条。
- ✅ 只保留了确实需要的授权（`Git Credential Manager`、`GitHub Android`）

### 必做

1. **开启 2FA**（已完成，用 Passkey）
   https://github.com/settings/security

2. **检查已授权的第三方应用**，撤销不认识的
   - OAuth Apps：https://github.com/settings/applications
   - GitHub Apps（含各种连接器）：https://github.com/settings/installations
   这里每一项都代表「某个服务能代表你操作 GitHub」。不用的就撤掉。

3. **检查登录会话和设备**，踢掉不认识的
   https://github.com/settings/sessions

4. **检查 SSH / GPG 密钥**，删掉不认识的
   https://github.com/settings/keys

### 建议做

5. **给 `main` 加分支保护**，防止被强推覆盖或直接删除
   仓库 → Settings → Branches → Add branch protection rule
   - 勾选 `Protect matching branches`
   - 勾选 `Do not allow force pushes`
   - 勾选 `Do not allow deletions`

6. **开启安全功能**（公开仓库免费）
   仓库 → Settings → Code security and analysis
   - `Dependabot alerts` / `Dependabot security updates`
   - `Secret scanning` + `Push protection`（防止误传密钥）

7. **配置提交签名**，让 Vigilant mode 下的黄标变成绿色的 `Verified`
   推荐用 SSH 签名（不需要装 GPG）：

   ```bash
   # 1. 生成一把专用签名密钥（不要设密码短语，否则每次提交都要输）
   ssh-keygen -t ed25519 -C "signing" -f ~/.ssh/id_ed25519_signing -N ""

   # 2. 把公钥加到 GitHub，类型选 Authentication Key 之外要再传一次并选 Signing Key
   #    https://github.com/settings/ssh/new  →  Key type 选 "Signing Key"

   # 3. 告诉 git 用它签名
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519_signing.pub
   git config --global commit.gpgsign true
   ```

   配置好之后新提交会显示绿色 `Verified`。**已有的两个提交仍然是黄标**（签名不能追溯补），
   但之后不会再有。

8. **设置 Commit 邮箱隐私**
   https://github.com/settings/emails → 勾选 `Keep my email addresses private`
   本仓库的提交用的是 `184805341+buyimeng@users.noreply.github.com`，不含真实邮箱。

### 不要做

9. **不要在这个仓库加 GitHub Actions workflow。** 一个静态页面不需要 CI，
   而 workflow 拥有仓库写权限和 Secrets 访问权，是远比页面危险的东西。

10. **不要把 Token 提交进来。** 任何 PAT、密钥、密码都不要写进仓库。
    如果误传了，**改密码 / 撤销 Token 是不够的**——Git 历史里还在，必须撤销凭证并重写历史。

11. **不要为了「方便」关掉 Vigilant mode。** 黄标看着难受，但它是你唯一的「有人动了我的仓库」告警。
    正解是配签名（第 7 条），不是关告警。

---

## 发现问题的上报方式

这是个个人小工具，没有正式的安全响应流程。如果你发现了问题，
直接在仓库开一个 issue 说明复现步骤即可。

---

## 最后一句实话

这个工具**不联网、不写盘、不读剪贴板**，所以它自己造成伤害的能力很小。
你的不安更应该落在「账号」而不是「文件」上——**2FA + 撤销不用的授权 + 分支保护**，
这三件事做完，风险就基本收敛了。

如果哪天你想把这个页面分享给别人，建议**同时给出上面那个 sha256**，
让对方下载后自己核一遍。
