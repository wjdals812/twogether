import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import Auth from './Auth'
import PlaceMap from './PlaceMap'
import RoomGate, { type Room } from './RoomGate'
import { supabase } from './supabase'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [room, setRoom] = useState<Room | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    setRoom(undefined)
    if (!uid) return
    supabase
      .from('room_members')
      .select('rooms(id, invite_code)')
      .limit(1)
      .then(({ data }) => setRoom((data?.[0]?.rooms as unknown as Room) ?? null))
  }, [uid])

  if (session === undefined) return null
  if (!session) return <Auth />
  if (room === undefined) return null
  if (!room) return <RoomGate onRoom={setRoom} />
  return <PlaceMap room={room} onLeave={() => setRoom(null)} />
}
