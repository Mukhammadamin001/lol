import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage } from 'claude-code'

import type { ContextReading } from '../types'

const reading = atom({ plugin: 'context-bar', key: 'reading' } as const, null)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)
// The highest threshold already toasted, so each one toasts once per climb.
const warnedAt = atom({ plugin: 'context-bar', key: 'warnedAt' } as const, 0)

const THRESHOLDS = [90, 70]

function toReading(context: SessionContextUsage): ContextReading | null {
  if (context.tokens === undefined) {
    return null
  }
  const percent =
    context.percent ?? Math.round((context.tokens * 100) / context.window)

  return { tokens: context.tokens, window: context.window, percent: Math.min(100, percent) }
}

// 950, 72k, 1.2M
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }

  return n >= 1000 ? `${Math.floor(n / 1000)}k` : String(n)
}

function colorFor(percent: number): 'error' | 'warning' | 'success' {
  return percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'
}

function summary(now: ContextReading | null): string {
  return now === null
    ? 'no reading yet; it arrives with the next response'
    : `${now.percent}% used, ${formatTokens(now.tokens)} of ${formatTokens(now.window)} tokens`
}

async function setHidden($: EngineInterface, value: boolean) {
  await update($, isHidden, () => value)
  await $.store.set('isHidden', value)
}

async function record($: EngineInterface, now: ContextReading | null) {
  await update($, reading, () => now)

  const percent = now?.percent ?? 0
  const crossed = THRESHOLDS.find(t => percent >= t) ?? 0
  const before = await read($, warnedAt)
  if (crossed > before) {
    $.ui.toast(
      crossed >= 90
        ? `Context ${percent}% full. Run /compact soon.`
        : `Context ${percent}% full.`,
    )
  }
  // Dropping back (after /compact) re-arms the toasts.
  if (crossed !== before) {
    await update($, warnedAt, () => crossed)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Show or hide the context bar above the prompt',
      argumentHint: '[on|off]',
      immediate: true,
    })
    const stored = await $.store.get('isHidden')
    if (typeof stored === 'boolean') {
      await update($, isHidden, () => stored)
    }
    await record($, toReading((await $.session.usage()).context))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await record($, toReading(e.context))
    }

    return next(e)
  })

  // Never stands in the way of a compaction: a failure replays its result.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    await record($, toReading((await $.session.usage()).context))

    return done
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await record($, null)
    }

    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const hide =
      arg === 'off' || arg === 'hide'
        ? true
        : arg === 'on' || arg === 'show'
          ? false
          : arg === ''
            ? !(await read($, isHidden))
            : undefined
    if (hide === undefined) {
      return { text: 'Usage: /context-bar [on|off]. With no argument it toggles.' }
    }
    await setHidden($, hide)
    const now = await read($, reading)

    return {
      text: `Context bar ${hide ? 'hidden' : 'shown'}. Context: ${summary(now)}.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }
    const now = await read($, reading)
    if (now === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    // Leave room for the label, the figures and the Hide button.
    const width = Math.max(10, Math.min(30, e.props.bodyColumns - 36))
    const filled = Math.round((now.percent * width) / 100)

    return (
      <Box>
        <Text dimColor>Context </Text>
        <Text color={colorFor(now.percent)}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(width - filled)}</Text>
        <Text bold> {now.percent}%</Text>
        <Text dimColor>
          {' '}· {formatTokens(now.tokens)}/{formatTokens(now.window)}{' '}
        </Text>
        <Button key="hide" label="Hide" onPress={() => setHidden($, true)} />
      </Box>
    )
  })
}
