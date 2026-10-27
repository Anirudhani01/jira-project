import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { AppProviders } from './app/providers';
import { routes } from './app/routes';
import { createQueryClient } from './lib/queryClient';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <AppProviders client={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
