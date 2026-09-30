import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Room } from './RoomGate'

type Row = { kakao_id: string; name: string; address: string; lat: number; lng: number }
type Place = { id: string; place_name: string; address_name: string; x: string; y: string }

const toPlace = (r: Row): Place => ({
  id: r.kakao_id,
  place_name: r.name,
  address_name: r.address,
  x: String(r.lng),
  y: String(r.lat),
})

export default function PlaceMap({ room }: { room: Room }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<naver.maps.Map>(null)
  const markers = useRef<naver.maps.Marker[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [saved, setSaved] = useState<Place[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const m = new naver.maps.Map(el.current!, {
      center: new naver.maps.LatLng(37.5665, 126.978),
      zoom: 14,
    })
    map.current = m
    return () => m.destroy()
  }, [])

  useEffect(() => {
    const merge = (r: Row) =>
      setSaved((prev) => (prev.some((p) => p.id === r.kakao_id) ? prev : [...prev, toPlace(r)]))

    supabase
      .from('places')
      .select('kakao_id, name, address, lat, lng')
      .eq('room_id', room.id)
      .order('created_at')
      .then(({ data, error }) => {
        if (error) return setError(`불러오기 실패: ${error.message}`)
        data.forEach(merge)
      })

    const channel = supabase
      .channel(`places:${room.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'places', filter: `room_id=eq.${room.id}` },
        (payload) => merge(payload.new as Row),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [room.id])

  useEffect(() => {
    markers.current.forEach((m) => m.setMap(null))
    markers.current = saved.map(
      (p) => new naver.maps.Marker({ position: new naver.maps.LatLng(+p.y, +p.x), map: map.current! }),
    )
  }, [saved])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`)
    if (!res.ok) return setError(`검색 실패 (${res.status})`)
    setResults((await res.json()).documents)
  }

  async function add(p: Place) {
    map.current!.panTo(new naver.maps.LatLng(+p.y, +p.x))
    if (saved.some((s) => s.id === p.id)) return
    setSaved((prev) => [...prev, p])
    const { error } = await supabase.from('places').insert({
      room_id: room.id,
      kakao_id: p.id,
      name: p.place_name,
      address: p.address_name,
      lat: +p.y,
      lng: +p.x,
    })
    if (error && error.code !== '23505') {
      setSaved((prev) => prev.filter((s) => s.id !== p.id))
      setError(`저장 실패: ${error.message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100svh' }}>
      <div ref={el} style={{ flex: 1 }} />
      <div style={{ maxHeight: '45svh', overflow: 'auto', padding: 12, textAlign: 'left' }}>
        <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="장소 검색"
            style={{ flex: 1, padding: 8 }}
          />
          <button>검색</button>
        </form>
        <p>
          초대 코드: <b>{room.invite_code}</b> <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </p>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
          {results.map((p) => (
            <li key={p.id} style={{ padding: '6px 0' }}>
              <b>{p.place_name}</b> <small>{p.address_name}</small>{' '}
              <button onClick={() => add(p)}>{saved.some((s) => s.id === p.id) ? '추가됨' : '추가'}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
