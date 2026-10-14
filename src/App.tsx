import type { Session } from '@supabase/supabase-js'
import { lazy, Suspense, useEffect, useState } from 'react'
import Auth from './Auth'
import RoomGate, { type Room } from './RoomGate'
import { supabase } from './supabase'

// The naver map script and PlaceMap are only needed once the user is signed in, so the login screen does not wait for
// them. loadMap() is called as soon as a session exists, in parallel with the room list, so a returning user waits no longer than before.
let mapLoading: Promise<typeof import('./PlaceMap')> | undefined
const loadMap = () =>
  (mapLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${import.meta.env.VITE_NAVER_MAP_CLIENT_ID}`
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('naver maps failed to load'))
    document.head.appendChild(s)
  })
    .then(() => import('./PlaceMap'))
    .catch((e) => {
      mapLoading = undefined // let a later attempt retry
      throw e
    }))
const PlaceMap = lazy(loadMap)

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
    const start = (s: Session | null) => {
      if (s) loadMap().catch(() => {}) // a failure surfaces when PlaceMap renders
      setSession(s)
    }
    supabase.auth.getSession().then(({ data }) => start(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => start(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // a room is renamed by another member without any event reaching us, so reload when the user looks at the room list
  async function loadRooms() {
    // room_members is readable for every member of my rooms, so without this filter a room shows up once per member
    const { data } = await supabase
      .from('room_members')
      .select('rooms(id, invite_code, name, created_at)')
      .eq('user_id', session?.user.id ?? '')
    const list = (data ?? []).map((m) => m.rooms as unknown as Room)
    list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    setRooms((prev) => (data ? list : (prev ?? [])))
  }

  const uid = session?.user.id
  useEffect(() => {
    setRooms(undefined)
    if (!uid) return
    loadRooms()
    const onVisible = () => document.visibilityState === 'visible' && loadRooms()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
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
    <Suspense fallback={null}>
      <PlaceMap
        room={room}
        rooms={rooms}
        onSwitch={switchTo}
        onRefresh={loadRooms}
        onRoom={joined}
        onRename={(name) => setRooms(rooms.map((r) => (r.id === room.id ? { ...r, name } : r)))}
        onLeave={() => setRooms(rooms.filter((r) => r.id !== room.id))}
      />
    </Suspense>
  )
}
