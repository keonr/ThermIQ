import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatTemperature, probeLabel } from './telemetry.ts'

test('displays Celsius and Fahrenheit using Celsius inputs', () => {
  assert.equal(formatTemperature(0, 'C'), '0.0°C')
  assert.equal(formatTemperature(0, 'F'), '32.0°F')
  assert.equal(formatTemperature(-40, 'F'), '-40.0°F')
})

test('does not render missing or invalid data as a temperature', () => {
  assert.equal(formatTemperature(null, 'F'), 'Unavailable')
  assert.equal(formatTemperature(Number.NaN, 'C'), 'Unavailable')
})

test('resolves probe display labels while preserving probe IDs as fallback', () => {
  const names = { 'e4:07:91:38:f7:ec': 'Probe 1' }
  assert.equal(probeLabel('e4:07:91:38:f7:ec', names), 'Probe 1')
  assert.equal(probeLabel('fb:b0:ef:86:75:57', names), 'fb:b0:ef:86:75:57')
})
