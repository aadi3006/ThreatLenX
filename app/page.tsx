'use client';
import { useEffect } from 'react';
import SocSpatialWrapper from './soc-spatial';
import { bootstrapSecurity } from './core/bootstrap';

export default function Home() {
  // Bootstrap SecurityService once — idempotent.
  // Ensures LocalProvider + IndexedDB are ready before SocSpatialWrapper mounts.
  useEffect(() => {
    bootstrapSecurity().catch((err) =>
      console.error('[page] SecurityService bootstrap failed:', err)
    );
  }, []);

  return (
    <main className="explainsec-soc-app" style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#000403' }}>
      <SocSpatialWrapper />
    </main>
  );
}
