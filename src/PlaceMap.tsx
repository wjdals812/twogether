import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import type { Room } from './RoomGate'

type Place = { id: string; place_name: string; address_name: string; x: string; y: string }
type Status = 'want' | 'visited'
type Comment = { id: string; place_id: string; user_id: string; body: string; created_at: string }
type Saved = {
  id: string
  kakao_id: string
  name: string
  address: string
  lat: number
  lng: number
  status: Status
  rating: number | null
}

const COLUMNS = 'id, kakao_id, name, address, lat, lng, status, rating'
const STATUS_LABEL: Record<Status, string> = { want: '🏃가보자', visited: '😎방문완' }
const STATUS_COLOR: Record<Status, string> = { want: '#fbe8a6', visited: '#8fbcec' } // keep in sync with --want / --visited in index.css
// name only in the search box, the place's coordinates as map center so nearby matches rank first
const naverLink = (name: string, lat: number, lng: number) =>
  `https://map.naver.com/p/search/${encodeURIComponent(name)}?c=16.00,${lng},${lat},0,0,0,dh`
const COMMENT_COLUMNS = 'id, place_id, user_id, body, created_at'
// today: time only, other days: date only
const stamp = (iso: string) => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
}
// marker content is raw HTML and names come from other room members
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const isTemp =(p: Saved) => p.id.startsWith('tmp:')

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
  const [closing, setClosing] = useState(false)
  const [flash, setFlash] = useState<string | null>(null) // card marked after a marker tap, until the sheet closes
  // slide the sheet down first, unmount after the transition (0.22s, see .sheet.closing)
  const closeList = () => {
    setClosing(true)
    setTimeout(() => {
      setListOpen(false)
      setClosing(false)
      setFlash(null)
    }, 220)
  }
  const [copied, setCopied] = useState(false)
  const [byRating, setByRating] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [chatFor, setChatFor] = useState<string | null>(null)
  const [uid, setUid] = useState('')

  useEffect(() => {
    const m = new naver.maps.Map(el.current!, {
      center: new naver.maps.LatLng(37.5665, 126.978),
      zoom: 14,
    })
    map.current = m
    // marker names are shown from this zoom level on (.zoomed in index.css)
    const showNames = () => el.current?.classList.toggle('zoomed', m.getZoom() >= 16)
    showNames()
    const zoom = naver.maps.Event.addListener(m, 'zoom_changed', showNames)
    const click = naver.maps.Event.addListener(m, 'click', () => {
      setResults([])
      setSelected(null)
      closeList()
    })
    return () => {
      naver.maps.Event.removeListener(click)
      naver.maps.Event.removeListener(zoom)
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

  const addComment = (c: Comment) => setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]))

  async function say(p: Saved, body: string) {
    const { data, error } = await supabase
      .from('place_comments')
      .insert({ place_id: p.id, room_id: room.id, body })
      .select(COMMENT_COLUMNS)
      .single()
    if (data) addComment(data)
    else setError(`댓글 저장 실패: ${error?.message}`)
  }

  async function unsay(c: Comment) {
    if (!window.confirm('삭제하시겠습니까?')) return
    setComments((prev) => prev.filter((x) => x.id !== c.id))
    const { error } = await supabase.from('place_comments').delete().eq('id', c.id)
    if (error) {
      addComment(c)
      setError(`삭제 실패: ${error.message}`)
    }
  }

  const swipe = useRef<number | null>(null) // touch start y of a possible close-swipe on the sheet
  const edits = useRef(0) // bumped by patch(); a load that started before an edit must not overwrite it

  async function load() {
    const startedAt = edits.current
    const { data, error } = await supabase
      .from('places')
      .select(COLUMNS)
      .eq('room_id', room.id)
      .order('created_at')
    if (error) return setError(`불러오기 실패: ${error.message}`)
    const c = await supabase
      .from('place_comments')
      .select(COMMENT_COLUMNS)
      .eq('room_id', room.id)
      .order('created_at')
    if (c.data) setComments(c.data)
    if (edits.current !== startedAt) return // realtime delivers the edit's result
    // replace with the server state (drops rows deleted elsewhere) but keep rows still being added
    setSaved((prev) => [
      ...data,
      ...prev.filter((p) => isTemp(p) && !data.some((d) => d.kakao_id === p.kakao_id)),
    ])
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? ''))
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'place_comments', filter: `room_id=eq.${room.id}` }, (e) =>
        addComment(e.new as Comment),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'place_comments' }, (e) =>
        setComments((prev) => prev.filter((c) => c.id !== e.old.id)),
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
      const size = 14
      const on = p.kakao_id === selected
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(p.lat, p.lng),
        map: map.current!,
        title: p.name,
        zIndex: on ? 100 : 1,
        icon: {
          // the selected marker gets a pulsing halo (.pin.on::after in index.css)
          content: `<div class="${on ? 'pin on' : 'pin'}" style="--c:${STATUS_COLOR[p.status]};position:relative;width:${size}px;height:${size}px;box-sizing:border-box;border-radius:50%;background:${STATUS_COLOR[p.status]};border:2px solid #fff;box-shadow:0 1px 4px rgb(28 36 48 / .45)"><span class="pin-name">${escapeHtml(p.name)}</span></div>`,
          anchor: new naver.maps.Point(size / 2, size / 2),
        },
      })
      naver.maps.Event.addListener(marker, 'click', () => {
        setSelected(p.kakao_id)
        setFlash(p.kakao_id)
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

  async function patch(p: Saved, fields: Partial<Pick<Saved, 'status' | 'rating'>>) {
    edits.current++
    merge({ ...p, ...fields })
    let { error } = await supabase.from('places').update(fields).eq('id', p.id)
    // some browsers/networks block PATCH (CORS preflight fails, no error code): retry as POST via rpc
    if (error && !error.code) ({ error } = await supabase.rpc('update_place', { pid: p.id, fields }))
    edits.current++
    if (error) {
      merge(p)
      setError(`수정 실패: ${error.message}`)
    }
  }

  function focusPlace(p: Saved) {
    map.current!.panTo(new naver.maps.LatLng(p.lat, p.lng))
    setSelected(p.kakao_id)
    closeList()
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
          aria-label={`저장한 장소 열기. ${STATUS_LABEL.want} ${wantCount}곳, ${STATUS_LABEL.visited} ${visitedCount}곳`}
        >
          <span className="dock-title">
            <Icon d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
            Places
          </span>
          <span className="dock-count">
            <span className="dot want" />
            {wantCount}
          </span>
          <span className="dock-count">
            <span className="dot visited" />
            {visitedCount}
          </span>
          <Icon d="M6 15l6-6 6 6" />
        </button>
      )}

      {listOpen && (
        <section
          className={closing ? 'panel sheet closing' : 'panel sheet'}
          aria-label="place"
          // swipe down closes the sheet: from the header, or from the list while it is scrolled to the top
          onTouchStart={(e) => {
            const t = e.target as HTMLElement
            const atTop = !!t.closest('.sheet-head') || (e.currentTarget.querySelector('.sheet-body')?.scrollTop ?? 0) === 0
            swipe.current = atTop ? e.touches[0].clientY : null
          }}
          onTouchMove={(e) => {
            if (swipe.current === null) return
            const dy = Math.max(0, e.touches[0].clientY - swipe.current)
            e.currentTarget.style.transition = 'none'
            e.currentTarget.style.transform = `translateY(${dy}px)`
          }}
          onTouchEnd={(e) => {
            if (swipe.current === null) return
            const el = e.currentTarget
            const close = e.changedTouches[0].clientY - swipe.current > 80
            swipe.current = null
            el.style.transition = 'transform 0.22s ease-out'
            el.style.transform = close ? 'translateY(100%)' : ''
            if (close) closeList()
          }}
        >
          <div className="sheet-head">
            <h2>
              📍 Places<span>{saved.length}</span>
            </h2>
            <div>
              <button className="btn btn-ghost btn-icon" aria-label="새로고침" onClick={load}>
                <Icon d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </button>
              <button className="btn btn-ghost btn-icon" aria-label="닫기" onClick={closeList}>
                <Icon d="M6 6l12 12M18 6 6 18" />
              </button>
            </div>
          </div>
          <div className="sheet-body">
            <div className="invite">
              <span>
                초대 코드<b>{room.invite_code}</b>
              </span>
              <span>
                <button className="btn btn-sm" onClick={copyCode}>
                  {copied ? '복사됨' : '복사'}
                </button>{' '}
                <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>
                  로그아웃
                </button>
              </span>
            </div>
            {saved.length > 1 && (
              <select
                className="sort"
                aria-label="정렬"
                value={byRating ? 'rating' : 'added'}
                onChange={(e) => setByRating(e.target.value === 'rating')}
              >
                <option value="added">등록순</option>
                <option value="rating">별점 높은순</option>
              </select>
            )}
            {saved.length === 0 ? (
              <p className="empty">저장한 장소가 없습니다. 위 검색창에서 장소를 찾아 추가해 보세요.</p>
            ) : (
              <ul className="list">
                {(byRating ? [...saved].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)) : saved).map((p) => (
                  <li
                    key={p.kakao_id}
                    id={`place-${p.kakao_id}`}
                    className={p.kakao_id === flash ? 'place flash' : 'place'}
                  >
                    <div className="place-head" onClick={() => focusPlace(p)}>
                      <button className="place-name">{p.name}</button>
                      <span className="place-addr">{p.address}</span>
                    </div>
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
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 4l2.5 5.2 5.6.8-4 4 1 5.6L12 17l-5.1 2.6 1-5.6-4-4 5.6-.8z" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    </div>
                    <button className="chat-open" disabled={isTemp(p)} onClick={() => setChatFor(p.kakao_id)}>
                      💬 대화 {comments.filter((c) => c.place_id === p.id).length || '시작하기'}
                    </button>
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
          </div>
        </section>
      )}
      {saved.find((p) => p.kakao_id === chatFor) && (
        <div className="modal" onClick={() => setChatFor(null)}>
          <div className="panel modal-box" role="dialog" aria-label="대화" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const p = saved.find((x) => x.kakao_id === chatFor)!
              return (
                <>
                  <div className="sheet-head">
                    <h2>{p.name}</h2>
                    <button className="btn btn-ghost btn-icon" aria-label="닫기" onClick={() => setChatFor(null)}>
                      <Icon d="M6 6l12 12M18 6 6 18" />
                    </button>
                  </div>
                  <Thread
                    comments={comments.filter((c) => c.place_id === p.id)}
                    uid={uid}
                    onSend={(body) => say(p, body)}
                    onDelete={unsay}
                  />
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

function Thread({ comments, uid, onSend, onDelete }: {
  comments: Comment[]
  uid: string
  onSend: (body: string) => void
  onDelete: (c: Comment) => void
}) {
  const [text, setText] = useState('')
  const send = (e: React.FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    onSend(body)
    setText('')
  }
  return (
    <div className="chat" ref={(el) => el?.scrollTo(0, el.scrollHeight)}>
      {comments.map((c) => (
        <div key={c.id} className={c.user_id === uid ? 'msg mine' : 'msg'}>
          <div className="bubble">{c.body}</div>
          <div className="meta">
            <time>{stamp(c.created_at)}</time>
            {c.user_id === uid && (
              <button aria-label="내 글 삭제" onClick={() => onDelete(c)}>
                삭제
              </button>
            )}
          </div>
        </div>
      ))}
      <form className="chat-form" onSubmit={send}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="여기 어때?" aria-label="댓글" />
        <button className="btn btn-sm btn-primary" disabled={!text.trim()}>
          보내기
        </button>
      </form>
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
