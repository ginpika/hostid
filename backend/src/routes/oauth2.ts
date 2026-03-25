import { Router, Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { auth, AuthRequest } from '../middleware/auth'
import { AppError } from '../middleware/error'
import {
  generateAuthorizationCode,
  generateAccessToken,
  generateRefreshToken,
  saveAuthorizationCode,
  consumeAuthorizationCode,
  saveAccessToken,
  saveRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyPKCE,
  validateRedirectUri,
  decryptClientSecret,
  getScopeDescription
} from '../services/oauth2'

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * GET /api/oauth2/authorize
 * 显示授权页面或直接重定向（如果自动批准）
 */
router.get('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    scope = 'openid profile email',
    state,
    code_challenge,
    code_challenge_method = 'S256'
  } = req.query as Record<string, string>

  // 验证必需参数
  if (response_type !== 'code') {
    throw new AppError('Unsupported response_type. Only "code" is supported.', 400)
  }

  if (!client_id || !redirect_uri) {
    throw new AppError('Missing required parameters: client_id and redirect_uri', 400)
  }

  // 查找 OAuth App
  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp) {
    throw new AppError('Invalid client_id', 400)
  }

  if (!oauthApp.isActive) {
    throw new AppError('This application is disabled', 400)
  }

  // 验证 redirect_uri
  let redirectUris: string[] = []
  try {
    redirectUris = JSON.parse(oauthApp.redirectUris)
  } catch {
    throw new AppError('Invalid redirect_uris configuration', 500)
  }

  if (!validateRedirectUri(redirect_uri, redirectUris)) {
    throw new AppError('Invalid redirect_uri', 400)
  }

  // 获取当前用户
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, username: true, email: true, nickname: true, avatar: true }
  })

  if (!user) {
    throw new AppError('User not found', 404)
  }

  // 返回授权页面数据
  res.json({
    app: {
      name: oauthApp.name,
      description: oauthApp.description,
      homepage: oauthApp.homepage
    },
    user: {
      username: user.username,
      nickname: user.nickname,
      email: user.email
    },
    scope: getScopeDescription(scope),
    requestedScope: scope,
    clientId: client_id,
    redirectUri: redirect_uri,
    state,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method
  })
}))

/**
 * POST /api/oauth2/authorize
 * 处理用户的授权决定
 */
router.post('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    client_id,
    redirect_uri,
    scope = 'openid profile email',
    state,
    code_challenge,
    code_challenge_method = 'S256',
    approve // 'true' or 'false'
  } = req.body

  // 查找 OAuth App
  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp || !oauthApp.isActive) {
    throw new AppError('Invalid or disabled application', 400)
  }

  // 验证 redirect_uri
  let redirectUris: string[] = []
  try {
    redirectUris = JSON.parse(oauthApp.redirectUris)
  } catch {
    throw new AppError('Invalid redirect_uris configuration', 500)
  }

  if (!validateRedirectUri(redirect_uri, redirectUris)) {
    throw new AppError('Invalid redirect_uri', 400)
  }

  // 构建基础重定向 URL
  const redirectUrl = new URL(redirect_uri)

  // 用户拒绝授权
  if (approve !== 'true') {
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('error_description', 'User denied the authorization request')
    if (state) {
      redirectUrl.searchParams.set('state', state)
    }
    res.json({ redirectUrl: redirectUrl.toString() })
    return
  }

  // 生成授权码
  const code = generateAuthorizationCode()

  // 保存授权码
  await saveAuthorizationCode({
    code,
    clientId: client_id,
    redirectUri: redirect_uri,
    userId: req.userId!,
    scope,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method as 'S256' | 'plain' | undefined
  })

  // 构建重定向 URL
  redirectUrl.searchParams.set('code', code)
  if (state) {
    redirectUrl.searchParams.set('state', state)
  }

  res.json({ redirectUrl: redirectUrl.toString() })
}))

/**
 * POST /api/oauth2/token
 * 使用授权码换取令牌
 */
