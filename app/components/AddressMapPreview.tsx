'use client'

import { useEffect, useRef, useState } from 'react'
import { geocodeAddress, type GeoPoint } from '@/lib/kakaoMap'

type Status = 'idle' | 'loading' | 'ok' | 'notfound' | 'nokey' | 'error'

export default function AddressMapPreview({ address, height = 150 }: { address: string; height?: number }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [point, setPoint] = useState<GeoPoint | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  // 1단계: 주소 -> 좌표 지오코딩
  useEffect(() => {
    let cancelled = false
    setPoint(null)
    if (!address?.trim()) { setStatus('idle'); return }
    if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) { setStatus('nokey'); return }
    setStatus('loading')
    geocodeAddress(address)
      .then((result) => {
        if (cancelled) return
        if (!result) { setStatus('notfound'); return }
        setPoint(result)
        setStatus('ok')
      })
      .catch((e) => {
        if (cancelled) return
        setErrorMsg(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [address])

  // 2단계: 좌표가 정해지고 컨테이너가 화면에 표시된 뒤(status === 'ok') 지도 생성
  // (display:none 상태의 컨테이너에 지도를 만들면 크기가 0으로 잡혀 깨지므로 렌더 이후에 생성)
  useEffect(() => {
    if (status !== 'ok' || !point || !mapRef.current) return
    const kakao = window.kakao
    const map = new kakao.maps.Map(mapRef.current, {
      center: new kakao.maps.LatLng(point.lat, point.lng),
      level: 4,
    })
    new kakao.maps.Marker({ position: new kakao.maps.LatLng(point.lat, point.lng), map })
  }, [status, point])

  if (!address?.trim()) return null

  return (
    <div>
      <div ref={mapRef} style={{ width: '100%', height, borderRadius: 6, background: '#f4f4f2', display: status === 'ok' ? 'block' : 'none' }} />
      {status === 'nokey' && (
        <div style={{ fontSize: 11, color: '#b45309', padding: '8px 10px', background: '#fffbeb', borderRadius: 6 }}>
          지도 기능을 사용하려면 Kakao Maps API 키(NEXT_PUBLIC_KAKAO_MAP_KEY) 설정이 필요합니다.
        </div>
      )}
      {status === 'error' && (
        <div style={{ fontSize: 11, color: '#b91c1c', padding: '8px 10px', background: '#fef2f2', borderRadius: 6 }}>
          지도를 불러오지 못했습니다: {errorMsg}
        </div>
      )}
      {status === 'notfound' && (
        <div style={{ fontSize: 11, color: '#888', padding: '8px 10px', background: '#f8f8f7', borderRadius: 6 }}>
          주소를 지도에서 찾을 수 없습니다.
        </div>
      )}
      {status === 'loading' && (
        <div style={{ fontSize: 11, color: '#888', padding: '8px 10px' }}>지도를 불러오는 중...</div>
      )}
    </div>
  )
}
