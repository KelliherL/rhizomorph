import { placeholder } from '@observatory/core'

export function App() {
  const { ready } = placeholder()

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <p>the Observatory — {ready ? 'scaffold ready' : 'not ready'}</p>
    </main>
  )
}
