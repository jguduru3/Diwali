import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { Area } from '@pataka/shared';
import { RequireRole } from './auth/RequireRole';
import { GameRedirect } from './components/BeaFloat';
import { Layout } from './components/Layout';
import { About } from './routes/About';
import { Account } from './routes/Account';
import { AdminLayout } from './routes/admin/AdminLayout';
import { Blocked } from './routes/admin/Blocked';
import { Categories } from './routes/admin/Categories';
import { Clusters } from './routes/admin/Clusters';
import { AdminDocuments } from './routes/admin/Documents';
import { Licences } from './routes/admin/Licences';
import { Members } from './routes/admin/Members';
import { AdminOrders } from './routes/admin/Orders';
import { Overview } from './routes/admin/Overview';
import {
  AdminAgents,
  AdminFeedback,
  AdminPayouts,
  AdminSubscriptions,
} from './routes/admin/Growth';
import { Shops } from './routes/admin/Shops';
import { Home } from './routes/customer/Home';
import { KitsPage } from './routes/customer/KitsPage';
import { MockPayPage } from './routes/customer/MockPayPage';
import { OrderPage } from './routes/customer/OrderPage';
import { OrdersPage } from './routes/customer/OrdersPage';
import { PlanPage } from './routes/customer/PlanPage';
import { CartPage } from './routes/customer/CartPage';
import { settings } from './lib/settings';
import { InductionPage } from './routes/growth/InductionPage';
import { ShopPage } from './routes/customer/ShopPage';
import { Gate } from './routes/gate/Gate';
import { AgentPage } from './routes/growth/AgentPage';
import { OwnerApprovePage, OwnerReviewPage } from './routes/growth/OwnerPages';
import { TermsPage } from './routes/growth/TermsPage';
import { Login } from './routes/Login';
import { MerchantStart } from './routes/MerchantStart';
import { NotFound } from './routes/NotFound';
import { Counter } from './routes/shop/Counter';
import { Hours } from './routes/shop/Hours';
import { Licence } from './routes/shop/Licence';
import { Packing } from './routes/shop/Packing';
import { Payments } from './routes/shop/Payments';
import { Poster } from './routes/shop/Poster';
import { Prices } from './routes/shop/Prices';
import { Report } from './routes/shop/Report';
import { ShopHome } from './routes/shop/ShopHome';
import { ShopGuard } from './routes/shop/ShopLayout';

const guard = (el: ReactNode, area?: Area) => <RequireRole area={area}>{el}</RequireRole>;

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/s/:code', element: <ShopPage /> },
      { path: '/s/:code/plan', element: <PlanPage /> },
      { path: '/cart', element: <CartPage /> },
      ...(settings.gameEnabled ? [{ path: '/play', element: <GameRedirect /> }] : []),
      { path: '/induction', element: <InductionPage /> },
      { path: '/orders', element: guard(<OrdersPage />) },
      { path: '/orders/:id', element: guard(<OrderPage />) },
      // The ₹30 fee checkout checks the customer itself; a subscription checkout needs no sign-in.
      { path: '/pay/mock/:checkoutId', element: <MockPayPage /> },
      { path: '/kits/:type', element: <KitsPage /> },
      { path: '/terms/:party', element: <TermsPage /> },
      { path: '/m/approve/:token', element: <OwnerApprovePage /> },
      { path: '/m/review/:token', element: <OwnerReviewPage /> },
      // Open to visitors: the agent intro explains the role before anyone signs in.
      { path: '/agent', element: <AgentPage /> },
      { path: '/about', element: <About /> },
      { path: '/login', element: <Login /> },
      { path: '/merchant', element: <MerchantStart /> },
      { path: '/account', element: guard(<Account />) },
      {
        path: '/shop',
        element: <ShopGuard />,
        children: [
          { index: true, element: <ShopHome /> },
          { path: 'packing', element: <Packing /> },
          { path: 'counter', element: <Counter /> },
          { path: 'prices', element: <Prices /> },
          { path: 'hours', element: <Hours /> },
          { path: 'payments', element: <Payments /> },
          { path: 'licence', element: <Licence /> },
          { path: 'report', element: <Report /> },
          { path: 'poster', element: <Poster /> },
        ],
      },
      { path: '/gate', element: guard(<Gate />, 'gate') },
      {
        path: '/admin',
        element: guard(<AdminLayout />, 'admin'),
        children: [
          { index: true, element: <Overview /> },
          { path: 'orders', element: <AdminOrders /> },
          { path: 'licences', element: <Licences /> },
          { path: 'documents', element: <AdminDocuments /> },
          { path: 'shops', element: <Shops /> },
          { path: 'clusters', element: <Clusters /> },
          { path: 'categories', element: <Categories /> },
          { path: 'team', element: <Members /> },
          { path: 'blocked', element: <Blocked /> },
          { path: 'agents', element: <AdminAgents /> },
          { path: 'payouts', element: <AdminPayouts /> },
          { path: 'subscriptions', element: <AdminSubscriptions /> },
          { path: 'feedback', element: <AdminFeedback /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
