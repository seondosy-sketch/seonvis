'use client'

declare global {
  interface Window {
    kakao: any
  }
}

const SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js'

export const OFFICE = {
  name: '서울 사무실',
  address: '서울시 강동구 고덕비즈밸리로2가길 60',
}

export interface GeoPoint {
  lat: number
  lng: number
}

let sdkPromise: Promise<void> | null = null

export function loadKakaoMapSdk(): Promise<void> {
  const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY
  if (!key) return Promise.reject(new Error('NEXT_PUBLIC_KAKAO_MAP_KEY 환경변수가 설정되지 않았습니다'))
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.kakao?.maps) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SDK_URL}"]`) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => window.kakao.maps.load(resolve))
      existing.addEventListener('error', () => reject(new Error('Kakao Maps SDK 로드 실패')))
      return
    }
    const script = document.createElement('script')
    script.src = `${SDK_URL}?appkey=${key}&autoload=false&libraries=services`
    script.async = true
    script.onload = () => window.kakao.maps.load(resolve)
    script.onerror = () => reject(new Error('Kakao Maps SDK 로드 실패'))
    document.head.appendChild(script)
  })
  return sdkPromise
}

export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  if (!address?.trim()) return null
  await loadKakaoMapSdk()
  const kakao = window.kakao

  return new Promise((resolve) => {
    const geocoder = new kakao.maps.services.Geocoder()
    geocoder.addressSearch(address, (result: any[], status: string) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) })
        return
      }
      // 도로명/지번 주소로 못 찾으면 키워드(건물명 등)로 재검색
      const places = new kakao.maps.services.Places()
      places.keywordSearch(address, (data: any[], status2: string) => {
        if (status2 === kakao.maps.services.Status.OK && data[0]) {
          resolve({ lat: parseFloat(data[0].y), lng: parseFloat(data[0].x) })
        } else {
          resolve(null)
        }
      })
    })
  })
}

export function openKakaoDirectionsLink(fromName: string, from: GeoPoint, toName: string, to: GeoPoint) {
  const url = `https://map.kakao.com/link/from/${encodeURIComponent(fromName)},${from.lat},${from.lng}/to/${encodeURIComponent(toName)},${to.lat},${to.lng}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function openDirectionsFromOffice(destName: string, destAddress: string): Promise<{ ok: boolean; message?: string }> {
  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) {
    return { ok: false, message: 'Kakao Maps API 키(NEXT_PUBLIC_KAKAO_MAP_KEY)가 설정되지 않았습니다.' }
  }
  if (!destAddress?.trim()) {
    return { ok: false, message: '주소가 입력되지 않았습니다.' }
  }
  try {
    const [from, to] = await Promise.all([
      geocodeAddress(OFFICE.address),
      geocodeAddress(destAddress),
    ])
    if (!from) return { ok: false, message: '사무실 주소를 지도에서 찾을 수 없습니다.' }
    if (!to) return { ok: false, message: '입력한 주소를 지도에서 찾을 수 없습니다.' }
    openKakaoDirectionsLink(OFFICE.name, from, destName || '목적지', to)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '길찾기를 여는 중 오류가 발생했습니다.' }
  }
}
