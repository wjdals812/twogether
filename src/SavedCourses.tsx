import { useEffect, useState } from 'react'
import { Timeline, type Plan, type Stop } from './Course'
import { supabase } from './supabase'

type Saved = Plan & { id: string; created_at: string }

const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })

// the courses saved in this room: a list, and one course opened as a timeline
export default function SavedCourses({ roomId, onPick, onClose }: {
  roomId: string
  onPick: (s: Stop) => void
  onClose: () => void
}) {
  const [list, setList] = useState<Saved[] | null>(null)
  const [open, setOpen] = useState<Saved | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('room_courses')
      .select('id, summary, stops, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => (error ? setError('불러오지 못했습니다.') : setList(data as Saved[])))
  }, [roomId])

  async function remove(c: Saved) {
    if (!window.confirm('이 코스를 삭제할까요?')) return
    const { error } = await supabase.from('room_courses').delete().eq('id', c.id)
    if (error) return setError('삭제하지 못했습니다.')
    setList((prev) => prev?.filter((x) => x.id !== c.id) ?? null)
    setOpen(null)
  }

  return (
    <div className="modal center" onClick={onClose}>
      <div className="panel modal-box dialog" role="dialog" aria-label="저장한 코스" onClick={(e) => e.stopPropagation()}>
        <h2>📌 저장한 코스</h2>
        {open ? (
          <>
            {open.summary && <p className="course-summary">{open.summary}</p>}
            <Timeline stops={open.stops} onPick={onPick} />
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost danger" onClick={() => remove(open)}>
                삭제
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}>
                목록
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            {error && <p className="error">{error}</p>}
            {list?.length === 0 && <p className="course-hint">아직 저장한 코스가 없어요. 코스를 짠 뒤 저장해 보세요.</p>}
            <ul className="saved-courses">
              {list?.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpen(c)}>
                    {c.summary || '코스'}
                    <small>
                      {day(c.created_at)} · {c.stops.length}곳
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
