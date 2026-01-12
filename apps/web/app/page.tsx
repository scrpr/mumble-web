'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useGatewayStore } from '../src/state/gateway-store'

export default function ConnectPage() {
  const router = useRouter()
  const { gatewayStatus, status, servers, connect, connectError, init, disconnect } = useGatewayStore()

  const [serverId, setServerId] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [tokens, setTokens] = useState('')

  useEffect(() => {
    init()
  }, [init, disconnect])

  useEffect(() => {
    if (status === 'connected') {
      router.push('/app')
    }
  }, [status, router])

  const canConnect = useMemo(() => {
    return Boolean(serverId && username && status !== 'connecting')
  }, [serverId, username, status])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>连接到 Mumble</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>服务器（白名单）</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
            >
              <option value="" disabled>
                请选择…
              </option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>用户名</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your name" />
          </div>

          <div className="space-y-2">
            <Label>密码（可选）</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password" />
          </div>

          <div className="space-y-2">
            <Label>Tokens（可选，逗号分隔）</Label>
            <Input value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="token1,token2" />
          </div>

          {connectError ? <p className="text-sm text-destructive">{connectError}</p> : null}

          <div className="flex gap-2">
            <Button
              disabled={!canConnect}
              onClick={() => {
                const parsedTokens = tokens
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean)

                connect({
                  serverId,
                  username,
                  ...(password ? { password } : {}),
                  ...(parsedTokens.length ? { tokens: parsedTokens } : {})
                })
              }}
            >
              {status === 'connecting' ? '连接中…' : '连接'}
            </Button>
            <Button variant="secondary" onClick={() => disconnect()}>
              断开
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            Gateway: {gatewayStatus} · Session: {status}
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
