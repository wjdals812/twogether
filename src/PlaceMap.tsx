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
const STATUS_COLOR: Record<Status, string> = { want: '#b8742c', visited: '#3a7d5c' } // keep in sync with --want / --visited in index.css
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
  const [copied, setCopied] = useState(false)
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
      const size = p.kakao_id === selected ? 28 : 20
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(p.lat, p.lng),
        map: map.current!,
        title: p.name,
        zIndex: p.kakao_id === selected ? 100 : 1,
        icon: {
          content: `<div style="width:${size}px;height:${size}px;box-sizing:border-box;border-radius:50%;background:${STATUS_COLOR[p.status]};border:3px solid #fff;box-shadow:0 1px 4px rgb(20 30 26 / .45)"></div>`,
          anchor: new naver.maps.Point(size / 2, size / 2),
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

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('복사하지 못했습니다. 코드를 직접 선택해 주세요.')
    }
  }

  const wantCount = saved.filter((p) => p.status === 'want').length
  const visitedCount = saved.length - wantCount

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={el} style={{ position: 'absolute', inset: 0, zIndex: 0, isolation: 'isolate' }} />

      <div className="panel search">
        <form className="search-row" onSubmit={search} role="search">
          <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-3.5-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="장소 이름으로 검색"
            aria-label="장소 검색"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label="검색어 지우기"
              onClick={() => {
                setQuery('')
                setResults([])
              }}
            >
              <Icon d="M6 6l12 12M18 6 6 18" />
            </button>
          )}
        </form>
        {error && <p className="error">{error}</p>}
        {results.length > 0 && (
          <>
            <ul className="results">
              {results.map((p) => (
                <li className="result" key={p.id}>
                  <div className="result-text">
                    <span className="result-name">{p.place_name}</span>
                    <span className="result-addr">{p.address_name}</span>
                  </div>
                  <div className="result-side">
                    {saved.some((s) => s.kakao_id === p.id) ? (
                      <button className="btn btn-sm" disabled>
                        추가됨
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => add(p)}>
                        추가
                      </button>
                    )}
                    <a href={naverLink(p.place_name, +p.y, +p.x)} target="_blank" rel="noopener noreferrer">
                      네이버 지도 ↗
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            <button className="btn btn-ghost btn-sm results-close" onClick={() => setResults([])}>
              결과 닫기
            </button>
          </>
        )}
      </div>

      {!listOpen && (
        <button
          className="panel dock"
          onClick={() => setListOpen(true)}
          aria-label={`저장한 장소 열기. 가고 싶어요 ${wantCount}곳, 다녀왔어요 ${visitedCount}곳`}
        >
          저장한 장소
          <span className="dock-count">
            <span className="dot want" />
            {wantCount}
          </span>
          <span className="dock-count">
            <span className="dot visited" />
            {visitedCount}
          </span>
        </button>
      )}

      {listOpen && (
        <section className="panel sheet" aria-label="저장한 장소">
          <div className="sheet-head">
            <h2>
              저장한 장소<span>{saved.length}</span>
            </h2>
            <div>
              <button className="btn btn-ghost btn-icon" aria-label="새로고침" onClick={load}>
                <Icon d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </button>
              <button className="btn btn-ghost btn-icon" aria-label="닫기" onClick={() => setListOpen(false)}>
                <Icon d="M6 6l12 12M18 6 6 18" />
              </button>
            </div>
          </div>
          <div className="sheet-body">
            <div className="invite">
              <span>
                초대 코드<b>{room.invite_code}</b>
              </span>
              <button className="btn btn-sm" onClick={copyCode}>
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
            {saved.length === 0 ? (
              <p className="empty">저장한 장소가 없습니다. 위 검색창에서 장소를 찾아 추가해 보세요.</p>
            ) : (
              <ul className="list">
                {saved.map((p) => (
                  <li
                    key={p.kakao_id}
                    id={`place-${p.kakao_id}`}
                    className={p.kakao_id === selected ? 'place selected' : 'place'}
                  >
                    <button
                      className="place-name"
                      onClick={() => {
                        map.current!.panTo(new naver.maps.LatLng(p.lat, p.lng))
                        setSelected(p.kakao_id)
                        setListOpen(false)
                      }}
                    >
                      {p.name}
                    </button>
                    <span className="place-addr">{p.address}</span>
                    <div className="place-tools">
                      <div className="seg" role="group" aria-label="상태">
                        {(['want', 'visited'] as Status[]).map((st) => (
                          <button
                            key={st}
                            disabled={isTemp(p)}
                            className={p.status === st ? `on ${st}` : undefined}
                            aria-pressed={p.status === st}
                            onClick={() => p.status !== st && patch(p, { status: st })}
                          >
                            {STATUS_LABEL[st]}
                          </button>
                        ))}
                      </div>
                      <div className="stars" role="group" aria-label="별점">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            disabled={isTemp(p)}
                            className={p.rating !== null && n <= p.rating ? 'on' : undefined}
                            aria-label={`${n}점`}
                            aria-pressed={p.rating === n}
                            onClick={() => patch(p, { rating: p.rating === n ? null : n })}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      key={p.memo}
                      className="field memo"
                      defaultValue={p.memo}
                      disabled={isTemp(p)}
                      placeholder="메모"
                      aria-label={`${p.name} 메모`}
                      onBlur={(e) => e.target.value !== p.memo && patch(p, { memo: e.target.value })}
                    />
                    <div className="place-foot">
                      <a href={naverLink(p.name, p.lat, p.lng)} target="_blank" rel="noopener noreferrer">
                        네이버 지도에서 보기 ↗
                      </a>
                      <button className="btn btn-ghost btn-sm danger" disabled={isTemp(p)} onClick={() => remove(p)}>
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="sheet-foot">
              <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>
                로그아웃
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
