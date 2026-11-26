import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTemperature } from './telemetry.ts'

test('displays Celsius and Fahrenheit using Celsius inputs', () => {
  assert.equal(formatTemperature(0, 'C'), '0.0°C')
  assert.equal(formatTemperature(0, 'F'), '32.0°F')
  assert.equal(formatTemperature(-40, 'F'), '-40.0°F')
})

test('does not render missing or invalid data as a temperature', () => {
  assert.equal(formatTemperature(null, 'F'), 'Unavailable')
  assert.equal(formatTemperature(Number.NaN, 'C'), 'Unavailable')
})
