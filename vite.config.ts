import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env) // the function reads GEMINI_API_KEY and the Supabase variables from process.env
  return {
    plugins: [
      react(),
      {
        // dev-only: runs api/course.ts right here, so the function can be tried before it is deployed
        name: 'local-course-api',
        configureServer(server) {
          server.middlewares.use('/api/course', async (req, res) => {
            const { POST } = await server.ssrLoadModule('/api/course.ts')
            const chunks: Buffer[] = []
            for await (const c of req) chunks.push(c)
            const headers = new Headers({ 'content-type': 'application/json' })
            if (req.headers.authorization) headers.set('authorization', req.headers.authorization)
            const out: Response = await POST(
              new Request('http://localhost/api/course', { method: 'POST', headers, body: Buffer.concat(chunks) }),
            )
            res.statusCode = out.status
            res.setHeader('content-type', 'application/json')
            res.end(await out.text())
          })
        },
      },
    ],
    server: {
      proxy: {
        // dev-only mirror of api/search.ts (Vercel function in production)
        '/api/search': {
          target: 'https://dapi.kakao.com',
          changeOrigin: true,
          rewrite: (p) => p.replace('/api/search', '/v2/local/search/keyword.json'),
          headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
        },
      },
    },
  }
})
