export interface DiagnosticMessageDto {
  code: string
  params?: Record<string, string | number | boolean>
  fallback: string
}

type Params = Record<string, string | number | boolean>

const str = (params: Params | undefined, key: string) => String(params?.[key] ?? '')

const ZH_MESSAGES: Record<string, (p?: Params) => string> = {
  // Outbound 25
  OUTBOUND25_OPEN: p => `25 端口可出站（已通过 ${str(p, 'host')}${str(p, 'ip') ? ` (${str(p, 'ip')})` : ''} 验证，耗时 ${str(p, 'latencyMs')} ms）`,
  OUTBOUND25_BLOCKED: p => `25 端口出站受阻（已尝试 ${str(p, 'count')} 个外部公网 MX 服务器均未连通）`,
  OUTBOUND25_NO_TARGETS: () => '无法解析外部公网 MX 测试目标，未能完成 25 端口出站检测',
  OUTBOUND25_RELAY_FALLBACK: p => `25 端口出站直连不可用，但当前已配置 SMTP 中继（${str(p, 'host')}:${str(p, 'port')}），对外发信将通过中继发送`,
  OUTBOUND25_DIRECT_BLOCKED_HINT: () => '直连收件方 MX 发信需要放行服务器 TCP 25 出站；如云厂商封锁 25 端口，请在「系统设置 → SMTP 中继」配置中继服务器',

  // Inbound 25
  INBOUND25_OPEN: p => `25 端口可入站：外部流量经 ${str(p, 'host')}${str(p, 'ip') ? ` (${str(p, 'ip')})` : ''}:25 已直达本机 SMTP 服务（本地端口 ${str(p, 'localPort')}）`,
  INBOUND25_OPEN_NO_MX: p => `通过回退主机 ${str(p, 'host')}:25 可连通本机 SMTP（端口 ${str(p, 'localPort')}），但尚未配置有效 MX 记录`,
  INBOUND25_LOCAL_DOWN: p => `本地 SMTP 接收服务（端口 ${str(p, 'port')}）未响应（${str(p, 'error')}）`,
  INBOUND25_INVALID_DOMAIN: p => `本地 SMTP 服务（端口 ${str(p, 'port')}）运行正常，但当前域名 "${str(p, 'domain')}" 不是有效公网域名，无法检测公网 25 端口入站`,
  INBOUND25_NO_PUBLIC_TARGET: p => `本地 SMTP 服务（端口 ${str(p, 'port')}）运行正常，但未解析到 ${str(p, 'domain')} 可用于公网入站检测的 MX 或 A/AAAA 地址`,
  INBOUND25_FOREIGN_BANNER: p => `${str(p, 'host')} (${str(p, 'ip')}):25 有 SMTP 响应，但未路由到当前 HostID 实例（横幅：${str(p, 'banner')}）`,
  INBOUND25_REFUSED: p => `连接 ${str(p, 'host')} (${str(p, 'ip')}):25 被拒绝（ECONNREFUSED）；本地 SMTP（端口 ${str(p, 'localPort')}）正常`,
  INBOUND25_UNREACHABLE: p => `无法连接 ${str(p, 'host')} (${str(p, 'ip')}):25（${str(p, 'error')}）`,
  INBOUND25_UNVERIFIABLE_OUTBOUND_BLOCKED: p => `本地 SMTP（端口 ${str(p, 'localPort')}）监听正常，但本机 25 端口出站受限，无法从内部自检公网 ${str(p, 'host')}:25 入口`,
  INBOUND25_ISSUE_START_LOCAL: p => `请确认 HostID 后端进程已启动并监听入站 SMTP 端口 ${str(p, 'port')}`,
  INBOUND25_ISSUE_CHECK_MX_TARGET: () => '请检查 MX 记录是否确实指向本服务器公网 IP，或是否经过了外部邮件代理转发',
  INBOUND25_ISSUE_PORT_MAPPING: p => `请检查宿主机到容器的 25 端口映射（如 Docker -p 25:${str(p, 'localPort')}）及反向转发规则`,
  INBOUND25_ISSUE_FIREWALL_OR_HAIRPIN: p => `请检查服务器防火墙、云厂商安全组入站 TCP 25、Docker 端口映射（25:${str(p, 'localPort')}）以及路由器 NAT 回环设置`,
  INBOUND25_ISSUE_EXTERNAL_VERIFY: p => `请在外部服务器执行 nc -vz ${str(p, 'host')} 25，或使用外部邮箱向本站账号发送测试邮件以确认入站`,

  // MX
  MX_INVALID_DOMAIN: p => `域名 "${str(p, 'domain')}" 不是有效的公网邮件域名`,
  MX_NOT_FOUND: p => `未查询到 ${str(p, 'domain')} 的 MX 记录`,
  MX_DNS_ERROR: p => `查询 ${str(p, 'domain')} 的 MX 记录失败（${str(p, 'error')}）`,
  MX_NULL_RECORD: p => `${str(p, 'domain')} 配置了 Null MX 记录（.），表示拒绝接收任何邮件`,
  MX_INVALID_EXCHANGE: p => `${str(p, 'domain')} 的 MX 记录包含不合法的主机名目标`,
  MX_PRIVATE_IP: p => `${str(p, 'domain')} 的 MX 目标仅解析到内网或保留 IP，外部无法投递`,
  MX_EXCHANGE_UNRESOLVABLE: p => `${str(p, 'domain')} 的 MX 目标未能解析到任何公网 A/AAAA IP 地址`,
  MX_VALID_WITH_WARNINGS: p => `${str(p, 'domain')} 有 ${str(p, 'count')} 条可用 MX 记录，但存在警告项`,
  MX_VALID: p => `${str(p, 'domain')} 的 MX 记录合法（共 ${str(p, 'count')} 条，主记录：${str(p, 'primary')}）`,
  MX_ISSUE_NULL_MX: () => '检测到 Null MX 记录（"."），RFC 7505 定义该记录用于声明域名不接收邮件',
  MX_ISSUE_IP_LITERAL: p => `MX 目标 "${str(p, 'exchange')}" 不能直接填写 IP 地址，必须为主机名（RFC 5321）`,
  MX_ISSUE_INVALID_HOST: p => `MX 目标 "${str(p, 'exchange')}" 不是合法的公网主机名`,
  MX_ISSUE_PRIVATE_IP: p => `MX 目标 "${str(p, 'exchange')}" 仅解析到非公网 IP：${str(p, 'ips')}`,
  MX_ISSUE_UNRESOLVABLE: p => `MX 目标 "${str(p, 'exchange')}" 未解析到公网 A 或 AAAA 记录`,
  MX_ISSUE_CNAME: p => `MX 目标 "${str(p, 'exchange')}" 是 CNAME（指向 ${str(p, 'target')}），RFC 2181 要求 MX 直接指向 A/AAAA 主机名`,

  // SPF
  SPF_INVALID_DOMAIN: p => `域名 "${str(p, 'domain')}" 不是有效的公网邮件域名`,
  SPF_NOT_FOUND: p => `未在 ${str(p, 'domain')} 找到 SPF（v=spf1）TXT 记录`,
  SPF_DNS_ERROR: p => `查询 ${str(p, 'domain')} 的 TXT 记录失败（${str(p, 'error')}）`,
  SPF_MULTIPLE_RECORDS: p => `${str(p, 'domain')} 存在 ${str(p, 'count')} 条 SPF 记录；RFC 7208 规定同一域名只能有 1 条，多条会导致 PermError`,
  SPF_INVALID: p => `${str(p, 'domain')} 的 SPF 记录存在语法或解析错误`,
  SPF_VALID_WITH_WARNINGS: p => `${str(p, 'domain')} 的 SPF 记录语法有效，但存在安全或规范建议`,
  SPF_VALID: p => `${str(p, 'domain')} 的 SPF 记录合法（DNS 查询 ${str(p, 'lookups')}/${str(p, 'max')} 次）`,
  SPF_ISSUE_NEAR_MISS: p => `检测到疑似 SPF TXT 记录 "${str(p, 'record')}"，但未以标准的 "v=spf1 " 开头`,
  SPF_ISSUE_INVALID_VERSION: p => `${str(p, 'domain')} 的 SPF 记录必须以 "v=spf1" 开头`,
  SPF_ISSUE_DUPLICATE_MODIFIER: p => `${str(p, 'domain')} 的 SPF 记录中重复出现了 "${str(p, 'modifier')}=" 修饰符`,
  SPF_ISSUE_INVALID_DOMAIN_SPEC: p => `SPF 项 "${str(p, 'term')}" 中的域名格式不合法`,
  SPF_ISSUE_TYPO_EQUALS: p => `SPF 项 "${str(p, 'term')}" 误用了 "="，通常应为 "${str(p, 'expected')}"`,
  SPF_ISSUE_PLUS_ALL: () => '使用了 "+all"，允许互联网任意主机伪造本域名发信，强烈建议改为 "~all" 或 "-all"',
  SPF_ISSUE_NEUTRAL_ALL: () => '使用了 "?all"（中性策略），建议改为 "~all" 或 "-all"',
  SPF_ISSUE_INVALID_IP4: p => `ip4 机制 "${str(p, 'term')}" 的 IPv4 地址或掩码不合法`,
  SPF_ISSUE_INVALID_IP6: p => `ip6 机制 "${str(p, 'term')}" 的 IPv6 地址或掩码不合法`,
  SPF_ISSUE_INVALID_TERM: p => `无法识别或格式错误的 SPF 机制："${str(p, 'term')}"`,
  SPF_ISSUE_DEPRECATED_PTR: () => '使用了 RFC 7208 已弃用的 "ptr" 机制，解析慢且容易误判，建议替换',
  SPF_ISSUE_CYCLE: p => `SPF include/redirect 存在循环引用（涉及 ${str(p, 'target')}）`,
  SPF_ISSUE_INCLUDE_MISSING: p => `SPF ${str(p, 'kind')} 引用的域名 "${str(p, 'target')}" 没有 SPF 记录（会导致 PermError）`,
  SPF_ISSUE_INCLUDE_MULTIPLE: p => `SPF ${str(p, 'kind')} 引用的域名 "${str(p, 'target')}" 存在 ${str(p, 'count')} 条 SPF 记录（会导致 PermError）`,
  SPF_ISSUE_INCLUDE_DNS_ERROR: p => `解析 SPF ${str(p, 'kind')} 目标 "${str(p, 'target')}" 失败（${str(p, 'error')}）`,
  SPF_ISSUE_TOO_MANY_LOOKUPS: p => `SPF 累计 DNS 查询次数为 ${str(p, 'count')} 次，超过 RFC 7208 的 ${str(p, 'max')} 次上限，会导致 PermError`,
  SPF_ISSUE_HIGH_LOOKUPS: p => `SPF 累计 DNS 查询次数为 ${str(p, 'count')}/${str(p, 'max')} 次，已接近上限`,
  SPF_ISSUE_ALL_AND_REDIRECT: () => '同时配置了 "all" 和 "redirect="；按 RFC 7208 规定存在 "all" 时 "redirect=" 会被忽略',
  SPF_ISSUE_NO_TERMINATOR: () => '缺少结尾机制 "all"（如 "~all" 或 "-all"）或 "redirect="',
  SPF_ISSUE_TERMS_AFTER_ALL: () => '"all" 之后出现的机制不会被执行',
  SPF_ISSUE_LONG_RECORD: p => `SPF 记录长度为 ${str(p, 'length')} 字节，建议控制在 450 字节以内以避免 UDP DNS 截断`,

  // DMARC
  DMARC_INVALID_DOMAIN: p => `域名 "${str(p, 'domain')}" 不是有效的公网邮件域名`,
  DMARC_NOT_FOUND: p => `未在 ${str(p, 'lookupDomain')} 找到 DMARC（v=DMARC1）TXT 记录`,
  DMARC_DNS_ERROR: p => `查询 ${str(p, 'lookupDomain')} 的 TXT 记录失败（${str(p, 'error')}）`,
  DMARC_MULTIPLE_RECORDS: p => `${str(p, 'lookupDomain')} 存在 ${str(p, 'count')} 条 DMARC 记录；RFC 7489 规定只能有 1 条，多条会导致失效`,
  DMARC_INVALID: p => `${str(p, 'lookupDomain')} 的 DMARC 记录不合法`,
  DMARC_VALID_WITH_WARNINGS: p => `${str(p, 'lookupDomain')} 的 DMARC 记录语法合法（p=${str(p, 'policy')}），但存在建议项`,
  DMARC_VALID: p => `${str(p, 'lookupDomain')} 的 DMARC 记录合法（策略 p=${str(p, 'policy')}）`,
  DMARC_ISSUE_EMPTY_TAG: () => 'DMARC 记录中存在多余的空分号片段（";;"）',
  DMARC_ISSUE_SYNTAX: p => `DMARC 标签语法错误："${str(p, 'segment')}"`,
  DMARC_ISSUE_VERSION_FIRST: () => '"v=DMARC1" 必须作为 DMARC 记录的第一个标签',
  DMARC_ISSUE_VERSION_CASE: p => `DMARC 版本标签值 "${str(p, 'value')}" 必须严格大写为 "DMARC1"（RFC 7489）`,
  DMARC_ISSUE_DUPLICATE_TAG: p => `DMARC 记录中存在重复标签 "${str(p, 'tag')}"`,
  DMARC_ISSUE_INVALID_POLICY: p => `策略值 "${str(p, 'tag')}=${str(p, 'value')}" 不合法，仅支持 none、quarantine 或 reject`,
  DMARC_ISSUE_INVALID_PCT: p => `比例 "pct=${str(p, 'value')}" 不合法，必须为 0 到 100 的整数`,
  DMARC_ISSUE_INVALID_ALIGNMENT: p => `对齐模式 "${str(p, 'tag')}=${str(p, 'value')}" 不合法，仅支持 r（宽松）或 s（严格）`,
  DMARC_ISSUE_INVALID_RI: p => `报告间隔 "ri=${str(p, 'value')}" 不合法，必须为正整数（秒）`,
  DMARC_ISSUE_INVALID_FO: p => `失败报告选项 "fo=${str(p, 'value')}" 不合法，仅允许冒号分隔的 0、1、d、s`,
  DMARC_ISSUE_UNCOMMON_RF: p => `报告格式 "rf=${str(p, 'value')}" 非标准格式（RFC 7489 标准为 afrf）`,
  DMARC_ISSUE_INVALID_URI: p => `标签 "${str(p, 'tag')}" 中的报告地址 "${str(p, 'uri')}" 不合法，需使用 mailto:user@domain 格式`,
  DMARC_ISSUE_UNKNOWN_TAG: p => `包含未识别的 DMARC 标签 "${str(p, 'tag')}"`,
  DMARC_ISSUE_MISSING_POLICY: () => '缺少必填标签 "p="（策略：none / quarantine / reject）',
  DMARC_ISSUE_NONE_WITHOUT_RUA: () => '当前策略为 "p=none" 且未配置 "rua=" 接收邮箱，既不拦截伪造邮件也不会收到报告'
}

export function formatDiagnosticMessage(msg: DiagnosticMessageDto, language: 'zh-CN' | 'en-US'): string {
  if (language === 'zh-CN') {
    const formatter = ZH_MESSAGES[msg.code]
    if (formatter) return formatter(msg.params)
  }
  return msg.fallback
}
