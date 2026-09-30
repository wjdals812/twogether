import { useState } from 'react'
import Brand from './Brand'
import { supabase } from './supabase'

export type Room = { id: string; invite_code: string }

export default function RoomGate({ onRoom }: { onRoom: (r: Room) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function run(fn: 'create_room' | 'join_room') {
    setError('')
    const { data, error } = await supabase.rpc(fn, fn === 'join_room' ? { code } : undefined)
    if (error) setError(error.message)
    else onRoom(data)
  }

  return (
    <main className="screen">
      <div className="card">
        <Brand />
        <p className="tagline">방을 만들거나 초대 코드로 들어오세요</p>
        <div className="stack">
          <button className="btn btn-primary" onClick={() => run('create_room')}>
            새 방 만들기
          </button>
          <div className="divider">또는</div>
          <input
            className="field"
            placeholder="초대 코드"
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="btn" onClick={() => run('join_room')} disabled={!code.trim()}>
            코드로 입장
          </button>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    </main>
  )
}
