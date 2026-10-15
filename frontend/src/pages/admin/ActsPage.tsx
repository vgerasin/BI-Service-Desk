import { Typography } from 'antd';
import ActGenerator from '../../components/ActGenerator';
import '../../analytics-glass.css';

export default function ActsPage() {
  return (
    <div className="analytics-glass">
      <Typography.Title level={4} style={{ marginBottom: 16 }}>Акты приёма-передачи</Typography.Title>
      <ActGenerator />
    </div>
  );
}
