import { buildApp } from './app.js'

const app = buildApp()

app.listen({ port: 4173 }, (err, address) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
  app.log.info(`observatory server listening at ${address}`)
})
