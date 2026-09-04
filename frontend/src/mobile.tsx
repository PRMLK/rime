import { createRoot } from 'react-dom/client';
import { MobilePlayer } from './components/MobilePlayer';
import { AuthGate } from './components/AuthGate';
import './index.css';

createRoot(document.getElementById('mobile-root')!).render(
  <AuthGate>{(user, refreshAuth) => <MobilePlayer user={user} onAuthChanged={refreshAuth} />}</AuthGate>,
);
