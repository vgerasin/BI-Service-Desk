import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button, Input, Spin, Typography, Divider } from 'antd';
import { CheckCircleFilled, StarFilled } from '@ant-design/icons';
import axios from 'axios';
import CsiQuestionBlock from '../components/CsiQuestionBlock';
import { APP_NAME } from '../branding';
import CsiAnswersDisplay from '../components/CsiAnswersDisplay';
import {
  CSI_QUESTIONS, makeCsiInitialAnswers, csiAllAnswered, csiScore, toCsiAnswerPayload,
} from '../csiQuestions';
import type { CsiAnswerValue } from '../csiQuestions';

const surveyApi = axios.create({ baseURL: '/api' });

type SubmittedAnswer = { key: string; answer: CsiAnswerValue; text?: string };

type SurveyData = {
  id: number;
  requestId: number;
  token: string;
  submittedAt: string | null;
  answers: SubmittedAnswer[] | null;
  comment: string | null;
  avgScore: number | null;
  request: { number: string; name: string } | null;
};

export default function SurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [answers, setAnswers] = useState(makeCsiInitialAnswers());
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, isError } = useQuery<SurveyData>({
    queryKey: ['survey', token],
    queryFn: () => surveyApi.get(`/ratings/survey/${token}`).then(r => r.data),
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: () => surveyApi.post(`/ratings/survey/${token}`, {
      answers: toCsiAnswerPayload(answers),
      comment: comment || undefined,
    }),
    onSuccess: () => setSubmitted(true),
  });

  const allAnswered = csiAllAnswered(answers);

  if (isLoading) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <Typography.Title level={4} style={{ color: '#ff4d4f' }}>Ссылка недействительна</Typography.Title>
            <Typography.Text type="secondary">Опрос не найден или ссылка устарела</Typography.Text>
          </div>
        </div>
      </div>
    );
  }

  if (submitted || data.submittedAt) {
    const finalAnswers: SubmittedAnswer[] = submitted
      ? toCsiAnswerPayload(answers)
      : (data.answers || []);
    const score = submitted ? csiScore(answers) : (data.avgScore ?? 0);
    const finalComment = submitted ? comment : data.comment;

    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <Logo />
          <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
            <CheckCircleFilled style={{ fontSize: 56, color: '#52c41a', marginBottom: 16, display: 'block' }} />
            <Typography.Title level={3} style={{ margin: '0 0 8px', color: '#1a1a1a' }}>
              Спасибо за вашу оценку!
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              Ваш отзыв поможет нам стать лучше
            </Typography.Text>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #fffbe6 0%, #fff7cc 100%)',
            borderRadius: 12, padding: '20px 24px', textAlign: 'center',
            border: '1px solid #ffe58f', marginBottom: 20,
          }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Итоговый балл</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <StarFilled style={{ color: '#faad14', fontSize: 20 }} />
              <span style={{ fontSize: 28, fontWeight: 800, color: '#d48806' }}>{score}</span>
              <span style={{ fontSize: 16, color: '#aaa', fontWeight: 400 }}>/ 5</span>
            </div>
          </div>

          <CsiAnswersDisplay answers={finalAnswers} comment={finalComment} />
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <Logo />
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={3} style={{ margin: '0 0 4px', color: '#1a1a1a', fontSize: 20 }}>
            Оценка выполнения заявки
          </Typography.Title>
          {data.request && (
            <div style={{ fontSize: 13, color: '#888' }}>
              <span style={{
                background: '#e6f4ff', color: '#1677ff', borderRadius: 4,
                padding: '2px 8px', fontWeight: 600, fontSize: 12, marginRight: 8,
              }}>
                {data.request.number}
              </span>
              {data.request.name}
            </div>
          )}
        </div>

        <Divider style={{ margin: '0 0 20px' }} />

        {CSI_QUESTIONS.map((q, i) => (
          <CsiQuestionBlock
            key={q.key}
            index={i}
            question={q}
            value={answers[q.key]}
            onChange={v => setAnswers(prev => ({ ...prev, [q.key]: v }))}
          />
        ))}

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#e6f4ff', borderRadius: 10, padding: '10px 14px', margin: '4px 0 20px', fontSize: 13, color: '#1677ff',
        }}>
          <span>Отвечено вопросов: {Object.values(answers).filter(a => a.answer).length} / 5</span>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {Object.values(answers).some(a => a.answer) ? csiScore(answers) : '—'} / 5
          </span>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Typography.Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
            Комментарий <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>(необязательно)</Typography.Text>
          </Typography.Text>
          <Input.TextArea
            rows={3}
            placeholder="Поделитесь вашими впечатлениями о работе команды..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            style={{ borderRadius: 8, resize: 'none' }}
          />
        </div>

        {!allAnswered && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            Пожалуйста, ответьте на все вопросы
          </Typography.Text>
        )}

        <Button
          type="primary"
          size="large"
          block
          disabled={!allAnswered}
          loading={submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          style={{
            background: allAnswered ? 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)' : undefined,
            border: 'none',
            height: 46,
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Отправить оценку
        </Button>

        {submitMutation.isError && (
          <Typography.Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 8, textAlign: 'center' }}>
            Ошибка при отправке. Попробуйте снова.
          </Typography.Text>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0,
      }}>
        BI
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>{APP_NAME}</div>
        <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.2 }}>Портал разработки Power BI</div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #f0f4ff 0%, #fff 60%, #f0fff4 100%)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '40px 16px 60px',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  padding: '32px 32px 28px',
  width: '100%',
  maxWidth: 560,
  boxShadow: '0 8px 40px rgba(0,0,0,0.10)',
};