router.post('/token', asyncHandler(async (req: Request, res: Response) => {
  const {
    grant_type,
    code,
    redirect_uri,
    client_id,
    client_secret,
    code_verifier,
    refresh_token
  } = req.body

  // 处理 refresh_token 授权类型
  if (grant_type === 'refresh_token') {
    if (!refresh_token || !client_id) {
      throw new AppError('Missing required parameters for refresh_token grant', 400)
    }

    // 验证 refresh token
    const tokenData = await verifyRefreshToken(refresh_token)
    if (!tokenData) {
      throw new AppError('Invalid or expired refresh token', 400)
    }

    // 验证 client_id 匹配
    if (tokenData.clientId !== client_id) {
      throw new AppError('Client ID mismatch', 400)
    }

    // 查找 OAuth App
    const oauthApp = await prisma.oAuthApp.findUnique({
      where: { clientId: client_id }
    })

    if (!oauthApp || !oauthApp.isActive) {
      throw new AppError('Invalid or disabled application', 400)
    }

    // 对于机密客户端，验证 client_secret
    if (oauthApp.isConfidential) {
      if (!client_secret) {
        throw new AppError('client_secret is required for confidential clients', 400)
      }

      const decryptedSecret = decryptClientSecret(oauthApp.clientSecret)
      if (client_secret !== decryptedSecret) {
        throw new AppError('Invalid client_secret', 401)
      }
    }

    // 生成新的 access token
    const accessToken = generateAccessToken()
    await saveAccessToken({
      token: accessToken,
      clientId: client_id,
      userId: tokenData.userId,
      scope: tokenData.scope
    })

    // 生成新的 refresh token
    const newRefreshToken = generateRefreshToken()
    await saveRefreshToken(newRefreshToken, client_id, tokenData.userId, tokenData.scope)

    // 删除旧的 refresh token
    await prisma.refreshToken.delete({ where: { token: refresh_token } }).catch(() => {})

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: tokenData.scope
    })
    return
  }

  // 处理 authorization_code 授权类型
  if (grant_type !== 'authorization_code') {
    throw new AppError('Unsupported grant_type. Only "authorization_code" and "refresh_token" are supported.', 400)
  }

  if (!code || !redirect_uri || !client_id) {
    throw new AppError('Missing required parameters', 400)
  }

  // 查找 OAuth App
  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp) {
    throw new AppError('Invalid client_id', 400)
  }

  if (!oauthApp.isActive) {
    throw new AppError('This application is disabled', 400)
  }

  // 对于机密客户端，验证 client_secret
  if (oauthApp.isConfidential) {
    if (!client_secret) {
      throw new AppError('client_secret is required for confidential clients', 400)
    }

    const decryptedSecret = decryptClientSecret(oauthApp.clientSecret)
    if (client_secret !== decryptedSecret) {
      throw new AppError('Invalid client_secret', 401)
    }
  }

  // 消费授权码（一次性使用）
  const codeData = await consumeAuthorizationCode(code)

  if (!codeData) {
    throw new AppError('Invalid or expired authorization code', 400)
  }

  // 验证 client_id 匹配
  if (codeData.clientId !== client_id) {
    throw new AppError('Client ID mismatch', 400)
  }

  // 验证 redirect_uri 匹配
  if (codeData.redirectUri !== redirect_uri) {
    throw new AppError('Redirect URI mismatch', 400)
  }

  // 验证 PKCE
  if (codeData.codeChallenge) {
    if (!code_verifier) {
      throw new AppError('code_verifier is required for PKCE', 400)
    }

    if (!verifyPKCE(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod || 'S256')) {
      throw new AppError('Invalid code_verifier', 400)
    }
  }

  // 生成 access token
  const accessToken = generateAccessToken()
  await saveAccessToken({
    token: accessToken,
    clientId: client_id,
    userId: codeData.userId,
    scope: codeData.scope
  })

  // 生成 refresh token
  const refreshToken = generateRefreshToken()
  await saveRefreshToken(refreshToken, client_id, codeData.userId, codeData.scope)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshToken,
    scope: codeData.scope
  })
}))

/**
 * GET /api/oauth2/userinfo
 * 获取用户信息
 */
router.get('/userinfo', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Authorization header required', 401)
  }

  const token = authHeader.substring(7)

  // 验证 access token
  const tokenData = await verifyAccessToken(token)

  if (!tokenData) {
    throw new AppError('Invalid or expired access token', 401)
  }

  // 获取用户信息
  const user = await prisma.user.findUnique({
    where: { id: tokenData.userId },
    select: {
      id: true,
      username: true,
      email: true,
      nickname: true,
      avatar: true
    }
  })

  if (!user) {
    throw new AppError('User not found', 404)
  }

  // 构建响应
  const response: Record<string, any> = {
    sub: user.id
  }

  // 根据返回信息
  if (tokenData.scope.includes('profile')) {
    response.name = user.nickname || user.username
    response.username = user.username
    if (user.avatar) {
      response.picture = user.avatar.startsWith('http')
        ? user.avatar
        : `/api/auth/avatar/${user.avatar}`
    }
  }

  if (tokenData.scope.includes('email')) {
    response.email = user.email
    response.email_verified = true
  }

  res.json(response)
}))

export default router