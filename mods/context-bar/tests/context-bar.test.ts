import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionContextUsage } from 'claude-code'

const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const PRESENTATION = { isFullscreen: true, columns: 120 }

function at(tokens: number, window = 200_000): SessionContextUsage {
  return { tokens, window, percent: Math.round((tokens * 100) / window) }
}

// Stands in for the engine beneath the mod; returns the toasts it raised.
function engine(on: On, start: SessionContextUsage = { window: 200_000 }) {
  const toasts: string[] = []
  mock.store(on)
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: start, rateLimits: [] } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({
    type: 'Text',
    children: ['engine band'],
  }))

  return toasts
}

async function measure($: Engine, context: SessionContextUsage) {
  await $.session.measure({ context, rateLimits: [], changed: ['context'] })
}

test('the band draws the fill, its color and the token counts', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await measure($, at(150_000))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ text: /75%/ })).toBeDefined()
    expect(await ui.find({ text: /150k\/200k/ })).toBeDefined()
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some(t => t.props.color === 'warning')).toBe(true)
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band leaves the engine its own until the first reading', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('each threshold toasts once per climb and re-arms after a drop', async ($, on) => {
  const toasts = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  await measure($, at(100_000))
  expect(toasts).toEqual([])
  await measure($, at(142_000))
  await measure($, at(150_000))
  expect(toasts).toEqual(['Context 71% full.'])
  await measure($, at(182_000))
  await measure($, at(190_000))
  expect(toasts).toEqual(['Context 71% full.', 'Context 91% full. Run /compact soon.'])

  await measure($, at(40_000))
  await measure($, at(150_000))
  expect(toasts).toHaveLength(3)
  expect(toasts[2]).toBe('Context 75% full.')
})

test('/context-bar toggles the band, and the Hide button hides it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await measure($, at(72_000))
  const run = (args: string) =>
    $.command.run({
      command: 'context-bar',
      args,
      origin: { kind: 'composer' },
      presentation: PRESENTATION,
    })

  expect((await run('off')).text).toBe(
    'Context bar hidden. Context: 36% used, 72k of 200k tokens.',
  )
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()

  expect((await run('')).text).toMatch(/^Context bar shown\./)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /36%/ })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()

  expect((await run('sideways')).text).toMatch(/^Usage:/)
})

test('a hidden band stays hidden in the next session', async ($, on) => {
  mock.store(on, { isHidden: true })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: at(72_000), rateLimits: [] },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, () => ({
    type: 'Text',
    children: ['engine band'],
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()
})
