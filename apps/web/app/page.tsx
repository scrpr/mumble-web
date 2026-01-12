'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useGatewayStore } from '../src/state/gateway-store'
import { RadioTower, User, KeyRound, Server, ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '../src/ui/cn'

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

  useEffect(() => {
    const first = servers[0]
    if (!serverId && first) {
      setServerId(first.id)
    }
  }, [servers, serverId])

  const canConnect = useMemo(() => {
    return Boolean(serverId && username && status !== 'connecting')
  }, [serverId, username, status])

  const handleConnect = () => {
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
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      {/* Background Decoration */}
      <div className="pointer-events-none absolute -left-1/4 -top-1/4 h-[800px] w-[800px] rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-1/4 -right-1/4 h-[800px] w-[800px] rounded-full bg-primary/5 blur-3xl" />

      <Card className="z-10 w-full max-w-md border-border/50 bg-card/50 backdrop-blur-xl shadow-2xl transition-all duration-500">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
            <RadioTower className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Mumble Web</CardTitle>
          <CardDescription>
            High quality, low latency voice chat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server</Label>
            <div className="relative">
              <Server className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <select
                className={cn(
                  "flex h-10 w-full rounded-md border border-input bg-background/50 px-3 pl-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
                  !serverId && "text-muted-foreground"
                )}
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                <option value="" disabled>
                  Select a server...
                </option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id} className="text-foreground">
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Identity</Label>
            <div className="space-y-3">
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 bg-background/50 border-input/50 focus:bg-background transition-colors"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                />
              </div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 bg-background/50 border-input/50 focus:bg-background transition-colors"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="Password (Optional)"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Access Tokens</Label>
            <Input
              className="bg-background/50 border-input/50 focus:bg-background transition-colors"
              value={tokens}
              onChange={(e) => setTokens(e.target.value)}
              placeholder="Comma,separated,tokens"
            />
          </div>

          {connectError ? (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive animate-in fade-in slide-in-from-top-1">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="flex-1 text-xs">{connectError}</span>
            </div>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-4 pt-2">
          <Button
            className="w-full font-semibold shadow-lg shadow-primary/20"
            size="lg"
            disabled={!canConnect}
            onClick={handleConnect}
          >
            {status === 'connecting' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                Connect
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>

          <div className="flex w-full justify-between items-center text-[10px] text-muted-foreground px-1">
            <div className="flex items-center gap-1">
              <span className={cn("inline-block h-2 w-2 rounded-full", gatewayStatus === 'open' ? "bg-emerald-500" : "bg-yellow-500")} />
              Gateway {gatewayStatus}
            </div>
            {status === 'reconnecting' && (
              <button onClick={() => disconnect()} className="hover:text-foreground underline transition-colors">
                Cancel Reconnect
              </button>
            )}
          </div>
        </CardFooter>
      </Card>
    </main>
  )
}
