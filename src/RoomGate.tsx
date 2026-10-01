import { useState } from 'react'
import Brand from './Brand'
import { koError } from './errors'
import { supabase } from './supabase'

export type Room = { id: string; invite_code: string; name: string; created_at: string }

// create a room or join one by invite code; used on the first screen and inside the rooms sheet
export function RoomForm({ onRoom }: { onRoom: (r: Room) => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  async function run(fn: 'create_room' | 'join_room') {
    setError('')
    const args = fn === 'join_room' ? { code } : { room_name: name.trim() || '새 방' }
    const { data, error } = await supabase.rpc(fn, args)
    if (error) setError(koError(error))
    else onRoom(data)
  }

  return (
    <div className="stack">
      <input
        className="field"
        placeholder="방 이름 (예: 연인, 친구들)"
        maxLength={20}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
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
    </div>
  )
}

export default function RoomGate({ onRoom }: { onRoom: (r: Room) => void }) {
  return (
    <main className="screen">
      <div className="card">
        <Brand />
        <p className="tagline">방을 만들거나 초대 코드로 들어오세요</p>
        <div className="stack">
          <RoomForm onRoom={onRoom} />
          <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    </main>
  )
}
