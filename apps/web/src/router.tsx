import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { Area } from '@pataka/shared';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { About } from './routes/About';
import { Account } from './routes/Account';
import { AdminLayout } from './routes/admin/AdminLayout';
import { Blocked } from './routes/admin/Blocked';
import { Categories } from './routes/admin/Categories';
import { Clusters } from './routes/admin/Clusters';
import { Licences } from './routes/admin/Licences';
import { Members } from './routes/admin/Members';
import { Overview } from './routes/admin/Overview';
import { Shops } from './routes/admin/Shops';
import { BookPage } from './routes/customer/BookPage';
import { Home } from './routes/customer/Home';
import { PlanPage } from './routes/customer/PlanPage';
import { ShopPage } from './routes/customer/ShopPage';
import { TicketPage } from './routes/customer/TicketPage';
import { Gate } from './routes/gate/Gate';
import { Login } from './routes/Login';
import { NotFound } from './routes/NotFound';
import { Counter } from './routes/shop/Counter';
import { Licence } from './routes/shop/Licence';
import { Prices } from './routes/shop/Prices';
import { Report } from './routes/shop/Report';
import { ShopLayout } from './routes/shop/ShopLayout';
import { ShopToday } from './routes/shop/ShopToday';
import { Slots } from './routes/shop/Slots';

const guard = (el: ReactNode, area?: Area) => <RequireRole area={area}>{el}</RequireRole>;

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/s/:code', element: <ShopPage /> },
      { path: '/s/:code/plan', element: <PlanPage /> },
      { path: '/s/:code/book', element: <BookPage /> },
      { path: '/ticket', element: guard(<TicketPage />) },
      { path: '/about', element: <About /> },
      { path: '/login', element: <Login /> },
      { path: '/account', element: guard(<Account />) },
      {
        path: '/shop',
        element: guard(<ShopLayout />, 'shop'),
        children: [
          { index: true, element: <ShopToday /> },
          { path: 'counter', element: <Counter /> },
          { path: 'prices', element: <Prices /> },
          { path: 'slots', element: <Slots /> },
          { path: 'licence', element: <Licence /> },
          { path: 'report', element: <Report /> },
        ],
      },
      { path: '/gate', element: guard(<Gate />, 'gate') },
      {
        path: '/admin',
        element: guard(<AdminLayout />, 'admin'),
        children: [
          { index: true, element: <Overview /> },
          { path: 'licences', element: <Licences /> },
          { path: 'shops', element: <Shops /> },
          { path: 'clusters', element: <Clusters /> },
          { path: 'categories', element: <Categories /> },
          { path: 'team', element: <Members /> },
          { path: 'blocked', element: <Blocked /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
