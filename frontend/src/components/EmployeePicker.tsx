import { useRef, useState } from 'react';
import { AutoComplete, Input, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import api from '../api/client';

export interface EmployeeOption {
  inn: string;
  fullName: string;
  position: string | null;
  email: string | null;
}

// Typeahead over /admin/employees/search (the HR directory, "База сотрудников") — types a
// surname/first name, picks a real person with an email. Only ever returns people who have an
// email (filtered server-side), which is exactly what callers of this component need it for.
export default function EmployeePicker({
  value, onChange, placeholder = 'Начните вводить фамилию или имя...',
}: {
  value: EmployeeOption | null;
  onChange: (employee: EmployeeOption | null) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value?.fullName ?? '');
  const [options, setOptions] = useState<{ value: string; label: React.ReactNode; employee: EmployeeOption }[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(q: string) {
    setText(q);
    if (value) onChange(null);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setOptions([]); return; }
    timer.current = setTimeout(async () => {
      const { data } = await api.get<EmployeeOption[]>('/admin/employees/search', { params: { q } });
      setOptions(data.map(e => ({
        value: e.fullName,
        employee: e,
        label: (
          <Space direction="vertical" size={0}>
            <span>{e.fullName}</span>
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>{e.position || '—'}</span>
          </Space>
        ),
      })));
    }, 300);
  }

  function handleSelect(_: string, option: any) {
    setText(option.employee.fullName);
    onChange(option.employee);
  }

  return (
    <AutoComplete value={text} options={options} onSearch={handleSearch} onSelect={handleSelect} style={{ width: '100%' }}>
      <Input.Search placeholder={placeholder} prefix={<SearchOutlined />} allowClear onSearch={() => {}} />
    </AutoComplete>
  );
}
