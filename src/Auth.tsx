import { useState } from 'react'
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      style={{ display: 'grid', gap: 8, maxWidth: 320, margin: '20vh auto', padding: 16 }}
    >
      <h2>twogether</h2>
      <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        type="password"
        placeholder="비밀번호 (6자 이상)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button>로그인</button>
      <button type="button" onClick={() => submit(true)}>
        회원가입
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </form>
  )
}
