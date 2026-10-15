import { Typography } from 'antd';
import { StarFilled } from '@ant-design/icons';
import { CSI_QUESTIONS } from '../csiQuestions';

interface Answer { key: string; answer: 'yes' | 'no' | 'other'; text?: string | null }

// Read-only recap of a submitted CSI survey — shared by the customer's own embedded card
// (RequestDetailPage), the admin/executor view of the same data, and the standalone
// /survey/:token thank-you screen, so a fix to how an answer renders only has to happen once.
// `answer: 'other'` is legacy-only (see csiQuestions.ts) — new submissions can't produce it, but
// old rows saved before that change still have it, so it stays supported here for display.
export default function CsiAnswersDisplay({
  answers, avgScore, comment,
}: {
  answers?: Answer[] | null;
  avgScore?: number | string | null;
  comment?: string | null;
}) {
  return (
    <div>
      {avgScore != null && (
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          Итоговый балл: <Typography.Text strong style={{ color: '#faad14' }}><StarFilled style={{ marginRight: 2 }} />{Number(avgScore)} / 5</Typography.Text>
        </div>
      )}
      {answers && answers.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {CSI_QUESTIONS.map((q) => {
            const a = answers.find((x) => x.key === q.key);
            const color = a?.answer === 'yes' ? '#52c41a' : a?.answer === 'no' ? '#ff4d4f' : '#d48806';
            const label = a?.answer === 'yes' ? 'Да' : a?.answer === 'no' ? 'Нет' : 'Свой вариант';
            return (
              <div key={q.key} style={{ padding: '6px 0' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 5 }} />
                  <span style={{ color: '#595959', flex: 1, lineHeight: 1.4 }}>{q.text}</span>
                  <span style={{ fontWeight: 700, color, flexShrink: 0, whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                {a?.text?.trim() && (
                  <div style={{ marginLeft: 15, marginTop: 2, fontSize: 12, color: '#8c8c8c', fontStyle: 'italic' }}>
                    «{a.text.trim()}»
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {comment && (
        <div style={{ marginTop: 8, padding: '10px 12px', background: '#fafafa', borderRadius: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Комментарий:</Typography.Text>
          <div style={{ marginTop: 2, fontSize: 13, color: '#555', fontStyle: 'italic' }}>«{comment}»</div>
        </div>
      )}
    </div>
  );
}
