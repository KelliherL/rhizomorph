import Fastify from 'fastify'
import { placeholder } from '@observatory/core'

export function buildApp() {
  const app = Fastify()

  app.get('/api/meta', async () => placeholder())

  return app
}
