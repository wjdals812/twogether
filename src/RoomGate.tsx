import { useState } from 'react'
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
    <div style={{ display: 'grid', gap: 8, maxWidth: 320, margin: '20vh auto', padding: 16 }}>
      <h2>방 입장</h2>
      <button onClick={() => run('create_room')}>새 방 만들기</button>
      <input placeholder="초대 코드" value={code} onChange={(e) => setCode(e.target.value)} />
      <button onClick={() => run('join_room')} disabled={!code.trim()}>
        코드로 입장
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
    </div>
  )
}
