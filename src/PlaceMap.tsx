import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Room } from './RoomGate'

type Place = { id: string; place_name: string; address_name: string; x: string; y: string }
type Status = 'want' | 'visited'
type Saved = {
  id: string
  kakao_id: string
  name: string
  address: string
  lat: number
  lng: number
  status: Status
  memo: string
  rating: number | null
}

const COLUMNS = 'id, kakao_id, name, address, lat, lng, status, memo, rating'
const STATUS_LABEL: Record<Status, string> = { want: '가고 싶어요', visited: '다녀왔어요' }
const STATUS_COLOR: Record<Status, string> = { want: '#e5484d', visited: '#30a46c' }
// name only in the search box, the place's coordinates as map center so nearby matches rank first
const naverLink = (name: string, lat: number, lng: number) =>
  `https://map.naver.com/p/search/${encodeURIComponent(name)}?c=16.00,${lng},${lat},0,0,0,dh`
const isTemp = (p: Saved) => p.id.startsWith('tmp:')

export default function PlaceMap({ room }: { room: Room }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<naver.maps.Map>(null)
  const markers = useRef<naver.maps.Marker[]>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [saved, setSaved] = useState<Saved[]>([])
  const [error, setError] = useState('')
  const searchCache = useRef(new Map<string, Place[]>())
  const [listOpen, setListOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const m = new naver.maps.Map(el.current!, {
      center: new naver.maps.LatLng(37.5665, 126.978),
      zoom: 14,
    })
    map.current = m
    const click = naver.maps.Event.addListener(m, 'click', () => {
      setResults([])
      setSelected(null)
    })
    return () => {
      naver.maps.Event.removeListener(click)
      m.destroy()
    }
  }, [])

  // insert/update: replace the row with the same kakao_id (also swaps the optimistic temp row for the real one)
  const merge = (r: Saved) =>
    setSaved((prev) =>
      prev.some((p) => p.kakao_id === r.kakao_id)
        ? prev.map((p) => (p.kakao_id === r.kakao_id ? r : p))
        : [...prev, r],
    )

  async function load() {
    const { data, error } = await supabase
      .from('places')
      .select(COLUMNS)
      .eq('room_id', room.id)
      .order('created_at')
    if (error) return setError(`불러오기 실패: ${error.message}`)
    // replace with the server state (drops rows deleted elsewhere) but keep rows still being added
    setSaved((prev) => [
      ...data,
      ...prev.filter((p) => isTemp(p) && !data.some((d) => d.kakao_id === p.kakao_id)),
    ])
  }

  useEffect(() => {
    load()

    const table = { schema: 'public', table: 'places' }
    const channel = supabase
      .channel(`places:${room.id}`)
      .on('postgres_changes', { event: 'INSERT', ...table, filter: `room_id=eq.${room.id}` }, (e) =>
        merge(e.new as Saved),
      )
      .on('postgres_changes', { event: 'UPDATE', ...table, filter: `room_id=eq.${room.id}` }, (e) =>
        merge(e.new as Saved),
      )
      // DELETE events can't be filtered by room (old row only carries the id), but we only drop ids we hold
      .on('postgres_changes', { event: 'DELETE', ...table }, (e) =>
        setSaved((prev) => prev.filter((p) => p.id !== e.old.id)),
      )
      // events missed while disconnected (iOS suspends background apps) are not replayed, so reload on (re)connect
      .subscribe((status) => status === 'SUBSCRIBED' && load())
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', load)
      supabase.removeChannel(channel)
    }
  }, [room.id])

  useEffect(() => {
    markers.current.forEach((m) => {
      naver.maps.Event.clearInstanceListeners(m)
      m.setMap(null)
    })
    markers.current = saved.map((p) => {
      const size = p.kakao_id === selected ? 26 : 16
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(p.lat, p.lng),
        map: map.current!,
        title: p.name,
        zIndex: p.kakao_id === selected ? 100 : 1,
        icon: {
          content: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${STATUS_COLOR[p.status]};border:2px solid #fff;box-shadow:0 0 3px #0008"></div>`,
          anchor: new naver.maps.Point(size / 2 + 2, size / 2 + 2),
        },
      })
      naver.maps.Event.addListener(marker, 'click', () => {
        setSelected(p.kakao_id)
        setListOpen(true)
      })
      return marker
    })
  }, [saved, selected])

  // bring the selected place into view inside the open sheet
  useEffect(() => {
    if (listOpen && selected) document.getElementById(`place-${selected}`)?.scrollIntoView({ block: 'center' })
  }, [listOpen, selected])

  // search while typing: from 2 characters, after a short pause, dropping responses for outdated input
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setResults([])
    const cached = searchCache.current.get(q)
    if (cached) return setResults(cached)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        if (!res.ok) return setError(`검색 실패 (${res.status})`)
        setError('')
        const documents: Place[] = (await res.json()).documents
        searchCache.current.set(q, documents)
        setResults(documents)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError('검색 실패')
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [query])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`)
    if (!res.ok) return setError(`검색 실패 (${res.status})`)
    setResults((await res.json()).documents)
  }

  async function add(p: Place) {
    map.current!.panTo(new naver.maps.LatLng(+p.y, +p.x))
    if (saved.some((s) => s.kakao_id === p.id)) return
    merge({
      id: `tmp:${p.id}`,
      kakao_id: p.id,
      name: p.place_name,
      address: p.address_name,
      lat: +p.y,
      lng: +p.x,
      status: 'want',
      memo: '',
      rating: null,
    })
    const { data, error } = await supabase
      .from('places')
      .insert({
        room_id: room.id,
        kakao_id: p.id,
        name: p.place_name,
        address: p.address_name,
        lat: +p.y,
        lng: +p.x,
      })
      .select(COLUMNS)
      .single()
    if (data) merge(data)
    else if (error?.code !== '23505') {
      setSaved((prev) => prev.filter((s) => s.kakao_id !== p.id))
      setError(`저장 실패: ${error?.message}`)
    }
  }

  async function patch(p: Saved, fields: Partial<Pick<Saved, 'status' | 'memo' | 'rating'>>) {
    merge({ ...p, ...fields })
    const { error } = await supabase.from('places').update(fields).eq('id', p.id)
    if (error) {
      merge(p)
      setError(`수정 실패: ${error.message}`)
    }
  }

  async function remove(p: Saved) {
    if (!window.confirm(`'${p.name}'을(를) 삭제할까요?`)) return
    setSaved((prev) => prev.filter((s) => s.id !== p.id))
    const { error } = await supabase.from('places').delete().eq('id', p.id)
    if (error) {
      merge(p)
      setError(`삭제 실패: ${error.message}`)
    }
  }

  const panel: React.CSSProperties = {
    position: 'absolute',
    background: 'var(--bg)',
    color: 'var(--text-h)',
    boxShadow: 'var(--shadow)',
    textAlign: 'left',
    zIndex: 10,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={el} style={{ position: 'absolute', inset: 0, zIndex: 0, isolation: 'isolate' }} />

      <div style={{ ...panel, top: 8, left: 8, right: 8, borderRadius: 12, padding: 8 }}>
        <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="장소 검색"
            style={{ flex: 1, padding: 8, minWidth: 0 }}
          />
          <button>검색</button>
        </form>
        {error && <p style={{ color: 'crimson', margin: '8px 0 0' }}>{error}</p>}
        {results.length > 0 && (
          <div style={{ maxHeight: '40svh', overflow: 'auto', marginTop: 8 }}>
            <ul style={{ paddingLeft: 0, margin: 0, listStyle: 'none' }}>
              {results.map((p) => (
                <li
                  key={p.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{p.place_name}</b>
                    <small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.address_name}
                    </small>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    <button onClick={() => add(p)}>{saved.some((s) => s.kakao_id === p.id) ? '추가됨' : '추가'}</button>
                    <a href={naverLink(p.place_name, +p.y, +p.x)} target="_blank" rel="noopener noreferrer">
                      <small>네이버 지도</small>
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            <button onClick={() => setResults([])} style={{ marginTop: 6 }}>
              검색 결과 닫기
            </button>
          </div>
        )}
      </div>

      {!listOpen && (
        <button
          onClick={() => setListOpen(true)}
          style={{ ...panel, bottom: 16, left: '50%', transform: 'translateX(-50%)', borderRadius: 999, padding: '10px 20px', border: 0, font: 'inherit', fontWeight: 700, cursor: 'pointer' }}
        >
          저장한 장소 ({saved.length})
        </button>
      )}

      {listOpen && (
        <div style={{ ...panel, bottom: 0, left: 0, right: 0, maxHeight: '60svh', overflow: 'auto', borderRadius: '16px 16px 0 0', padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0 }}>저장한 장소 ({saved.length})</h3>
            <span style={{ display: 'flex', gap: 8 }}>
              <button onClick={load}>새로고침</button>
              <button onClick={() => setListOpen(false)}>닫기</button>
            </span>
          </div>
          <p style={{ margin: '8px 0' }}>
            초대 코드: <b>{room.invite_code}</b> <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
          </p>
          <ul style={{ paddingLeft: 0, margin: 0, listStyle: 'none' }}>
            {saved.map((p) => (
              <li
                key={p.kakao_id}
                id={`place-${p.kakao_id}`}
                style={{
                  padding: '8px 6px',
                  borderTop: '1px solid var(--border)',
                  background: p.kakao_id === selected ? 'var(--accent-bg)' : undefined,
                  borderRadius: 6,
                }}
              >
                <button
                  onClick={() => {
                    map.current!.panTo(new naver.maps.LatLng(p.lat, p.lng))
                    setSelected(p.kakao_id)
                    setListOpen(false)
                  }}
                  style={{ border: 0, background: 'none', font: 'inherit', fontWeight: 700, cursor: 'pointer', padding: 0, color: 'inherit' }}
                >
                  {p.name}
                </button>{' '}
                <small>{p.address}</small>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    disabled={isTemp(p)}
                    onClick={() => patch(p, { status: p.status === 'want' ? 'visited' : 'want' })}
                    style={{ color: STATUS_COLOR[p.status] }}
                  >
                    {STATUS_LABEL[p.status]}
                  </button>
                  <select
                    disabled={isTemp(p)}
                    value={p.rating ?? ''}
                    onChange={(e) => patch(p, { rating: e.target.value ? +e.target.value : null })}
                  >
                    <option value="">별점 없음</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {'★'.repeat(n)}
                      </option>
                    ))}
                  </select>
                  <a
                    href={naverLink(p.name, p.lat, p.lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ alignSelf: 'center' }}
                  >
                    네이버 지도에서 보기
                  </a>
                  <button disabled={isTemp(p)} onClick={() => remove(p)}>
                    삭제
                  </button>
                </div>
                <input
                  key={p.memo}
                  defaultValue={p.memo}
                  disabled={isTemp(p)}
                  placeholder="메모"
                  onBlur={(e) => e.target.value !== p.memo && patch(p, { memo: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 6, marginTop: 4 }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
