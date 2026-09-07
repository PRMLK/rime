import { createRoot } from 'react-dom/client';
import { MobilePlayer } from './components/MobilePlayer';
import { AuthGate } from './components/AuthGate';
import { MobileServerGate } from './components/MobileServerGate';
import { ClientCacheProvider } from './lib/client-cache-context';
import { clientSettingsScope } from './lib/client-settings';
import './index.css';

createRoot(document.getElementById('mobile-root')!).render(
  <MobileServerGate>
    {(connection) => (
      <AuthGate server={connection?.server} onSwitchServer={connection?.switchServer}>
        {(user, refreshAuth) => (
          <ClientCacheProvider
            key={clientSettingsScope(connection?.server.id, user.id)}
            scope={clientSettingsScope(connection?.server.id, user.id)}
          >
            <MobilePlayer
              user={user}
              onAuthChanged={refreshAuth}
              server={connection?.server}
              onSwitchServer={connection?.switchServer}
            />
          </ClientCacheProvider>
        )}
      </AuthGate>
    )}
  </MobileServerGate>,
);
