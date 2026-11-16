import assert from 'node:assert/strict'
import { test } from 'node:test'
import { saveFavoriteCAS } from '../src/lib/favorite-request.ts'

function statusError(status: number) { return Object.assign(new Error('request failed'), { status }) }

test('rechecks the revision after an uncertain accepted write and fences a delayed older write', async () => {
  let revision = 0
  let favorite = false
  let writes = 0
  const expected: number[] = []
  const request = async <T>(_path: string, options?: RequestInit): Promise<T> => {
    if (!options) return { favorite, revision } as T
    const body = JSON.parse(String(options.body)) as { favorite: boolean; expectedRevision: number }
    expected.push(body.expectedRevision)
    if (body.expectedRevision !== revision) throw statusError(409)
    favorite = body.favorite; revision++; writes++
    if (writes === 1) throw statusError(0) // The write committed but its response was lost.
    return { favorite, revision } as T
  }
  const saved = await saveFavoriteCAS(request, 8, false, () => true)
  assert.deepEqual(expected, [0, 1])
  assert.deepEqual(saved, { favorite: false, revision: 2 })
  // A request that began at revision zero cannot reapply a previous intent.
  assert.notEqual(0, revision)
})

test('retries a CAS conflict with the new revision and stops after three conflicts', async () => {
  const revisions: number[] = []
  let gets = 0
  const request = async <T>(_path: string, options?: RequestInit): Promise<T> => {
    if (!options) return { favorite: false, revision: gets++ } as T
    revisions.push((JSON.parse(String(options.body)) as { expectedRevision: number }).expectedRevision)
    throw statusError(409)
  }
  await assert.rejects(saveFavoriteCAS(request, 8, true, () => true), { status: 409 })
  assert.deepEqual(revisions, [0, 1, 2])
})

test('an identity change after reading the revision prevents a queued write', async () => {
  let current = true
  let posted = false
  const request = async <T>(_path: string, options?: RequestInit): Promise<T> => {
    if (options) posted = true
    current = false
    return { favorite: false, revision: 0 } as T
  }
  await assert.rejects(saveFavoriteCAS(request, 8, true, () => current), /账号/)
  assert.equal(posted, false)
})
