export type PageOrientation = 'portrait' | 'landscape'

export type PageMargins = {
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
}

export const DEFAULT_PAGE_MARGINS: PageMargins = {
  marginTop: 25,
  marginRight: 20,
  marginBottom: 25,
  marginLeft: 20,
}

export const MIN_CONTENT_WIDTH_MM = 20
export const MIN_CONTENT_HEIGHT_MM = 5

export const readPageOrientation = (value: unknown): PageOrientation =>
  value === 'landscape' ? 'landscape' : 'portrait'

export const pageDimensions = (orientation: PageOrientation) =>
  orientation === 'landscape' ? { width: 297, height: 210 } : { width: 210, height: 297 }

export const samePageMargins = (first: PageMargins, second: PageMargins) =>
  first.marginTop === second.marginTop && first.marginRight === second.marginRight
  && first.marginBottom === second.marginBottom && first.marginLeft === second.marginLeft

export const validPageMargins = (margins: PageMargins, orientation: PageOrientation) => {
  const { width, height } = pageDimensions(orientation)
  const { marginTop, marginRight, marginBottom, marginLeft } = margins
  const tolerance = 1e-9
  return [marginTop, marginRight, marginBottom, marginLeft].every(value => Number.isFinite(value) && value >= 0)
    && marginLeft + marginRight <= width - MIN_CONTENT_WIDTH_MM + tolerance
    && marginTop + marginBottom <= height - MIN_CONTENT_HEIGHT_MM + tolerance
}

export const fitPageMargins = (margins: PageMargins, orientation: PageOrientation): PageMargins => {
  const { width, height } = pageDimensions(orientation)
  const horizontalScale = Math.min(1, (width - MIN_CONTENT_WIDTH_MM) / (margins.marginLeft + margins.marginRight))
  const verticalScale = Math.min(1, (height - MIN_CONTENT_HEIGHT_MM) / (margins.marginTop + margins.marginBottom))

  return {
    marginTop: margins.marginTop * verticalScale,
    marginRight: margins.marginRight * horizontalScale,
    marginBottom: margins.marginBottom * verticalScale,
    marginLeft: margins.marginLeft * horizontalScale,
  }
}
