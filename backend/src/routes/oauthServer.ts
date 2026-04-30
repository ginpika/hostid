/**
 * OAuth 授权服务器路由
 * 实现 OAuth 2.0 授权码流程和令牌颁发
 * 支持 PKCE 验证、刷新令牌和用户信息接口
 */
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
  decryptClientSecret
} from '../services/oauth2'

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const SSO_COOKIE_NAME = process.env.SSO_COOKIE_NAME || 'sso_token'

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

router.get('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    response_type,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method = 'S256'
  } = req.query as Record<string, string>

  if (response_type !== 'code') {
    throw new AppError('Unsupported response_type. Only "code" is supported.', 400)
  }

  if (!client_id || !redirect_uri) {
    throw new AppError('Missing required parameters: client_id and redirect_uri', 400)
  }

  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp) {
    throw new AppError('Invalid client_id', 400)
  }

  if (!oauthApp.isActive) {
    throw new AppError('This application is disabled', 400)
  }

  let redirectUris: string[] = []
  try {
    redirectUris = JSON.parse(oauthApp.redirectUris)
  } catch {
    throw new AppError('Invalid redirect_uris configuration', 500)
  }

  if (!redirectUris.includes(redirect_uri)) {
    throw new AppError('Invalid redirect_uri', 400)
  }

  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, username: true, email: true, nickname: true, avatar: true }
  })

  if (!user) {
    throw new AppError('User not found', 404)
  }

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
    clientId: client_id,
    redirectUri: redirect_uri,
    state,
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method
  })
}))

router.post('/authorize', auth, asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method = 'S256',
    approve
  } = req.body

  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp || !oauthApp.isActive) {
    throw new AppError('Invalid or disabled application', 400)
  }

  let redirectUris: string[] = []
  try {
    redirectUris = JSON.parse(oauthApp.redirectUris)
  } catch {
    throw new AppError('Invalid redirect_uris configuration', 500)
  }

  if (!redirectUris.includes(redirect_uri)) {
    throw new AppError('Invalid redirect_uri', 400)
  }

  const redirectUrl = new URL(redirect_uri)

  if (approve !== 'true') {
    redirectUrl.searchParams.set('error', 'access_denied')
    redirectUrl.searchParams.set('error_description', 'User denied the authorization request')
    if (state) {
      redirectUrl.searchParams.set('state', state)
    }
    res.json({ redirectUrl: redirectUrl.toString() })
    return
  }

  const code = generateAuthorizationCode()

  await saveAuthorizationCode({
    code,
    clientId: client_id,
    redirectUri: redirect_uri,
    userId: req.userId!,
    scope: 'openid profile email',
    codeChallenge: code_challenge,
    codeChallengeMethod: code_challenge_method as 'S256' | 'plain' | undefined
  })

  redirectUrl.searchParams.set('code', code)
  if (state) {
    redirectUrl.searchParams.set('state', state)
  }

  res.json({ redirectUrl: redirectUrl.toString() })
}))

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

  if (grant_type === 'refresh_token') {
    if (!refresh_token || !client_id) {
      throw new AppError('Missing required parameters for refresh_token grant', 400)
    }

    const tokenData = await verifyRefreshToken(refresh_token)
    if (!tokenData) {
      throw new AppError('Invalid or expired refresh token', 400)
    }

    if (tokenData.clientId !== client_id) {
      throw new AppError('Client ID mismatch', 400)
    }

    const oauthApp = await prisma.oAuthApp.findUnique({
      where: { clientId: client_id }
    })

    if (!oauthApp || !oauthApp.isActive) {
      throw new AppError('Invalid or disabled application', 400)
    }

    if (oauthApp.isConfidential) {
      if (!client_secret) {
        throw new AppError('client_secret is required for confidential clients', 400)
      }

      const decryptedSecret = decryptClientSecret(oauthApp.clientSecret)
      if (client_secret !== decryptedSecret) {
        throw new AppError('Invalid client_secret', 401)
      }
    }

    const accessToken = generateAccessToken()
    await saveAccessToken({
      token: accessToken,
      clientId: client_id,
      userId: tokenData.userId,
      scope: 'openid profile email'
    })

    const newRefreshToken = generateRefreshToken()
    await saveRefreshToken(newRefreshToken, client_id, tokenData.userId)

    await prisma.refreshToken.delete({ where: { token: refresh_token } }).catch(() => {})

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: newRefreshToken
    })
    return
  }

  if (grant_type !== 'authorization_code') {
    throw new AppError('Unsupported grant_type. Only "authorization_code" and "refresh_token" are supported.', 400)
  }

  if (!code || !redirect_uri || !client_id) {
    throw new AppError('Missing required parameters', 400)
  }

  const oauthApp = await prisma.oAuthApp.findUnique({
    where: { clientId: client_id }
  })

  if (!oauthApp) {
    throw new AppError('Invalid client_id', 400)
  }

  if (!oauthApp.isActive) {
    throw new AppError('This application is disabled', 400)
  }

  if (oauthApp.isConfidential) {
    if (!client_secret) {
      throw new AppError('client_secret is required for confidential clients', 400)
    }

    const decryptedSecret = decryptClientSecret(oauthApp.clientSecret)
    if (client_secret !== decryptedSecret) {
      throw new AppError('Invalid client_secret', 401)
    }
  }

  const codeData = await consumeAuthorizationCode(code)

  if (!codeData) {
    throw new AppError('Invalid or expired authorization code', 400)
  }

  if (codeData.clientId !== client_id) {
    throw new AppError('Client ID mismatch', 400)
  }

  if (codeData.redirectUri !== redirect_uri) {
    throw new AppError('Redirect URI mismatch', 400)
  }

  if (codeData.codeChallenge) {
    if (!code_verifier) {
      throw new AppError('code_verifier is required for PKCE', 400)
    }

    if (!verifyPKCE(code_verifier, codeData.codeChallenge, codeData.codeChallengeMethod || 'S256')) {
      throw new AppError('Invalid code_verifier', 400)
    }
  }

  const accessToken = generateAccessToken()
  await saveAccessToken({
    token: accessToken,
    clientId: client_id,
    userId: codeData.userId,
    scope: 'openid profile email'
  })

  const refreshToken = generateRefreshToken()
  await saveRefreshToken(refreshToken, client_id, codeData.userId)

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: refreshToken
  })
}))

router.get('/userinfo', asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Authorization header required', 401)
  }

  const token = authHeader.substring(7)

  const tokenData = await verifyAccessToken(token)

  if (!tokenData) {
    throw new AppError('Invalid or expired access token', 401)
  }

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

  const response: Record<string, any> = {
    sub: user.id,
    name: user.nickname || user.username,
    username: user.username,
    email: user.email,
    email_verified: true
  }

  if (user.avatar) {
    response.picture = user.avatar.startsWith('http')
      ? user.avatar
      : `/api/auth/avatar/${user.avatar}`
  }

  res.json(response)
}))

export default router