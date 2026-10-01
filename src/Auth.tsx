import { useState } from 'react'
import Brand from './Brand'
import { koError } from './errors'
import { supabase } from './supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [signUp, setSignUp] = useState(false)
  const [error, setError] = useState('')

  function switchMode() {
    setSignUp(!signUp)
    setConfirm('')
    setError('')
  }

  async function submit() {
    setError('')
    if (signUp && password !== confirm) return setError('비밀번호가 서로 다릅니다.')
    const creds = { email, password }
    const { error } = signUp
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds)
    if (error) setError(koError(error))
  }

  return (
    <main className="screen">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
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
            autoComplete={signUp ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {signUp && (
            <input
              className="field"
              type="password"
              placeholder="비밀번호 확인"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary">{signUp ? '가입하기' : '로그인'}</button>
          <button className="btn btn-ghost" type="button" onClick={switchMode}>
            {signUp ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 회원가입'}
          </button>
        </div>
      </form>
    </main>
  )
}
