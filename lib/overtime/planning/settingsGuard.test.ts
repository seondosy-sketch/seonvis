import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPeriodLoader } from './loadGate'
import { createSettingsActionGuard } from './settingsGuard'

// page.tsx와 같은 연결: loader(기간 세대) + 렌더 뒤 갱신되는 자료 소유·쓰기 권한(ref) + 설정 화면(key=viewEpoch)마다 가드
function screen(initial: string) {
  const loader = createPeriodLoader<string, null>({
    initial, label: p => p, sync: async () => null, onSync: () => {}, run: async () => {},
    onReloadStart: () => {}, onPeriodChange: () => {}, onError: () => {},
  })
  const state = { owned: true, canWrite: true }   // page.tsx settingsStateRef.current
  let viewEpoch = 0
  const writes: string[] = []
  const ui = { error: null as string | null, changed: 0 }
  // PlanSettings 한 화면 — 만들어질 때의 기간·세대에 묶인 가드를 받고, handler는 PlanSettings와 같은 순서(가드 → 쓰기 → 오류 또는 onChanged)
  function mount() {
    const canStartAction = createSettingsActionGuard({
      beginAction: e => loader.beginAction(e), viewEpoch, periodLabel: loader.current(), state: () => state,
    })
    const handler = (name: string, fail = false) => async () => {
      if (!canStartAction()) return
      ui.error = null
      writes.push(name)
      const res = await Promise.resolve({ error: fail ? { message: 'x' } : null })
      if (res.error) { ui.error = res.error.message; return }
      ui.changed++
    }
    return {
      saveTarget: handler('target'), toggleProject: handler('project'), toggleTask: handler('task'),
      failing: handler('target', true), canStartAction,
    }
  }
  const changePeriod = (p: string) => { viewEpoch = loader.changePeriod(p) }
  return { loader, state, writes, ui, mount, changePeriod }
}

describe('설정 화면 쓰기의 기간 소유권(createSettingsActionGuard)', () => {
  it('A 화면 handler 확보 → B 전환 → 오래된 A handler 호출: 쓰기 0회, 메시지·onChanged 없음', async () => {
    const s = screen('2026-10')
    const a = s.mount()
    s.ui.error = 'B 화면의 기존 안내'
    s.changePeriod('2026-11')
    s.mount()                                   // B 화면
    for (const h of [a.saveTarget, a.toggleProject, a.toggleTask, a.failing]) await h()
    expect(s.writes).toEqual([])
    expect(s.ui).toEqual({ error: 'B 화면의 기존 안내', changed: 0 })
  })

  it('A → B → A: 처음 A 화면의 handler는 라벨이 같아도 0회, 새 A 화면의 handler는 1회', async () => {
    const s = screen('2026-10')
    const firstA = s.mount()
    s.changePeriod('2026-11')
    s.changePeriod('2026-10')
    const newA = s.mount()
    await firstA.toggleProject()
    expect(s.writes).toEqual([])
    await newA.toggleProject()
    expect(s.writes).toEqual(['project'])
    expect(s.ui.changed).toBe(1)
  })

  it('현재 A 화면 handler: 목표·프로젝트·업무 각 1회 쓰기, 성공은 onChanged, 실패는 오류 표시(기존 동작)', async () => {
    const s = screen('2026-10')
    const a = s.mount()
    await a.saveTarget()
    await a.toggleProject()
    await a.toggleTask()
    expect(s.writes).toEqual(['target', 'project', 'task'])
    expect(s.ui).toEqual({ error: null, changed: 3 })
    await a.failing()
    expect(s.ui).toEqual({ error: 'x', changed: 3 })
  })

  it('쓰기 권한 없음 → 0회', async () => {
    const s = screen('2026-10')
    const a = s.mount()
    s.state.canWrite = false
    await a.saveTarget()
    expect(s.writes).toEqual([])
  })

  it('자료 소유권 없음(새 기간 자료가 아직 오지 않음) → 0회, 자료가 오면 같은 화면의 handler가 그때부터 동작(호출 시점 판정)', async () => {
    const s = screen('2026-10')
    s.state.owned = false
    const a = s.mount()
    await a.toggleTask()
    expect(s.writes).toEqual([])
    s.state.owned = true                         // 렌더 뒤 ref 갱신 — 가드를 다시 만들지 않아도 반영
    await a.toggleTask()
    expect(s.writes).toEqual(['task'])
  })

  it('같은 기간 reload 중(자료 소유·세대 그대로) → 설정 handler는 계속 동작', async () => {
    const s = screen('2026-10')
    const a = s.mount()
    const r = s.loader.reload()                  // loading 중 — 세대·자료 소유는 바뀌지 않는다
    await a.saveTarget()
    await r
    await a.toggleProject()
    expect(s.writes).toEqual(['target', 'project'])
  })

  it('화면이 사라지면(dispose) 0회, 화면 기간 라벨이 지금 기간과 다르면 0회', async () => {
    const s = screen('2026-10')
    const a = s.mount()
    s.loader.dispose()
    await a.saveTarget()
    expect(s.writes).toEqual([])
    s.loader.activate()
    const mismatched = createSettingsActionGuard({
      beginAction: e => s.loader.beginAction(e), viewEpoch: 0, periodLabel: '2026-09', state: () => s.state,
    })
    expect([a.canStartAction(), mismatched()]).toEqual([true, false])
  })
})

