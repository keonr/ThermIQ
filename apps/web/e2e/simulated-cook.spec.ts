import { expect, test } from '@playwright/test'

type Session = { id: string; name: string }

test('place probes, record a cook, replay a rotation, compare and calibrate', async ({ page, request }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Probe 1', exact: true })).toBeVisible()
  const editor = page.getByRole('region', { name: 'Equipment and chamber layout' })
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('Test smoker')
  await editor.getByRole('button', { name: 'Add food' }).click()
  await editor.getByLabel('Food name').fill('Brisket')

  for (const [probe, x, y] of [[1, 100, 100], [2, 430, 100], [4, 300, 330]]) {
    await editor.getByLabel('Place probe').selectOption(`sim-probe-${probe}`)
    await editor.getByLabel('X (mm)', { exact: true }).fill(String(x))
    await editor.getByLabel('Y (mm)', { exact: true }).fill(String(y))
  }
  await editor.getByRole('button', { name: 'Save equipment layout' }).click()
  await expect(editor.getByText('Equipment layout saved.')).toBeVisible()

  const sessions = page.getByRole('region', { name: 'Cook sessions' })
  const list = async (): Promise<Session[]> => (await request.get('/api/v1/sessions')).json()
  async function start(name: string) {
    await sessions.getByLabel('Cook name').fill(name)
    await sessions.getByRole('combobox', { name: 'Equipment', exact: true }).selectOption({ label: 'Test smoker' })
    await sessions.getByRole('button', { name: 'Start cook', exact: true }).click()
    await expect(sessions.getByText(`Recording: ${name}`, { exact: false })).toBeVisible()
    return (await list()).find((item) => item.name === name)!.id
  }
  async function samples(id: string) {
    const history = await request.get(`/api/v1/sessions/${id}/history`)
    return (await history.json()).snapshots as { observed_at: string }[]
  }

  const first = await start('Brisket trial')
  await sessions.getByLabel('Ambient high (°C)').fill('100')
  await expect(sessions.getByRole('region', { name: 'Cook alerts and estimates' })).toHaveCount(1)
  await expect(sessions.getByText(/ambient above/).first()).toBeVisible()
  await expect.poll(async () => (await samples(first)).length).toBeGreaterThan(0)

  const placement = page.getByRole('region', { name: 'Edit cook placements' })
  await placement.getByRole('button', { name: 'Brisket', exact: true }).click()
  await placement.getByLabel('Angle (°)').fill('90')
  await placement.getByRole('button', { name: 'Record placement change' }).click()
  await expect(placement.getByText('Placement change recorded.')).toBeVisible()
  const changes = await (await request.get(`/api/v1/sessions/${first}/placements`)).json()
  const movedAt = Date.parse(changes[0].recorded_at)
  await expect.poll(async () => Date.parse((await samples(first)).at(-1)!.observed_at) - movedAt, {
    timeout: 15000,
  }).toBeGreaterThan(6500)
  await sessions.getByRole('button', { name: 'Finish cook' }).click()
  const replay = page.getByRole('region', { name: 'Cook replay' })
  await replay.getByRole('button', { name: /Placement change 1/ }).click()
  await expect(replay.getByText('Test smoker · Placement change 1')).toBeVisible()
  const slider = replay.getByRole('slider', { name: 'Replay position' })
  await slider.focus()
  await slider.press('End')
  await expect(replay.getByRole('img', { name: 'Top-down ambient readings and estimated heat distribution' })).toBeVisible()

  await replay.getByRole('button', { name: '3D', exact: true }).click()
  const canvas = replay.locator('.chamber-three canvas')
  await expect(canvas).toBeVisible({ timeout: 12000 })
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeGreaterThan(0)
  await replay.getByRole('button', { name: '2D', exact: true }).click()

  const second = await start('Second trial')
  await expect.poll(async () => (await samples(second)).length).toBeGreaterThan(0)
  await sessions.getByRole('button', { name: 'Finish cook' }).click()

  const comparison = page.getByRole('region', { name: 'Compare cooks' })
  await comparison.getByLabel('First cook').selectOption(first)
  await comparison.getByLabel('Second cook').selectOption(second)
  await comparison.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(comparison.getByRole('rowheader', { name: 'Brisket trial' })).toBeVisible()
  await expect(comparison.getByRole('rowheader', { name: 'Second trial' })).toBeVisible()

  const calibration = page.getByRole('region', { name: 'Smoker calibration' })
  await calibration.getByLabel('Finished cook').selectOption(first)
  await calibration.getByLabel('Final sampling window (min)').fill('0.1')
  await calibration.getByRole('button', { name: 'Analyze and save' }).click()
  await expect(calibration.getByRole('rowheader', { name: 'sim-probe-4' })).toBeVisible()
  await expect(calibration.getByRole('region', { name: 'Calibration heat map' })).toBeVisible()
})
