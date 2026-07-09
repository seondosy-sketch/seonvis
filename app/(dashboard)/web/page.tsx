'use client'

const SITES: {
  name: string
  description: string
  url: string
  logo?: string
}[] = [
  // 사이트 목록을 여기에 추가하세요
]

export default function WebPage() {
  return (
    <div style={{ padding: '32px 32px', maxWidth: 960, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1a7fa8', marginBottom: 24 }}>
        WEB 검색
      </h2>

      {SITES.length === 0 ? (
        <div style={{
          textAlign: 'center', color: '#aaa', fontSize: 14,
          padding: '80px 0',
          border: '2px dashed #e8e8e6',
          borderRadius: 10,
        }}>
          사이트 목록을 등록해주세요
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
        }}>
          {SITES.map((site) => (
            <a
              key={site.url}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                border: '1px solid #e8e8e6',
                borderRadius: 10,
                padding: '28px 16px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                transition: 'box-shadow 0.15s, border-color 0.15s',
                background: '#fff',
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = '#b3d9ea'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                  ;(e.currentTarget as HTMLDivElement).style.borderColor = '#e8e8e6'
                }}
              >
                <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {site.logo ? (
                    <img src={site.logo} alt={site.name} style={{ maxHeight: 56, maxWidth: 140, objectFit: 'contain' }} />
                  ) : (
                    <div style={{
                      width: 56, height: 56, borderRadius: 12,
                      background: '#f0f7fb',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, color: '#1a7fa8', fontWeight: 700,
                    }}>
                      {site.name[0]}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#222', marginBottom: 4 }}>
                    {site.name}
                  </div>
                  {site.description && (
                    <div style={{ fontSize: 11, color: '#888' }}>{site.description}</div>
                  )}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
