import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateImportWords, validatePassword, validateProfileName } from '../src/lib/form-validation.ts'

test('profile limits count Unicode characters and reject blank names', () => {
  assert.equal(validateProfileName('  学习者  '), undefined)
  assert.ok(validateProfileName(' \n\t '))
  assert.equal(validateProfileName('😀'.repeat(40)), undefined)
  assert.match(validateProfileName('😀'.repeat(41))!, /40/)
})

test('password validation uses UTF-8 bytes for registration and login', () => {
  assert.equal(validatePassword('12345678', true), undefined)
  assert.ok(validatePassword('1234567', true))
  assert.equal(validatePassword('密码中文'.repeat(6), true), undefined)
  assert.match(validatePassword('中'.repeat(25), true)!, /72/)
  assert.match(validatePassword('中'.repeat(25), false)!, /72/)
  assert.equal(validatePassword('old', false), undefined)
  assert.ok(validatePassword('', false))
})

test('imports preserve omitted optional fields while retaining explicit clearing', () => {
  const words = validateImportWords(JSON.stringify({ words: [
    { text: ' curiosity ', meaning: ' 新释义 ' },
    { text: 'achieve', meaning: '实现', phonetic: '', example: '  ', exampleMeaning: '新的例句' },
  ] }))
  assert.deepEqual(words[0], { text: 'curiosity', meaning: '新释义' })
  assert.equal(Object.hasOwn(words[0]!, 'example'), false)
  assert.deepEqual(words[1], { text: 'achieve', meaning: '实现', phonetic: '', example: '', exampleMeaning: '新的例句' })
})

test('import errors locate the specific item and field', () => {
  const good = { text: 'curiosity', meaning: '好奇心' }
  assert.throws(() => validateImportWords(JSON.stringify([good, { text: 'bad', meaning: ' ' }])), /第 2 项.*meaning/)
  assert.throws(() => validateImportWords(JSON.stringify([good, { text: 'bad', meaning: '错误', phonetic: null }])), /第 2 项.*phonetic/)
  assert.throws(() => validateImportWords(JSON.stringify([good, { text: 'bad', meaning: '错误', example: 'a\u0080b' }])), /第 2 项.*example.*控制字符/)
  assert.throws(() => validateImportWords(JSON.stringify([good, { text: 'bad', meaning: '错误', exampleMeaning: '中'.repeat(2001) }])), /第 2 项.*exampleMeaning.*2000/)
  assert.throws(() => validateImportWords(JSON.stringify([good, { text: ' CURIOSITY ', meaning: '重复' }])), /第 2 项.*第 1 项重复/)
})

test('import strings support valid astral characters and permitted whitespace', () => {
  assert.equal(validateImportWords(JSON.stringify([{ text: '😀'.repeat(128), meaning: 'a\n\tb\r\nc' }]))[0]!.text.length, 256)
  assert.throws(() => validateImportWords('[{"text":"invalid","meaning":"\\ud800"}]'), /meaning.*Unicode/)
  assert.throws(() => validateImportWords(JSON.stringify([{ text: '😀'.repeat(129), meaning: '超长' }])), /text.*128/)
})

test('import rejects malformed JSON, wrong envelopes and oversized batches', () => {
  assert.throws(() => validateImportWords('[{'), /JSON 格式/)
  for (const source of ['null', '[]', '{}', '{"words":"bad"}', '[[1,2]]']) assert.throws(() => validateImportWords(source))
  assert.throws(() => validateImportWords(JSON.stringify(Array.from({ length: 5001 }, (_, index) => ({ text: `word${index}`, meaning: '含义' })))), /5000/)
})
