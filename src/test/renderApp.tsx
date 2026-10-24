// Mounts the whole app at a URL with the real AuthProvider, so a test drives the same routes,
// guards and sessionStorage handoffs an organizer does. Seed mid-wizard state with the
// flowState writers before calling it. The network is src/test/fakeWca.ts and
// the PDF worker src/test/fakeWorker.ts, both installed by routeSetup.ts.

import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { AppRoutes } from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { ThemeProvider } from '../theme/ThemeContext';
import type { WCAToken, WCAUser } from '../auth/wca';
import { freshToken, organizer } from './fakeWca';

const probe = { path: '' };

// eslint-disable-next-line react-refresh/only-export-components -- test helper, never hot-reloaded
function LocationProbe() {
  const { pathname, search } = useLocation();
  useEffect(() => { probe.path = pathname + search; }, [pathname, search]);
  return null;
}

/** The router's current path and query, as of the last committed render. */
export const currentPath = () => probe.path;

export interface RenderAppOptions {
  /** null renders signed out. */
  user?: WCAUser | null;
  token?: WCAToken;
}

export function renderApp(path: string, { user = organizer, token = freshToken() }: RenderAppOptions = {}) {
  if (user) {
    sessionStorage.setItem('wca_token', JSON.stringify(token));
    sessionStorage.setItem('wca_user', JSON.stringify(user));
  }
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <AppRoutes />
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
