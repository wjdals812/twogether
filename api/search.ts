// ponytail: public endpoint, anyone can spend the Kakao quota. Verify the Supabase JWT here if abused.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')
  if (!query) return Response.json({ documents: [] })

  const res = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } },
  )
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } })
}
