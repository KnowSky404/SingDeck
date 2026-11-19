export type Language = "en" | "zh";
export type Translate = (
  message: string,
  values?: Record<string, string | number>,
) => string;

export function loadLanguage(): Language {
  try {
    const saved = localStorage.getItem("singdeck.language");
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* Use the browser language when storage is unavailable. */
  }
  return typeof navigator !== "undefined" && navigator.language.startsWith("zh")
    ? "zh"
    : "en";
}

const zh: Record<string, string> = {
  "Authentication failed. Disconnect and check the Bearer token on the entry page.":
    "身份验证失败，请退出连接并在入口页检查密钥。",
  "This instance denied access. Check its access policy.":
    "实例拒绝访问，请检查访问策略。",
  "This capability is unavailable on the connected instance.":
    "当前实例不支持该功能。",
  "The requested resource or capability is unavailable.":
    "请求的资源或功能不可用。",
  "The instance rejected this request. Check the selected resource.":
    "实例拒绝了请求，请检查所选资源。",
  "The API timed out. Check the endpoint and connection.":
    "API 请求超时，请检查地址和连接。",
  "The request was canceled.": "请求已取消。",
  "Connection interrupted. Check endpoint, TLS, CORS and browser local-network permissions.":
    "连接中断，请检查地址、TLS、CORS 和浏览器本地网络权限。",
  "Unsupported API. SingDeck currently requires stable sing-box ≥1.14.0 with Service API 4.":
    "API 不受支持，SingDeck 目前需要稳定版 sing-box ≥1.14.0 和 Service API 4。",
  "Native Service API · gRPC-Web": "原生 Service API · gRPC-Web",
  Close: "关闭",
  "SingDeck · Network workspace": "SingDeck · 网络面板",
  Overview: "概览",
  Proxies: "代理",
  Connections: "连接",
  Logs: "日志",
  Settings: "设置",
  "Your network, at a glance.": "一览网络运行状况。",
  "Find your route. Keep your network moving.": "选择路由，管理代理组和节点。",
  "See where your traffic goes, in real time.":
    "实时查看流量去向，筛选和管理连接。",
  "A live view into your instance.": "实时查看实例日志。",
  "Instance and dashboard information.": "查看当前实例和面板信息。",
  "Main navigation": "主导航",
  "Mobile navigation": "移动端导航",
  "Open navigation": "打开导航",
  "Skip to content": "跳转到内容",
  "Collapse sidebar": "收起侧栏",
  "Expand sidebar": "展开侧栏",
  "SingDeck navigation": "SingDeck 导航",
  "Your network workspace": "网络管理面板",
  "Native Service API": "原生 Service API",
  Source: "源码",
  Licenses: "许可证",
  Disconnected: "未连接",
  Connecting: "连接中",
  Connected: "已连接",
  Reconnecting: "重新连接中",
  "Connection failed": "连接失败",
  "Current connection": "当前连接",
  Disconnect: "退出连接",
  Retry: "重试",
  "API endpoint": "API 地址",
  "Demo workspace": "演示实例",
  "Mock mode": "演示模式",
  "No server is contacted.": "不会连接任何服务器。",
  Theme: "主题",
  Language: "语言",
  Light: "浅色",
  Dark: "深色",
  System: "跟随系统",
  "Light theme": "浅色主题",
  "Dark theme": "深色主题",
  "System theme": "跟随系统主题",
  "Core version": "核心版本",
  "API version": "API 版本",
  Instance: "实例",
  Uptime: "运行时间",
  Service: "服务状态",
  Unavailable: "不可用",
  unavailable: "不可用",
  Unknown: "未知",
  Idle: "空闲",
  Starting: "启动中",
  Running: "运行中",
  Stopping: "停止中",
  Fatal: "致命错误",
  "Live updates": "实时更新",
  "Updates inactive": "暂停更新",
  Download: "下载",
  Upload: "上传",
  Memory: "内存",
  "Active connections": "活动连接",
  "Traffic activity": "流量趋势",
  "Last {seconds} seconds": "最近 {seconds} 秒",
  "Traffic history. Current download {down} per second; upload {up} per second.":
    "流量历史。当前每秒下载 {down}，上传 {up}。",
  "Traffic unavailable": "流量不可用",
  "The native API has not reported traffic tracking data.":
    "原生 API 尚未返回流量跟踪数据。",
  "Collecting traffic samples": "正在收集流量样本",
  "The graph appears after the next measured interval.":
    "下一个采样周期后显示图表。",
  "Instance details": "实例信息",
  "Cumulative download": "累计下载",
  "Cumulative upload": "累计上传",
  "The service reported a fatal error. Inspect the instance locally.":
    "服务报告了致命错误，请在实例所在设备检查。",
  "Outbound groups": "代理组",
  "View proxies": "查看代理",
  "Recent logs": "最近日志",
  "View logs": "查看日志",
  "Search outbounds": "搜索节点",
  "Search outbounds…": "搜索节点…",
  "Protocol filter": "协议筛选",
  "All protocols": "全部协议",
  "Group layout": "组布局",
  "Node layout": "节点布局",
  "Group list": "组列表",
  "Group cards": "组卡片",
  "List view": "节点列表",
  "Compact cards": "节点卡片",
  Groups: "代理组",
  Nodes: "节点",
  "{count} groups": "{count} 个代理组",
  "Node details for {name}": "查看 {name} 的节点详情",
  "Node names and latency": "节点全名与延迟",
  "Selected: {name}": "已选择：{name}",
  "Read only": "只读",
  "Collapse {name}": "收起 {name}",
  "Expand {name}": "展开 {name}",
  "Test group": "测试组",
  "Test {name}": "测试 {name}",
  "Test {name} in {group}": "测试 {group} 中的 {name}",
  Select: "选择",
  "Select {name}": "选择 {name}",
  Selected: "已选择",
  "Confirming…": "确认中…",
  "Selection failed": "选择失败",
  "Test failed": "测试失败",
  "No outbounds match your filters.": "没有符合筛选条件的节点。",
  "No result": "无结果",
  "Invalid result": "无效结果",
  "Selection is confirmed by the instance. “No result” can mean untested or a failed test: this API removes failed test history.":
    "选择结果由实例确认。“无结果”可能表示未测试或测试失败：API 不保留失败的测试记录。",
  "Close all connections": "关闭全部连接",
  "Search connections": "搜索连接",
  "Search destinations, sources, routes…": "搜索目标、来源、路由…",
  "Network filter": "网络筛选",
  "All networks": "全部网络",
  "Outbound filter": "出站筛选",
  "All outbounds": "全部出站",
  "Unknown outbound": "未知出站",
  "Sort connections": "连接排序",
  "Newest first": "最新优先",
  "Most traffic": "流量优先",
  "Status filter": "状态筛选",
  "All statuses": "全部状态",
  Status: "状态",
  Active: "活动中",
  Closed: "已关闭",
  "Connection records": "连接记录",
  "Connection action failed": "连接操作失败",
  "Display limit reached": "已达到显示上限",
  "Only {count} connection records are retained. The instance may have more records.":
    "最多保留 {count} 条连接记录，实例可能有更多记录。",
  "{count} matching connections · {size} rows per page":
    "{count} 条匹配连接 · 每页 {size} 条",
  Destination: "目标",
  Network: "网络",
  Outbound: "出站",
  Actions: "操作",
  "Details for {id}": "{id} 的详情",
  "Close {id}": "关闭 {id}",
  "Server-reported connection state": "实例报告的连接状态",
  "Previous page": "上一页",
  "Next page": "下一页",
  "Page {page} / {pages}": "第 {page} / {pages} 页",
  "Close all active connections?": "关闭全部活动连接？",
  "This interrupts traffic on {count} tracked connections. Applications may reconnect automatically.":
    "这会中断 {count} 条活动连接的流量。应用可能会自动重连。",
  "Close failed": "关闭失败",
  Cancel: "取消",
  "Closing…": "关闭中…",
  "Close all": "全部关闭",
  "Connection details": "连接详情",
  "The API reports Active and Closed; it does not report a separate Blocked state.":
    "API 提供活动和关闭状态，未提供独立的阻止状态。",
  Pause: "暂停",
  Resume: "继续",
  "Search logs": "搜索日志",
  "Search log messages…": "搜索日志内容…",
  "Log level": "日志级别",
  "All levels": "全部级别",
  "{level} and above": "{level} 及以上",
  "Auto scroll": "自动滚动",
  "View paused": "显示已暂停",
  "The stream continues into a bounded buffer. Resume to see the latest entries.":
    "日志仍在写入有容量限制的缓冲区，继续后可查看最新日志。",
  "Runtime stream": "运行日志",
  "Core output level: {level} · View filter is independent · Local receipt times":
    "核心输出级别：{level} · 显示筛选独立生效 · 时间为本地接收时间",
  "Copy filtered logs": "复制筛选日志",
  "Export filtered logs": "导出筛选日志",
  "Clear local logs": "清空面板日志",
  "Log messages": "日志内容",
  "Filtered logs copied.": "已复制筛选日志。",
  "Clipboard unavailable. Use Export to save filtered logs.":
    "无法使用剪贴板，请导出日志。",
  "Filtered logs exported.": "已导出筛选日志。",
  "{count} shown · {limit} entry limit · 16K characters per message":
    "显示 {count} 条 · 最多 {limit} 条 · 每条最多 16K 字符",
  "Paused locally": "显示已暂停",
  Streaming: "接收中",
  "Local receipt time": "本地接收时间",
  "About SingDeck": "关于 SingDeck",
  "Dashboard version {version}": "面板版本 {version}",
  Author: "作者",
  Repository: "项目仓库",
  "(opens in a new tab)": "（在新标签页打开）",
  "Dashboard compatibility": "面板兼容性",
  Dashboard: "面板版本",
  "Supported API": "支持的 API",
  "Core baseline": "最低核心版本",
  Transport: "传输协议",
  "Local deployment guide": "本地部署指南",
  "Download dashboard": "下载面板",
  "Connect your network.": "连接你的网络。",
  "Choose a trusted sing-box instance, or explore SingDeck with demo data.":
    "连接可信的 sing-box 实例，或使用演示数据体验 SingDeck。",
  "Connect an instance": "连接实例",
  "Enter the native Service API address and your Bearer token.":
    "输入原生 Service API 地址和访问密钥。",
  "Take a look around": "先体验一下",
  "No instance needed. A separate workspace, with clearly labeled simulated data.":
    "无需实例，使用明确标记的模拟数据体验独立面板。",
  "Switch outbounds and explore proxy groups": "切换出站，管理代理组",
  "Inspect and filter live connections": "查看和筛选实时连接",
  "Follow a stream of runtime logs": "查看实时运行日志",
  "Explore demo": "体验演示",
  "Demo never connects to your local instance.": "演示模式不会连接你的实例。",
  "Your browser connects directly to your instance. Tokens stay in memory.":
    "浏览器直接连接你的实例，密钥仅保存在内存中。",
  "Bearer token": "访问密钥",
  "Held in memory only": "仅保存在内存中",
  "Listener origin or reverse-proxy API prefix. Do not include /dashboard/.":
    "填写 API 监听地址或反向代理前缀，不要包含 /dashboard/。",
  "Never stored in localStorage, URLs or build artifacts. Re-enter after a reload.":
    "不会写入本地存储、网址或构建文件，刷新后需重新输入。",
  "Local instances can use http://127.0.0.1:9090. Allow this site’s local-network permission and API CORS origin. Use HTTPS for remote instances.":
    "本机可使用 http://127.0.0.1:9090，请允许浏览器本地网络权限并配置 API CORS 来源。远程实例须使用 HTTPS。",
  "Test connection": "测试连接",
  "Testing…": "测试中…",
  Connect: "连接",
  "Connecting…": "连接中…",
  "Cancel connection": "取消连接",
  "Connection verified: sing-box {version} · API {api}.":
    "连接验证成功：sing-box {version} · API {api}。",
  "Enter a complete HTTP or HTTPS API endpoint.":
    "请输入完整的 HTTP 或 HTTPS API 地址。",
  "Use an HTTP(S) endpoint without credentials, query parameters or a fragment.":
    "请使用不含账号密码、查询参数或片段的 HTTP(S) 地址。",
  "Remote instances require HTTPS. Use a loopback SSH tunnel for HTTP.":
    "远程实例须使用 HTTPS，HTTP 请通过回环 SSH 隧道访问。",
  "Invalid profile.": "配置无效。",
  "Settings not persisted": "设置未保存",
  "Browser storage is unavailable. Settings are kept only until this page closes.":
    "浏览器存储不可用，设置仅保留到页面关闭。",
  "Connection notice": "连接提示",
  "No active connection": "没有活动连接",
  "Connect a trusted instance from the entry page or explore the demo.":
    "请在入口页连接可信实例或体验演示。",
  "Data unavailable": "数据不可用",
  "Disconnect and correct the API address or token on the entry page, then retry.":
    "请退出连接，在入口页更正 API 地址或密钥后重试。",
  "Loading live data": "正在加载实时数据",
  "Waiting for the instance…": "正在等待实例…",
  "{channel} stream interrupted": "{channel} 数据流中断",
  "Retained data may be stale.": "保留的数据可能已过期。",
  "Nothing to show yet": "暂无内容",
  "No matching data has been received from this instance.":
    "尚未收到符合条件的实例数据。",
  "Reconnecting · data may be stale": "重新连接中 · 数据可能已过期",
  "Some live data is unavailable": "部分实时数据不可用",
  "Some streams were interrupted. Open the relevant page for details.":
    "部分数据流中断，请前往对应页面查看详情。",
  "Loading page": "正在加载页面",
  "Page not found": "页面不存在",
  "Choose a page from the navigation to continue.": "请从导航中选择页面。",
  "This view could not be displayed": "无法显示该页面",
  "Reload this page to recover. Your credentials have not been persisted.":
    "请刷新页面恢复，访问密钥未写入持久存储。",
  "Authentication failed. Check the token in Settings.":
    "身份验证失败，请退出连接并在入口页检查密钥。",
  "Connection interrupted. Check the endpoint, TLS certificate, CORS and browser local-network permissions.":
    "连接中断，请检查地址、TLS 证书、CORS 和浏览器本地网络权限。",
};

export function translate(language: Language): Translate {
  return (message, values = {}) => {
    const template =
      language === "zh"
        ? (zh[message.replace(/\s+/g, " ").trim()] ?? message)
        : message;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      String(values[name] ?? match),
    );
  };
}