describe('PlanSettings.tsx·page.tsx 연결 — 각 handler가 DB 쓰기 전에 가드를 부른다', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  const settings = read('app/(dashboard)/overtime/plan/_components/PlanSettings.tsx')
  const page = read('app/(dashboard)/overtime/plan/page.tsx')
  const handler = (name: string) => {
    const i = settings.indexOf(`  async function ${name}(`)
    expect(i, name).toBeGreaterThan(0)
    return settings.slice(i, settings.indexOf('\n  }\n', i))
  }

  it.each(['saveTarget', 'toggleProject', 'toggleTask'])('%s: 첫 문장이 가드이고, 쓰기·메시지·onChanged보다 앞선다', name => {
    const b = handler(name)
    const lines = b.split('\n')
    expect(lines[1].trim()).toBe('if (!canStartAction()) return')
    const guard = b.indexOf('if (!canStartAction()) return')
    for (const after of ['supabase.from(', 'setError(', 'onChanged()']) {
      expect(b.indexOf(after), `${name}: ${after}`).toBeGreaterThan(guard)
    }
  })

  it('PlanSettings의 DB 쓰기는 위 세 handler 안에만 있다(가드 없는 다른 쓰기 경로 없음)', () => {
    const writes = [...settings.matchAll(/supabase\.from\(/g)].map(m => m.index!)
    const ranges = ['saveTarget', 'toggleProject', 'toggleTask'].map(n => {
      const i = settings.indexOf(`  async function ${n}(`)
      return [i, settings.indexOf('\n  }\n', i)] as const
    })
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) expect(ranges.some(([a, b]) => w > a && w < b), `쓰기 위치 ${w}`).toBe(true)
    expect(settings).not.toMatch(/\.rpc\(/)
  })

  it('page.tsx: 설정 화면에 세대·기간에 묶인 함수형 가드를 넘기고, key·canWrite·onChanged 보호를 유지한다', () => {
    expect(page).toMatch(/<PlanSettings\n\s*key=\{viewEpoch\}/)
    expect(page).toContain('canWrite={canWrite && dataOwned}')
    expect(page).toContain('canStartAction={canStartSettingsAction}')
    expect(page).toContain('useEffect(() => { settingsStateRef.current = { owned: dataOwned, canWrite } }, [dataOwned, canWrite])')
    expect(page).toMatch(/const canStartSettingsAction = useCallback\(\(\) => createSettingsActionGuard\(\{\n\s*beginAction: e => loaderRef\.current!\.beginAction\(e\),\n\s*viewEpoch,\n\s*periodLabel: label,\n\s*state: \(\) => settingsStateRef\.current,\n\s*\}\)\(\), \[viewEpoch, label\]\)/)
    expect(page).toContain('if (loaderRef.current!.beginAction(viewEpoch) && preview)')
  })
})
