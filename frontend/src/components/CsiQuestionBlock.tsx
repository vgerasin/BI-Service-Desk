import { Typography, Button, Input, Space } from 'antd';
import type { CsiQuestion, CsiAnswerState, CsiAnswerValue } from '../csiQuestions';

const ANSWER_STYLES: Record<CsiAnswerValue, React.CSSProperties> = {
  yes: { background: '#f6ffed', borderColor: '#b7eb8f', color: '#52c41a' },
  no: { background: '#fff1f0', borderColor: '#ffccc7', color: '#ff4d4f' },
};
const ANSWER_LABELS: Record<CsiAnswerValue, string> = { yes: 'Да', no: 'Нет' };

export default function CsiQuestionBlock({
  index, question, value, onChange,
}: {
  index: number;
  question: CsiQuestion;
  value: CsiAnswerState;
  onChange: (next: CsiAnswerState) => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 8 }}>
        <Typography.Text strong style={{ fontSize: 14, display: 'block', lineHeight: 1.45 }}>
          {index + 1}. {question.text}
        </Typography.Text>
        {question.hint && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{question.hint}</Typography.Text>
        )}
      </div>
      <Space wrap size={8}>
        {(['yes', 'no'] as CsiAnswerValue[]).map(v => (
          <Button
            key={v}
            size="middle"
            style={{
              fontWeight: 600,
              ...(value.answer === v ? ANSWER_STYLES[v] : {}),
            }}
            onClick={() => onChange({ ...value, answer: v })}
          >
            {ANSWER_LABELS[v]}
          </Button>
        ))}
      </Space>
      <Input.TextArea
        rows={2}
        style={{ marginTop: 8 }}
        placeholder="Комментарий (необязательно)"
        value={value.text}
        onChange={e => onChange({ ...value, text: e.target.value })}
      />
    </div>
  );
}
