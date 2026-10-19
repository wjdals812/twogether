export async function GET(request: Request) {
  // only logged-in users may spend the Kakao quota: Supabase accepts the token only if it is valid
  const auth = request.headers.get('authorization')
  const user = auth
    ? await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY!, authorization: auth },
      })
    : null
  if (!user?.ok) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const query = new URL(request.url).searchParams.get('query')
  if (!query) return Response.json({ documents: [] })

  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } },
  )
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // private: a shared CDN copy would be served without the login check; the browser still reuses it
  if (res.ok) headers['cache-control'] = 'private, max-age=600'
  return new Response(res.body, { status: res.status, headers })
}
