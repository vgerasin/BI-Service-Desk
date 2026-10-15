import { UserOutlined, TeamOutlined, BankOutlined, IdcardOutlined } from '@ant-design/icons';
import { useAuth } from '../../contexts/AuthContext';
import { UserRole } from '../../types';
import { useFeatures } from '../../hooks/useFeatures';
import TabsHub from '../../components/TabsHub';
import UsersPage from './UsersPage';
import ContractorsPage from './ContractorsPage';
import CustomersPage from './CustomersPage';
import EmployeesPage from './EmployeesPage';

/** «Команда»: everyone the system knows about — users, contractors, customers, employee directory. */
export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;
  const { hrDirectory } = useFeatures();

  return (
    <TabsHub
      tabs={[
        { key: 'users', label: <span><UserOutlined /> Пользователи</span>, element: <UsersPage />, hidden: !isAdmin },
        { key: 'contractors', label: <span><TeamOutlined /> Подрядчики</span>, element: <ContractorsPage /> },
        { key: 'customers', label: <span><BankOutlined /> Заказчики</span>, element: <CustomersPage />, hidden: !isAdmin },
        { key: 'employees', label: <span><IdcardOutlined /> Сотрудники</span>, element: <EmployeesPage />, hidden: !isAdmin || !hrDirectory },
      ]}
    />
  );
}
