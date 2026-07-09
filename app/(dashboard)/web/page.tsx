'use client'

const GROUPS = [
  {
    label: '회사',
    sites: [
      { name: 'SEON',    url: 'https://seon.co.kr/',                                           logo: '/ci/1. Seon.png' },
      { name: '비즈메카', url: 'https://gwp.ktbizoffice.com/EKPHome/Login?compid=seoneng',      logo: '/ci/2. bizmeka.png' },
    ],
  },
  {
    label: '검색',
    sites: [
      { name: '구글',  url: 'https://www.google.com',  logo: '/ci/3. google.png' },
      { name: '네이버', url: 'https://www.naver.com/',  logo: '/ci/4. naver.png' },
      { name: '다음',  url: 'https://www.daum.net/',   logo: '/ci/5. daum.png' },
    ],
  },
  {
    label: '입찰',
    sites: [
      { name: '나라장터',  url: 'https://www.g2b.go.kr/',             logo: '/ci/6. narajang.png' },
      { name: '한전 SRM', url: 'https://srm.kepco.net/index.do',     logo: '/ci/7. kepco.png' },
      { name: '인포21C',  url: 'https://infose.info21c.net/',         logo: '/ci/8. info21c.png' },
    ],
  },
  {
    label: '자료검색',
    sites: [
      { name: '지리정보시스템',    url: 'https://www.geoinfo.or.kr/index.do?cntyn=0#',      logo: '/ci/9. geoinfo.png' },
      { name: '환경영향평가',      url: 'https://www.eiass.go.kr/',                          logo: '/ci/10. EIASS.png' },
      { name: '오픈인프라 검색',   url: 'https://openinframap.org/#11.95/37.32345/126.66395', logo: '/ci/11. open infrastructure.png' },
    ],
  },
  {
    label: 'AI',
    sites: [
      { name: 'ChatGPT', url: 'https://chatgpt.com/',              logo: '/ci/12. chatGPT.png' },
      { name: 'Gemini',  url: 'https://gemini.google.com/app?hl=ko', logo: '/ci/13. GEMINI.png' },
      { name: 'Claude',  url: 'https://claude.com/ko',             logo: '/ci/14. Claude.png' },
      { name: 'Figma',   url: 'https://www.figma.com/ko-kr/',      logo: '/ci/15. Figma.png' },
      { name: 'Canva',   url: 'https://www.canva.com/ko_kr/',      logo: '/ci/16. canva.png' },
    ],
  },
  {
    label: 'MAP',
    sites: [
      { name: '네이버지도', url: 'https://map.naver.com/p/',            logo: '/ci/17. naver map.png' },
      { name: '카카오맵',  url: 'https://map.kakao.com/',              logo: '/ci/18. kakaomap.png' },
      { name: '구글어스',  url: 'https://earth.google.com/web/',       logo: '/ci/19. google earth.png' },
      { name: '브이월드',  url: 'https://www.vworld.kr/v4po_main.do',  logo: '/ci/20. V world.png' },
    ],
  },
]

export default function WebPage() {
  return (
    <div style={{ padding: '32px', maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a7fa8', marginBottom: 28 }}>
        WEB 검색
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {GROUPS.map(group => (
          <div key={group.label}>
            {/* 그룹 헤더 */}
            <div style={{
              fontSize: 12, fontWeight: 700, color: '#888',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              borderBottom: '1px solid #e8e8e6',
              paddingBottom: 6, marginBottom: 14,
            }}>
              {group.label}
            </div>

            {/* 카드 그리드 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}>
              {group.sites.map(site => (
                <a
                  key={site.url}
                  href={site.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <div
                    style={{
                      border: '1px solid #e8e8e6',
                      borderRadius: 10,
                      padding: '20px 12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      background: '#fff',
                      transition: 'box-shadow 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLDivElement
                      el.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'
                      el.style.borderColor = '#a8d5e8'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLDivElement
                      el.style.boxShadow = 'none'
                      el.style.borderColor = '#e8e8e6'
                    }}
                  >
                    <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <img
                        src={site.logo}
                        alt={site.name}
                        style={{ maxHeight: 44, maxWidth: 120, objectFit: 'contain' }}
                      />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#333', textAlign: 'center' }}>
                      {site.name}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
