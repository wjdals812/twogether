import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST as course } from './course'
import { GET as search } from './search'

// every outgoing call goes to this fake: [url fragment, response] pairs, first match wins
const fake = (routes: [string, () => Response][]) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => routes.find(([k]) => url.includes(k))![1]()))

const places = [0, 1, 2].map((n) => ({ name: `p${n}`, address: `a${n}`, lat: 37.5 + n / 1000, lng: 127, rating: null }))
const gemini = (text: string) => () => Response.json({ candidates: [{ content: { parts: [{ text }] } }] })
const courseReq = (auth: string | null = 'Bearer t') =>
  new Request('http://x/api/course', {
    method: 'POST',
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify({ room_id: 'r', wish: '' }),
  })

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', 'k')
  vi.stubEnv('VITE_SUPABASE_URL', 'http://db')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const db = (taken = 'ok'): [string, () => Response][] => [
  ['/rest/v1/places', () => Response.json(places)],
  ['/rpc/take_course_call', () => Response.json(taken)],
]

it('course: drops unknown and repeated place numbers, adds the distance to the previous stop', async () => {
  const plan = { summary: 's', stops: [{ i: 2, note: 'n' }, { i: 9 }, { i: 2 }, { i: 1.5 }, { i: 0 }] }
  fake([...db(), ['generativelanguage', gemini(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)]])
  const res = await course(courseReq())
  const body = await res.json()
  expect(res.status).toBe(200)
  expect(body.stops.map((s: { name: string }) => s.name)).toEqual(['p2', 'p0'])
  expect(body.stops[0].m).toBeUndefined()
  expect(body.stops[1].m).toBeGreaterThan(0)
})

it('course: unusable AI answers become ai_failed', async () => {
  for (const text of ['not json', '{"stops":[{"i":7}]}']) {
    fake([...db(), ['generativelanguage', gemini(text)]])
    const res = await course(courseReq())
    expect(res.status).toBe(502)
  }
})

it('course: refuses without a token, and does not call Gemini when the limit is hit', async () => {
  expect((await course(courseReq(null))).status).toBe(400)
  fake([...db('user_limit'), ['generativelanguage', () => { throw new Error('Gemini must not be called') }]])
  const res = await course(courseReq())
  expect(res.status).toBe(429)
  expect(await res.json()).toEqual({ error: 'user_limit' })
})

it('search: 401 without a valid token, results with one', async () => {
  const req = (auth?: string) =>
    new Request('http://x/api/search?query=cafe', { headers: auth ? { authorization: auth } : {} })
  expect((await search(req())).status).toBe(401)

  fake([['/auth/v1/user', () => new Response('{}', { status: 401 })]])
  expect((await search(req('Bearer bad'))).status).toBe(401)

  fake([
    ['/auth/v1/user', () => Response.json({ id: 'u' })],
    ['dapi.kakao.com', () => Response.json({ documents: [{ id: '1' }] })],
  ])
  const ok = await search(req('Bearer good'))
  expect(ok.status).toBe(200)
  expect(ok.headers.get('cache-control')).toContain('private')
  expect((await ok.json()).documents).toHaveLength(1)
})
