export const translations = {
  'zh-CN': {
    // Navigation
    inbox: '收件箱',
    sent: '已发送',
    trash: '垃圾箱',
    archived: '已归档',
    compose: '撰写',
    logout: '退出登录',
    mail: '邮件',
    close: '关闭',
    menu: '菜单',
    usernameHint: '只能包含字母、数字、点和下划线',
    pleaseCompleteVerification: '请完成人机验证',
    
    // Login success
    loginSuccess: '登录成功',
    redirecting: '正在跳转...',
    
    // SSO
    ssoLogin: '统一登录',
    ssoLoginHint: '登录以访问',
    ssoPoweredBy: '由 HostID SSO 提供支持',
    ssoInfo: 'SSO 信息',
    
    // Email actions
    delete: '删除',
    restore: '恢复',
    reply: '回复',
    replyAll: '回复全部',
    forward: '转发',
    markAsRead: '标记为已读',
    markAsUnread: '标记为未读',
    clear: '清空',
    star: '星标',
    unstar: '取消星标',
    archive: '归档',
    unarchive: '取消归档',
    moveTo: '移动到',
    moveToInbox: '移动到收件箱',
    moveToSent: '移动到已发送',
    moveToTrash: '移动到垃圾箱',
    moveToArchived: '移动到已归档',
    clickToCopy: '点击复制',
    
    // Sidebar
    mailbox: '邮箱',
    general: '常规',
    about: '关于',
    profile: '个人资料',
    admin: '管理员',
    
    // Connection Config
    connectionConfig: '连接配置',
    connectionConfigDesc: '选择您的连接模式',
    localMode: '本地模式',
    remoteMode: '远程模式',
    localModeDesc: '连接本地后端服务',
    remoteModeDesc: '连接远程服务器',
    host: '主机',
    port: '端口',
    serverUrl: '服务器地址',
    testConnection: '测试连接',
    saveConfig: '保存配置',
    checking: '检测中...',
    localBackendOnline: '本地后端运行中',
    localBackendOffline: '本地后端未运行',
    connectionSuccess: '连接成功',
    connectionFailed: '连接失败',
    
    // Theme
    lightMode: '浅色模式',
    darkMode: '深色模式',
    systemMode: '跟随系统',
    systemModeDesc: '自动跟随系统设置',
    selectTheme: '选择主题',
    currentTheme: '当前主题',
    moreThemesComing: '更多主题敬请期待',
    
    // Admin page
    adminPanel: '管理员面板',
    adminDescription: '数据库管理工具',
    adminAccessDenied: '需要管理员权限',
    tables: '数据表',
    selectTable: '选择一个数据表查看',
    refresh: '刷新',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    showing: '显示',
    of: '共',
    confirmDelete: '确定要删除这条记录吗？',
    actions: '操作',
    
    // About page
    aboutDescription: '自托管邮件系统',
    aboutIntro: '一套自托管的邮件解决方案，适用于个人和小型团队使用。',
    features: '功能特性',
    feature1: '域名内邮件收发',
    feature2: '富文本邮件编辑',
    feature3: '文件附件支持',
    feature4: 'Markdown & HTML 邮件渲染',
    feature5: '星标与邮件管理',
    feature6: '多语言支持（中文/English）',
    builtWith: 'Built with React, TypeScript, Tailwind CSS & Node.js',
    backToInbox: '返回收件箱',
    
    // Profile page
    profileDescription: '管理您的个人信息',
    accountInfo: '账户信息',
    basicInfo: '基本信息',
    personalInfo: '个人信息',
    nickname: '昵称',
    phone: '手机号',
    birthday: '生日',
    registeredAt: '注册时间',
    edit: '编辑',
    editProfile: '编辑资料',
    profileUpdated: '资料已更新',
    saveFailed: '保存失败',
    profileNotFound: '未找到用户信息',
    nicknamePlaceholder: '请输入昵称',
    phonePlaceholder: '请输入手机号',
    saving: '保存中...',
    save: '保存',
    
    // Email list
    from: '发件人',
    subject: '主题',
    received: '收到',
    noEmails: '没有邮件',
    selectEmailToView: '选择邮件以查看详情',
    selectArchivedEmail: '选择归档邮件以查看详情',
    openInNewWindow: '新窗口打开',
    emailNotFound: '邮件未找到',
    emails: '邮件',
    select: '选择',
    selected: '已选择',
    selectAll: '全选',
    cancel: '取消',
    
    // Email compose
    to: '收件人',
    cc: '抄送',
    bcc: '密送',
    recipients: '收件人',
    addRecipient: '添加收件人',
    recipientPlaceholder: '输入用户名，用逗号分隔多个',
    recipientHint: '按回车添加收件人，或用逗号分隔多个收件人',
    changeType: '更改类型',
    noRecipients: '请至少添加一个收件人',
    noRecipientsDisplay: '无收件人',
    maxRecipientsReached: '已达到最大收件人数量',
    invalidUsernames: '无效的用户名',
    invalidUsername: '无效的用户名',
    duplicateEmail: '邮箱已存在',
    subjectPlaceholder: '主题',
    bodyPlaceholder: '撰写邮件...',
    send: '发送',
    sending: '发送中...',
    discard: '丢弃',
    forwardMessage: '转发邮件',
    date: '日期',
    body: '正文',
    
    // Rich text editor
    bold: '粗体',
    italic: '斜体',
    underline: '下划线',
    strikethrough: '删除线',
    highlight: '高亮',
    bulletList: '无序列表',
    orderedList: '有序列表',
    blockquote: '引用',
    sourceCodeMode: '源代码模式',
    richTextMode: '富文本模式',
    addLink: '添加链接',
    removeLink: '移除链接',
    linkUrl: '链接地址',
    undo: '撤销',
    redo: '重做',
    
    // Attachments
    attachments: '附件',
    dropFilesHere: '拖放文件到此处或点击上传',
    maxFileSize: '最大文件大小',
    maxFiles: '最大文件数',
    fileTypeNotAllowed: '文件类型不允许',
    fileTooLarge: '文件太大',
    uploaded: '已上传',
    download: '下载',
    preview: '预览',
    image: '图片',
    
    // Login/Register
    login: '登录',
    register: '注册',
    username: '用户名',
    email: '邮箱',
    password: '密码',
    name: '姓名',
    confirmPassword: '确认密码',
    forgotPassword: '忘记密码？',
    createAccount: '创建账户',
    alreadyHaveAccount: '已有账户？',
    loginToAccount: '登录到您的账户',
    registerToAccount: '注册一个新账户',
    
    // Errors
    invalidCredentials: '用户名或密码错误',
    emailAlreadyRegistered: '邮箱已注册',
    usernameAlreadyTaken: '用户名已被占用',
    passwordTooShort: '密码太短',
    passwordsDoNotMatch: '密码不匹配',
    
    // Success
    emailSent: '邮件已发送',
    emailDeleted: '邮件已删除',
    emailRestored: '邮件已恢复',
    
    // Language switch
    language: '语言',
    chinese: '中文',
    english: 'English',
    
    // ToS
    tosAndPrivacy: '服务条款与隐私政策',
    
    // Loading
    loading: '加载中...',
    
    // Placeholders
    noSubject: '(无主题)',
    noContent: '(无内容)',
    
    // Date formats
    today: '今天',
    yesterday: '昨天',
    
    // Pagination
    page: '页',
    previous: '上一页',
    next: '下一页',
    
    // Other
    settings: '设置',
    help: '帮助',
    add: '添加',
  },
  'en-US': {
    // Navigation
    inbox: 'Inbox',
    sent: 'Sent',
    trash: 'Trash',
    archived: 'Archived',
    compose: 'Compose',
    logout: 'Logout',
    mail: 'Mail',
    close: 'Close',
    menu: 'Menu',
    usernameHint: 'Only letters, numbers, dots and underscores allowed',
    pleaseCompleteVerification: 'Please complete the verification',
    
    // Login success
    loginSuccess: 'Login Successful',
    redirecting: 'Redirecting...',
    
    // SSO
    ssoLogin: 'SSO Login',
    ssoLoginHint: 'Sign in to access',
    ssoPoweredBy: 'Powered by HostID SSO',
    ssoInfo: 'SSO Info',
    
    // Email actions
    delete: 'Delete',
    restore: 'Restore',
    reply: 'Reply',
    replyAll: 'Reply All',
    forward: 'Forward',
    markAsRead: 'Mark as Read',
    markAsUnread: 'Mark as Unread',
    clear: 'Clear',
    star: 'Star',
    unstar: 'Unstar',
    archive: 'Archive',
    unarchive: 'Unarchive',
    moveTo: 'Move to',
    moveToInbox: 'Move to Inbox',
    moveToSent: 'Move to Sent',
    moveToTrash: 'Move to Trash',
    moveToArchived: 'Move to Archived',
    clickToCopy: 'Click to copy',
    
    // Sidebar
    mailbox: 'Mailbox',
    general: 'General',
    about: 'About',
    profile: 'Profile',
    admin: 'Admin',
    
    // Connection Config
    connectionConfig: 'Connection Settings',
    connectionConfigDesc: 'Select your connection mode',
    localMode: 'Local Mode',
    remoteMode: 'Remote Mode',
    localModeDesc: 'Connect to local backend',
    remoteModeDesc: 'Connect to remote server',
    host: 'Host',
    port: 'Port',
    serverUrl: 'Server URL',
    testConnection: 'Test Connection',
    saveConfig: 'Save Settings',
    checking: 'Checking...',
    localBackendOnline: 'Local backend online',
    localBackendOffline: 'Local backend offline',
    connectionSuccess: 'Connection successful',
    connectionFailed: 'Connection failed',
    
    // Theme
    lightMode: 'Light',
    darkMode: 'Dark',
    systemMode: 'System',
    systemModeDesc: 'Follow system settings',
    selectTheme: 'Select Theme',
    currentTheme: 'Current Theme',
    moreThemesComing: 'More themes coming soon',
    
    // Admin page
    adminPanel: 'Admin Panel',
    adminDescription: 'Database management tool',
    adminAccessDenied: 'Admin access required',
    tables: 'Tables',
    selectTable: 'Select a table to view',
    refresh: 'Refresh',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    showing: 'Showing',
    of: 'of',
    confirmDelete: 'Are you sure you want to delete this record?',
    actions: 'Actions',
    
    // About page
    aboutDescription: 'Self-hosted Email System',
    aboutIntro: 'A self-hosted email solution for personal and small team use.',
    features: 'Features',
    feature1: 'Send and receive emails within your domain',
    feature2: 'Rich text email composition',
    feature3: 'File attachments support',
    feature4: 'Markdown & HTML email rendering',
    feature5: 'Star and organize emails',
    feature6: 'Multi-language support (中文/English)',
    builtWith: 'Built with React, TypeScript, Tailwind CSS & Node.js',
    backToInbox: 'Back to Inbox',
    
    // Profile page
    profileDescription: 'Manage your personal information',
    accountInfo: 'Account Info',
    basicInfo: 'Basic Info',
    personalInfo: 'Personal Info',
    nickname: 'Nickname',
    phone: 'Phone',
    birthday: 'Birthday',
    registeredAt: 'Registered At',
    edit: 'Edit',
    editProfile: 'Edit Profile',
    profileUpdated: 'Profile updated',
    saveFailed: 'Save failed',
    profileNotFound: 'Profile not found',
    nicknamePlaceholder: 'Enter nickname',
    phonePlaceholder: 'Enter phone number',
    saving: 'Saving...',
    save: 'Save',
    
    // Email list
    from: 'From',
    subject: 'Subject',
    received: 'Received',
    noEmails: 'No emails',
    selectEmailToView: 'Select an email to view',
    selectArchivedEmail: 'Select an archived email to view',
    openInNewWindow: 'Open in new window',
    emailNotFound: 'Email not found',
    emails: 'Emails',
    select: 'Select',
    selected: 'Selected',
    selectAll: 'Select All',
    cancel: 'Cancel',
    
    // Email compose
    to: 'To',
    cc: 'Cc',
    bcc: 'Bcc',
    recipients: 'Recipients',
    addRecipient: 'Add Recipient',
    recipientPlaceholder: 'Enter username, separate multiple with commas',
    recipientHint: 'Press Enter to add recipient, or use commas to separate multiple',
    changeType: 'Change Type',
    noRecipients: 'Please add at least one recipient',
    noRecipientsDisplay: 'No recipients',
    maxRecipientsReached: 'Maximum recipients reached',
    invalidUsernames: 'Invalid usernames',
    invalidUsername: 'Invalid username',
    duplicateEmail: 'Email already exists',
    subjectPlaceholder: 'Subject',
    bodyPlaceholder: 'Compose email...',
    send: 'Send',
    sending: 'Sending...',
    discard: 'Discard',
    forwardMessage: 'Forwarded message',
    date: 'Date',
    body: 'Body',
    
    // Rich text editor
    bold: 'Bold',
    italic: 'Italic',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    highlight: 'Highlight',
    bulletList: 'Bullet List',
    orderedList: 'Ordered List',
    blockquote: 'Quote',
    sourceCodeMode: 'Source Code',
    richTextMode: 'Rich Text',
    addLink: 'Add Link',
    removeLink: 'Remove Link',
    linkUrl: 'Link URL',
    undo: 'Undo',
    redo: 'Redo',
    
    // Attachments
    attachments: 'Attachments',
    dropFilesHere: 'Drop files here or click to upload',
    maxFileSize: 'Max file size',
    maxFiles: 'Max files',
    fileTypeNotAllowed: 'File type not allowed',
    fileTooLarge: 'File too large',
    uploaded: 'Uploaded',
    download: 'Download',
    preview: 'Preview',
    image: 'Image',
    
    // Login/Register
    login: 'Login',
    register: 'Register',
    username: 'Username',
    email: 'Email',
    password: 'Password',
    name: 'Name',
    confirmPassword: 'Confirm Password',
    forgotPassword: 'Forgot password?',
    createAccount: 'Create account',
    alreadyHaveAccount: 'Already have an account?',
    loginToAccount: 'Sign in to your account',
    registerToAccount: 'Get started with your free account',
    
    // Errors
    invalidCredentials: 'Username or password is incorrect',
    emailAlreadyRegistered: 'Email already registered',
    usernameAlreadyTaken: 'Username already taken',
    passwordTooShort: 'Password too short',
    passwordsDoNotMatch: 'Passwords do not match',
    
    // Success
    emailSent: 'Email sent',
    emailDeleted: 'Email deleted',
    emailRestored: 'Email restored',
    
    // Language switch
    language: 'Language',
    chinese: '中文',
    english: 'English',
    
    // ToS
    tosAndPrivacy: 'ToS & Privacy Policy',
    
    // Loading
    loading: 'Loading...',
    
    // Placeholders
    noSubject: '(No subject)',
    noContent: '(No content)',
    
    // Date formats
    today: 'Today',
    yesterday: 'Yesterday',
    
    // Pagination
    page: 'Page',
    previous: 'Previous',
    next: 'Next',
    
    // Other
    settings: 'Settings',
    help: 'Help',
    add: 'Add',
  }
} as const;
