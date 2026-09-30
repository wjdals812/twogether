// ponytail: public endpoint, anyone can spend the Kakao quota. Verify the Supabase JWT here if abused.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')
  if (!query) return Response.json({ documents: [] })

  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } },
  )
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  // same query within 10 min is served from the CDN without running the function; errors are never cached
  if (res.ok) headers['cache-control'] = 'public, s-maxage=600, stale-while-revalidate=3600'
  return new Response(res.body, { status: res.status, headers })
}
