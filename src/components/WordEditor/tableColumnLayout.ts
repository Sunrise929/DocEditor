// The dialog uses hundredths of a centimeter to keep the width budget exact.
export type TableColumnLayout = {
  indentLeft: number
  widths: number[]
}

export type TableColumnSettings = {
  layout: TableColumnLayout
  availableWidth: number
  subjectIndex: number | null
}

export const MIN_SUBJECT_WIDTH = 20
export const toColumnUnits = (cm: number) => Math.round(cm * 100)
export const toCentimeters = (units: number) => units / 100
export const toColumnPixels = (units: number) => Number((toCentimeters(units) * 96 / 2.54).toFixed(4))

export const widthUnitsFromFractions = (fractions: readonly number[], totalWidth: number) => {
  let end = 0
  let previous = 0
  return fractions.map(fraction => {
    end += fraction * totalWidth
    const boundary = Math.round(end)
    const width = boundary - previous
    previous = boundary
    return width
  })
}

export const balanceColumnLayout = (
  layout: TableColumnLayout, availableWidth: number, balanceIndex: number,
): TableColumnLayout => {
  const widths = [...layout.widths]
  const used = widths.reduce((total, width, index) => index === balanceIndex ? total : total + width, 0)
  widths[balanceIndex] = availableWidth - layout.indentLeft - used
  return { ...layout, widths }
}
