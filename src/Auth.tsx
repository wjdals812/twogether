import { useState } from 'react'
import Brand from './Brand'
import { supabase } from './supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(signUp: boolean) {
    setError('')
    const creds = { email, password }
    const { error } = signUp
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds)
    if (error) setError(error.message)
  }

  return (
    <main className="screen">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          submit(false)
        }}
      >
        <Brand />
        <p className="tagline">함께 채우는 장소 지도</p>
        <div className="stack">
          <input
            className="field"
            type="email"
            placeholder="이메일"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="field"
            type="password"
            placeholder="비밀번호 (6자 이상)"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary">로그인</button>
          <button className="btn btn-ghost" type="button" onClick={() => submit(true)}>
            회원가입
          </button>
        </div>
      </form>
    </main>
  )
}
