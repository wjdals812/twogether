import { useState } from 'react'
import { supabase } from './supabase'

type Stop = { name: string; address: string; note: string; m?: number } // m: meters from the previous stop
type Plan = { summary: string; stops: Stop[] }

// straight-line distance x1.3 for winding streets, 80 m per minute; too far to walk shows the distance instead
const gap = (m: number) => {
  const min = Math.max(1, Math.round((m * 1.3) / 80))
  return min >= 25 ? `약 ${(m / 1000).toFixed(1)}km` : `도보 약 ${min}분`
}

const MESSAGES: Record<string, string> = {
  too_few: '가보자 장소가 2곳 이상 있어야 코스를 짤 수 있어요.',
  not_configured: 'AI 기능이 아직 설정되지 않았습니다.',
  unauthorized: '로그인이 만료됐습니다. 다시 로그인해 주세요.',
}

// asks /api/course for a route through the room's saved "가보자" places
export default function Course({ roomId, onPick, onClose }: {
  roomId: string
  onPick: (s: Stop) => void
  onClose: () => void
}) {
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState('')

  async function ask() {
    setBusy(true)
    setError('')
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/course', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token}` },
        body: JSON.stringify({ room_id: roomId, wish }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setPlan(body)
      else setError(MESSAGES[body.error] ?? '코스를 만들지 못했습니다. 잠시 뒤에 다시 시도해 주세요.')
    } catch {
      setError('코스를 만들지 못했습니다. 네트워크를 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal center" onClick={onClose}>
      <form
        className="panel modal-box dialog"
        role="dialog"
        aria-label="코스 짜기"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) ask()
        }}
      >
        <h2>✨ 코스 짜기</h2>
        {plan ? (
          <>
            {plan.summary && <p className="course-summary">{plan.summary}</p>}
            <ol className="course">
              {plan.stops.map((s, i) => (
                <li key={s.name + s.address}>
                  {/* the time to the next stop hangs off this row, see .course-gap */}
                  {plan.stops[i + 1]?.m !== undefined && <span className="course-gap">{gap(plan.stops[i + 1].m!)}</span>}
                  <button type="button" onClick={() => onPick(s)}>
                    <b aria-hidden="true" />
                    <span>
                      {s.name}
                      {s.note && <small>{s.note}</small>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPlan(null)}>
                다시 짜기
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="course-hint">저장한 "가보자" 장소로 순서를 짜 드려요.</p>
            <input
              className="field"
              autoFocus
              maxLength={200}
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder="원하는 분위기 (예: 반나절, 여유롭게)"
              aria-label="원하는 분위기"
            />
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                취소
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? '짜는 중…' : '코스 짜기'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
