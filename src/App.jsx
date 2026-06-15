import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import UserLayout from './components/UserLayout';
import Home from './pages/Home';
import Order from './pages/Order';
import HistoryOrder from './pages/HistoryOrder';
import Profile from './pages/Profile';
import Deposit from './pages/Deposit';
import ClaimVoucher from './pages/ClaimVoucher';
import PaymentQris from './pages/PaymentQris';
import DepositHistory from './pages/DepositHistory';
import DepositDetail from './pages/DepositDetail';
import ActiveOrder from './pages/ActiveOrder';
import AdminUsers from './pages/admin/AdminUsers';
import AdminVouchers from './pages/admin/AdminVouchers';
import AdminOrders from './pages/admin/AdminOrders';
import AdminDeposits from './pages/admin/AdminDeposits';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminFeatures from './pages/admin/AdminFeatures';

// Layout Admin (Nanti di-slicing terpisah)
import AdminLayout from './components/AdminLayout';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UserLayout />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="order" element={<Order />} />
          <Route path="orders/:orderId" element={<ActiveOrder />} />
          <Route path="history" element={<HistoryOrder />} />
          <Route path="profile" element={<Profile />} />
          <Route path="deposit" element={<Deposit />} />
          <Route path="deposit/qris" element={<PaymentQris />} />
          <Route path="deposit/history" element={<DepositHistory />} />
          <Route path="deposit/history/:orderId" element={<DepositDetail />} />
          <Route path="claim-voucher" element={<ClaimVoucher />} />
          <Route path="active-order" element={<Navigate to="/history" replace />} />
          <Route path="hist.order" element={<Navigate to="/history" replace />} />
          <Route path="deposite" element={<Navigate to="/deposit" replace />} />
          <Route path="payment-qris" element={<Navigate to="/deposit" replace />} />
        </Route>

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="vouchers" element={<AdminVouchers />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="deposits" element={<AdminDeposits />} />
          <Route path="features" element={<AdminFeatures />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
