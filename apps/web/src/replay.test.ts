import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestAt } from './replay.ts'

test('replay only uses events and samples at or before the playhead', () => {
  const frames = [{ at: 10, name: 'original' }, { at: 20, name: 'rotated' }, { at: 20, name: 'moved' }]
  const at = (position: number) => latestAt(frames, (frame) => frame.at, position)?.name
  assert.equal(at(9), undefined)
  assert.equal(at(10), 'original')
  assert.equal(at(19), 'original')
  assert.equal(at(20), 'moved')
  assert.equal(at(100), 'moved')
  assert.equal(latestAt([], Number, 0), undefined)
})
