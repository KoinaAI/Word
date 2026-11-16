import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearSubmittedDraft, rebaseCompletedDraft, sameDraft, type SavedDraft } from '../src/lib/draft-completion.ts'

function store(value: string | null) {
  let saved = value
  return { getItem: (_key: string) => saved, removeItem: (_key: string) => { saved = null }, value: () => saved }
}

const submitted: SavedDraft<{ name: string }> = { format: 1, baseline: { name: 'Old' }, value: { name: 'Submitted' }, revision: 'edit-1' }

test('a confirmed save clears its unchanged persisted revision', () => {
  const storage = store(JSON.stringify(submitted))
  assert.equal(clearSubmittedDraft(storage, 'draft', submitted), true)
  assert.equal(storage.value(), null)
})

test('a later editor keeps its new text when an old save completes', () => {
  const later = { ...submitted, value: { name: 'New draft' }, revision: 'edit-2' }
  const storage = store(JSON.stringify(later))
  assert.equal(clearSubmittedDraft(storage, 'draft', submitted), false)
  assert.deepEqual(JSON.parse(storage.value()!), later)
})

test('returning to the submitted text still preserves the newer edit revision', () => {
  const later = { ...submitted, revision: 'edit-3' }
  const storage = store(JSON.stringify(later))
  assert.equal(clearSubmittedDraft(storage, 'draft', submitted), false)
  assert.deepEqual(JSON.parse(storage.value()!), later)
})

test('a different baseline belongs to a different save', () => {
  const storage = store(JSON.stringify({ ...submitted, baseline: { name: 'Other server value' } }))
  assert.equal(clearSubmittedDraft(storage, 'draft', submitted), false)
  assert.notEqual(storage.value(), null)
})

test('missing, malformed and inaccessible storage never causes deletion or throws', () => {
  for (const current of [null, '{bad json', 'null', '[]']) {
    const storage = store(current)
    assert.equal(clearSubmittedDraft(storage, 'draft', submitted), false)
    assert.equal(storage.value(), current)
  }
  assert.equal(clearSubmittedDraft({ getItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('must not delete') } }, 'draft', submitted), false)
  assert.equal(clearSubmittedDraft({ getItem: () => JSON.stringify(submitted), removeItem: () => { throw new Error('blocked') } }, 'draft', submitted), false)
})

test('snapshot comparison ignores object key order while preserving array order and legacy snapshots', () => {
  assert.equal(sameDraft({ b: [1, 2], a: null }, { a: null, b: [1, 2] }), true)
  assert.equal(sameDraft({ a: [1, 2] }, { a: [2, 1] }), false)
  assert.equal(sameDraft({}, { extra: undefined }), false)
  const legacy: SavedDraft<string> = { format: 1, baseline: '', value: 'legacy' }
  assert.equal(clearSubmittedDraft(store(JSON.stringify(legacy)), 'draft', legacy), true)
})


test('completion adopts confirmed values when the current snapshot is unchanged', () => {
  assert.deepEqual(rebaseCompletedDraft(submitted, submitted, { name: 'Confirmed' }), {
    ...submitted, baseline: { name: 'Confirmed' }, value: { name: 'Confirmed' },
  })
})

test('completion rebases only fields that were not edited after submission', () => {
  const request: SavedDraft<{ goal: number; exam: string; name: string }> = {
    format: 1, baseline: { goal: 20, exam: '', name: 'Old' },
    value: { goal: 25, exam: '', name: 'Old' }, revision: 'save-1',
  }
  const later = { ...request, value: { ...request.value, exam: '2027-06-01' }, revision: 'edit-2' }
  const confirmed = { goal: 25, exam: '', name: 'Server name' }
  assert.deepEqual(rebaseCompletedDraft(later, request, confirmed), {
    ...later, baseline: confirmed, value: { goal: 25, exam: '2027-06-01', name: 'Server name' },
  })
})

test('completion preserves a newly edited import string and advances its baseline', () => {
  const request: SavedDraft<string> = { format: 1, baseline: '', value: 'submitted import', revision: 'save-1' }
  const later = { ...request, value: 'new import', revision: 'edit-2' }
  assert.deepEqual(rebaseCompletedDraft(later, request, ''), { ...later, baseline: '' })
})

test('an older completion cannot rebase a draft already based on a newer save', () => {
  const later = { ...submitted, baseline: { name: 'New baseline' }, revision: 'edit-2' }
  assert.equal(rebaseCompletedDraft(later, submitted, { name: 'Old completion' }), null)
})
