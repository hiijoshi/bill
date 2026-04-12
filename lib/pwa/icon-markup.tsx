import React from 'react'

export function PwaIconMarkup({
  size,
  maskable = false
}: {
  size: number
  maskable?: boolean
}) {
  const padding = maskable ? Math.round(size * 0.16) : Math.round(size * 0.1)
  const radius = Math.round(size * 0.22)
  const innerRadius = Math.round(size * 0.16)
  const gridStroke = Math.max(2, Math.round(size * 0.012))

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 18% 18%, rgba(110,168,255,0.42), transparent 28%), radial-gradient(circle at 82% 16%, rgba(45,212,191,0.28), transparent 24%), linear-gradient(180deg, #f8fbff 0%, #dfe8f5 100%)'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
          backgroundSize: `${Math.round(size * 0.12)}px ${Math.round(size * 0.12)}px`
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: padding,
          display: 'flex',
          borderRadius: radius,
          background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.98) 100%)',
          boxShadow: '0 28px 68px rgba(15,23,42,0.28)'
        }}
      />

      <div
        style={{
          position: 'absolute',
          inset: padding + Math.round(size * 0.06),
          borderRadius: innerRadius,
          border: `${gridStroke}px solid rgba(255,255,255,0.14)`
        }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: Math.round(size * 0.045),
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div
          style={{
            fontSize: Math.round(size * 0.16),
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: `-${Math.round(size * 0.01)}px`,
            color: '#f8fafc'
          }}
        >
          Mb
        </div>
        <div
        style={{
          width: Math.round(size * 0.34),
          height: Math.round(size * 0.24),
          display: 'flex',
          borderRadius: Math.round(size * 0.05),
          background: 'linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))',
          border: `${gridStroke}px solid rgba(255,255,255,0.12)`,
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '14%',
              right: '14%',
              top: '20%',
              height: `${Math.round(size * 0.016)}px`,
              background: 'rgba(226,232,240,0.76)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '14%',
              width: '28%',
              bottom: '18%',
              height: '42%',
              borderRadius: Math.round(size * 0.025),
              background: '#60a5fa'
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '43%',
              width: '18%',
              bottom: '18%',
              height: '58%',
              borderRadius: Math.round(size * 0.025),
              background: '#34d399'
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: '14%',
              width: '18%',
              bottom: '18%',
              height: '30%',
              borderRadius: Math.round(size * 0.025),
              background: '#f59e0b'
            }}
          />
        </div>
        <div
          style={{
            fontSize: Math.round(size * 0.05),
            letterSpacing: `${Math.round(size * 0.012)}px`,
            textTransform: 'uppercase',
            color: 'rgba(226,232,240,0.82)',
            fontWeight: 700
          }}
        >
          ERP
        </div>
      </div>
    </div>
  )
}
