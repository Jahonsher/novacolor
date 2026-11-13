import { useState, type FormEvent } from 'react'
import { api, usingMock } from '../api'
import { errText } from '../lib'
import { Button, Field, Input } from '../ui'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return setError('Parolni kiriting')
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      onLogin() // the index route then redirects to the dashboard (or `from`)
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-display text-5xl leading-none text-stone-900">NovaColor</p>
          <p className="mt-2 text-xs font-semibold tracking-[0.24em] text-stone-500 uppercase">Boshqaruv paneli</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm" noValidate>
          <h1 className="mb-5 text-lg font-semibold">Kirish</h1>
          <Field label="Parol" error={error}>
            {(id) => (
              <div className="relative">
                <Input
                  id={id}
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  className="pr-20"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute inset-y-0 right-0 px-3 text-sm text-stone-500 hover:text-stone-800"
                  aria-pressed={show}
                >
                  {show ? 'Yashirish' : "Ko'rsatish"}
                </button>
              </div>
            )}
          </Field>
          <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full">
            Kirish
          </Button>
          {usingMock() && (
            <p className="mt-4 text-center text-xs text-amber-700">Sinov rejimi: parol — novacolor</p>
          )}
        </form>
      </div>
    </div>
  )
}
