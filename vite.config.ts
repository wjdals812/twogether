import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        // dev-only mirror of api/search.ts (Vercel function in production)
        '/api/search': {
          target: 'https://dapi.kakao.com',
          changeOrigin: true,
          rewrite: (p) => p.replace('/api/search', '/v2/local/search/keyword.json'),
          headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
        },
        // ponytail: dev uses the deployed function (and its Gemini key); run `vercel dev` instead to test api/course.ts itself
        '/api/course': { target: 'https://twogether-three.vercel.app', changeOrigin: true },
      },
    },
  }
})
