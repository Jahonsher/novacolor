import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { detectName, detectPhone } from '../src/ai/lead-detect.js'

describe('phone detection', () => {
  const uz = '+998 90 123 45 67'
  const positives: [string, string][] = [
    ['+998 90 123 45 67', uz],
    ['raqamim +998901234567', uz],
    ['998901234567', uz],
    ['998 90 123-45-67', uz],
    ['90 1234567', uz],
    ['901234567', uz],
    ['(90) 123-45-67', uz],
    ['90-123-45-67 ga qo‘ng‘iroq qiling', uz],
    ['Мой номер: +998 (90) 123-45-67, звоните', uz],
    ['Alisher 93 555 44 33', '+998 93 555 44 33'],
    ['+7 916 123-45-67', '+79161234567'],
    ['+49 30 1234567', '+49301234567'],
    ['call 5551234567', '5551234567'],
  ]
  for (const [input, expected] of positives) {
    test(`detects ${JSON.stringify(input)}`, () => assert.equal(detectPhone(input), expected))
  }

  const negatives = [
    'Salom, Africa qancha turadi?',
    '2016-2020 yillar',
    'Sana 12.05.2024',
    '100 m2 xona uchun',
    'narxi 50000 so‘mmi?',
    'ISO 9001 sertifikati',
    'rang kodi 12345',
    '',
  ]
  for (const input of negatives) {
    test(`ignores ${JSON.stringify(input)}`, () => assert.equal(detectPhone(input), null))
  }
})

describe('name detection', () => {
  const cases: [string, string | null][] = [
    ['Mening ismim Alisher, raqamim 901234567', 'Alisher'],
    ['ismim: dilnoza', 'Dilnoza'],
    ['Меня зовут Ольга', 'Ольга'],
    ['Alisher, +998 90 123 45 67', 'Alisher'],
    ['Men Jasur bo‘laman', 'Jasur'],
    ['Telefon: 901234567', null],
    ['Salom 901234567', null],
    ['Qanday rang bor?', null],
  ]
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${expected}`, () => assert.equal(detectName(input), expected))
  }
})
