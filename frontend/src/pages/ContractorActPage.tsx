import { useQuery } from '@tanstack/react-query';
import { Typography, Skeleton, Empty, Alert } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import api from '../api/client';
import ActGenerator from '../components/ActGenerator';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';
import '../analytics-glass.css';

export default function ContractorActPage() {
  const { user } = useAuth();
  // Own contractor plus, for a team lead, their direct reports' — a subordinate (has a
  // managerId) always gets an empty array back, even if they have their own contractor.
  const { data: team = [], isLoading } = useQuery({
    queryKey: ['my-team'],
    queryFn: () => api.get('/acts/my-team').then(r => r.data),
  });

  if (isLoading) return <Skeleton active />;

  // Admin previewing "as executor": their own account isn't linked to a contractor, so let
  // them pick one instead of showing the "not linked" dead end — same generator, admin-scoped.
  if (!team.length && user?.role === UserRole.ADMIN) {
    return (
      <div className="analytics-glass">
        <Typography.Title level={4} style={{ marginBottom: 16 }}>Акт приёма-передачи</Typography.Title>
        <Alert
          type="info"
          showIcon
          icon={<EyeOutlined />}
          message="Режим просмотра: ваш аккаунт администратора не привязан к подрядчику — выберите, чей кабинет предпросмотреть"
          style={{ marginBottom: 16 }}
        />
        <ActGenerator />
      </div>
    );
  }

  if (!team.length) {
    return (
      <Empty
        description="Ваш аккаунт не привязан к подрядчику — обратитесь к администратору"
        style={{ marginTop: 80 }}
      />
    );
  }

  return (
    <div className="analytics-glass">
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Акт приёма-передачи</Typography.Title>
      {team.length === 1 ? (
        <ActGenerator contractorId={team[0].id} contractorName={team[0].name} />
      ) : (
        <ActGenerator fixedContractors={team} />
      )}
    </div>
  );
}
