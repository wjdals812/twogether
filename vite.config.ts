import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        // ponytail: dev-only proxy, swap for a serverless function when deploying
        '/api/kakao': {
          target: 'https://dapi.kakao.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/kakao/, ''),
          headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
        },
      },
    },
  }
})
