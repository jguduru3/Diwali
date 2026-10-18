import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useRoutes, type Location } from 'react-router-dom';
import { routes } from '../router';

// Plain MemoryRouter + useRoutes: the data router's fetch-based navigation
// trips over jsdom's AbortSignal, and these tests only need routing + guards.
function App({ onLocation }: { onLocation: (l: Location) => void }) {
  onLocation(useLocation());
  return useRoutes(routes);
}

export function renderAt(path: string) {
  const state = { location: undefined as unknown as Location };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App onLocation={(l) => (state.location = l)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { state };
}
