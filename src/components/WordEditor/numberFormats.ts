export type NumberFormat = 'decimal' | 'chinese' | 'alpha' | 'roman' | 'circled'
export type NumberSuffix = '.' | '、' | ''
export type NumberWrapper = '' | '()' | '（）'
export type NumberStyle = {
  format: NumberFormat
  suffix: NumberSuffix
  wrapper: NumberWrapper
  uppercase: boolean
}

export const isNumberWrapper = (value: unknown): value is NumberWrapper =>
  value === '' || value === '()' || value === '（）'

const circledNumbers = '⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿'
const numberToken = `[0-9a-zA-Z零一二三四五六七八九十百千万亿${circledNumbers}]+`
export const numberPrefixPattern = new RegExp(
  `(\\(${numberToken}\\)|（${numberToken}）|${numberToken})([.、]?) $`,
)

export const isNumberSuffix = (value: unknown): value is NumberSuffix =>
  value === '.' || value === '、' || value === ''

export const isNumberFormat = (value: unknown): value is NumberFormat =>
  value === 'decimal' || value === 'chinese' || value === 'alpha' || value === 'roman' || value === 'circled'

export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const digits = '零一二三四五六七八九'
const smallUnits = ['', '十', '百', '千']
const groupUnits = ['', '万', '亿', '万亿']

const formatChineseGroup = (group: number) => {
  let output = ''
  let zeroPending = false
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(group / 10 ** place) % 10
    if (digit === 0) {
      zeroPending ||= Boolean(output)
      continue
    }
    if (zeroPending) output += digits[0]
    output += digits[digit]! + smallUnits[place]
    zeroPending = false
  }
  return output
}

const formatChinese = (value: number) => {
  let output = ''
  let zeroPending = false
  for (let place = groupUnits.length - 1; place >= 0; place--) {
    const group = Math.floor(value / 10000 ** place) % 10000
    if (group === 0) {
      zeroPending ||= Boolean(output)
      continue
    }
    if (output && (zeroPending || group < 1000)) output += digits[0]
    output += formatChineseGroup(group) + groupUnits[place]
    zeroPending = false
  }
  return output.replace(/^一十/, '十')
}

const parseChinese = (text: string) => {
  let total = 0
  let group = 0
  let digit = 0
  for (const part of text.match(/万亿|[零一二三四五六七八九十百千万亿]/g) ?? []) {
    const small = smallUnits.indexOf(part)
    const large = groupUnits.indexOf(part)
    if (small > 0) {
      group += (digit || 1) * 10 ** small
      digit = 0
    } else if (large > 0) {
      total += (group + digit) * 10000 ** large
      group = 0
      digit = 0
    } else {
      digit = digits.indexOf(part)
    }
  }
  const value = total + group + digit
  return isPositiveInteger(value) && formatChinese(value) === text ? value : null
}

const formatAlphabetic = (value: number) => {
  let output = ''
  while (value > 0) {
    value--
    output = String.fromCharCode(97 + value % 26) + output
    value = Math.floor(value / 26)
  }
  return output
}

const romanSymbols = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'],
  [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
] as const
const romanValues: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

const formatRoman = (value: number) => {
  if (value > 3999) return String(value)
  let output = ''
  for (const [amount, symbol] of romanSymbols) {
    const count = Math.floor(value / amount)
    output += symbol.repeat(count)
    value -= count * amount
  }
  return output
}

const parseRoman = (text: string) => {
  let value = 0
  let previous = 0
  for (let index = text.length - 1; index >= 0; index--) {
    const current = romanValues[text[index]!] ?? 0
    value += current < previous ? -current : current
    previous = current
  }
  return isPositiveInteger(value) && formatRoman(value) === text ? value : null
}

const formatCircled = (value: number) => circledNumbers[value]
  ?? Array.from(String(value), digit => circledNumbers[Number(digit)]).join('')

const parseCircled = (text: string) => {
  if (text.length === 1) {
    const value = circledNumbers.indexOf(text)
    return value > 0 ? value : null
  }

  let value = 0
  for (const digit of text) {
    const index = circledNumbers.indexOf(digit)
    if (index < 0 || index > 9) return null
    value = value * 10 + index
  }
  return isPositiveInteger(value) && formatCircled(value) === text ? value : null
}

const formatters = {
  decimal: String,
  chinese: formatChinese,
  alpha: formatAlphabetic,
  roman: formatRoman,
  circled: formatCircled,
}

export const formatNumberLabel = (value: number, { format, suffix, wrapper, uppercase }: NumberStyle) => {
  const token = formatters[format](value)
  const text = uppercase ? token.toUpperCase() : token
  return wrapper.slice(0, 1) + text + wrapper.slice(1) + suffix
}

export const parseNumberPrefix = (
  prefix: string, getPreviousFormat: () => NumberFormat | undefined,
): ({ value: number } & Omit<NumberStyle, 'suffix'>) | null => {
  const wrapper = prefix.startsWith('(') ? '()' : prefix.startsWith('（') ? '（）' : ''
  if (wrapper && !prefix.endsWith(wrapper.slice(1))) return null
  const token = wrapper ? prefix.slice(1, -1) : prefix
  const uppercase = /^[A-Z]+$/.test(token)
  const text = uppercase ? token.toLowerCase() : token
  const style = { wrapper, uppercase } as const

  if (/^[1-9][0-9]*$/.test(text)) {
    const value = Number(text)
    return isPositiveInteger(value) ? { ...style, value, format: 'decimal' } : null
  }

  if (/^[a-z]$/.test(text)) {
    const roman = romanValues[text]
    if (roman) {
      const previous = getPreviousFormat()
      if (previous === 'roman' || (text === 'i' && previous !== 'alpha')) {
        return { ...style, value: roman, format: 'roman' }
      }
    }
    return { ...style, value: text.charCodeAt(0) - 96, format: 'alpha' }
  }

  if (/^[ivxlcdm]+$/.test(text)) {
    const value = parseRoman(text)
    return value === null ? null : { ...style, value, format: 'roman' }
  }

  const circled = parseCircled(text)
  if (circled !== null) return { ...style, value: circled, format: 'circled' }

  const value = parseChinese(text)
  return value === null ? null : { ...style, value, format: 'chinese' }
}
