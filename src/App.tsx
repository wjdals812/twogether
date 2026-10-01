import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import Auth from './Auth'
import PlaceMap from './PlaceMap'
import RoomGate, { type Room } from './RoomGate'
import { supabase } from './supabase'

const LAST_ROOM = 'twogether.room'
const remembered = () => {
  try {
    return localStorage.getItem(LAST_ROOM)
  } catch {
    return null
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [rooms, setRooms] = useState<Room[] | undefined>(undefined)
  const [currentId, setCurrentId] = useState(remembered)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    setRooms(undefined)
    if (!uid) return
    supabase
      .from('room_members')
      .select('rooms(id, invite_code, name, created_at)')
      .then(({ data }) => {
        const list = (data ?? []).map((m) => m.rooms as unknown as Room)
        setRooms(list.sort((a, b) => a.created_at.localeCompare(b.created_at)))
      })
  }, [uid])

  function switchTo(id: string) {
    setCurrentId(id)
    try {
      localStorage.setItem(LAST_ROOM, id)
    } catch {
      // private mode: the last room is just not remembered
    }
  }

  function joined(r: Room) {
    setRooms((prev) => [...(prev ?? []).filter((x) => x.id !== r.id), r])
    switchTo(r.id)
  }

  if (session === undefined) return null
  if (!session) return <Auth />
  if (rooms === undefined) return null
  const room = rooms.find((r) => r.id === currentId) ?? rooms[0]
  if (!room) return <RoomGate onRoom={joined} />
  return (
    <PlaceMap
      room={room}
      rooms={rooms}
      onSwitch={switchTo}
      onRoom={joined}
      onRename={(name) => setRooms(rooms.map((r) => (r.id === room.id ? { ...r, name } : r)))}
      onLeave={() => setRooms(rooms.filter((r) => r.id !== room.id))}
    />
  )
}
