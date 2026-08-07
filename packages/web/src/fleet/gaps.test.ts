import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FLEET_SRC = path.resolve(import.meta.dirname)
const CLI_REMEDY_SOURCES = [
  path.join(FLEET_SRC, 'gaps.ts'),
  path.resolve(FLEET_SRC, '../panels/burn/format.ts'),
]

describe('clone-safe CLI remedies', () => {
  it('does not ship a bare rhizomorph command in web source', () => {
    const bareCommand = /(?:^|[\s"'`])rhizomorph\s+(?:[a-z][\w-]*|--[\w-]+)/
    const violations = CLI_REMEDY_SOURCES
      .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => bareCommand.test(text))
      .map(({ file }) => path.relative(FLEET_SRC, file))

    expect(violations).toEqual([])
  })
})
