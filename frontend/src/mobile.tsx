import { createRoot } from 'react-dom/client';
import { MobilePlayer } from './components/MobilePlayer';
import { AuthGate } from './components/AuthGate';
import { MobileServerGate } from './components/MobileServerGate';
import './index.css';

createRoot(document.getElementById('mobile-root')!).render(
  <MobileServerGate>
    {(connection) => (
      <AuthGate server={connection?.server} onSwitchServer={connection?.switchServer}>
        {(user, refreshAuth) => (
          <MobilePlayer
            user={user}
            onAuthChanged={refreshAuth}
            server={connection?.server}
            onSwitchServer={connection?.switchServer}
          />
        )}
      </AuthGate>
    )}
  </MobileServerGate>,
);
